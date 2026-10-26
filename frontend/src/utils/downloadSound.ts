import { API_BASE_URL } from '@/utils/constants';

const DEFAULT_SOUND_FILENAME = 'sound';
const DEFAULT_SOUND_EXTENSION = '.wav';
const MAX_FILENAME_LENGTH = 80;
const URL_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,5}$/;
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

function resolveSoundUrl(url: string): string {
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  return `${API_BASE_URL}${url}`;
}

/** Builds a filesystem-safe file name (with extension) for a sound download. */
export function buildSoundFilename(name: string, url: string, variantLabel?: string): string {
  const pathname = url.split(/[?#]/)[0];
  const extension = pathname.match(URL_EXTENSION_PATTERN)?.[0] ?? DEFAULT_SOUND_EXTENSION;
  const base = name
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .trim() || DEFAULT_SOUND_FILENAME;
  return `${base}${variantLabel ? ` (${variantLabel})` : ''}${extension}`;
}

/** Downloads a sound's original audio file (the exact bytes, not a re-encoded buffer). */
export async function downloadSoundFile(url: string, filename: string): Promise<void> {
  const response = await fetch(resolveSoundUrl(url), { credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to download sound: ${response.statusText || response.status}`);
  const blob = await response.blob();

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
