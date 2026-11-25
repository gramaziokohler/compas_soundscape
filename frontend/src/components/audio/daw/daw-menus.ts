import type { ReactNode } from 'react';
import type { NestedMenuItem } from '@/components/ui/NestedMenu';

/**
 * DAW right-click menus — one structure for both scopes, rendered by `NestedMenu`.
 *
 * Track menu (track-head kebab, right-click on the head or on an empty lane):
 *   title · schedule actions · Variant ▸ / Linked entity ▸ for all clips · navigation · clear/reset
 * Clip menu (right-click on a clip):
 *   title + trigger · Variant ▸ / Linked entity ▸ for this clip · apply to all · trim / delete
 *   · per-occurrence variation · Track ▸ (the track menu above, same items)
 *
 * Choices use the same rows at both scopes (radio submenus with the current value as hint),
 * so a user who learned one menu knows the other.
 */

export interface DawMenuVariant {
  id: string;
  /** "A", "B", ... */
  label: string;
}

export interface DawMenuEntity {
  id: string;
  /** 1-based number shown on the entity badge. */
  displayNumber: number;
}

const MIXED_HINT = 'mixed';

const entityLabel = (e: DawMenuEntity) => `Entity ${e.displayNumber}`;

function variantSubmenu(
  key: string,
  label: string,
  variants: DawMenuVariant[],
  current: number | null,
  onPick: (variantIndex: number) => void,
): NestedMenuItem {
  return {
    kind: 'submenu',
    key,
    label,
    hint: current === null ? MIXED_HINT : variants[current]?.label,
    items: variants.map((v, vi) => ({
      kind: 'radio' as const,
      key: v.id,
      label: `Variant ${v.label}`,
      checked: current === vi,
      onSelect: () => onPick(vi),
    })),
  };
}

function entitySubmenu(
  key: string,
  label: string,
  entities: DawMenuEntity[],
  /** Linked entity id; `undefined` = none, `null` = clips disagree. */
  current: string | null | undefined,
  onPick: (entityId: string) => void,
): NestedMenuItem {
  const active = current ? entities.find((e) => e.id === current) : undefined;
  return {
    kind: 'submenu',
    key,
    label,
    hint: current === null ? MIXED_HINT : active ? String(active.displayNumber) : '—',
    items: entities.map((e) => ({
      kind: 'radio' as const,
      key: e.id,
      label: entityLabel(e),
      title: current === e.id ? 'Click again to unlink' : undefined,
      checked: current === e.id,
      onSelect: () => onPick(e.id),
    })),
  };
}

/** Drops leading/trailing/duplicate separators left by conditional rows. */
function tidy(items: Array<NestedMenuItem | false | null | undefined>): NestedMenuItem[] {
  const out: NestedMenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.kind === 'separator' && (out.length === 0 || out[out.length - 1].kind === 'separator')) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1].kind === 'separator') out.pop();
  return out;
}

/* ------------------------------------------------------------------ track */

export interface TrackMenuModel {
  title: string;
  /** Recurring activity: "Interval settings" instead of "Distribute evenly". */
  isRecurring: boolean;
  clipCount: number;
  variants: DawMenuVariant[];
  /** Variant every clip plays, or null when they differ. */
  uniformVariantIndex: number | null;
  linkedEntities: DawMenuEntity[];
  /** Entity every clip is linked to; `undefined` = none, `null` = clips differ. */
  uniformEntityId: string | null | undefined;
  hasEntityLinks: boolean;
}

export interface TrackMenuActions {
  onDistribute: () => void;
  onSelectAllClips: () => void;
  onPickVariantForAll: (variantIndex: number) => void;
  onPickEntityForAll: (entityId: string) => void;
  onOpenSoundCard?: () => void;
  onZoomToEntity?: () => void;
  onClearEntityLinks: () => void;
  onClearClips: () => void;
  onResetTrack: () => void;
}

/** Track rows without the title (the clip menu nests them under "Track ▸"). */
export function buildTrackMenuBody(m: TrackMenuModel, a: TrackMenuActions): NestedMenuItem[] {
  const noClips = m.clipCount === 0;
  return tidy([
    { kind: 'action', key: 'distribute', label: m.isRecurring ? 'Interval settings…' : 'Distribute evenly…', onSelect: a.onDistribute },
    { kind: 'action', key: 'select-all', label: 'Select all clips', disabled: noClips, onSelect: a.onSelectAllClips },
    { kind: 'separator', key: 'sep-links' },
    m.variants.length > 1 && !noClips
      && variantSubmenu('variant-all', 'Variant (all clips)', m.variants, m.uniformVariantIndex, a.onPickVariantForAll),
    m.linkedEntities.length > 0 && !noClips
      && entitySubmenu('entity-all', 'Linked entity (all clips)', m.linkedEntities, m.uniformEntityId, a.onPickEntityForAll),
    { kind: 'separator', key: 'sep-nav' },
    a.onOpenSoundCard && { kind: 'action', key: 'open-card', label: 'Open sound card', onSelect: a.onOpenSoundCard },
    a.onZoomToEntity && { kind: 'action', key: 'zoom', label: 'Zoom to entity', onSelect: a.onZoomToEntity },
    { kind: 'separator', key: 'sep-reset' },
    { kind: 'action', key: 'clear-links', label: 'Clear entity links', disabled: !m.hasEntityLinks, onSelect: a.onClearEntityLinks },
    { kind: 'action', key: 'reset-track', label: 'Reset track', title: 'Back to the orchestrated / automatic schedule', onSelect: a.onResetTrack },
    { kind: 'action', key: 'clear-clips', label: 'Clear clips', danger: true, disabled: noClips, onSelect: a.onClearClips },
  ]);
}

export function buildTrackMenuItems(m: TrackMenuModel, a: TrackMenuActions): NestedMenuItem[] {
  return [{ kind: 'label', key: 'title', label: m.title }, ...buildTrackMenuBody(m, a)];
}

/* ------------------------------------------------------------------- clip */

export interface ClipMenuModel {
  /** 1-based position of the clip on its track (time order). */
  clipNumber: number;
  clipCount: number;
  triggerExpression: string | null;
  variants: DawMenuVariant[];
  currentVariantIndex: number;
  linkedEntities: DawMenuEntity[];
  currentEntityId?: string;
  hasTrim: boolean;
  /** Clips the Delete row removes: >1 when this clip is part of a multi-selection. */
  deleteCount: number;
  /** Per-occurrence pitch / level sliders (sound events only). */
  variationContent: ReactNode | null;
  trackTitle: string;
}

export interface ClipMenuActions {
  onPickVariant: (variantIndex: number) => void;
  onPickEntity: (entityId: string) => void;
  onApplyVariantToAll: () => void;
  onApplyEntityToAll: () => void;
  onResetTrim: () => void;
  onDelete: () => void;
}

export function buildClipMenuItems(m: ClipMenuModel, a: ClipMenuActions, trackBody: NestedMenuItem[]): NestedMenuItem[] {
  const variantLabel = m.variants[m.currentVariantIndex]?.label ?? 'A';
  const entity = m.linkedEntities.find((e) => e.id === m.currentEntityId);
  return tidy([
    { kind: 'label', key: 'title', label: `Clip ${m.clipNumber} of ${m.clipCount}` },
    !!m.triggerExpression && { kind: 'label', key: 'trigger', label: `↳ ${m.triggerExpression ?? ""}`, mono: true },
    { kind: 'separator', key: 'sep-links' },
    m.variants.length > 1 && variantSubmenu('variant', 'Variant', m.variants, m.currentVariantIndex, a.onPickVariant),
    m.linkedEntities.length > 0
      && entitySubmenu('entity', 'Linked entity', m.linkedEntities, m.currentEntityId, a.onPickEntity),
    m.variants.length > 1
      && { kind: 'action', key: 'variant-to-all', label: `Use variant ${variantLabel} on all clips`, onSelect: a.onApplyVariantToAll },
    entity
      && { kind: 'action', key: 'entity-to-all', label: `Use entity ${entity.displayNumber} on all clips`, onSelect: a.onApplyEntityToAll },
    { kind: 'separator', key: 'sep-edit' },
    m.hasTrim && { kind: 'action', key: 'reset-trim', label: 'Reset clip trim', onSelect: a.onResetTrim },
    {
      kind: 'action',
      key: 'delete',
      label: m.deleteCount > 1 ? `Delete ${m.deleteCount} selected clips` : 'Delete clip',
      danger: true,
      onSelect: a.onDelete,
    },
    { kind: 'separator', key: 'sep-variation' },
    !!m.variationContent && { kind: 'custom', key: 'variation', content: m.variationContent },
    { kind: 'separator', key: 'sep-track' },
    { kind: 'submenu', key: 'track', label: 'Track', hint: m.trackTitle, title: m.trackTitle, items: trackBody },
  ]);
}
