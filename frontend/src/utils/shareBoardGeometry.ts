/**
 * Connecting lines of the Settings → Share link board (three columns: scenes,
 * simulations, listeners). Pure geometry, in board-relative pixels.
 */
import type { ShareItemKind, ShareLink } from '@/types/share';

export interface BoardRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BoardSegment {
  key: string;
  linkId: string;
  path: string;
  /** Scene → listener with no simulation: the line passes behind the middle column. */
  skipsMiddle: boolean;
}

const COLUMN_ORDER: ShareItemKind[] = ['scene', 'simulation', 'listener'];

const LINK_FIELD: Record<ShareItemKind, 'sceneId' | 'simulationId' | 'listenerId'> = {
  scene: 'sceneId',
  simulation: 'simulationId',
  listener: 'listenerId',
};

/** Key of an item chip in the board (`${kind}:${id}`). */
export function boardItemKey(kind: ShareItemKind, id: string): string {
  return `${kind}:${id}`;
}

/** Horizontal S-curve from the right edge of `from` to the left edge of `to`. */
function curve(from: BoardRect, to: BoardRect): string {
  const x1 = from.right;
  const y1 = (from.top + from.bottom) / 2;
  const x2 = to.left;
  const y2 = (to.top + to.bottom) / 2;
  const dx = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/**
 * One segment per pair of consecutive members of each link, left to right.
 * Links whose chips are not measured (not shared any more) are skipped.
 */
export function buildBoardSegments(links: ShareLink[], rects: Map<string, BoardRect>): BoardSegment[] {
  const segments: BoardSegment[] = [];
  for (const link of links) {
    const members = COLUMN_ORDER.flatMap((kind) => {
      const id = link[LINK_FIELD[kind]];
      const rect = id ? rects.get(boardItemKey(kind, id)) : undefined;
      return rect ? [{ kind, rect }] : [];
    });
    for (let i = 0; i + 1 < members.length; i += 1) {
      const from = members[i];
      const to = members[i + 1];
      segments.push({
        key: `${link.id}:${from.kind}-${to.kind}`,
        linkId: link.id,
        path: curve(from.rect, to.rect),
        skipsMiddle: from.kind === 'scene' && to.kind === 'listener',
      });
    }
  }
  return segments;
}
