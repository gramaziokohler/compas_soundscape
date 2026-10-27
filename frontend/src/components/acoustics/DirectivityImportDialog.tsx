'use client';

/**
 * DirectivityImportDialog
 *
 * Import a measured source directivity into the user's library: drop a SOFA
 * file or a BRAS `*_IR_front_pole.csv`, pick the source for multi-source SOFA
 * files, name it, and watch the server job (parsing, resampling, first-order fit).
 * When it is done the dialog shows the horizontal / vertical polar cuts and how
 * well the wave solver's first-order approximation covers the balloon; "Use for
 * this sound" hands the record to the picker that opened the dialog.
 *
 * Rendered by DirectivityDialogsHost from `directivityStore.dialog`.
 */

import { useMemo, useState } from 'react';
import { apiService } from '@/services/api';
import { useDirectivityStore } from '@/store/directivityStore';
import { ModalShell } from '@/components/ui/ModalShell';
import { FileDropRow } from '@/components/ui/FileDropRow';
import { CardSelect } from '@/components/ui/CardSelect';
import { Notice } from '@/components/ui/Notice';
import { buildPolarCutSVG, fitExplainedPercent, polarLegend } from '@/lib/acoustics/directivity-polar';
import { DIRECTIVITY, FORM_FIELD_CLASS, UI_BORDER_RADIUS } from '@/utils/constants';
import type { DirectivityInspectResult, DirectivityPreview, DirectivityRecord } from '@/types/directivity';

interface DirectivityImportDialogProps {
  onImported?: (record: DirectivityRecord) => void;
}

type Phase = 'pick' | 'importing' | 'done';

const FORMAT_LABEL: Record<string, string> = { sofa: 'SOFA', bras_csv: 'BRAS impulse-response CSV' };

function defaultName(file: File, info: DirectivityInspectResult | null, source: string): string {
  if (info?.sofa_sources.length && source) return source.replace(/_/g, ' ');
  return file.name.replace(/\.[^.]+$/, '').replace(/_1x1_64442_IR_front_pole$/i, '').replace(/_/g, ' ');
}

export function DirectivityImportDialog({ onImported }: DirectivityImportDialogProps) {
  const closeDialog = useDirectivityStore((s) => s.closeDialog);
  const importFile = useDirectivityStore((s) => s.importFile);

  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<DirectivityInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('pick');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<DirectivityRecord | null>(null);
  const [preview, setPreview] = useState<DirectivityPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const acceptFile = async (next: File | null) => {
    if (!next) return;
    setError(null);
    setFile(next);
    setInfo(null);
    setSource('');
    setInspecting(true);
    try {
      const result = await apiService.inspectDirectivityFile(next);
      setInfo(result);
      const firstSource = result.sofa_sources[0] ?? '';
      setSource(firstSource);
      setName((prev) => prev || defaultName(next, result, firstSource).slice(0, DIRECTIVITY.NAME_MAX_LEN));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file');
      setFile(null);
    } finally {
      setInspecting(false);
    }
  };

  const handleImport = async () => {
    if (!file || !name.trim()) return;
    setPhase('importing');
    setError(null);
    setProgress(0);
    try {
      const saved = await importFile(file, name.trim(), source || undefined, (p, text) => {
        setProgress(p);
        setStatusText(text);
      });
      setRecord(saved);
      try {
        const pv = await apiService.getDirectivityPreview(saved.id);
        if (!('analytical' in pv)) setPreview(pv);
      } catch {
        /* preview is optional */
      }
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setPhase('pick');
    }
  };

  const polar = useMemo(() => {
    if (!preview) return null;
    const size = Math.round(DIRECTIVITY.PREVIEW_W / 2) - 6;
    return {
      horizontal: buildPolarCutSVG(preview, 'horizontal', { size }),
      vertical: buildPolarCutSVG(preview, 'vertical', { size }),
      legend: polarLegend(preview),
    };
  }, [preview]);

  const explained = fitExplainedPercent(record?.fit_residual);
  const canImport = !!file && !!info && !inspecting && name.trim().length > 0 && !(info.sofa_sources.length > 0 && !source);

  return (
    <ModalShell title="Import source directivity" onClose={closeDialog} width={DIRECTIVITY.DIALOG_WIDTH}>
      <div className="flex flex-col gap-3">
        {phase !== 'done' && (
          <>
            <p className="text-[11px] text-secondary-hover">
              SOFA files (sources measured by microphones around them) or the BRAS benchmark
              <code className="mx-1">*_IR_front_pole.csv</code> balloons. The on-axis response is kept; the
              balloon is resampled to 48 kHz and stored in your library.
            </p>
            <FileDropRow
              inputId="directivity-import-file"
              accept={DIRECTIVITY.ACCEPT}
              acceptLabel={DIRECTIVITY.ACCEPT_LABEL}
              label={file ? file.name : 'Import file'}
              isDragging={isDragging}
              isUploading={inspecting || phase === 'importing'}
              onFileChange={(e) => void acceptFile(e.target.files?.[0] ?? null)}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); void acceptFile(e.dataTransfer.files?.[0] ?? null); }}
            />
            {info && (
              <div className="flex flex-col gap-1 text-[11px] text-secondary-hover">
                <span>
                  {FORMAT_LABEL[info.format] ?? info.format}
                  {info.fs ? ` · ${(info.fs / 1000).toFixed(1)} kHz` : ''}
                  {info.n_points ? ` · ${info.n_points} directions` : ''}
                </span>
                {info.warning && <Notice type="warning" message={info.warning} />}
              </div>
            )}
            {info && info.sofa_sources.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xxs card-label text-secondary-hover">Source in the file</label>
                <CardSelect
                  value={source}
                  onChange={(v) => { setSource(v); setName(v.replace(/_/g, ' ').slice(0, DIRECTIVITY.NAME_MAX_LEN)); }}
                  options={info.sofa_sources.map((s) => ({ value: s, label: s }))}
                  compact
                  forceMenu
                  disabled={phase === 'importing'}
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xxs card-label text-secondary-hover" htmlFor="directivity-import-name">Name</label>
              <input
                id="directivity-import-name"
                className={FORM_FIELD_CLASS}
                value={name}
                maxLength={DIRECTIVITY.NAME_MAX_LEN}
                onChange={(e) => setName(e.target.value)}
                disabled={phase === 'importing'}
                placeholder="e.g. Genelec 8020 (BRAS)"
              />
            </div>
            {phase === 'importing' && (
              <div className="flex flex-col gap-1">
                <div className="h-1 w-full overflow-hidden" style={{ background: 'var(--color-secondary-lighter)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}>
                  <div className="h-full transition-all" style={{ width: `${Math.max(2, progress)}%`, background: 'var(--color-primary)' }} />
                </div>
                <span className="text-[10px] text-secondary-hover">{statusText || 'Queued…'}</span>
              </div>
            )}
          </>
        )}

        {phase === 'done' && record && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-foreground">{record.name}</span>
            <span className="text-[11px] text-secondary-hover">
              {record.n_points} directions · {record.taps} taps at {record.fs ? `${(record.fs / 1000).toFixed(0)} kHz` : '48 kHz'}
              {record.source_label ? ` · ${record.source_label}` : ''}
            </span>
            {polar && (
              <div className="flex gap-2 items-start">
                <div className="shrink-0" dangerouslySetInnerHTML={{ __html: polar.horizontal }} aria-label="Horizontal cut" />
                <div className="shrink-0" dangerouslySetInnerHTML={{ __html: polar.vertical }} aria-label="Vertical cut" />
                <div className="flex flex-col gap-0.5 text-[10px] text-secondary-hover">
                  {polar.legend.map((l) => (
                    <span key={l.label} className="flex items-center gap-1">
                      <span className="inline-block w-3 h-0.5" style={{ background: 'var(--color-primary)', opacity: l.opacity }} aria-hidden />
                      {l.label}
                    </span>
                  ))}
                  <span className="mt-1">0 dB at the rim, {DIRECTIVITY.PREVIEW_MIN_DB} dB at the centre</span>
                </div>
              </div>
            )}
            {explained !== null && (
              <span className="text-[10px] text-secondary-hover">
                The wave solver uses a first-order pattern per octave band, which explains about {explained}% of this
                balloon in its worst band. The ray / image-source engine uses the full balloon.
              </span>
            )}
          </div>
        )}

        {error && <p className="text-[10px] font-medium" style={{ color: 'var(--color-error)' }}>{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={closeDialog}
            className="flex-1 py-1.5 text-xs font-medium rounded transition-colors"
            style={{ background: 'var(--color-secondary-lighter)', color: 'var(--foreground)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          >
            {phase === 'done' ? 'Done' : 'Cancel'}
          </button>
          {phase !== 'done' ? (
            <button
              type="button"
              disabled={!canImport || phase === 'importing'}
              onClick={() => void handleImport()}
              className="flex-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              {phase === 'importing' ? 'Importing…' : 'Import'}
            </button>
          ) : (
            onImported && record && (
              <button
                type="button"
                onClick={() => { onImported(record); closeDialog(); }}
                className="flex-1 py-1.5 text-xs font-medium rounded transition-colors"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
              >
                Use for this sound
              </button>
            )
          )}
        </div>
      </div>
    </ModalShell>
  );
}
