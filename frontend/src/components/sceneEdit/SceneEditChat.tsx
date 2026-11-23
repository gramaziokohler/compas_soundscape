'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSceneEditChat } from '@/hooks/useSceneEditChat';
import { isModEnter } from '@/lib/shortcuts/keyboard-utils';
import { SCENE_EDIT } from '@/utils/constants';
import { SceneChatMessageItem } from './SceneChatMessageItem';

export interface SceneEditChatProps {
  /** Scene (scenario usage card) index. */
  usageIndex: number;
  /** Focus the message box on mount. */
  autoFocus?: boolean;
}

/**
 * SceneEditChat Component
 *
 * Persistent per-scene chat that edits a generated sound scene: each message is
 * planned by the edit agent, applied as one undo step, then the needed sounds are
 * generated and the timeline re-orchestrated. Shared by the Simple-mode chat
 * panel and the Expert scenario card.
 *
 * Usage:
 * ```tsx
 * <SceneEditChat usageIndex={scene.usageIndex} autoFocus />
 * ```
 */
export function SceneEditChat({ usageIndex, autoFocus }: SceneEditChatProps) {
  const { state, send, cancel } = useSceneEditChat(usageIndex);
  const { messages, turn, ready, canSend, canEdit } = state;
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Follow the conversation: a new message or reply update scrolls to the bottom.
  useEffect(() => {
    const timer = setTimeout(() => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    }, SCENE_EDIT.SCROLL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [messages.length, last?.text, last?.changes?.length, turn?.phase]);

  const submit = (text = draft) => {
    if (!canSend || !text.trim()) return;
    send(text);
    setDraft('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isModEnter(e) || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="scene-chat">
      {messages.length > 0 ? (
        <div ref={listRef} className="scene-chat__list" aria-live="polite">
          {messages.map((m) => (
            <SceneChatMessageItem key={m.id} message={m} turn={turn?.turnId === m.id ? turn : null} />
          ))}
        </div>
      ) : (
        <EmptyState message={ready ? SCENE_EDIT.EMPTY_HINT : SCENE_EDIT.NOT_READY} />
      )}

      {canEdit && messages.length === 0 && ready && (
        <div className="scene-chat__examples">
          {SCENE_EDIT.EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="bubble-chip"
              disabled={!canSend}
              onClick={() => setDraft(example)}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="scene-chat__composer">
          <textarea
            ref={inputRef}
            className="bubble-composer__input"
            rows={2}
            maxLength={SCENE_EDIT.MESSAGE_MAX_CHARS}
            placeholder={SCENE_EDIT.COMPOSER_PLACEHOLDER}
            value={draft}
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Ask for a change to this scene"
          />
          {turn?.phase === 'planning' ? (
            <button type="button" className="bubble-chip" onClick={cancel} title="Stop planning this edit">
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="bubble-send"
              onClick={() => submit()}
              disabled={!canSend || !draft.trim()}
              aria-label="Send"
              title="Apply this change (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
