/**
 * Inline links in short plain-text notes (scene footnotes).
 *
 * Links are stored in the text itself as `[label](https://…)`; bare `http(s)://`
 * URLs are links too and display shortened (`host/…`). Only http(s) URLs ever
 * become links, so a stored note cannot produce a `javascript:` href.
 */

export type NoteSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/;

/** `www.example.com/a/b` → `example.com/…`; falls back to the raw URL. */
export function shortUrlLabel(url: string): string {
  try {
    const { hostname, pathname, search, hash } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    return pathname.length > 1 || search || hash ? `${host}/…` : host;
  } catch {
    return url;
  }
}

/** Split a note into text and link segments, in order. */
export function parseNoteLinks(note: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (text) segments.push({ kind: 'text', text });
  };
  for (const match of note.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    let consumed = match[0];
    if (match[1] && match[2]) {
      pushText(note.slice(last, start));
      segments.push({ kind: 'link', text: match[1], href: match[2] });
    } else {
      const href = match[3].replace(TRAILING_PUNCTUATION, '');
      consumed = href;
      pushText(note.slice(last, start));
      segments.push({ kind: 'link', text: shortUrlLabel(href), href });
    }
    last = start + consumed.length;
  }
  pushText(note.slice(last));
  return segments;
}

/** Characters a reader sees (link labels, shortened bare URLs) — not the raw markup. */
export function visibleNoteLength(note: string): number {
  return parseNoteLinks(note).reduce((n, s) => n + s.text.length, 0);
}

/** Normalize a typed URL: trims and adds `https://` when no scheme is given. Null if unusable. */
export function normalizeLinkUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('.') || parsed.hostname === 'localhost' ? url : null;
  } catch {
    return null;
  }
}

/** Markdown link for `label` → `url`; brackets in the label are dropped so it parses back. */
export function formatNoteLink(label: string, url: string): string {
  return `[${label.replace(/[[\]\n]/g, '').trim()}](${url})`;
}
