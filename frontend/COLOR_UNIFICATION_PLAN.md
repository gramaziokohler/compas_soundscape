# Color System Unification Plan

**Goal:** Single source of truth for all colors — `globals.css` CSS custom properties.  
**Rule:** No hardcoded hex/rgb in TypeScript/JSX. No near-duplicate CSS vars. Use existing semantic vars wherever possible.

---

## Color Mapping Reference

| Old constant / value | CSS var to use | Notes |
|---|---|---|
| `PRIMARY_COLOR = '#2F2FE4'` | `--color-primary` | ✅ Removed |
| `DARK_MODE.LIGHT_COLOR = '#2F2FE4'` | `--color-primary` | ✅ Removed |
| `DARK_MODE.LIGHT_COLOR_HEX = 0x2F2FE4` | `getCssColorHex('--color-primary')` | ✅ Removed |
| `--color-dark-mode-accent: #1a15c0` | `--color-primary` | ✅ Removed (duplicate blue) |
| `RECEIVER_CONFIG.COLOR = 0xf0a938` | `getCssColorHex('--color-receiver')` | ✅ Removed |
| `GRID_LISTENER_CONFIG.COLOR` | `getCssColorHex('--color-receiver')` | ✅ Removed |
| `OBJECT_LABEL.BG_COLOR = 'rgba(20,20,20,0.80)'` | inlined directly | ✅ Removed |
| `OBJECT_LABEL.TEXT_COLOR = '#ffffff'` | `'white'` inlined | ✅ Removed |
| `IMPACT_MATERIALS.*.color` | `getMaterialColorByAbsorption()` | ✅ Removed |
| `PLAYBACK_CONTROLS.PRIMARY_PINK` etc. | deleted (unused) | ✅ Removed |
| `SIMULATION_MISMATCH_COLOR_HEX = 0xFF6666` | `getCssColorHex('--color-error')` | ✅ Removed |
| `AREA_DRAWING.LINE_COLOR = 0x10B981` | `getCssColorHex('--color-success')` | ✅ Removed |
| `AREA_DRAWING.FILL_COLOR_DEFAULT = 0xd1fae5` | `getCssColorHex('--color-success-light')` | ✅ Removed |
| `AREA_DRAWING.FILL_COLOR_GENERATED = 0x059669` | `getCssColorHex('--color-success-hover')` | ✅ Removed |
| `AREA_DRAWING.POINT_PREVIEW_COLOR = 0x10B981` | `getCssColorHex('--color-success')` | ✅ Removed |
| `'#10B981'` (GridListenerContent bg) | `color-mix(in srgb, var(--color-success) 80%, transparent)` | ✅ Fixed |
| `'#10B981'` (GridListenerContent btn) | `'var(--color-success)'` | ✅ Fixed |
| `'#6b7280'` (GridListenerContent) | `'var(--color-secondary-hover)'` | ✅ Fixed |
| `'#9CA3AF'` (SEDWaveformPlayer) | `'var(--color-secondary-hover)'` | ✅ Fixed |
| `'rgba(16, 185, 129, 0.85)'` (canvas pill) | `getComputedStyle` + `color-mix` | ✅ Fixed |
| `'#ffffff'` (TextContextContent) | `'white'` | ✅ Fixed |
| `bg-blue-100 text-blue-800 …` (ImpulseResponseUpload badges) | `bg-info-light text-info` | ✅ Fixed |
| `bg-red-* border-red-* text-red-*` (ImpulseResponseUpload errors) | `bg-error/* border-error text-error` | ✅ Fixed |
| `bg-red-900/20` (WaveSurferTimeline) | `bg-error/10 border-error/30 text-error` | ✅ Fixed |
| `bg-blue-100 hover:bg-blue-200` (VirtualTreeItem) | `bg-info-light hover:bg-info/20` | ✅ Fixed |
| `var(--color-error, #ef4444)` fallback | `var(--color-error)` (no fallback) | ✅ Fixed |
| `bg-white bg-opacity-50` (SpeckleScene overlays) | `bg-background/50` | ✅ Fixed |
| `MATERIAL_DEFAULT_COLOR = '#808080'` | kept `@deprecated` — 2 callers still import | ⚠️ Kept |
| `RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_COLOR = 0x00ffff` | kept — no close semantic match | ⚠️ Kept |
| `SCENE_GRID.COLOR_MAIN/COLOR_SECONDARY` | kept — Three.js scene only, no UI usage | ⚠️ Kept |
| `ARCTIC_THEME.BACKGROUND_COLOR/GEOMETRY_COLOR` | kept — Three.js scene only | ⚠️ Kept |
| `SCENE_FOG.COLOR/COLOR_LIGHT` | kept — Three.js scene only | ⚠️ Kept |
| `SCENE_ENVIRONMENT.GROUND_COLOR` | kept — Three.js scene only | ⚠️ Kept |

---

## globals.css — CSS Custom Properties

Single source of truth. All vars defined in `:root` and exposed via `@theme inline`.

### Active vars
```
--color-primary: #2F2FE4
--color-primary-hover: #5151e3
--color-primary-light: #c2c2ff
--color-primary-lighter: #c6c6fb

--color-secondary: #1f1f1f
--color-secondary-hover: #787878
--color-secondary-light: #dbdbdb
--color-secondary-lighter: #f3f3f3

--color-success: #10B981
--color-success-hover: #059669
--color-success-light: #d1fae5

--color-error: #EF4444
--color-error-hover: #dc2626
--color-error-light: #fee2e2

--color-warning: #F59E0B
--color-warning-hover: #d97706
--color-warning-light: #fef3c7

--color-info: #3B82F6
--color-info-hover: #2563eb
--color-info-light: #dbeafe

--color-material-start: #67bfb4   (acoustic gradient low absorption)
--color-material-mid: #ffbf6d     (acoustic gradient mid absorption)
--color-material-end: #eb5c52     (acoustic gradient high absorption)

--color-receiver: #f0a938         (Three.js receiver cubes + UI color dots)
```

### Removed vars (were near-duplicates)
- ~~`--color-dark-mode-accent: #1a15c0`~~ → use `--color-primary`

---

## getCssColorHex utility

`frontend/src/utils/utils.ts` — reads CSS var at runtime, returns `number` for Three.js.

```ts
export function getCssColorHex(cssVar: string): number {
  const val = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim().replace('#', '');
  return parseInt(val, 16);
}
```

---

## File-by-file Status

### Phase 1 — Foundation
- ✅ `globals.css` — CSS vars defined, `@theme inline` wired, `.timeline-hscroll` fix
- ✅ `utils/utils.ts` — `getCssColorHex()` added

### Phase 2 — constants.ts cleanup
- ✅ Removed `PRIMARY_COLOR`, `PRIMARY_COLOR_HEX`
- ✅ Removed `DARK_MODE.LIGHT_COLOR`, `DARK_MODE.LIGHT_COLOR_HEX`
- ✅ Removed `RECEIVER_CONFIG.COLOR`, `GRID_LISTENER_CONFIG.COLOR`
- ✅ Removed `OBJECT_LABEL.BG_COLOR`, `OBJECT_LABEL.TEXT_COLOR`
- ✅ Removed `IMPACT_MATERIALS.*.color` fields
- ✅ Removed `PLAYBACK_CONTROLS.PRIMARY_PINK`, `.MIDDLE_PINK`, `.BUTTON_GREY`
- ✅ Removed `SIMULATION_MISMATCH_COLOR_HEX`
- ✅ Removed `AREA_DRAWING.LINE_COLOR`, `.FILL_COLOR_DEFAULT`, `.FILL_COLOR_GENERATED`, `.POINT_PREVIEW_COLOR`
- ✅ Updated `SPECKLE_FILTER_COLORS.SOUND_LINKED_PENDING` → `'var(--color-primary-light)'`
- ✅ Updated `getMaterialColorByAbsorption()` to read CSS vars via `getComputedStyle`
- ✅ Marked `MATERIAL_DEFAULT_COLOR` as `@deprecated`

### Phase 3 — Three.js managers
- ✅ `sound-sphere-manager.ts` — 4× `--color-dark-mode-accent` → `--color-primary`; `getCssColorHex` import added
- ✅ `SpeckleScene.tsx` — 4× `RECEIVER_CONFIG.COLOR`, 4× dark mode accent, 2× `SIMULATION_MISMATCH_COLOR_HEX`, 3× `bg-white bg-opacity-50`, `DARK_MODE.LIGHT_COLOR_HEX`, `DARK_MODE.LIGHT_COLOR`
- ✅ `receiver-manager.ts` — 2 material blocks use `getCssColorHex('--color-receiver')`
- ✅ `grid-receiver-manager.ts` — `getCssColorHex('--color-receiver')` for color+emissive
- ✅ `label-sprite-factory.ts` — inlined `'rgba(20, 20, 20, 0.80)'` and `'white'`
- ✅ `area-drawing-manager.ts` — 4 color fields → `getCssColorHex` with semantic vars; canvas label → `getComputedStyle`

### Phase 4 — UI components
- ✅ `EntityInfoPanel.tsx` — `receiverColor = 'var(--color-receiver)'`; `RECEIVER_CONFIG` import removed
- ✅ `ListenersSection.tsx` — `LISTENER_COLOR = 'var(--color-receiver)'`; `RECEIVER_CONFIG` import removed
- ✅ `ReceiversSection.tsx` — `receiverColor = 'var(--color-receiver)'`; `RECEIVER_CONFIG` import removed
- ✅ `ImpulseResponseUpload.tsx` — badges use semantic Tailwind classes; error classes replaced
- ✅ `WaveSurferTimeline.tsx` — `bg-red-*` → `bg-error/*`, `text-red-*` → `text-error`
- ✅ `VirtualTreeItem.tsx` — `bg-blue-100 hover:bg-blue-200` → `bg-info-light hover:bg-info/20`
- ✅ `SEDWaveformPlayer.tsx` — `'#9CA3AF'` → `'var(--color-secondary-hover)'`
- ✅ `AudioAnalysisAfterContent.tsx` — dropped `#ef4444` fallback from `var(--color-error, ...)`
- ✅ `TextContextContent.tsx` — `'#ffffff'` → `'white'`
- ✅ `GridListenerContent.tsx` — `'#10B981'`/`'#6b7280'` → CSS vars
- ✅ `absorption-histogram-utils.ts` — removed static `GREY`/`GRID`/`BG` constants; fallbacks inlined

---

## Remaining / Intentionally Kept

- `MATERIAL_DEFAULT_COLOR = '#808080'` — `@deprecated`, still imported by `acousticMaterialStore.ts` and `useSpeckleSurfaceMaterials.ts`. Inline `'#808080'` when those files are refactored.
- `RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_COLOR = 0x00ffff` — cyan, no semantic match; Three.js only.
- `SCENE_GRID`, `ARCTIC_THEME`, `SCENE_FOG`, `SCENE_ENVIRONMENT` color fields — Three.js scene config, not UI colors, no close semantic matches.
- `UI_SHADOWS` rgba values — design tokens for box-shadow strings, not color values per se.
- `UI_OVERLAY.BACKGROUND / BORDER_COLOR` — alpha-composited black/white overlays for 3D scene glass UI.
