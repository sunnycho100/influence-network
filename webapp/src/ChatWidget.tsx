import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatCitation } from '@alumni-graph/shared';

import { extensionClient } from './lib/extension-client';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: ChatCitation[];
  usedLlm?: boolean;
  error?: boolean;
}

interface ChatWidgetProps {
  onSelectProfile?: (profileId: string) => void;
}

const SUGGESTIONS = [
  'Who should I contact for Amazon experiences?',
  'Anyone at UW-Madison?',
  'Find people working in machine learning.',
];

export function ChatWidget({ onSelectProfile }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const submit = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || sending) return;

      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: question,
      };
      setTurns((prev) => [...prev, userTurn]);
      setInput('');
      setSending(true);

      try {
        const result = await extensionClient.chatQuery(question);
        const assistantTurn: ChatTurn = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: result.answer,
          citations: result.citations,
          usedLlm: result.usedLlm,
        };
        setTurns((prev) => [...prev, assistantTurn]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat request failed';
        setTurns((prev) => [
          ...prev,
          {
            id: `a-err-${Date.now()}`,
            role: 'assistant',
            text: message,
            error: true,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void submit(input);
      }
    },
    [input, submit],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open network chat"
        className="fixed bottom-5 right-5 z-40 h-10 px-4 inline-flex items-center gap-2 bg-surface border border-hairline hover:border-accent/60 transition-colors font-mono text-[10px] tracking-[0.18em] uppercase text-ink-1 hover:text-ink-0"
      >
        <span
          className="block w-[6px] h-[6px]"
          style={{ background: '#38BDF8' }}
          aria-hidden
        />
        Ask network
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[340px] sm:w-[380px] bg-surface border border-hairline shadow-[0_18px_40px_-20px_rgba(0,0,0,0.85)] flex flex-col" style={{ maxHeight: 'min(540px, calc(100vh - 40px))' }}>
      {/* Header */}
      <div className="flex items-center justify-between h-9 px-3 border-b border-hairline shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="block w-[6px] h-[6px]"
            style={{ background: '#38BDF8' }}
            aria-hidden
          />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-1">
            Ask network
          </span>
        </div>
        <div className="flex items-center">
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => setTurns([])}
              className="px-2 h-8 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 hover:text-ink-0 transition-colors"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="px-2 h-8 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 hover:text-ink-0 transition-colors border-l border-hairline"
          >
            ×
          </button>
        </div>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-[160px]"
      >
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-[12px] text-ink-2 leading-relaxed">
              Ask about people in your local network. Try one of these:
            </p>
            <div className="flex flex-col gap-1">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void submit(suggestion)}
                  className="text-left text-[12px] text-ink-1 hover:text-ink-0 px-2 py-1 border border-hairline hover:border-accent/60 transition-colors bg-transparent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <ChatBubble
              key={turn.id}
              turn={turn}
              {...(onSelectProfile ? { onSelectProfile } : {})}
            />
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 text-ink-3 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span className="inline-block w-[6px] h-[6px] bg-ink-3 animate-pulse" />
            thinking…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-hairline px-3 py-2 shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Ask about your network…"
          disabled={sending}
          className="w-full resize-none bg-transparent text-[12px] text-ink-1 placeholder:text-ink-3 focus:outline-none leading-snug"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-ink-3">
            Enter to send · Shift+Enter for newline
          </span>
          <button
            type="button"
            onClick={() => void submit(input)}
            disabled={sending || !input.trim()}
            className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-1 hover:text-ink-0 disabled:text-ink-4 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  turn,
  onSelectProfile,
}: {
  turn: ChatTurn;
  onSelectProfile?: (profileId: string) => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 bg-ink-0 text-surface text-[12px] leading-relaxed whitespace-pre-wrap">
          {turn.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={[
          'max-w-[92%] px-3 py-2 border text-[12px] leading-relaxed whitespace-pre-wrap',
          turn.error
            ? 'border-red-500/40 text-red-300/90'
            : 'border-hairline text-ink-1',
        ].join(' ')}
      >
        {turn.text}
      </div>
      {turn.citations && turn.citations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {turn.citations.map((citation) => (
            <button
              key={citation.profileId}
              type="button"
              onClick={() => onSelectProfile?.(citation.profileId)}
              title={citation.reason}
              className="px-2 py-1 border border-hairline hover:border-accent/60 transition-colors font-mono text-[10px] tracking-[0.12em] uppercase text-ink-2 hover:text-ink-0"
            >
              {citation.name}
            </button>
          ))}
        </div>
      )}
      {turn.usedLlm === false && !turn.error && turn.citations && turn.citations.length > 0 && (
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-ink-3">
          Local match · add a Gemini API key in the extension for richer answers
        </span>
      )}
    </div>
  );
}
