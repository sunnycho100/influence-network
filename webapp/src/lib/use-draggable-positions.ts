import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from './graph-layout';

export interface NodePos {
  x: number;
  y: number;
}

const REPEL_DIST = 92;          // collision radius (canvas units)
const ANCHOR_PULL = 0.18;       // spring strength back toward layout position
const COLLISION_PUSH = 0.55;    // how aggressively collisions resolve per tick
const SETTLE_EPSILON = 0.05;    // stop animating when total motion < this
const MAX_TICK_MS = 32;         // clamp dt to avoid huge jumps

/**
 * Per-node position state with light physics:
 * - Each node has an anchor (the computed layout position).
 * - Non-dragged nodes are spring-pulled back to their anchor every frame.
 * - Pairs within REPEL_DIST get pushed apart (collision).
 * - The dragged node is pinned to the pointer; "me" is pinned to its anchor.
 *
 * Result: nodes hold their orbit and only get nudged when the dragged node
 * collides with them, then drift back to position when the collision passes.
 */
export function useDraggableNodePositions(layoutNodes: GraphNode[]) {
  const [positions, setPositions] = useState<Record<string, NodePos>>({});
  const positionsRef = useRef<Record<string, NodePos>>({});
  const anchorsRef = useRef<Record<string, NodePos>>({});
  const draggingIdRef = useRef<string | null>(null);
  const dragTargetRef = useRef<NodePos | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // Sync anchors + initial positions whenever the node set changes.
  const idsKey = layoutNodes.map((n) => n.id).join('|');
  useEffect(() => {
    const anchors: Record<string, NodePos> = {};
    const pos: Record<string, NodePos> = {};
    for (const n of layoutNodes) {
      anchors[n.id] = { x: n.x, y: n.y };
      // Preserve current position if the node already existed; otherwise seed from anchor.
      pos[n.id] = positionsRef.current[n.id] ?? { x: n.x, y: n.y };
    }
    anchorsRef.current = anchors;
    positionsRef.current = pos;
    setPositions(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const stepPhysics = useCallback(
    (dtMs: number) => {
      const dt = Math.min(dtMs, MAX_TICK_MS) / 16; // normalize to ~60fps frames
      const pos = { ...positionsRef.current };
      const anchors = anchorsRef.current;
      const draggingId = draggingIdRef.current;
      const dragTarget = dragTargetRef.current;

      let totalMotion = 0;

      // 1) Pin special nodes (dragged + "me").
      if (draggingId && dragTarget) {
        pos[draggingId] = { x: dragTarget.x, y: dragTarget.y };
      }
      if (anchors['me']) {
        pos['me'] = { x: anchors['me'].x, y: anchors['me'].y };
      }

      // 2) Anchor spring pull (skip dragged + "me").
      for (const node of layoutNodes) {
        if (node.id === draggingId || node.id === 'me') continue;
        const a = anchors[node.id];
        const p = pos[node.id];
        if (!a || !p) continue;
        const dx = (a.x - p.x) * ANCHOR_PULL * dt;
        const dy = (a.y - p.y) * ANCHOR_PULL * dt;
        pos[node.id] = { x: p.x + dx, y: p.y + dy };
        totalMotion += Math.abs(dx) + Math.abs(dy);
      }

      // 3) Collision resolution (skip "me" — it never moves).
      for (let i = 0; i < layoutNodes.length; i += 1) {
        const a = layoutNodes[i]!;
        for (let j = i + 1; j < layoutNodes.length; j += 1) {
          const b = layoutNodes[j]!;
          const pa = pos[a.id];
          const pb = pos[b.id];
          if (!pa || !pb) continue;
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist >= REPEL_DIST) continue;
          const overlap = (REPEL_DIST - dist) * COLLISION_PUSH;
          const nx = dx / dist;
          const ny = dy / dist;

          const aLocked = a.id === draggingId || a.id === 'me';
          const bLocked = b.id === draggingId || b.id === 'me';

          if (aLocked && bLocked) continue;
          if (aLocked) {
            pos[b.id] = { x: pb.x + nx * overlap, y: pb.y + ny * overlap };
            totalMotion += overlap;
          } else if (bLocked) {
            pos[a.id] = { x: pa.x - nx * overlap, y: pa.y - ny * overlap };
            totalMotion += overlap;
          } else {
            const half = overlap / 2;
            pos[a.id] = { x: pa.x - nx * half, y: pa.y - ny * half };
            pos[b.id] = { x: pb.x + nx * half, y: pb.y + ny * half };
            totalMotion += overlap;
          }
        }
      }

      positionsRef.current = pos;
      setPositions(pos);
      return totalMotion;
    },
    [layoutNodes],
  );

  const ensureRunning = useCallback(() => {
    if (rafRef.current !== null) return;
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      const motion = stepPhysics(dt);
      const stillDragging = draggingIdRef.current !== null;
      if (stillDragging || motion > SETTLE_EPSILON) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stepPhysics]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const moveNode = useCallback(
    (_id: string, x: number, y: number) => {
      dragTargetRef.current = { x, y };
      ensureRunning();
    },
    [ensureRunning],
  );

  const beginDrag = useCallback(
    (id: string) => {
      if (id === 'me') return;
      draggingIdRef.current = id;
      const current = positionsRef.current[id];
      dragTargetRef.current = current ? { ...current } : null;
      ensureRunning();
    },
    [ensureRunning],
  );

  const endDrag = useCallback(() => {
    draggingIdRef.current = null;
    dragTargetRef.current = null;
    ensureRunning(); // let nodes settle back to anchors
  }, [ensureRunning]);

  const memoPositions = useMemo(() => positions, [positions]);

  return {
    positions: memoPositions,
    moveNode,
    beginDrag,
    endDrag,
    draggingIdRef,
  };
}
