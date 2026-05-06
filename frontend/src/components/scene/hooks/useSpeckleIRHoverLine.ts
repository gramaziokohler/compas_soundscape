import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { getCssColorHex } from '@/utils/utils';
import { IR_HOVER_LINE } from '@/utils/constants';
import type { SoundEvent, ReceiverData } from '@/types';

interface IRHoverLineProps {
  hoveredIRSourceReceiver: { sourceId: string; receiverId: string } | null;
  receivers: ReceiverData[];
  gridListeners: any[];
  soundscapeData: SoundEvent[] | null;
  activeSimulationPositions: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
  } | null;
}

export function useSpeckleIRHoverLine({
  hoveredIRSourceReceiver,
  receivers,
  gridListeners,
  soundscapeData,
  activeSimulationPositions,
}: IRHoverLineProps) {
  const irHoverLineRef = useRef<THREE.Line | null>(null);

  useEffect(() => {
    if (!IR_HOVER_LINE.ENABLED) return;
    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    if (!coordinator) return;

    // Remove existing line
    if (irHoverLineRef.current) {
      const scene = viewer?.getRenderer().scene;
      if (scene) scene.remove(irHoverLineRef.current);
      irHoverLineRef.current.geometry.dispose();
      (irHoverLineRef.current.material as THREE.Material).dispose();
      irHoverLineRef.current = null;
      viewer?.requestRender();
    }

    if (!hoveredIRSourceReceiver) return;

    const { sourceId, receiverId } = hoveredIRSourceReceiver;

    const soundSphereManager = coordinator.getSoundSphereManager();
    const receiverManager = coordinator.getReceiverManager();
    if (!soundSphereManager || !receiverManager) return;

    // Prefer simulation-time positions (source of truth per card) over current manager positions
    const spherePos: [number, number, number] | undefined =
      activeSimulationPositions?.sources[sourceId]
      ?? soundSphereManager.getSpherePosition(sourceId)
      ?? soundscapeData?.find(s => s.id === sourceId)?.position as [number, number, number] | undefined;
    let receiverPos: [number, number, number] | undefined =
      activeSimulationPositions?.receivers[receiverId]
      ?? receivers.find((r) => r.id === receiverId)?.position;

    // Fall back to grid listener points (IDs: `{gridId}-{pointIndex}`) when no sim position covers it
    if (!receiverPos) {
      outer: for (const g of gridListeners) {
        const prefix = `${g.id}-`;
        if (receiverId.startsWith(prefix)) {
          const idx = parseInt(receiverId.slice(prefix.length), 10);
          if (!isNaN(idx) && g.points[idx]) {
            receiverPos = g.points[idx];
            break outer;
          }
        }
      }
    }

    if (!spherePos || !receiverPos) return;

    const srcPos = { x: spherePos[0], y: spherePos[1], z: spherePos[2] };
    const points = [
      new THREE.Vector3(srcPos.x, srcPos.y, srcPos.z),
      new THREE.Vector3(receiverPos[0], receiverPos[1], receiverPos[2]),
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: getCssColorHex('--color-primary'),
      opacity: IR_HOVER_LINE.OPACITY,
      transparent: true,
      dashSize: IR_HOVER_LINE.DASH_SIZE,
      gapSize: IR_HOVER_LINE.GAP_SIZE,
      depthTest: false,
      depthWrite: false,
    });

    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 9999;
    line.layers.enable(4); // SPECKLE_OVERLAY_LAYER

    const scene = viewer?.getRenderer().scene;
    if (scene) {
      scene.add(line);
      irHoverLineRef.current = line;
      viewer?.requestRender();
    }

    return () => {
      const { viewer: v } = useSpeckleEngineStore.getState();
      if (irHoverLineRef.current) {
        const s = v?.getRenderer().scene;
        if (s) s.remove(irHoverLineRef.current);
        irHoverLineRef.current.geometry.dispose();
        (irHoverLineRef.current.material as THREE.Material).dispose();
        irHoverLineRef.current = null;
        v?.requestRender();
      }
    };
  }, [hoveredIRSourceReceiver, receivers, gridListeners, soundscapeData, activeSimulationPositions]);
}
