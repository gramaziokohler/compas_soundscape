import { useEffect } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAcousticsSimulationStore, useUIStore } from '@/store';
import type { BoundingBoxBounds } from '@/lib/three/BoundingBoxManager';
import { RESONANCE_AUDIO } from '@/utils/constants';
import { clampRoomBounds } from '@/lib/audio/utils/resonance-rooms';

interface BoundingBoxGumballProps {
  isViewerReady: boolean;
  canEdit: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useSpeckleBoundingBoxGumball({
  isViewerReady,
  canEdit,
  containerRef,
}: BoundingBoxGumballProps) {
  const expandedTabIndex = useUIStore((s) => s.expandedSimulationTabIndex);
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const editCardId = expandedTabIndex !== null
    && simulationConfigs[expandedTabIndex]?.type === 'resonance'
    ? simulationConfigs[expandedTabIndex].id
    : null;

  useEffect(() => {
    const canvas = containerRef.current?.querySelector('canvas');
    const { viewer, resonanceRoomBoxes } = useSpeckleEngineStore.getState();
    if (!canvas || !viewer || !resonanceRoomBoxes || !canEdit || !editCardId) return;

    const getManager = () => resonanceRoomBoxes.get(editCardId) ?? useSpeckleEngineStore.getState().resonanceRoomBoxes?.get(editCardId);

    let isDragging = false;
    let dragAxis: 'x' | 'y' | 'z' | 'xy' | null = null;
    let dragNormal: THREE.Vector3 | null = null;
    let dragStartAnchor: THREE.Vector3 | null = null;
    let baseBoundsAtDragStart: BoundingBoxBounds | null = null;
    let isMoveHandle = false;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const scene = viewer.getRenderer().scene;
    const camera = (viewer as { getRenderer: () => { renderingCamera: THREE.Camera } }).getRenderer().renderingCamera;
    if (!camera) return;

    const dragAnchor = new THREE.Object3D();
    dragAnchor.visible = false;
    scene.add(dragAnchor);

    const transformControls = new TransformControls(camera, canvas);
    transformControls.setMode('translate');
    transformControls.setSpace('world');
    transformControls.setSize(0.65);
    const transformHelper = transformControls as unknown as THREE.Object3D;
    transformHelper.visible = false;
    transformControls.getRaycaster().layers.enable(0);
    transformControls.getRaycaster().layers.enable(4);
    scene.add(transformHelper);

    requestAnimationFrame(() => {
      transformHelper.traverse((child) => {
        child.renderOrder = 10000;
        child.layers.disableAll();
        child.layers.enable(0);
        child.layers.enable(4);
      });
    });

    const updatePointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const getControlPointer = (e: PointerEvent, button: number) =>
      ({ x: pointer.x, y: pointer.y, button } as PointerEvent);

    const moveDraggedFace = (bounds: BoundingBoxBounds, normal: THREE.Vector3, delta: number): BoundingBoxBounds => {
      const nextBounds: BoundingBoxBounds = {
        min: [...bounds.min] as [number, number, number],
        max: [...bounds.max] as [number, number, number],
      };
      const minExtent = RESONANCE_AUDIO.MIN_ROOM_EXTENT;
      if (Math.abs(normal.x) > 0.5) {
        if (normal.x > 0) nextBounds.max[0] += delta;
        else nextBounds.min[0] -= delta;
        if (nextBounds.max[0] - nextBounds.min[0] < minExtent) {
          if (normal.x > 0) nextBounds.max[0] = nextBounds.min[0] + minExtent;
          else nextBounds.min[0] = nextBounds.max[0] - minExtent;
        }
      } else if (Math.abs(normal.y) > 0.5) {
        if (normal.y > 0) nextBounds.max[1] += delta;
        else nextBounds.min[1] -= delta;
        if (nextBounds.max[1] - nextBounds.min[1] < minExtent) {
          if (normal.y > 0) nextBounds.max[1] = nextBounds.min[1] + minExtent;
          else nextBounds.min[1] = nextBounds.max[1] - minExtent;
        }
      } else if (Math.abs(normal.z) > 0.5) {
        if (normal.z > 0) nextBounds.max[2] += delta;
        else nextBounds.min[2] -= delta;
        if (nextBounds.max[2] - nextBounds.min[2] < minExtent) {
          if (normal.z > 0) nextBounds.max[2] = nextBounds.min[2] + minExtent;
          else nextBounds.min[2] = nextBounds.max[2] - minExtent;
        }
      }
      return nextBounds;
    };

    const syncTransformAxis = (axis: 'x' | 'y' | 'z' | 'xy' | null) => {
      if (axis === 'xy') {
        transformControls.showX = true;
        transformControls.showY = true;
        transformControls.showZ = false;
        transformControls.axis = null;
        return;
      }
      transformControls.showX = axis === 'x';
      transformControls.showY = axis === 'y';
      transformControls.showZ = axis === 'z';
      transformControls.axis = axis === 'x' ? 'X' : axis === 'y' ? 'Y' : axis === 'z' ? 'Z' : null;
    };

    transformControls.addEventListener('change', () => viewer.requestRender());

    transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = !!(event as { value?: boolean }).value;
      isDragging = dragging;
      const { cameraController, selectionExtension } = useSpeckleEngineStore.getState();
      getManager()?.setDragging(dragging);
      if (cameraController) {
        if (dragging) {
          cameraController.enabled = false;
        } else {
          setTimeout(() => {
            const { cameraController: cc } = useSpeckleEngineStore.getState();
            if (cc) cc.enabled = true;
          }, 100);
        }
      }
      if (selectionExtension) selectionExtension.enabled = !dragging;
      canvas.style.cursor = dragging ? 'grabbing' : 'default';
    });

    transformControls.addEventListener('objectChange', () => {
      const bbm = getManager();
      if (!dragStartAnchor || !baseBoundsAtDragStart || !bbm) return;

      let previewBounds: BoundingBoxBounds;
      if (isMoveHandle) {
        const delta = new THREE.Vector3().subVectors(dragAnchor.position, dragStartAnchor);
        previewBounds = {
          min: [
            baseBoundsAtDragStart.min[0] + delta.x,
            baseBoundsAtDragStart.min[1] + delta.y,
            baseBoundsAtDragStart.min[2],
          ],
          max: [
            baseBoundsAtDragStart.max[0] + delta.x,
            baseBoundsAtDragStart.max[1] + delta.y,
            baseBoundsAtDragStart.max[2],
          ],
        };
      } else if (dragNormal) {
        const projectedDelta = new THREE.Vector3()
          .subVectors(dragAnchor.position, dragStartAnchor)
          .dot(dragNormal);
        previewBounds = moveDraggedFace(baseBoundsAtDragStart, dragNormal, projectedDelta);
      } else {
        return;
      }

      previewBounds = clampRoomBounds(previewBounds);
      const cfg = useAcousticsSimulationStore.getState().simulationConfigs.find((c) => c.id === editCardId);
      const materials = cfg && cfg.type === 'resonance' ? cfg.room.materials : undefined;
      bbm.updateBoundingBox(previewBounds, {
        roomMaterials: materials,
        visible: true,
        editable: true,
        label: cfg?.display_name,
      });
      if (dragAxis && dragAxis !== 'xy') {
        bbm.showDimensionLabel(previewBounds, dragAxis);
      }
      useAcousticsSimulationStore.getState().setResonanceRoomBounds(editCardId, previewBounds);
      viewer.requestRender(8);
      viewer.requestRender();
    });

    const getIntersectedGumball = () => {
      const bbm = getManager();
      if (!bbm || bbm.gumballHandles.length === 0) return null;
      const cam = (useSpeckleEngineStore.getState().viewer as { getRenderer: () => { renderingCamera: THREE.Camera } } | null)
        ?.getRenderer().renderingCamera;
      if (!cam) return null;
      raycaster.setFromCamera(pointer, cam);
      const intersects = raycaster.intersectObjects(bbm.gumballHandles, false);
      return intersects.length > 0 ? (intersects[0].object as THREE.Mesh) : null;
    };

    const onCanvasPointerMove = (e: PointerEvent) => {
      if (isDragging) return;
      const bbm = getManager();
      if (!bbm) return;
      updatePointer(e);
      const hit = getIntersectedGumball();
      if (hit) {
        bbm.setHoveredGumball(hit);
        canvas.style.cursor = 'grab';
      } else if (bbm.activeGumball) {
        bbm.setHoveredGumball(null);
        canvas.style.cursor = 'default';
      }
    };

    const onDocumentDragMove = (e: PointerEvent) => {
      if (!isDragging) return;
      e.stopPropagation();
      updatePointer(e);
      transformControls.pointerMove(getControlPointer(e, -1));
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      updatePointer(e);
      const bbm = getManager();
      const v = useSpeckleEngineStore.getState().viewer;
      if (!bbm || bbm.gumballHandles.length === 0) return;
      const cam = (v as { getRenderer: () => { renderingCamera: THREE.Camera } } | null)?.getRenderer().renderingCamera;
      if (!cam) return;
      raycaster.setFromCamera(pointer, cam);
      const intersects = raycaster.intersectObjects(bbm.gumballHandles, false);
      if (intersects.length === 0) return;

      const hit = intersects[0].object as THREE.Mesh;
      const hitWorldPoint = intersects[0].point;
      e.stopPropagation();

      isMoveHandle = !!hit.userData.isMoveHandle;
      const normal: THREE.Vector3 = hit.userData.faceNormal;
      dragNormal = isMoveHandle ? null : normal.clone();
      if (isMoveHandle) {
        dragAxis = 'xy';
      } else if (Math.abs(normal.x) > 0.5) dragAxis = 'x';
      else if (Math.abs(normal.y) > 0.5) dragAxis = 'y';
      else dragAxis = 'z';

      const bounds = bbm.currentBounds;
      if (bounds) {
        baseBoundsAtDragStart = {
          min: [...bounds.min] as [number, number, number],
          max: [...bounds.max] as [number, number, number],
        };
        if (dragAxis && dragAxis !== 'xy') {
          bbm.showDimensionLabel(baseBoundsAtDragStart, dragAxis);
        }
      }

      dragAnchor.position.copy(hitWorldPoint);
      dragStartAnchor = hitWorldPoint.clone();
      dragAnchor.visible = true;
      bbm.setHoveredGumball(hit);
      syncTransformAxis(dragAxis);
      transformControls.attach(dragAnchor);
      dragAnchor.updateMatrixWorld(true);
      transformHelper.updateMatrixWorld(true);
      transformControls.pointerDown(getControlPointer(e, 0));
      document.addEventListener('pointermove', onDocumentDragMove, true);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      e.stopPropagation();
      transformControls.pointerUp(getControlPointer(e, 0));
      isDragging = false;
      dragAxis = null;
      dragNormal = null;
      dragStartAnchor = null;
      baseBoundsAtDragStart = null;
      isMoveHandle = false;
      syncTransformAxis(null);
      transformControls.detach();
      dragAnchor.visible = false;
      transformHelper.visible = false;
      canvas.style.cursor = 'default';
      document.removeEventListener('pointermove', onDocumentDragMove, true);
      const { selectionExtension } = useSpeckleEngineStore.getState();
      getManager()?.hideDimensionLabel();
      if (selectionExtension) selectionExtension.enabled = true;
    };

    canvas.addEventListener('pointermove', onCanvasPointerMove, true);
    canvas.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);

    return () => {
      canvas.removeEventListener('pointermove', onCanvasPointerMove, true);
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointermove', onDocumentDragMove, true);
      canvas.style.cursor = 'default';
      transformControls.detach();
      transformControls.dispose();
      scene.remove(transformHelper);
      scene.remove(dragAnchor);
      const { cameraController, selectionExtension } = useSpeckleEngineStore.getState();
      getManager()?.hideDimensionLabel();
      if (cameraController) cameraController.enabled = true;
      if (selectionExtension) selectionExtension.enabled = true;
    };
  }, [isViewerReady, canEdit, editCardId, containerRef]);
}
