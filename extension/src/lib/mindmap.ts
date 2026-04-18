import { buildMindMapData, type MindMapData } from '@alumni-graph/shared';

import { getGraphSnapshot } from './db';

export async function getExtensionMindMap(): Promise<MindMapData> {
  const snapshot = await getGraphSnapshot();
  return buildMindMapData(snapshot);
}
