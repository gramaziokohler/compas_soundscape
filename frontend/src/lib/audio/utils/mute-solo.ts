/**
 * Track-level mute/solo resolution shared by the engine sync, playing visuals,
 * sound cards and the exporter.
 *
 * Both sets hold EVERY variant sound id of a muted/soloed track (see
 * `handleMute` / `handleSolo` in audioControlsStore), so a clip that plays a
 * variant override follows its track. Several tracks can be soloed at once:
 * while any solo is active, only soloed tracks are audible.
 */
export function isSoundSilenced(
  soundId: string,
  mutedSounds: ReadonlySet<string>,
  soloedSounds: ReadonlySet<string>,
): boolean {
  if (soloedSounds.size > 0) return !soloedSounds.has(soundId);
  return mutedSounds.has(soundId);
}
