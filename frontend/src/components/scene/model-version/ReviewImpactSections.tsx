'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { MaterialSelect, type MaterialOption } from '@/components/ui/MaterialSelect';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { MODEL_VERSION } from '@/utils/constants';
import { assignedMaterialId, describeObjectChange, formatRelativeChange, regionChanges } from '@/utils/modelVersionImpact';
import type { ModelVersionImpactReport, ModelVersionObjectImpact, ModelVersionObjectStatus } from '@/types/modelVersionImpact';
import { assignMaterialToObjects, focusObjectsForMaterial, geometryIdsFor } from './reviewActions';

/** One impact row: icon, text (clickable when `onClick`), actions. */
export function ReviewRow({
  icon,
  children,
  actions,
  onClick,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const content = (
    <>
      <span className="mv-muted flex-shrink-0" style={{ width: 14, display: 'inline-flex' }} aria-hidden="true">{icon}</span>
      <span className="flex-1 min-w-0">{children}</span>
    </>
  );
  return (
    <div className="flex items-center gap-2" style={{ padding: '2px 0' }}>
      {onClick ? (
        <button type="button" className="mv-row mv-row--link flex-1 min-w-0" title={title} onClick={onClick}>
          {content}
        </button>
      ) : (
        <span className="flex items-center gap-2 flex-1 min-w-0" style={{ padding: '3px 6px' }}>{content}</span>
      )}
      {actions}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mv-hint" style={{ margin: '0 0 4px' }}>{children}</p>;
}

/** Counts grid: changed / added / removed / below tolerance. */
export function ImpactCounts({ counts }: { counts: ModelVersionImpactReport['region_counts'] }) {
  const cells: Array<[string, number, boolean]> = [
    ['Changed', counts.changed, false],
    ['Added', counts.added, false],
    ['Removed', counts.removed, false],
    ['Below tolerance', counts.below_tolerance, true],
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {cells.map(([label, value, muted]) => (
        <div key={label} className="mv-stat">
          <span className="mv-hint block truncate">{label}</span>
          <span className={muted ? 'mv-stat__value mv-muted' : 'mv-stat__value'}>{value}</span>
        </div>
      ))}
    </div>
  );
}

const DOT_CLASS: Record<ModelVersionObjectStatus, string> = {
  changed: 'mv-status-dot mv-status-dot--changed',
  added: 'mv-status-dot mv-status-dot--added',
  removed: 'mv-status-dot mv-status-dot--removed',
  below_tolerance: 'mv-status-dot',
};

const STATUS_GROUP_LABEL: Record<ModelVersionObjectStatus, string> = {
  changed: 'Changed',
  added: 'New',
  removed: 'Removed',
  below_tolerance: 'Below tolerance',
};

/** Material options of the active simulation card (empty when editing is inactive). */
function useReviewMaterials() {
  const isActive = useAcousticMaterialStore((s) => s.isActive);
  const materials = useAcousticMaterialStore((s) => s.availableMaterials);
  const assignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const options = useMemo<MaterialOption[]>(
    () => (isActive
      ? [...materials].filter((m) => typeof m.absorption === 'number' && !isNaN(m.absorption)).sort((a, b) => a.absorption - b.absorption)
      : []),
    [isActive, materials],
  );
  const colors = useMemo(() => new Map(options.map((m) => [m.id, getMaterialColorByAbsorption(m.absorption)])), [options]);
  const nameOf = (id: string | null) => (id ? materials.find((m) => m.id === id)?.name ?? id : null);
  return { editable: isActive && options.length > 0, options, colors, assignments, nameOf };
}

type ReviewMaterials = ReturnType<typeof useReviewMaterials>;

/** Material control: dropdown while a card's materials are editable, else "Assign" (activates editing). */
function MaterialControl({
  rawIds,
  materialId,
  placeholder,
  materials,
}: {
  rawIds: string[];
  materialId: string | null;
  placeholder: string;
  materials: ReviewMaterials;
}) {
  if (materials.editable) {
    return (
      <span style={{ width: MODEL_VERSION.REVIEW_MATERIAL_SELECT_WIDTH_PX, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <MaterialSelect
          value={materialId ?? ''}
          onChange={(id) => assignMaterialToObjects(rawIds, id)}
          materials={materials.options}
          materialColors={materials.colors}
          placeholder={placeholder}
          showSearch
          allowCustom
          variant="explorer"
          alignRight
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="mv-btn"
      title="Switch to Acoustics and select these surfaces to assign a material"
      onClick={(e) => { e.stopPropagation(); focusObjectsForMaterial(rawIds); }}
    >
      Assign
    </button>
  );
}

interface RegionRow {
  obj: ModelVersionObjectImpact;
  materialId: string | null;
}

function RegionObjectRow({ row, materials }: { row: RegionRow; materials: ReviewMaterials }) {
  const { obj, materialId } = row;
  const removed = obj.status === 'removed';
  return (
    <div className="flex items-center gap-2" style={{ padding: '3px 0' }}>
      <span className={DOT_CLASS[obj.status]} aria-hidden="true" />
      <span
        className={removed ? 'flex-1 min-w-0 truncate mv-muted' : 'flex-1 min-w-0 truncate'}
        style={removed ? { textDecoration: 'line-through' } : undefined}
        title={obj.layer ? `${obj.name} — ${obj.layer}` : obj.name}
      >
        {obj.name} · {describeObjectChange(obj)}
      </span>
      {!removed && materialId && !materials.editable && (
        <span className="mv-hint truncate" style={{ maxWidth: 110 }}>{materials.nameOf(materialId)}</span>
      )}
      {!removed && !materialId && !materials.editable && (
        <span style={{ color: 'var(--color-error)', fontSize: 11, whiteSpace: 'nowrap' }}>no material</span>
      )}
      {!removed && (materials.editable || !materialId) && (
        <MaterialControl rawIds={obj.raw_ids} materialId={materialId} placeholder="no material" materials={materials} />
      )}
    </div>
  );
}

/** A collapsible group of region rows with one material control for the group. */
function RegionGroup({ label, title, rows, materials }: { label: string; title?: string; rows: RegionRow[]; materials: ReviewMaterials }) {
  const [open, setOpen] = useState(false);
  const assignable = rows.filter((r) => r.obj.status !== 'removed');
  const missing = assignable.filter((r) => !r.materialId);
  // Assign the surfaces still missing a material; when none, set the whole group.
  const targets = missing.length > 0 ? missing : assignable;
  const targetIds = targets.flatMap((r) => r.obj.raw_ids);
  const common = new Set(targets.map((r) => r.materialId));
  const commonId = common.size === 1 ? [...common][0] : null;
  const counts = (['changed', 'added', 'removed'] as const)
    .map((status) => [status, rows.filter((r) => r.obj.status === status).length] as const)
    .filter(([, n]) => n > 0);

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2" style={{ padding: '3px 0' }}>
        <button type="button" className="mv-row mv-row--link flex-1 min-w-0" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={title}>
          <span aria-hidden="true" style={{ width: 10, flexShrink: 0, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}>▸</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{label}</span>
            <span className="mv-hint flex items-center gap-1.5 flex-wrap">
              {rows.length} surface{rows.length === 1 ? '' : 's'}
              {counts.map(([status, n]) => (
                <span key={status} className="inline-flex items-center gap-1">
                  <span className={DOT_CLASS[status]} aria-hidden="true" /> {n}
                </span>
              ))}
              {missing.length > 0 && (
                <span style={{ color: 'var(--color-error)' }}>· {missing.length} without material</span>
              )}
            </span>
          </span>
        </button>
        {targetIds.length > 0 && (
          <MaterialControl
            rawIds={targetIds}
            materialId={missing.length > 0 ? null : commonId}
            placeholder={missing.length > 0 ? `Assign ${missing.length}` : '(mixed)'}
            materials={materials}
          />
        )}
      </div>
      {open && (
        <div style={{ paddingLeft: 18 }}>
          {rows.map((row) => <RegionObjectRow key={`${row.obj.status}:${row.obj.key}`} row={row} materials={materials} />)}
        </div>
      )}
    </div>
  );
}

/** Last segment of a layer path ("Building::Level 1::Walls" → "Walls"). */
function layerLabel(layer: string | null): string {
  if (!layer) return 'No layer';
  const parts = layer.split('::');
  return parts[parts.length - 1] || layer;
}

/** Acoustic-region objects changed above tolerance, with their material (grouped when many). */
export function RegionChangesSection({ report }: { report: ModelVersionImpactReport }) {
  const materials = useReviewMaterials();
  const changes = useMemo(() => regionChanges(report), [report]);
  // Geometry leaf ids are what live assignments are keyed by (resolved once per report).
  const leafIds = useMemo(
    () => new Map(changes.map((o) => [o.key, o.status === 'removed' ? [] : geometryIdsFor(o.raw_ids)])),
    [changes],
  );
  const rows = useMemo<RegionRow[]>(
    () => changes.map((obj) => ({
      obj,
      materialId: obj.status === 'removed' ? null : assignedMaterialId(obj, materials.assignments, leafIds.get(obj.key)),
    })),
    [changes, leafIds, materials.assignments],
  );

  const groups = useMemo(() => {
    if (rows.length <= MODEL_VERSION.REGION_GROUP_THRESHOLD) return null;
    const layers = new Set(rows.map((r) => r.obj.layer ?? ''));
    const byLayer = layers.size > 1;
    const map = new Map<string, { label: string; title?: string; rows: RegionRow[] }>();
    for (const row of rows) {
      const key = byLayer ? row.obj.layer ?? '' : row.obj.status;
      const group = map.get(key) ?? {
        label: byLayer ? layerLabel(row.obj.layer) : STATUS_GROUP_LABEL[row.obj.status],
        title: byLayer ? row.obj.layer ?? undefined : undefined,
        rows: [],
      };
      group.rows.push(row);
      map.set(key, group);
    }
    return [...map.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length);
  }, [rows]);

  const { before, after } = report.region;

  return (
    <>
      <SectionTitle>Acoustic region</SectionTitle>
      {rows.length === 0 && <p className="mv-muted" style={{ padding: '2px 0 4px' }}>No surface changed above tolerance.</p>}
      {groups
        ? groups.map(([key, g]) => <RegionGroup key={key} label={g.label} title={g.title} rows={g.rows} materials={materials} />)
        : rows.map((row) => <RegionObjectRow key={`${row.obj.status}:${row.obj.key}`} row={row} materials={materials} />)}
      {!materials.editable && rows.some((r) => r.obj.status !== 'removed' && !r.materialId) && (
        <p className="mv-hint" style={{ paddingTop: 4 }}>Assign opens a simulation card in Acoustics so materials can be set here.</p>
      )}
      <p className="mv-hint" style={{ paddingTop: 2 }}>
        Bounding volume {Math.round(before.bounding_volume_m3)} → {Math.round(after.bounding_volume_m3)} m³
        {' '}({formatRelativeChange(before.bounding_volume_m3, after.bounding_volume_m3)})
        {' · '}surface {Math.round(before.area_m2)} → {Math.round(after.area_m2)} m²
      </p>
    </>
  );
}
