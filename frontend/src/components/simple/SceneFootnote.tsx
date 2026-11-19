'use client';

import {
  useCallback, useLayoutEffect, useRef, useState,
  type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent,
} from 'react';
import { Link2 } from 'lucide-react';
import { useAnalysisStore } from '@/store';
import { useCanEdit } from '@/hooks/useCanEdit';
import { useIsMac } from '@/hooks/useIsMac';
import { hasModKey } from '@/lib/shortcuts/keyboard-utils';
import { formatShortcutKeys } from '@/utils/platform';
import {
  formatNoteLink, normalizeLinkUrl, parseNoteLinks, visibleNoteLength,
} from '@/utils/footnoteLinks';
import { SIMPLE_MODE } from '@/utils/constants';

export interface SceneFootnoteProps {
  usageIndex: number;
  footnote?: string;
}

/**
 * SceneFootnote
 *
 * Optional footnote at the bottom-left of a scene panel (the spot of a simulation
 * card's "Solved in …" line), saved as the usage card's `footnote`. Shown in full
 * (wraps), with inline links: `[label](https://…)` and bare URLs open in a new tab.
 * Click the text to edit (Enter / focus leaving the editor saves, Esc cancels, empty
 * clears); select words and press Ctrl/Cmd+K or the link button to link them.
 * Read-only in the share view, where an empty footnote renders nothing.
 *
 * Usage:
 * ```tsx
 * <BubblePanel footerNote={<SceneFootnote usageIndex={i} footnote={config.footnote} />} … />
 * ```
 */
export function SceneFootnote({ usageIndex, footnote }: SceneFootnoteProps) {
  const canEdit = useCanEdit();
  const [isEditing, setIsEditing] = useState(false);

  const save = useCallback((text: string) => {
    useAnalysisStore.getState().handleUpdateConfig(usageIndex, { footnote: text.trim() || undefined });
    setIsEditing(false);
  }, [usageIndex]);

  if (isEditing) {
    return (
      <FootnoteEditor
        initialValue={footnote ?? ''}
        onSave={save}
        onCancel={() => setIsEditing(false)}
      />
    );
  }
  if (!canEdit) {
    return footnote ? <div className="whitespace-pre-wrap break-words"><FootnoteText text={footnote} /></div> : null;
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={`cursor-text whitespace-pre-wrap break-words text-left hover:text-foreground ${footnote ? '' : 'italic opacity-70'}`}
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsEditing(true);
        }
      }}
      title="Click to edit"
    >
      {footnote ? <FootnoteText text={footnote} /> : SIMPLE_MODE.SCENE_FOOTNOTE_PLACEHOLDER}
    </div>
  );
}

/** Read-only footnote text with its inline links (open in a new tab). */
export function FootnoteText({ text }: { text: string }) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <>
      {parseNoteLinks(text).map((seg, i) => (seg.kind === 'link' ? (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          title={seg.href}
          className="text-blue-text underline underline-offset-2 hover:opacity-80"
          onClick={stop}
        >
          {seg.text}
        </a>
      ) : <span key={i}>{seg.text}</span>))}
    </>
  );
}

interface FootnoteEditorProps {
  initialValue: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

function FootnoteEditor({ initialValue, onSave, onCancel }: FootnoteEditorProps) {
  const isMac = useIsMac();
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialValue);
  const [hasSelection, setHasSelection] = useState(false);
  /** Selection being linked while the URL field is open. */
  const [linkRange, setLinkRange] = useState<{ start: number; end: number } | null>(null);
  const [url, setUrl] = useState('');
  const [urlInvalid, setUrlInvalid] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value, linkRange]);

  const fits = (text: string) =>
    text.length <= SIMPLE_MODE.SCENE_FOOTNOTE_MAX_STORED_CHARS
    && visibleNoteLength(text) <= SIMPLE_MODE.SCENE_FOOTNOTE_MAX_CHARS;

  const syncSelection = () => {
    const el = textRef.current;
    setHasSelection(!!el && el.selectionStart !== el.selectionEnd);
  };

  const openLink = () => {
    const el = textRef.current;
    if (!el) return;
    setLinkRange({ start: el.selectionStart, end: el.selectionEnd });
    setUrl('');
    setUrlInvalid(false);
  };

  // Focus the textarea before the URL field unmounts, so its blur stays inside the editor.
  const closeLink = () => {
    const range = linkRange;
    textRef.current?.focus();
    setLinkRange(null);
    pendingCaret.current = range ? range.end : null;
  };

  const applyLink = () => {
    if (!linkRange) return;
    const href = normalizeLinkUrl(url);
    if (!href) {
      setUrlInvalid(true);
      return;
    }
    const { start, end } = linkRange;
    const label = value.slice(start, end);
    const inserted = label.trim() ? formatNoteLink(label, href) : href;
    const next = value.slice(0, start) + inserted + value.slice(end);
    if (!fits(next)) {
      setUrlInvalid(true);
      return;
    }
    textRef.current?.focus();
    setValue(next);
    setLinkRange(null);
    pendingCaret.current = start + inserted.length;
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.replace(/\n/g, ' ');
    if (next.length <= value.length || fits(next)) setValue(next);
  };

  const handleTextKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (hasModKey(e) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSave(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleUrlKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeLink();
    }
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && rootRef.current?.contains(e.relatedTarget)) return;
    onSave(value);
  };

  const shortcut = formatShortcutKeys(SIMPLE_MODE.SCENE_FOOTNOTE_LINK_SHORTCUT, isMac);

  return (
    <div ref={rootRef} className="flex flex-col gap-1" onBlur={handleBlur}>
      <div className="flex items-start gap-1">
        <textarea
          ref={textRef}
          value={value}
          rows={1}
          autoFocus
          onChange={handleChange}
          onKeyDown={handleTextKeyDown}
          onSelect={syncSelection}
          placeholder={SIMPLE_MODE.SCENE_FOOTNOTE_PLACEHOLDER}
          className="bubble-panel__title-input text-xxs text-foreground resize-none overflow-hidden"
          aria-label="Scene footnote"
        />
        <button
          type="button"
          className="bubble-panel__icon-btn shrink-0"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLink}
          disabled={!hasSelection && !linkRange}
          title={`${SIMPLE_MODE.SCENE_FOOTNOTE_LINK_TITLE} (${shortcut})`}
          aria-label={SIMPLE_MODE.SCENE_FOOTNOTE_LINK_TITLE}
        >
          <Link2 size={12} />
        </button>
      </div>
      {linkRange && (
        <div className="flex items-center gap-1">
          <input
            type="url"
            value={url}
            autoFocus
            onChange={(e) => { setUrl(e.target.value); setUrlInvalid(false); }}
            onKeyDown={handleUrlKeyDown}
            placeholder={SIMPLE_MODE.SCENE_FOOTNOTE_LINK_PLACEHOLDER}
            className="bubble-panel__title-input text-xxs text-foreground"
            aria-label="Link address"
            aria-invalid={urlInvalid}
            title={urlInvalid ? SIMPLE_MODE.SCENE_FOOTNOTE_LINK_INVALID : undefined}
          />
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 text-xxs bg-primary text-on-blue hover:bg-primary-hover"
            onClick={applyLink}
          >
            {SIMPLE_MODE.SCENE_FOOTNOTE_LINK_APPLY}
          </button>
        </div>
      )}
    </div>
  );
}
