'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CardBaseConfig, CardType } from '@/types/card';
import type { PyroomAcousticsSimulationConfig, ChorasSimulationConfig } from '@/types/acoustics';
import type {
  TextAnalysisConfig,
  ModelAnalysisConfig,
  AnalyzeModelConfig,
  ScenarioConfig,
} from '@/types/analysis';
import type { SoundGenerationConfig } from '@/types';

/**
 * SettingsSummary Component
 *
 * A collapsible, read-only summary of label/value settings rows. Rendered on
 * generated cards (via Card) to recap the pre-generation configuration without
 * exposing the editing UI. Renders nothing when `rows` is empty.
 *
 * **Usage:**
 * ```tsx
 * <SettingsSummary
 *   title="Sound Settings"
 *   rows={[
 *     { label: 'Duration', value: '8s' },
 *     { label: 'Prompt', value: longText, expandable: true },
 *   ]}
 * />
 * ```
 *
 * Rows marked `expandable` truncate long values and show a clickable "…" suffix
 * that toggles the full value.
 */
export interface SettingsRow {
  /** Left-aligned parameter name */
  label: string;
  /** Right-aligned parameter value */
  value: string;
  /** When true, long values truncate with a clickable "…" revealing the full value. */
  expandable?: boolean;
  /** Max characters before truncating an expandable value (default 48). */
  truncateAt?: number;
}

interface SettingsSummaryProps {
  /** Section title shown on the toggle button. */
  title?: string;
  /** Label/value rows to display. Renders nothing when empty. */
  rows: SettingsRow[];
  /** Whether the section starts expanded. */
  defaultExpanded?: boolean;
}

export function SettingsSummary({
  title = 'Settings',
  rows,
  defaultExpanded = false,
}: SettingsSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  if (rows.length === 0) return null;

  const toggleRow = (label: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="mt-2 mb-2">
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left text-xxs transition-colors"
        style={{ color: 'var(--color-on-blue-muted)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-on-blue)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-on-blue-muted)'; }}
      >
        {isExpanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        <span>{title}</span>
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1 text-xxs">
          {rows.map((row) => {
            const isRowExpanded = expandedRows.has(row.label);
            const truncateAt = row.truncateAt ?? 48;
            const isLong = row.value.length > truncateAt;
            return (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <span className="shrink-0" style={{ color: 'var(--color-on-blue-muted)' }}>{row.label}</span>
                <span className="text-right break-words max-w-[70%]" style={{ color: 'var(--color-on-blue)' }}>
                  {row.expandable && isLong ? (
                    <>
                      {isRowExpanded ? row.value : row.value.slice(0, truncateAt)}
                      <button
                        onClick={() => toggleRow(row.label)}
                        className="transition-colors px-0.5 cursor-pointer"
                        style={{ color: 'var(--color-on-blue-muted)' }}
                        title={isRowExpanded ? 'Collapse' : 'Show full value'}
                        aria-label={`${isRowExpanded ? 'Collapse' : 'Show full'} ${row.label}`}
                      >
                        …
                      </button>
                    </>
                  ) : (
                    row.value
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Card settings derivation
// ============================================================================

const SOUND_TYPES: CardType[] = [
  'text-to-audio',
  'text-to-speech',
  'upload',
  'library',
  'catalog',
  'sample-audio',
];

const SIMULATION_TYPES: CardType[] = [
  'resonance',
  'choras',
  'pyroomacoustics',
  'import-irs',
];

const ANALYSIS_TYPES: CardType[] = [
  '3d-model',
  'audio',
  'text',
  'model-analysis',
  'scenario',
  'freeform',
];

/**
 * Short, per-card-type section title for the settings summary.
 */
export function getSettingsTitle(config: CardBaseConfig): string {
  if (SIMULATION_TYPES.includes(config.type)) return 'Simulation Settings';
  if (SOUND_TYPES.includes(config.type)) return 'Sound Settings';
  if (ANALYSIS_TYPES.includes(config.type)) return 'Analysis Settings';
  return 'Settings';
}

/**
 * Derive a short, high-signal list of pre-generation settings rows from a card
 * config. Boolean parameters are shown only when true. Prompt/text values are
 * marked `expandable` so long prompts can be revealed on demand.
 */
export function getSettingsRows(config: CardBaseConfig): SettingsRow[] {
  const rows: SettingsRow[] = [];

  if (SIMULATION_TYPES.includes(config.type)) {
    const completedAt = 'completedAt' in config && typeof config.completedAt === 'number'
      ? config.completedAt
      : undefined;
    if (completedAt) {
      const date = new Date(completedAt);
      const pad = (value: number) => String(value).padStart(2, '0');
      rows.push({
        label: 'Generated',
        value: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
      });
    }
  }

  if (config.type === 'pyroomacoustics') {
    const s = (config as PyroomAcousticsSimulationConfig).settings;
    rows.push({ label: 'Simulation Mode', value: s.simulation_mode === 'foa' ? 'FOA' : 'Mono' });
    rows.push({ label: 'Max Order (ISM)', value: String(s.max_order) });
    if (s.ray_tracing) {
      rows.push({ label: 'Ray Tracing', value: 'Yes' });
      rows.push({ label: 'Rays', value: s.n_rays.toLocaleString() });
    }
    if (s.air_absorption) rows.push({ label: 'Air Absorption', value: 'Yes' });
    return rows;
  }

  if (config.type === 'choras') {
    const s = (config as ChorasSimulationConfig).settings;
    rows.push({ label: 'Method', value: s.simulation_method });
    if (s.simulation_method === 'DG') {
      rows.push({ label: 'Freq. Upper Limit', value: `${s.dg_freq_upper_limit} Hz` });
      rows.push({ label: 'Polynomial Order', value: String(s.dg_poly_order) });
      rows.push({ label: 'Points per Wavelength', value: String(s.dg_ppw) });
      rows.push({ label: 'CFL', value: String(s.dg_cfl) });
    }
    return rows;
  }

  // import-irs and resonance expose no meaningful settings summary
  if (config.type === 'import-irs' || config.type === 'resonance') return rows;

  if (SOUND_TYPES.includes(config.type)) {
    const original = (config as unknown as { originalConfig?: SoundGenerationConfig }).originalConfig;
    if (original) {
      switch (config.type) {
        case 'text-to-audio':
          if (original.prompt) rows.push({ label: 'Prompt', value: original.prompt, expandable: true });
          rows.push({ label: 'Duration', value: `${original.duration}s` });
          rows.push({ label: 'Variants', value: String(original.seed_copies) });
          if (original.steps) rows.push({ label: 'Steps', value: String(original.steps) });
          break;
        case 'text-to-speech':
          if (original.prompt) rows.push({ label: 'Prompt', value: original.prompt, expandable: true });
          if (original.voice_name) rows.push({ label: 'Voice', value: original.voice_name });
          break;
        case 'upload':
        case 'sample-audio': {
          const filename = original.uploadedAudioInfo?.filename;
          if (filename) rows.push({ label: 'File', value: filename, expandable: true });
          break;
        }
        case 'library': {
          const sound = original.selectedLibrarySound;
          if (sound?.description) rows.push({ label: 'Sound', value: sound.description, expandable: true });
          else if (sound?.location) rows.push({ label: 'Sound', value: sound.location, expandable: true });
          if (sound?.category) rows.push({ label: 'Category', value: sound.category });
          break;
        }
        case 'catalog': {
          const sound = original.selectedCatalogSound;
          if (sound?.name) rows.push({ label: 'Sound', value: sound.name, expandable: true });
          if (sound?.category) rows.push({ label: 'Category', value: sound.category });
          break;
        }
      }
    }
    return rows;
  }

  if (ANALYSIS_TYPES.includes(config.type)) {
    switch (config.type) {
      case '3d-model': {
        const c = config as ModelAnalysisConfig;
        rows.push({ label: 'Entities', value: `${c.selectedDiverseEntities.length} selected` });
        if (c.useModelAsContext) rows.push({ label: 'Use Model as Context', value: 'Yes' });
        break;
      }
      case 'audio':
        // deliberately no summary rows
        break;
      case 'text': {
        const c = config as TextAnalysisConfig;
        if (c.textInput) rows.push({ label: 'Prompt', value: c.textInput, expandable: true });
        if (c.useModelAsContext) rows.push({ label: 'Use Model as Context', value: 'Yes' });
        break;
      }
      case 'model-analysis': {
        const c = config as AnalyzeModelConfig;
        if (c.userContext) rows.push({ label: 'Context', value: c.userContext, expandable: true });
        break;
      }
      case 'scenario': {
        const c = config as ScenarioConfig;
        if (c.userContext) rows.push({ label: 'Context', value: c.userContext, expandable: true });
        rows.push({ label: 'People', value: String(c.peopleCount) });
        rows.push({ label: 'Likeliness', value: String(c.likeliness) });
        if (c.useAnalysisResult) rows.push({ label: 'Use Analysis Result', value: 'Yes' });
        break;
      }
      case 'freeform':
        break;
    }
  }

  return rows;
}
