/**
 * ResonanceMode
 *
 * Resonance Audio mode providing synthetic room acoustics.
 * One Google ResonanceAudio scene per powered ShoeBox card; sources fan out
 * into the rooms they occupy (see assignSourceRooms).
 *
 * Note: This is a wrapper around the resonance-audio library.
 * The library is dynamically imported to avoid SSR issues.
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { Position, Orientation, AmbisonicSendTap, ResonanceRoomSpec, ResonanceExportRoom, ResonanceRoomMaterial, ResonanceRoomDimensions } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import type { FadeOptions } from '../utils/fade-envelope';
import { applyFadeInOut } from '../utils/fade-envelope';
import { SourceLevelMeter } from '../utils/source-level';
import { SourceDirectivityStage, type RealtimeDirectivity } from '../utils/source-directivity';
import { AUDIO_CONTROL, DEFAULT_SPEED_OF_SOUND, GLOBAL_SOURCE, RESONANCE_AUDIO, AMBISONIC } from '@/utils/constants';
import {
  assignSourceRooms,
  isolateResonanceDirectPath,
  clampRoomBounds,
  type RoomAssignmentInput,
  type RoomSend,
} from '../utils/resonance-rooms';

type ResonanceAudioClass = new (context: AudioContext, options?: {
  ambisonicOrder?: number;
  speedOfSound?: number;
}) => ResonanceAudioScene;

interface ResonanceAudioScene {
  output: GainNode;
  ambisonicOutput: GainNode;
  createSource(): ResonanceAudioSource;
  setRoomProperties(dimensions: ResonanceRoomDimensions, materials: ResonanceRoomMaterial): void;
  setListenerPosition(x: number, y: number, z: number): void;
  setListenerOrientation(
    forwardX: number, forwardY: number, forwardZ: number,
    upX: number, upY: number, upZ: number,
  ): void;
  _listener: { input: AudioNode };
}

interface ResonanceAudioSource {
  input: AudioNode;
  setPosition(x: number, y: number, z: number): void;
  setGain(gain: number): void;
  setRolloff?(rolloff: string): void;
  setMinDistance?(distance: number): void;
  setMaxDistance?(distance: number): void;
  setSourceWidth?(degrees: number): void;
  _encoder: { output: AudioNode };
}

const DEFAULT_AMBISONIC_ORDER = 3;
const DEFAULT_ROLLOFF = 'logarithmic';
const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 10000;
const SEND_CHANNELS = AMBISONIC.CHANNELS.TOA;

interface RoomEntry {
  id: string;
  scene: ResonanceAudioScene;
  centerOffset: { x: number; y: number; z: number };
  dimensions: ResonanceRoomDimensions;
  materials: ResonanceRoomMaterial;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

interface RoomLink {
  roomId: string;
  source: ResonanceAudioSource;
  sendGain: GainNode;
  directGain: GainNode;
}

interface SourceEntry {
  buffer: AudioBuffer;
  position: { x: number; y: number; z: number };
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode;
  muteGainNode: GainNode;
  levelMeter: SourceLevelMeter;
  directivity: SourceDirectivityStage;
  isPlaying: boolean;
  isMuted: boolean;
  roomLinks: Map<string, RoomLink>;
  assignGen: number;
}

function boundsEqual(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
): boolean {
  return a.min[0] === b.min[0] && a.min[1] === b.min[1] && a.min[2] === b.min[2]
    && a.max[0] === b.max[0] && a.max[1] === b.max[1] && a.max[2] === b.max[2];
}

function materialsEqual(a: ResonanceRoomMaterial, b: ResonanceRoomMaterial): boolean {
  return a.left === b.left && a.right === b.right && a.front === b.front
    && a.back === b.back && a.down === b.down && a.up === b.up;
}

function dimensionsFromBounds(
  bounds: { min: [number, number, number]; max: [number, number, number] },
): { dimensions: ResonanceRoomDimensions; centerOffset: { x: number; y: number; z: number } } {
  const minExtent = RESONANCE_AUDIO.MIN_ROOM_EXTENT;
  return {
    centerOffset: {
      x: (bounds.min[0] + bounds.max[0]) / 2,
      y: (bounds.min[1] + bounds.max[1]) / 2,
      z: (bounds.min[2] + bounds.max[2]) / 2,
    },
    dimensions: {
      width: Math.max(bounds.max[0] - bounds.min[0], minExtent),
      height: Math.max(bounds.max[1] - bounds.min[1], minExtent),
      depth: Math.max(bounds.max[2] - bounds.min[2], minExtent),
    },
  };
}

export class ResonanceMode implements IAudioMode {
  private audioContext: AudioContext | null = null;
  private ResonanceAudio: ResonanceAudioClass | null = null;
  private masterGain: GainNode | null = null;
  private ambisonicSumBus: GainNode | null = null;
  private enabled: boolean = true;
  private speedOfSound: number = DEFAULT_SPEED_OF_SOUND;

  private rooms: Map<string, RoomEntry> = new Map();
  private pendingRooms: ResonanceRoomSpec[] | null = null;

  listenerPosition = { x: 0, y: 0, z: 0 } as unknown as Position;
  listenerOrientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

  private resonanceSources: Map<string, SourceEntry> = new Map();
  private sourceDirectivities: Map<string, RealtimeDirectivity> = new Map();
  private voices: Map<string, Set<AudioBufferSourceNode>> = new Map();
  private globalSourceIds: Set<string> = new Set();
  private pendingCleanups: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private warnedDirectPath = false;

  private assignmentInputs(): RoomAssignmentInput[] {
    let order = 0;
    const out: RoomAssignmentInput[] = [];
    this.rooms.forEach((room) => {
      out.push({ id: room.id, bounds: room.bounds, order: order++ });
    });
    return out;
  }

  private placeInRoom(sourceId: string, entry: SourceEntry, link: RoomLink): void {
    const room = this.rooms.get(link.roomId);
    if (!room) return;
    const isGlobal = this.globalSourceIds.has(sourceId);
    const at = isGlobal ? this.listenerPosition : entry.position;
    link.source.setSourceWidth?.(isGlobal
      ? GLOBAL_SOURCE.RESONANCE_SOURCE_WIDTH_DEG
      : GLOBAL_SOURCE.RESONANCE_POINT_SOURCE_WIDTH_DEG);
    link.source.setPosition(
      at.x - room.centerOffset.x,
      at.y - room.centerOffset.y,
      at.z - room.centerOffset.z,
    );
  }

  private rampGain(node: GainNode, value: number, immediate = false): void {
    if (!this.audioContext) {
      node.gain.value = value;
      return;
    }
    const now = this.audioContext.currentTime;
    node.gain.cancelScheduledValues(now);
    if (immediate) {
      node.gain.setValueAtTime(value, now);
      return;
    }
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(value, now + RESONANCE_AUDIO.ROOM_CROSSFADE_S);
  }

  private disposeLink(link: RoomLink): void {
    try { link.sendGain.disconnect(); } catch { /* already disconnected */ }
    try { link.directGain.disconnect(); } catch { /* already disconnected */ }
  }

  private createLink(entry: SourceEntry, room: RoomEntry, send: RoomSend): RoomLink | null {
    if (!this.audioContext) return null;
    const source = room.scene.createSource();
    source.setRolloff?.(DEFAULT_ROLLOFF);
    source.setMinDistance?.(DEFAULT_MIN_DISTANCE);
    source.setMaxDistance?.(DEFAULT_MAX_DISTANCE);
    source.setGain(1.0);

    const sendGain = this.audioContext.createGain();
    sendGain.gain.value = 0;
    const directGain = this.audioContext.createGain();
    directGain.gain.value = 0;

    entry.directivity.output.connect(sendGain);
    sendGain.connect(source.input);

    const isolated = isolateResonanceDirectPath(source, room.scene._listener.input, directGain);
    if (!isolated && !this.warnedDirectPath) {
      this.warnedDirectPath = true;
      console.warn('[ResonanceMode] Could not isolate the dry encoder path; overlapping rooms may double the direct sound');
    }

    const link: RoomLink = { roomId: room.id, source, sendGain, directGain };
    this.rampGain(sendGain, send.sendGain);
    this.rampGain(directGain, send.directGain);
    return link;
  }

  private syncSourceRooms(sourceId: string, entry: SourceEntry): void {
    const position = this.globalSourceIds.has(sourceId) ? this.listenerPosition : entry.position;
    const sends = assignSourceRooms(position, this.assignmentInputs());
    const wanted = new Set(sends.map((s) => s.roomId));
    entry.assignGen += 1;
    const gen = entry.assignGen;

    for (const send of sends) {
      const room = this.rooms.get(send.roomId);
      if (!room) continue;
      let link = entry.roomLinks.get(send.roomId);
      if (!link) {
        const created = this.createLink(entry, room, send);
        if (!created) continue;
        link = created;
        entry.roomLinks.set(send.roomId, link);
      } else {
        this.rampGain(link.sendGain, send.sendGain);
        this.rampGain(link.directGain, send.directGain);
      }
      this.placeInRoom(sourceId, entry, link);
    }

    for (const [roomId, link] of [...entry.roomLinks.entries()]) {
      if (wanted.has(roomId)) continue;
      this.rampGain(link.sendGain, 0);
      this.rampGain(link.directGain, 0);
      const key = `${sourceId}:${roomId}`;
      const existing = this.pendingCleanups.get(key);
      if (existing) clearTimeout(existing);
      const timeout = setTimeout(() => {
        this.pendingCleanups.delete(key);
        const live = this.resonanceSources.get(sourceId);
        if (!live || live.assignGen !== gen) return;
        const stale = live.roomLinks.get(roomId);
        if (!stale) return;
        this.disposeLink(stale);
        live.roomLinks.delete(roomId);
      }, RESONANCE_AUDIO.ROOM_CROSSFADE_S * 1000 + 20);
      this.pendingCleanups.set(key, timeout);
    }
  }

  private syncAllSources(): void {
    this.resonanceSources.forEach((entry, sourceId) => this.syncSourceRooms(sourceId, entry));
  }

  private applyListenerToScene(scene: ResonanceAudioScene, offset: { x: number; y: number; z: number }): void {
    const position = this.listenerPosition;
    const orientation = this.listenerOrientation;
    scene.setListenerPosition(
      position.x - offset.x,
      position.y - offset.y,
      position.z - offset.z,
    );
    const sinYaw = Math.sin(orientation.yaw), cosYaw = Math.cos(orientation.yaw);
    const sinPitch = Math.sin(orientation.pitch), cosPitch = Math.cos(orientation.pitch);
    const sinRoll = Math.sin(orientation.roll), cosRoll = Math.cos(orientation.roll);
    scene.setListenerOrientation(
      sinYaw * cosPitch, -cosYaw * cosPitch, sinPitch,
      cosYaw * sinRoll, sinYaw * sinRoll, cosRoll,
    );
  }

  private createScene(spec: ResonanceRoomSpec): RoomEntry | null {
    if (!this.audioContext || !this.ResonanceAudio || !this.masterGain || !this.ambisonicSumBus) {
      return null;
    }
    const bounds = clampRoomBounds(spec.bounds);
    const { dimensions, centerOffset } = dimensionsFromBounds(bounds);
    const scene = new this.ResonanceAudio(this.audioContext, {
      ambisonicOrder: DEFAULT_AMBISONIC_ORDER,
      speedOfSound: this.speedOfSound,
    });
    scene.setRoomProperties(dimensions, spec.materials);
    scene.output.connect(this.masterGain);
    scene.ambisonicOutput.connect(this.ambisonicSumBus);
    this.applyListenerToScene(scene, centerOffset);
    return { id: spec.id, scene, centerOffset, dimensions, materials: { ...spec.materials }, bounds };
  }

  private disposeScene(room: RoomEntry): void {
    try { room.scene.output.disconnect(); } catch { /* ignore */ }
    try { room.scene.ambisonicOutput.disconnect(); } catch { /* ignore */ }
  }

  /**
   * Load Resonance Audio library dynamically (browser-only)
   */
  private async loadResonanceAudio(): Promise<void> {
    if (this.ResonanceAudio) return;

    if (typeof window === 'undefined') {
      throw new Error('[ResonanceMode] Cannot load in SSR environment');
    }

    try {
      const module: { default?: { ResonanceAudio?: ResonanceAudioClass } | ResonanceAudioClass } = await import('resonance-audio');

      if (module.default && typeof module.default === 'object' && typeof module.default.ResonanceAudio === 'function') {
        this.ResonanceAudio = module.default.ResonanceAudio;
      } else if (typeof module.default === 'function') {
        this.ResonanceAudio = module.default;
      } else {
        console.error('[ResonanceMode] Unexpected module structure:', module);
        throw new Error('[ResonanceMode] Cannot find ResonanceAudio constructor');
      }

      console.log('[ResonanceMode] Library loaded successfully');
    } catch (error) {
      console.error('[ResonanceMode] Failed to load library:', error);
      throw error;
    }
  }

  async initialize(audioContext: AudioContext, speedOfSound: number = DEFAULT_SPEED_OF_SOUND): Promise<void> {
    this.audioContext = audioContext;
    this.speedOfSound = speedOfSound;

    try {
      console.log('[ResonanceMode] Initializing...');
      await this.loadResonanceAudio();
      if (!this.ResonanceAudio) {
        throw new Error('[ResonanceMode] Library not loaded');
      }

      this.masterGain = audioContext.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(audioContext.destination);

      this.ambisonicSumBus = audioContext.createGain();
      this.ambisonicSumBus.channelCount = SEND_CHANNELS;
      this.ambisonicSumBus.channelCountMode = 'explicit';
      this.ambisonicSumBus.channelInterpretation = 'discrete';

      if (this.pendingRooms) {
        const pending = this.pendingRooms;
        this.pendingRooms = null;
        this.setRooms(pending);
      }

      console.log('[ResonanceMode] Initialized successfully');
    } catch (error) {
      console.error('[ResonanceMode] Initialization failed:', error);
      throw error;
    }
  }

  setRooms(specs: ResonanceRoomSpec[]): void {
    if (!this.audioContext || !this.ResonanceAudio) {
      this.pendingRooms = specs;
      return;
    }

    const nextIds = new Set(specs.map((s) => s.id));

    for (const [id, room] of [...this.rooms.entries()]) {
      if (nextIds.has(id)) continue;
      this.disposeScene(room);
      this.rooms.delete(id);
    }

    for (const spec of specs) {
      const existing = this.rooms.get(spec.id);
      const bounds = clampRoomBounds(spec.bounds);
      if (!existing) {
        const created = this.createScene({ ...spec, bounds });
        if (created) this.rooms.set(spec.id, created);
        continue;
      }
      const boundsChanged = !boundsEqual(existing.bounds, bounds);
      const materialsChanged = !materialsEqual(existing.materials, spec.materials);
      if (!boundsChanged && !materialsChanged) continue;
      const { dimensions, centerOffset } = dimensionsFromBounds(bounds);
      existing.bounds = bounds;
      existing.centerOffset = centerOffset;
      existing.dimensions = dimensions;
      existing.materials = { ...spec.materials };
      existing.scene.setRoomProperties(dimensions, spec.materials);
      this.applyListenerToScene(existing.scene, centerOffset);
    }

    this.syncAllSources();
  }

  getExportRooms(): ResonanceExportRoom[] {
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      bounds: room.bounds,
      dimensions: { ...room.dimensions },
      materials: { ...room.materials },
      centerOffset: { ...room.centerOffset },
    }));
  }

  createSource(
    sourceId: string,
    audioBuffer: AudioBuffer,
    position: Position,
  ): void {
    if (!this.audioContext) {
      throw new Error('[ResonanceMode] Not initialized');
    }

    if (this.resonanceSources.has(sourceId)) {
      this.removeSource(sourceId);
    }

    try {
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1.0;

      const muteGainNode = this.audioContext.createGain();
      muteGainNode.gain.value = 1.0;

      const levelMeter = new SourceLevelMeter(this.audioContext);

      const directivity = new SourceDirectivityStage(this.audioContext);
      directivity.setBypass(this.globalSourceIds.has(sourceId));
      directivity.setResolved(this.sourceDirectivities.get(sourceId) ?? null);
      directivity.update(position, this.listenerPosition);

      gainNode.connect(muteGainNode);
      levelMeter.tap(gainNode);
      muteGainNode.connect(directivity.input);

      const entry: SourceEntry = {
        buffer: audioBuffer,
        position: { x: position.x, y: position.y, z: position.z },
        sourceNode: null,
        gainNode,
        muteGainNode,
        levelMeter,
        directivity,
        isPlaying: false,
        isMuted: false,
        roomLinks: new Map(),
        assignGen: 0,
      };
      this.resonanceSources.set(sourceId, entry);
      this.syncSourceRooms(sourceId, entry);

      console.log(`[ResonanceMode] Created source: ${sourceId} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
    } catch (error) {
      console.error(`[ResonanceMode] Error creating source ${sourceId}:`, error);
      throw error;
    }
  }

  playSource(sourceId: string, loop: boolean = false, offset: number = 0, duration?: number, opts?: FadeOptions): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source || !this.audioContext) {
      console.warn(`[ResonanceMode] Cannot play source ${sourceId}`);
      return;
    }

    if (source.isPlaying && source.sourceNode) {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
      source.sourceNode = null;
    }

    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = source.buffer;
    sourceNode.loop = loop;

    applyFadeInOut(sourceNode, source.gainNode, opts ? { ...opts, durationSec: duration } : {});
    source.sourceNode = sourceNode;

    sourceNode.onended = () => {
      if (!loop) {
        source.isPlaying = false;
        source.sourceNode = null;
      }
    };

    if (duration !== undefined && duration > 0) {
      sourceNode.start(0, offset, duration);
    } else {
      sourceNode.start(0, offset);
    }
    source.isPlaying = true;

    console.log(`[ResonanceMode] Playing source: ${sourceId} (loop: ${loop}, offset: ${offset}s, duration: ${duration ?? 'full'}s)`);
  }

  stopSource(sourceId: string): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source || !source.sourceNode) {
      return;
    }

    try {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
    } catch (error) {
      console.debug(`[ResonanceMode] Stop error for ${sourceId}:`, error);
    }

    source.sourceNode = null;
    source.isPlaying = false;
  }

  stopAllSources(): void {
    console.log(`[ResonanceMode] Stopping all ${this.resonanceSources.size} sources`);
    this.resonanceSources.forEach((_, sourceId) => {
      this.stopSource(sourceId);
    });
    this.stopAllVoices();
  }

  startVoice(sourceId: string, when: number, offset: number = 0, duration?: number, opts?: FadeOptions): void {
    if (!this.audioContext) return;
    const source = this.resonanceSources.get(sourceId);
    if (!source) {
      console.warn(`[ResonanceMode] startVoice: source ${sourceId} not found`);
      return;
    }

    const node = this.audioContext.createBufferSource();
    node.buffer = source.buffer;
    node.loop = false;
    applyFadeInOut(node, source.gainNode, opts ? { ...opts, durationSec: duration, startTimeSec: when } : {});

    if (duration !== undefined && duration > 0) {
      node.start(when, offset, duration);
    } else {
      node.start(when, offset);
    }

    let set = this.voices.get(sourceId);
    if (!set) {
      set = new Set();
      this.voices.set(sourceId, set);
    }
    set.add(node);
    node.onended = () => {
      set!.delete(node);
    };
  }

  stopAllVoicesForSource(sourceId: string): void {
    const set = this.voices.get(sourceId);
    if (!set) return;
    set.forEach((node) => {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Already stopped
      }
    });
    set.clear();
  }

  stopAllVoices(): void {
    this.voices.forEach((_set, sourceId) => this.stopAllVoicesForSource(sourceId));
  }

  getSourceLevel(sourceId: string): number {
    const source = this.resonanceSources.get(sourceId);
    if (!source) return 0;
    return source.levelMeter.read();
  }

  getPlayingSourceIds(): string[] {
    const ids = new Set<string>();
    this.voices.forEach((set, sourceId) => {
      if (set.size > 0) ids.add(sourceId);
    });
    this.resonanceSources.forEach((source, sourceId) => {
      if (source.isPlaying) ids.add(sourceId);
    });
    return Array.from(ids);
  }

  updateSourcePosition(sourceId: string, position: Position): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source) {
      return;
    }

    source.position = { x: position.x, y: position.y, z: position.z };
    source.directivity.update(source.position, this.listenerPosition);
    this.syncSourceRooms(sourceId, source);
  }

  setSourceDirectivity(sourceId: string, resolved: RealtimeDirectivity | null): void {
    if (resolved) this.sourceDirectivities.set(sourceId, resolved);
    else this.sourceDirectivities.delete(sourceId);
    const source = this.resonanceSources.get(sourceId);
    if (source) {
      source.directivity.setResolved(resolved);
      source.directivity.update(source.position, this.listenerPosition);
    }
  }

  removeSource(sourceId: string): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source) {
      return;
    }

    this.stopSource(sourceId);
    this.stopAllVoicesForSource(sourceId);
    this.voices.delete(sourceId);

    source.roomLinks.forEach((link) => this.disposeLink(link));
    source.roomLinks.clear();

    try {
      source.gainNode.disconnect();
      source.muteGainNode.disconnect();
    } catch {
      // Already disconnected
    }
    source.levelMeter.dispose();
    source.directivity.dispose();

    this.resonanceSources.delete(sourceId);
    console.log(`[ResonanceMode] Removed source: ${sourceId}`);
  }

  updateListener(position: Position, orientation: Orientation): void {
    this.listenerPosition = position;
    this.listenerOrientation = orientation;

    this.resonanceSources.forEach((source) => source.directivity.update(source.position, position));

    this.rooms.forEach((room) => this.applyListenerToScene(room.scene, room.centerOffset));

    this.globalSourceIds.forEach((sourceId) => {
      const source = this.resonanceSources.get(sourceId);
      if (source) this.syncSourceRooms(sourceId, source);
    });
  }

  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('[ResonanceMode] Not initialized');
    }
    return this.masterGain;
  }

  getAmbisonicSendTap(): AmbisonicSendTap | null {
    if (!this.ambisonicSumBus) return null;
    return { node: this.ambisonicSumBus, order: DEFAULT_AMBISONIC_ORDER, preRotated: true };
  }

  getMode(): AudioMode {
    return AudioMode.NO_IR_RESONANCE;
  }

  enable(): void {
    this.enabled = true;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(1, this.audioContext.currentTime);
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
    }
  }

  requiresReceiverMode(): boolean {
    return false;
  }

  setSourceVolume(sourceId: string, volume: number): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source || !this.audioContext) return;

    const clampedVolume = Math.max(
      AUDIO_CONTROL.SOURCE_VOLUME.MIN,
      Math.min(AUDIO_CONTROL.SOURCE_VOLUME.MAX, volume),
    );
    source.gainNode.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
  }

  setSourceMute(sourceId: string, muted: boolean): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source || !this.audioContext) return;

    source.isMuted = muted;
    const gainValue = muted ? AUDIO_CONTROL.DEFAULTS.MUTED_GAIN : AUDIO_CONTROL.DEFAULTS.UNMUTED_GAIN;
    source.muteGainNode.gain.setValueAtTime(gainValue, this.audioContext.currentTime);
  }

  setSourceGlobal(sourceId: string, isGlobal: boolean): void {
    if (this.globalSourceIds.has(sourceId) === isGlobal) return;
    if (isGlobal) this.globalSourceIds.add(sourceId);
    else this.globalSourceIds.delete(sourceId);

    const source = this.resonanceSources.get(sourceId);
    if (source) {
      source.directivity.setBypass(isGlobal);
      this.syncSourceRooms(sourceId, source);
    }
  }

  setMasterVolume(volume: number): void {
    if (!this.masterGain || !this.audioContext) return;

    const clampedVolume = Math.max(
      AUDIO_CONTROL.MASTER_VOLUME.MIN,
      Math.min(AUDIO_CONTROL.MASTER_VOLUME.MAX, volume),
    );
    this.masterGain.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
  }

  async setSpeedOfSound(c: number): Promise<void> {
    if (!this.audioContext || !this.ResonanceAudio) return;
    this.speedOfSound = c;

    const specs: ResonanceRoomSpec[] = Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      bounds: room.bounds,
      materials: room.materials,
    }));
    const existingSources = Array.from(this.resonanceSources.entries());

    this.rooms.forEach((room) => this.disposeScene(room));
    this.rooms.clear();
    existingSources.forEach(([id]) => this.removeSource(id));

    this.setRooms(specs);

    for (const [id, src] of existingSources) {
      this.createSource(id, src.buffer, src.position as Position);
    }
  }

  dispose(): void {
    console.log('[ResonanceMode] Disposing');

    this.pendingCleanups.forEach((t) => clearTimeout(t));
    this.pendingCleanups.clear();

    const sourceIds = Array.from(this.resonanceSources.keys());
    sourceIds.forEach((id) => this.removeSource(id));

    this.rooms.forEach((room) => this.disposeScene(room));
    this.rooms.clear();

    if (this.ambisonicSumBus) {
      try { this.ambisonicSumBus.disconnect(); } catch { /* ignore */ }
      this.ambisonicSumBus = null;
    }

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch (error) {
        console.debug('[ResonanceMode] Disconnect error:', error);
      }
      this.masterGain = null;
    }

    this.resonanceSources.clear();
    this.voices.clear();
    this.audioContext = null;
  }
}
