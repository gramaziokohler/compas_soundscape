import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { BoundingBoxBounds } from '@/lib/three/BoundingBoxManager';

interface BoundingBoxGumballProps {
  isViewerReady: boolean;
  showBoundingBox?: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  resonanceAudioConfig?: { roomMaterials?: any };
  onBoundsComputed?: (bounds: { min: [number, number, number]; max: [number, number, number] }) => void;
  roomScale: { x: number; y: number; z: number };
  refreshBoundingBoxTrigger: number;
}

export function useSpeckleBoundingBoxGumball({
  isViewerReady,
  showBoundingBox,
  containerRef,
  resonanceAudioConfig,
  onBoundsComputed,
  roomScale,
  refreshBoundingBoxTrigger,
}: BoundingBoxGumballProps) {
  const [draggedBoundsOverride, setDraggedBoundsOverride] = useState<BoundingBoxBounds | null>(null);

  // Reset override when room scale or refresh trigger changes
  useEffect(() => { setDraggedBoundsOverride(null); }, [roomScale.x, roomScale.y, roomScale.z]);
  useEffect(() => { setDraggedBoundsOverride(null); }, [refreshBoundingBoxTrigger]);

  useEffect(() => {
    const canvas = containerRef.current?.querySelector('canvas');
    const { viewer, boundingBoxManager } = useSpeckleEngineStore.getState();
    if (!canvas || !viewer || !boundingBoxManager || !showBoundingBox) return;

    let isDragging = false;
    let dragAxis: 'x' | 'y' | 'z' | null = null;
    let dragNormal: THREE.Vector3 | null = null;
    let dragStartAnchor: THREE.Vector3 | null = null;
    let baseBoundsAtDragStart: BoundingBoxBounds | null = null;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const scene = viewer.getRenderer().scene;
    const camera = (viewer as any).getRenderer().renderingCamera as THREE.Camera | null;
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
      if (Math.abs(normal.x) > 0.5) {
        if (normal.x > 0) nextBounds.max[0] += delta;
        else nextBounds.min[0] -= delta;
      } else if (Math.abs(normal.y) > 0.5) {
        if (normal.y > 0) nextBounds.max[1] += delta;
        else nextBounds.min[1] -= delta;
      } else if (Math.abs(normal.z) > 0.5) {
        if (normal.z > 0) nextBounds.max[2] += delta;
        else nextBounds.min[2] -= delta;
      }
      return nextBounds;
    };

    const syncTransformAxis = (axis: 'x' | 'y' | 'z' | null) => {
      const axisToken: 'X' | 'Y' | 'Z' | null =
        axis === 'x' ? 'X' : axis === 'y' ? 'Y' : axis === 'z' ? 'Z' : null;
      transformControls.showX = axis === 'x';
      transformControls.showY = axis === 'y';
      transformControls.showZ = axis === 'z';
      transformControls.axis = axisToken;
    };

    transformControls.addEventListener('change', () => viewer.requestRender());

    transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = !!(event as { value?: boolean }).value;
      isDragging = dragging;
      const { cameraController, selectionExtension } = useSpeckleEngineStore.getState();
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
      const { boundingBoxManager: bbm } = useSpeckleEngineStore.getState();
      if (!dragNormal || !dragStartAnchor || !baseBoundsAtDragStart || !bbm) return;

      const projectedDelta = new THREE.Vector3()
        .subVectors(dragAnchor.position, dragStartAnchor)
        .dot(dragNormal);
      const previewBounds = moveDraggedFace(baseBoundsAtDragStart, dragNormal, projectedDelta);

      bbm.updateBoundingBox(previewBounds, {
        roomMaterials: resonanceAudioConfig?.roomMaterials,
        visible: showBoundingBox,
      });
      setDraggedBoundsOverride(previewBounds);
      onBoundsComputed?.(previewBounds);
      viewer.requestRender(8);
      viewer.requestRender();
    });

    const getIntersectedGumball = () => {
      const { boundingBoxManager: bbm, viewer: v } = useSpeckleEngineStore.getState();
      if (!bbm || bbm.gumballHandles.length === 0 || !showBoundingBox) return null;
      const cam = (v as any)?.getRenderer().renderingCamera;
      if (!cam) return null;
      raycaster.setFromCamera(pointer, cam);
      const intersects = raycaster.intersectObjects(bbm.gumballHandles, false);
      return intersects.length > 0 ? (intersects[0].object as THREE.Mesh) : null;
    };

    const onCanvasPointerMove = (e: PointerEvent) => {
      if (isDragging) return;
      const { boundingBoxManager: bbm } = useSpeckleEngineStore.getState();
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
      updatePointer(e);
      const { boundingBoxManager: bbm, viewer: v } = useSpeckleEngineStore.getState();
      if (!bbm || bbm.gumballHandles.length === 0 || !showBoundingBox) return;
      const cam = (v as any)?.getRenderer().renderingCamera;
      if (!cam) return;
      raycaster.setFromCamera(pointer, cam);
      const intersects = raycaster.intersectObjects(bbm.gumballHandles, false);
      if (intersects.length === 0) return;

      const hit = intersects[0].object as THREE.Mesh;
      const hitWorldPoint = intersects[0].point;
      e.stopPropagation();

      const normal: THREE.Vector3 = hit.userData.faceNormal;
      dragNormal = normal.clone();
      if (Math.abs(normal.x) > 0.5) dragAxis = 'x';
      else if (Math.abs(normal.y) > 0.5) dragAxis = 'y';
      else dragAxis = 'z';

      const bounds = bbm.currentBounds;
      if (bounds) {
        baseBoundsAtDragStart = {
          min: [...bounds.min] as [number, number, number],
          max: [...bounds.max] as [number, number, number],
        };
      }

      dragAnchor.position.copy(hitWorldPoint);
      dragStartAnchor = hitWorldPoint.clone();
      dragAnchor.visible = true;
      transformHelper.visible = true;
      syncTransformAxis(dragAxis);
      transformControls.attach(dragAnchor);
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
      syncTransformAxis(null);
      transformControls.detach();
      dragAnchor.visible = false;
      transformHelper.visible = false;
      canvas.style.cursor = 'default';
      document.removeEventListener('pointermove', onDocumentDragMove, true);
      const { selectionExtension } = useSpeckleEngineStore.getState();
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
      if (cameraController) cameraController.enabled = true;
      if (selectionExtension) selectionExtension.enabled = true;
    };
  }, [isViewerReady, showBoundingBox]);

  return { draggedBoundsOverride };
}
