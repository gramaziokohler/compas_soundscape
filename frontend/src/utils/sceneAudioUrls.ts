/**
 * Audio files a scene can delete from the backend when its sounds are replaced.
 *
 * Returns the (non-blob) URLs of the events the scene owns (`isOwned` on the
 * event's `prompt_index`) that NO other event still plays. A duplicated scene
 * shares its source's files, so refreshing one scene must not delete audio the
 * other still uses.
 *
 * Usage:
 * ```ts
 * const urls = collectUnsharedSceneAudioUrls(
 *   [...(store.soundscapeData ?? []), ...store.generatedSounds],
 *   (pi) => linkedSoundIndices.some((i) => promptMatchesCard(pi, i)),
 * );
 * await apiService.deleteGeneratedSounds(urls);
 * ```
 */
export function collectUnsharedSceneAudioUrls(
  events: ReadonlyArray<{ url?: unknown; prompt_index?: number | null }>,
  isOwned: (promptIndex: number | null | undefined) => boolean,
): string[] {
  const isFileUrl = (u: unknown): u is string => typeof u === 'string' && u.length > 0 && !u.startsWith('blob:');
  const owned = new Set<string>();
  const usedElsewhere = new Set<string>();
  for (const e of events) {
    if (!isFileUrl(e.url)) continue;
    (isOwned(e.prompt_index) ? owned : usedElsewhere).add(e.url);
  }
  return [...owned].filter((u) => !usedElsewhere.has(u));
}
