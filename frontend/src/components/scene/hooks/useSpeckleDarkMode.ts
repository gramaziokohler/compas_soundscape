import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GeometryType } from '@speckle/viewer';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
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
  // the values saved by the enable branch.
  type DarkModeState = {
    sunIntensity: number;
    iblIntensity: number;
    /** All scene lights captured at enable (ambient/directional/hemisphere/…) —
     *  zeroed every tick so a render pass that restores them can't leak ambient. */
    ambientLights: Array<{ light: THREE.Light; intensity: number }>;
    sceneBackground: THREE.Color | THREE.Texture | null;
    clearColor: THREE.Color;
    clearAlpha: number;
    /** Object-center lights only (entity/marker lights now live in SoundSphereManager). */
    entityPointLights: THREE.PointLight[];
    entityObjectIds: string[];
    entityRenderViews: any[];
    /** SelectionExtension options saved before dark mode overrode the selection fill. */
    prevSelectionOptions: any;
    enforcementIntervalId: ReturnType<typeof setInterval> | null;
    pipelineShadowHookCleanup: (() => void) | null;
  };
  const darkModeStateRef = useRef<DarkModeState | null>(null);

  // Cheap change signature — a full material pass only runs when the visibility/
  // selection/link state actually changes. Resets on re-enable.
  const signatureRef = useRef<string>('');

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
      signatureRef.current = '';

      // 1. Save original light state
      const sunLight = speckleRenderer.sunLight;

      const ambientLights: Array<{ light: THREE.Light; intensity: number }> = [];
      scene.traverse((obj: THREE.Object3D) => {
        const maybeLight = obj as THREE.Light;
        if ((maybeLight as unknown as { isLight?: boolean }).isLight) {
          ambientLights.push({ light: maybeLight, intensity: maybeLight.intensity });
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
        prevSelectionOptions: null,
        enforcementIntervalId: null,
        pipelineShadowHookCleanup: null,
      };
      const dm = darkModeStateRef.current;

      // Shared materials. Fully rough + non-metallic + zero env intensity so it
      // cannot pick up the selection-highlight color as a specular/env tint on
      // neighbouring objects (which read as stray colored bands).
      const darkOpaqueMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        side: THREE.DoubleSide,
        transparent: false,
        roughness: 1,
        metalness: 0,
        envMapIntensity: 0,
      });

      const darkBackground = new THREE.Color(0x000000);

      /** Fast FNV-1a hash of a string-id array for the change signature. */
      const hashIds = (ids: Array<string> | undefined | null): string => {
        if (!ids || ids.length === 0) return '0';
        let h = 2166136261;
        for (let i = 0; i < ids.length; i++) {
          const s = ids[i];
          for (let j = 0; j < s.length; j++) {
            h ^= s.charCodeAt(j);
            h = Math.imul(h, 16777619);
          }
        }
        return `${ids.length}:${(h >>> 0).toString(36)}`;
      };

      const applyDarkModeState = (force: boolean) => {
        if (!isDarkModeRef.current || !viewer) return;
        const r = viewer.getRenderer();
        const s = r.scene;

        // Always kill ambient/IBL/background. This is cheap (a handful of
        // intensity writes) and must run every tick because some Speckle render
        // passes restore them — the old 150ms loop masked that by re-zeroing the
        // whole scene each tick. Kept out of the gated material pass below.
        r.sunLight.intensity = 0;
        r.indirectIBLIntensity = 0;
        for (const { light } of dm.ambientLights) light.intensity = 0;
        s.background = darkBackground;
        r.renderer.setClearColor(0x000000, 1);

        // Build the gate/filter sets once per pass.
        let hiddenSet: Set<string> | null = null;
        let isolatedSet: Set<string> | null = null;
        let selectedSet: Set<string> | null = null;
        let selObjs: any[] = [];
        try {
          const filterState = filtExt?.filteringState;
          if (filterState?.hiddenObjects?.length) hiddenSet = new Set(filterState.hiddenObjects);
          if (filterState?.isolatedObjects?.length) isolatedSet = new Set(filterState.isolatedObjects);
          selObjs = selExt?.getSelectedObjects() ?? [];
          if (selObjs.length > 0) {
            selectedSet = new Set((selObjs as any[]).map((o) => o.id as string).filter(Boolean));
          }
        } catch { /* non-critical */ }

        // Idempotency: skip the expensive material pass when nothing relevant changed.
        const signature = [
          hashIds(hiddenSet ? Array.from(hiddenSet) : null),
          hashIds(isolatedSet ? Array.from(isolatedSet) : null),
          hashIds(selectedSet ? Array.from(selectedSet) : null),
          hashIds(darkModeStateRef.current?.entityObjectIds),
        ].join('|');

        if (!force && signature === signatureRef.current) {
          // Cheap path — keep sphere colors/opacity coherent, no material churn.
          soundSphereManager?.enforceDarkModeColors();
          return;
        }
        signatureRef.current = signature;

        try {
          const needsFilter = hiddenSet || isolatedSet || selectedSet;
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
                  return true;
                })
              : batch.renderViews;

            if (rvs.length > 0) r.setMaterial(rvs, darkOpaqueMat);
          }
        } catch { /* non-critical */ }

        soundSphereManager?.enforceDarkModeColors();
        r.shadowMapNeedsUpdate = true;
        r.needsRender = true;
      };

      applyDarkModeState(true);

      // In dark mode, strip the selection FILL and any applied filter/main
      // material color: the selected object keeps the dark fill and shows only
      // the stencil outline border (outlineColor). This is what makes a selected
      // mesh read as "outlined" instead of flooded with the highlight color.
      try {
        if (selExt?.options) {
          dm.prevSelectionOptions = selExt.options;
          const baseSel: any = selExt.options.selectionMaterialData;
          (selExt as any).options = {
            ...selExt.options,
            selectionMaterialData: {
              ...baseSel,
              color: 0x1a1a2e,
              emissive: 0,
              opacity: 1,
              outlineColor: getCssColorHex('--color-primary'),
            },
          };
          // Repaint the current selection with the new material.
          const cur = (selExt.getSelectedObjects?.() ?? []) as any[];
          const ids = cur.map((o) => (typeof o === 'string' ? o : o?.id)).filter(Boolean) as string[];
          if (ids.length) selExt.selectObjects(ids);
        }
      } catch { /* non-critical */ }

      // Hook each GEOMETRY pass to ensure shadow maps render correctly in dark
      // mode. Only needed while shadows are actually enabled (budget > 0).
      const passCleanups: Array<() => void> = [];
      if (DARK_MODE.MAX_SHADOW_CASTING_LIGHTS > 0) {
        const pipeline = speckleRenderer.pipeline as any;
        const allStagePasses: any[] = [
          ...(pipeline.dynamicStage ?? []),
          ...(pipeline.progressiveStage ?? []),
          ...(pipeline.passthroughStage ?? []),
        ];
        const uniquePasses = [...new Set(allStagePasses)];
        const geometryPasses = uniquePasses.filter((p: any) => p.displayName === 'GEOMETRY');

        geometryPasses.forEach((p: any) => {
          const origOnBeforeRender = p.onBeforeRender;
          p.onBeforeRender = () => {
            if (isDarkModeRef.current) speckleRenderer.shadowMapNeedsUpdate = true;
            origOnBeforeRender?.();
          };
          passCleanups.push(() => { p.onBeforeRender = origOnBeforeRender; });
        });
      }
      dm.pipelineShadowHookCleanup = () => { passCleanups.forEach(fn => fn()); };

      // Enable dark mode on sound spheres
      if (soundSphereManager) soundSphereManager.enableDarkMode();

      // Add point lights at entity positions (managed + shadow-budgeted by the manager)
      if (soundSphereManager) {
        const entityPositions = soundSphereManager.getEntityLinkedSoundPositions();
        entityPositions.forEach(({ id, position }: { id: string; position: [number, number, number] }) => {
          soundSphereManager.addEntityDarkModeLight(
            id,
            position,
            DARK_MODE.ENTITY_LIGHT_INTENSITY,
            DARK_MODE.ENTITY_LIGHT_DISTANCE
          );
        });
      }

      // Idempotent enforcement safety-net. Full passes are skipped unless the
      // visibility/selection/link signature changed; the cheap sphere-color
      // guard still runs every tick.
      const intervalId = setInterval(() => applyDarkModeState(false), DARK_MODE.ENFORCEMENT_INTERVAL_MS);
      dm.enforcementIntervalId = intervalId;

      viewer.requestRender(8);
      setTimeout(() => viewer.requestRender(), 50);

      console.log('[useSpeckleDarkMode] Dark mode enabled', {
        entityObjects: dm.entityObjectIds.length,
        shadowCasters: DARK_MODE.MAX_SHADOW_CASTING_LIGHTS,
      });
    } else {
      // --- DISABLE DARK MODE ---
      isDarkModeRef.current = false;
      signatureRef.current = '';

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

      // Restore the original SelectionExtension material (undo the dark-mode
      // outline-only override) and repaint the current selection.
      try {
        if (saved.prevSelectionOptions && selExt) {
          (selExt as any).options = saved.prevSelectionOptions;
          const cur = (selExt.getSelectedObjects?.() ?? []) as any[];
          const ids = cur.map((o) => (typeof o === 'string' ? o : o?.id)).filter(Boolean) as string[];
          if (ids.length) selExt.selectObjects(ids);
        }
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
  // Effect - Ensure a (reactive) light exists for every linked sound
  // ============================================================================
  useEffect(() => {
    if (!isDarkMode || !darkModeStateRef.current) return;
    const { viewer, coordinator } = useSpeckleEngineStore.getState();
    if (!viewer) return;

    // Update entityObjectIds on the persistent ref so the enforcement interval picks up changes
    darkModeStateRef.current.entityObjectIds = Array.from(linkedObjectIds);

    // Linked objects are lit ONLY by the SoundSphereManager's entity light, which
    // is keyed by the sound id and therefore reacts to playback exactly like the
    // per-sphere lights. (The old, separate object-center light is gone: it was
    // static, duplicated the entity light, and never turned off during playback.)
    const ssm = coordinator?.getSoundSphereManager();
    if (ssm) {
      ssm.getEntityLinkedSoundPositions().forEach(({ id, position }) => {
        ssm.addEntityDarkModeLight(
          id,
          position,
          DARK_MODE.ENTITY_LIGHT_INTENSITY,
          DARK_MODE.ENTITY_LIGHT_DISTANCE
        );
      });
      viewer.requestRender();
    }
  }, [isDarkMode, linkedObjectIds]);
}
