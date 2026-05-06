import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GeometryType } from '@speckle/viewer';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useSpeckleStore } from '@/store';
import { DARK_MODE } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';

export function useSpeckleDarkMode({
  isDarkMode,
  isViewerReady,
  linkedObjectIds,
  worldTree,
  applyFilterColors,
  isDarkModeRef,
}: {
  isDarkMode: boolean;
  isViewerReady: boolean;
  linkedObjectIds: Set<string>;
  worldTree: any;
  applyFilterColors: () => void;
  /** Shared ref: set true on enable, false on disable. Read by applyHover patch in initViewer. */
  isDarkModeRef: React.MutableRefObject<boolean>;
}) {
  // Persistent ref — survives between effect runs so the disable branch can read
  // the values saved by the enable branch.  Mirrors darkModeStateRef in backup.
  type DarkModeState = {
    sunIntensity: number;
    iblIntensity: number;
    ambientLights: Array<{ light: THREE.AmbientLight; intensity: number }>;
    sceneBackground: THREE.Color | THREE.Texture | null;
    clearColor: THREE.Color;
    clearAlpha: number;
    entityPointLights: THREE.PointLight[];
    entityObjectIds: string[];
    entityRenderViews: any[];
    entityEmissiveMat: THREE.MeshStandardMaterial | null;
    enforcementIntervalId: ReturnType<typeof setInterval> | null;
    pipelineShadowHookCleanup: (() => void) | null;
  };
  const darkModeStateRef = useRef<DarkModeState | null>(null);

  // ============================================================================
  // Effect - Dark Mode (Sound Source Lighting)
  // ============================================================================
  useEffect(() => {
    const { viewer, coordinator, selectionExtension: selExt, filteringExtension: filtExt } =
      useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer || !coordinator) return;

    const speckleRenderer = viewer.getRenderer();
    const scene = speckleRenderer.scene;
    const webglRenderer = speckleRenderer.renderer;
    const soundSphereManager = coordinator.getSoundSphereManager();
    const adapter = coordinator.getAdapter();

    if (isDarkMode) {
      // --- ENABLE DARK MODE ---
      isDarkModeRef.current = true;

      // 1. Save original light state
      const sunLight = speckleRenderer.sunLight;

      const ambientLights: Array<{ light: THREE.AmbientLight; intensity: number }> = [];
      scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.AmbientLight) {
          ambientLights.push({ light: obj, intensity: obj.intensity });
        }
      });

      const savedBackground = scene.background as THREE.Color | THREE.Texture | null;
      const savedClearColor = new THREE.Color();
      webglRenderer.getClearColor(savedClearColor);
      const savedClearAlpha = webglRenderer.getClearAlpha();

      // Collect entity-linked object IDs
      const entityObjectIds = Array.from(linkedObjectIds);

      // Collect render views for entity-linked objects
      const entityRenderViews: any[] = [];
      if (worldTree && entityObjectIds.length > 0) {
        const findNodeAndCollectRvs = (node: any, targetId: string): boolean => {
          const nodeId = node?.raw?.id || node?.model?.id || node?.id;
          if (nodeId === targetId) {
            const collectRvs = (n: any) => {
              const rv = n?.model?.renderView;
              if (rv) entityRenderViews.push(rv);
              const children = n?.model?.children || n?.children;
              if (children) children.forEach((c: any) => collectRvs(c));
            };
            collectRvs(node);
            return true;
          }
          const children = node?.model?.children || node?.children;
          if (children) {
            for (const child of children) {
              if (findNodeAndCollectRvs(child, targetId)) return true;
            }
          }
          return false;
        };

        const rootChildren =
          worldTree.tree?._root?.children ||
          worldTree._root?.children ||
          worldTree.root?.children ||
          worldTree.children;
        if (rootChildren) {
          entityObjectIds.forEach((objId) => {
            for (const child of rootChildren) {
              if (findNodeAndCollectRvs(child, objId)) break;
            }
          });
        }
      }

      // Read current IBL intensity from a batch material
      let savedIblIntensity = 1;
      try {
        const bIds: string[] = (speckleRenderer as any).getBatchIds();
        for (const bid of bIds) {
          const b = (speckleRenderer as any).getBatch(bid);
          if (b?.batchMaterial?.envMapIntensity !== undefined) {
            savedIblIntensity = b.batchMaterial.envMapIntensity;
            break;
          }
        }
      } catch { /* non-critical */ }

      // Initialize the persistent state ref with all saved values
      darkModeStateRef.current = {
        sunIntensity: sunLight.intensity,
        iblIntensity: savedIblIntensity,
        ambientLights,
        sceneBackground: savedBackground,
        clearColor: savedClearColor,
        clearAlpha: savedClearAlpha,
        entityPointLights: [],
        entityObjectIds,
        entityRenderViews,
        entityEmissiveMat: null,
        enforcementIntervalId: null,
        pipelineShadowHookCleanup: null,
      };
      const dm = darkModeStateRef.current;

      // Shared materials
      const darkOpaqueMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        side: THREE.DoubleSide,
        transparent: false,
        roughness: 0.85,
        metalness: 0.05,
      });

      const entityEmissiveMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(getCssColorHex('--color-primary')),
        emissiveIntensity: DARK_MODE.ENTITY_EMISSIVE_INTENSITY,
        roughness: 0,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      dm.entityEmissiveMat = entityEmissiveMat;
      const blackColor = new THREE.Color(0x000000);

      const applyDarkModeState = () => {
        if (!isDarkModeRef.current || !viewer) return;
        const r = viewer.getRenderer();
        const s = r.scene;

        r.sunLight.intensity = 0;
        r.indirectIBLIntensity = 0;
        s.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.AmbientLight) obj.intensity = 0;
        });

        s.background = blackColor;
        r.renderer.setClearColor(0x000000, 0);

        const entityLinkedSet = new Set(darkModeStateRef.current?.entityObjectIds ?? []);
        try {
          const filterState = filtExt?.filteringState;
          const hiddenSet = filterState?.hiddenObjects?.length
            ? new Set(filterState.hiddenObjects)
            : null;
          const isolatedSet = filterState?.isolatedObjects?.length
            ? new Set(filterState.isolatedObjects)
            : null;
          const selObjs = selExt?.getSelectedObjects() ?? [];
          const selectedSet = selObjs.length > 0
            ? new Set((selObjs as any[]).map((o) => o.id as string).filter(Boolean))
            : null;

          const needsFilter = hiddenSet || isolatedSet || selectedSet || entityLinkedSet.size > 0;
          const batchIds: string[] = (r as any).getBatchIds();
          for (const id of batchIds) {
            const batch = (r as any).getBatch(id);
            if (!batch || batch.geometryType !== GeometryType.MESH) continue;

            const rvs: any[] = needsFilter
              ? batch.renderViews.filter((rv: any) => {
                  const objId: string | undefined = rv.renderData?.id;
                  if (!objId) return true;
                  if (hiddenSet?.has(objId)) return false;
                  if (isolatedSet && !isolatedSet.has(objId)) return false;
                  if (selectedSet?.has(objId)) return false;
                  if (entityLinkedSet.has(objId)) return false;
                  return true;
                })
              : batch.renderViews;

            if (rvs.length > 0) r.setMaterial(rvs, darkOpaqueMat);
          }

          if (selObjs.length > 0) {
            try {
              const ids = (selObjs as any[]).map((o: any) => o.id as string).filter(Boolean);
              selExt?.selectObjects(ids);
            } catch { /* non-critical */ }
          }
        } catch { /* non-critical */ }

        if (entityLinkedSet.size > 0) {
          try {
            const entityRvs: any[] = [];
            const bIds: string[] = (r as any).getBatchIds();
            for (const bid of bIds) {
              const b = (r as any).getBatch(bid);
              if (!b || b.geometryType !== GeometryType.MESH) continue;
              for (const rv of b.renderViews) {
                const objId: string | undefined = rv.renderData?.id;
                if (objId && entityLinkedSet.has(objId)) entityRvs.push(rv);
              }
            }
            if (entityRvs.length > 0 && dm.entityEmissiveMat) r.setMaterial(entityRvs, dm.entityEmissiveMat);
          } catch { /* non-critical */ }
        }

        if (coordinator) {
          const ssm = coordinator.getSoundSphereManager();
          if (ssm) ssm.enforceDarkModeColors();
        }

        r.shadowMapNeedsUpdate = true;
        r.needsRender = true;
      };

      applyDarkModeState();

      // Hook each GEOMETRY pass to ensure shadow maps render correctly in dark mode
      const pipeline = speckleRenderer.pipeline as any;
      const allStagePasses: any[] = [
        ...(pipeline.dynamicStage ?? []),
        ...(pipeline.progressiveStage ?? []),
        ...(pipeline.passthroughStage ?? []),
      ];
      const uniquePasses = [...new Set(allStagePasses)];
      const geometryPasses = uniquePasses.filter((p: any) => p.displayName === 'GEOMETRY');

      const passCleanups: Array<() => void> = [];
      geometryPasses.forEach((p: any) => {
        const origOnBeforeRender = p.onBeforeRender;
        p.onBeforeRender = () => {
          if (isDarkModeRef.current) speckleRenderer.shadowMapNeedsUpdate = true;
          origOnBeforeRender?.();
        };
        passCleanups.push(() => { p.onBeforeRender = origOnBeforeRender; });
      });
      dm.pipelineShadowHookCleanup = () => { passCleanups.forEach(fn => fn()); };

      // Enable dark mode on sound spheres
      if (soundSphereManager) soundSphereManager.enableDarkMode();

      // Add point lights at entity positions
      if (soundSphereManager && adapter) {
        const entityPositions = soundSphereManager.getEntityLinkedSoundPositions();
        const customGroup = adapter.getCustomObjectsGroup();

        entityPositions.forEach(({ id, position }: { id: string; position: [number, number, number] }) => {
          const light = new THREE.PointLight(
            getCssColorHex('--color-primary'),
            DARK_MODE.ENTITY_LIGHT_INTENSITY,
            DARK_MODE.ENTITY_LIGHT_DISTANCE,
            DARK_MODE.POINT_LIGHT_DECAY
          );
          light.name = `DarkModeEntityLight_${id}`;
          light.position.set(position[0], position[1], position[2]);
          light.layers.enableAll();
          light.castShadow = true;
          light.shadow.mapSize.width = DARK_MODE.SHADOW_MAP_SIZE;
          light.shadow.mapSize.height = DARK_MODE.SHADOW_MAP_SIZE;
          light.shadow.camera.near = DARK_MODE.SHADOW_CAMERA_NEAR;
          light.shadow.camera.far = DARK_MODE.ENTITY_LIGHT_DISTANCE;
          light.shadow.bias = DARK_MODE.SHADOW_BIAS;
          customGroup.add(light);
          dm.entityPointLights.push(light);
        });
      }

      // Start enforcement interval
      const intervalId = setInterval(applyDarkModeState, 150);
      dm.enforcementIntervalId = intervalId;

      viewer.requestRender(8);
      setTimeout(() => viewer.requestRender(), 50);

      console.log('[useSpeckleDarkMode] Dark mode enabled', {
        entityObjects: dm.entityObjectIds.length,
      });
    } else {
      // --- DISABLE DARK MODE ---
      isDarkModeRef.current = false;

      // Read the state saved when dark mode was enabled
      const saved = darkModeStateRef.current;
      if (!saved) return; // Dark mode was never enabled — nothing to restore

      // Stop enforcement interval
      if (saved.enforcementIntervalId) {
        clearInterval(saved.enforcementIntervalId);
      }
      saved.pipelineShadowHookCleanup?.();

      scene.background = saved.sceneBackground;
      webglRenderer.setClearColor(saved.clearColor, saved.clearAlpha);

      if (soundSphereManager) soundSphereManager.disableDarkMode();

      if (adapter) {
        const customGroup = adapter.getCustomObjectsGroup();
        saved.entityPointLights.forEach((light) => {
          customGroup.remove(light);
          light.dispose();
        });
      }

      try {
        speckleRenderer.resetMaterials();
      } catch { /* non-critical */ }

      try {
        if (filtExt) {
          const fs = filtExt.filteringState;
          if (fs?.hiddenObjects?.length) {
            filtExt.hideObjects(fs.hiddenObjects, undefined, true, false);
          }
          if (fs?.isolatedObjects?.length) {
            filtExt.isolateObjects(fs.isolatedObjects, undefined, true, true);
          }
        }
      } catch { /* non-critical */ }

      const sunLight = speckleRenderer.sunLight;
      sunLight.intensity = saved.sunIntensity;
      saved.ambientLights.forEach(({ light, intensity }) => { light.intensity = intensity; });
      speckleRenderer.indirectIBLIntensity = saved.iblIntensity;

      // Restore singleton filter material IBL
      try {
        const matModule = (speckleRenderer as any).batcher?.materials;
        if (matModule) {
          const singletons = [
            matModule.meshColoredMaterial,
            matModule.meshTransparentColoredMaterial,
            matModule.meshGhostMaterial,
            matModule.lineColoredMaterial,
            matModule.pointCloudColouredMaterial,
          ];
          for (const mat of singletons) {
            if (mat && 'envMapIntensity' in mat) {
              (mat as any).envMapIntensity = saved.iblIntensity;
            }
          }
        }
      } catch { /* non-critical */ }

      const capturedIbl = saved.iblIntensity;
      setTimeout(() => {
        applyFilterColors();
        try {
          const r = viewer.getRenderer();
          if (r) {
            r.indirectIBLIntensity = capturedIbl;
            r.needsRender = true;
          }
        } catch { /* non-critical */ }
      }, 100);

      darkModeStateRef.current = null;

      viewer.requestRender(8);
      setTimeout(() => viewer.requestRender(), 50);
      console.log('[useSpeckleDarkMode] Dark mode disabled');
    }

    return () => {
      if (darkModeStateRef.current?.enforcementIntervalId) {
        clearInterval(darkModeStateRef.current.enforcementIntervalId);
      }
      darkModeStateRef.current?.pipelineShadowHookCleanup?.();
    };
  }, [isDarkMode, isViewerReady]);

  // ============================================================================
  // Effect - Sync entityObjectIds + object-center point lights in dark mode
  // ============================================================================
  useEffect(() => {
    if (!isDarkMode || !darkModeStateRef.current) return;
    const { viewer, coordinator } = useSpeckleEngineStore.getState();
    if (!viewer) return;

    // Update entityObjectIds on the persistent ref so the enforcement interval picks up changes
    darkModeStateRef.current.entityObjectIds = Array.from(linkedObjectIds);

    const adapter = coordinator?.getAdapter();
    if (!adapter) return;

    const r = viewer.getRenderer();
    const customGroup = adapter.getCustomObjectsGroup();

    // Remove previously placed object-center lights (from scene AND from tracking array)
    // Mirrors the backup: filter entityPointLights to keep only DarkModeEntityLight_* entries
    if (darkModeStateRef.current) {
      darkModeStateRef.current.entityPointLights = darkModeStateRef.current.entityPointLights.filter((light) => {
        if (light.name.startsWith('DarkModeObjectLight_')) {
          customGroup.remove(light);
          light.dispose();
          return false;
        }
        return true;
      });
    }

    if (linkedObjectIds.size === 0) return;

    const entitySet = new Set(linkedObjectIds);
    const boxPerObject = new Map<string, THREE.Box3>();

    try {
      const bIds: string[] = (r as any).getBatchIds();
      for (const bid of bIds) {
        const b = (r as any).getBatch(bid);
        if (!b || b.geometryType !== GeometryType.MESH) continue;
        for (const rv of b.renderViews) {
          const objId: string | undefined = rv.renderData?.id;
          if (!objId || !entitySet.has(objId)) continue;
          const rvAabb: THREE.Box3 = rv.aabb;
          if (!rvAabb) continue;
          if (!boxPerObject.has(objId)) {
            boxPerObject.set(objId, rvAabb.clone());
          } else {
            boxPerObject.get(objId)!.union(rvAabb);
          }
        }
      }
    } catch { /* non-critical */ }

    const center = new THREE.Vector3();
    boxPerObject.forEach((box, objId) => {
      if (box.isEmpty()) return;
      box.getCenter(center);
      const light = new THREE.PointLight(
        getCssColorHex('--color-primary'),
        DARK_MODE.POINT_LIGHT_INTENSITY,
        DARK_MODE.POINT_LIGHT_DISTANCE,
        DARK_MODE.POINT_LIGHT_DECAY
      );
      light.name = `DarkModeObjectLight_${objId}`;
      light.position.copy(center);
      light.layers.enableAll();
      customGroup.add(light);
      // Track in the persistent state so the disable branch can remove them
      darkModeStateRef.current?.entityPointLights.push(light);
    });
  }, [isDarkMode, linkedObjectIds]);
}
