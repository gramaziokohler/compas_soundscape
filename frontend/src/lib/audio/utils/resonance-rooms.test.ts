import { describe, it, expect } from 'vitest';
import {
  assignSourceRooms,
  aabbsOverlap,
  clampRoomBounds,
  pointInAabb,
  distanceToAabb,
  type RoomAssignmentInput,
} from './resonance-rooms';

const hall: RoomAssignmentInput = {
  id: 'hall',
  order: 0,
  bounds: { min: [0, 0, 0], max: [10, 10, 4] },
};
const booth: RoomAssignmentInput = {
  id: 'booth',
  order: 1,
  bounds: { min: [2, 2, 0], max: [4, 4, 3] },
};
const twin: RoomAssignmentInput = {
  id: 'twin',
  order: 2,
  bounds: { min: [2, 2, 0], max: [4, 4, 3] },
};

describe('assignSourceRooms', () => {
  it('puts a source inside one box into that room at unity', () => {
    const sends = assignSourceRooms({ x: 1, y: 1, z: 1 }, [hall, booth]);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ roomId: 'hall', sendGain: 1, directGain: 1, isPrimary: true });
  });

  it('blends overlapping rooms: smallest is primary, equal-power reverb', () => {
    const sends = assignSourceRooms({ x: 3, y: 3, z: 1 }, [hall, booth]);
    expect(sends.map((s) => s.roomId)).toEqual(['booth', 'hall']);
    const n = Math.SQRT1_2; // 1/sqrt(2)
    expect(sends[0]).toMatchObject({ roomId: 'booth', isPrimary: true });
    expect(sends[0].sendGain).toBeCloseTo(n);
    expect(sends[0].directGain).toBeCloseTo(Math.sqrt(2));
    expect(sends[1]).toMatchObject({ roomId: 'hall', isPrimary: false, directGain: 0 });
    expect(sends[1].sendGain).toBeCloseTo(n);
  });

  it('breaks equal-volume ties by card order', () => {
    const sends = assignSourceRooms({ x: 3, y: 3, z: 1 }, [twin, booth]);
    expect(sends[0].roomId).toBe('booth');
    expect(sends[0].isPrimary).toBe(true);
  });

  it('falls back to the nearest room when outside every box', () => {
    const far = assignSourceRooms({ x: 20, y: 5, z: 1 }, [hall, booth]);
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ roomId: 'hall', sendGain: 1, directGain: 1, isPrimary: true });
  });

  it('returns empty when there are no rooms', () => {
    expect(assignSourceRooms({ x: 0, y: 0, z: 0 }, [])).toEqual([]);
  });
});

describe('aabb helpers', () => {
  it('detects overlap and containment', () => {
    expect(aabbsOverlap(hall.bounds, booth.bounds)).toBe(true);
    expect(pointInAabb({ x: 3, y: 3, z: 1 }, booth.bounds)).toBe(true);
    expect(pointInAabb({ x: 1, y: 1, z: 1 }, booth.bounds)).toBe(false);
    expect(distanceToAabb({ x: 3, y: 3, z: 1 }, booth.bounds)).toBe(0);
    expect(distanceToAabb({ x: 0, y: 3, z: 1 }, booth.bounds)).toBe(2);
  });

  it('clamps degenerate axes to MIN_ROOM_EXTENT', () => {
    const clamped = clampRoomBounds({ min: [0, 0, 0], max: [0.1, 4, 4] });
    expect(clamped.max[0] - clamped.min[0]).toBeGreaterThanOrEqual(1);
    expect(clamped.max[1] - clamped.min[1]).toBeCloseTo(4);
  });
});
