'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect, useMemo } from 'react';
import { FilteringExtension, type Viewer } from '@speckle/viewer';
import { SPECKLE_FILTER_COLORS } from '@/utils/constants';

/**
 * Selected entity data for display in RightSidebar
 */
export interface SelectedEntityInfo {
  objectId: string;
  objectName: string;
  objectType: string;
  parentName?: string;
  /** Present when a receiver sphere is selected */
  receiverData?: {
    position: [number, number, number];
  };
  /** Present when a sound sphere is selected */
  soundData?: {
    promptIndex: number;
  };
}

/**
 * Color group for material assignment or other custom coloring
 */
export interface ColorGroup {
  objectIds: string[];
  color: string;
}

/**
 * Context value interface
 *
 * Manages object-to-sound linking and diverse selection for Speckle objects.
 * Uses FilteringExtension to color objects based on their state:
 * - Light pink: Objects linked to sounds (config state, no audio generated yet)
 * - Full pink: Objects linked to sounds WITH generated audio
 * - Green: Objects selected for diverse analysis
 * - Custom: Material assignment colors (registered externally)
 */
interface SpeckleSelectionModeContextType {
  // Objects with linked sounds (objectId -> soundTabIndex)
  linkedObjectIds: Set<string>;

  // Objects selected for diverse analysis
  diverseSelectedObjectIds: Set<string>;

  // Version number to track link changes (increments on link/unlink)
  linkVersion: number;

  // Currently selected entity for display in RightSidebar
  selectedEntity: SelectedEntityInfo | null;
  setSelectedEntity: (entity: SelectedEntityInfo | null) => void;

  // Link management
  linkObjectToSound: (objectId: string, soundTabIndex: number, hasGeneratedSound?: boolean) => void;
  unlinkObjectFromSound: (objectId: string) => void;

  // Diverse selection management
  addToDiverseSelection: (objectId: string) => void;
  removeFromDiverseSelection: (objectId: string) => void;
  clearDiverseSelection: () => void;
  setDiverseSelection: (objectIds: string[]) => void;

  // Get state for a specific object
  getObjectLinkState: (objectId: string) => {
    isLinked: boolean;
    isDiverse: boolean;
    linkColor: string;
    linkedSoundIndex?: number;
  };

  // Viewer integration
  setViewer: (viewer: Viewer | null) => void;

  // Apply colors to all tracked objects using FilteringExtension
  applyFilterColors: () => void;

  // Clear all filter colors
  clearFilterColors: () => void;

  // Material colors registration (for acoustic simulation material assignment)
  // These colors are merged with diverse/linked colors in applyFilterColors
  registerMaterialColors: (colors: ColorGroup[]) => void;
  clearMaterialColors: () => void;
}

const SpeckleSelectionModeContext = createContext<SpeckleSelectionModeContextType | null>(null);

interface SpeckleSelectionModeProviderProps {
  children: ReactNode;
}

/**
 * SpeckleSelectionModeProvider
 *
 * Manages the visual state of Speckle objects using FilteringExtension:
 * - Green coloring for objects linked to sounds
 * - Pink coloring for objects selected for diverse analysis
 *
 * Note: SelectionExtension is still used elsewhere for interactive selection.
 * This context only manages the coloring of linked/diverse objects.
 */
export function SpeckleSelectionModeProvider({ children }: SpeckleSelectionModeProviderProps) {
  // Track which objects are linked to which sound tabs (objectId -> soundTabIndex)
  const [objectSoundLinks, setObjectSoundLinks] = useState<Map<string, number>>(new Map());

  // Track which linked objects have generated sound (full pink vs light pink)
  const [generatedSoundObjectIds, setGeneratedSoundObjectIds] = useState<Set<string>>(new Set());

  // Track which objects are selected for diverse analysis
  const [diverseSelectedObjectIds, setDiverseSelectedObjectIds] = useState<Set<string>>(new Set());

  // Version number to force re-renders when links change
  const [linkVersion, setLinkVersion] = useState(0);

  // Currently selected entity for display in RightSidebar
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntityInfo | null>(null);

  // Viewer reference for FilteringExtension access
  const viewerRef = useRef<Viewer | null>(null);

  // Refs to track current state for applyFilterColors (avoids stale closure)
  // These are updated synchronously in the setter functions, not via effects
  const objectSoundLinksRef = useRef(objectSoundLinks);
  const generatedSoundObjectIdsRef = useRef(generatedSoundObjectIds);
  const diverseSelectedObjectIdsRef = useRef(diverseSelectedObjectIds);

  // Material colors registered by SpeckleSurfaceMaterialsSection
  const materialColorsRef = useRef<ColorGroup[]>([]);

  const setViewer = useCallback((viewer: Viewer | null) => {
    viewerRef.current = viewer;
  }, []);

  // Apply filter colors using FilteringExtension.setUserObjectColors
  // Uses refs to avoid recreating this function when state changes
  // Merges diverse/linked colors with registered material colors
  const applyFilterColors = useCallback(() => {
    if (!viewerRef.current) return;

    const filteringExt = viewerRef.current.getExtension(FilteringExtension);
    if (!filteringExt) {
      console.warn('[SpeckleSelectionModeContext] FilteringExtension not available');
      return;
    }

    // Read from refs to get current state
    const currentLinks = objectSoundLinksRef.current;
    const currentGenerated = generatedSoundObjectIdsRef.current;
    const currentDiverse = diverseSelectedObjectIdsRef.current;
    const materialColors = materialColorsRef.current;

    // Build color groups for FilteringExtension
    const colorGroups: { objectIds: string[]; color: string }[] = [];

    // First: Material colors (lowest priority - can be overridden by diverse/linked)
    if (materialColors.length > 0) {
      colorGroups.push(...materialColors);
    }

    // Second: Green for diverse-selected objects (exclude those that are already linked)
    const diverseOnlyIds = Array.from(currentDiverse).filter(
      id => !currentLinks.has(id)
    );
    if (diverseOnlyIds.length > 0) {
      colorGroups.push({
        objectIds: diverseOnlyIds,
        color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION
      });
    }

    // Third: Light pink for sound-linked objects WITHOUT generated sound (pending/config state)
    const pendingLinkedIds = Array.from(currentLinks.keys()).filter(
      id => !currentGenerated.has(id)
    );
    if (pendingLinkedIds.length > 0) {
      colorGroups.push({
        objectIds: pendingLinkedIds,
        color: SPECKLE_FILTER_COLORS.SOUND_LINKED_PENDING
      });
    }

    // Fourth: Full pink for sound-linked objects WITH generated sound (highest priority)
    const generatedLinkedIds = Array.from(currentLinks.keys()).filter(
      id => currentGenerated.has(id)
    );
    if (generatedLinkedIds.length > 0) {
      colorGroups.push({
        objectIds: generatedLinkedIds,
        color: SPECKLE_FILTER_COLORS.SOUND_LINKED
      });
    }

    // Apply colors
    if (colorGroups.length > 0) {
      filteringExt.setUserObjectColors(colorGroups);
      console.log('[Context] Applied colors - material:', materialColors.length, 'groups, diverse:', diverseOnlyIds.length, 'pending:', pendingLinkedIds.length, 'generated:', generatedLinkedIds.length);
    } else {
      // Clear colors if no objects to color
      filteringExt.removeUserObjectColors();
      console.log('[Context] Cleared all colors (no objects)');
    }

    // Request render update
    viewerRef.current.requestRender();
  }, []); // No dependencies - uses refs for current state

  // Clear all filter colors
  const clearFilterColors = useCallback(() => {
    if (!viewerRef.current) return;

    const filteringExt = viewerRef.current.getExtension(FilteringExtension);
    if (filteringExt) {
      filteringExt.removeUserObjectColors();
      viewerRef.current.requestRender();
    }
  }, []);

  // Register material colors (from SpeckleSurfaceMaterialsSection)
  // These will be merged with diverse/linked colors in applyFilterColors
  const registerMaterialColors = useCallback((colors: ColorGroup[]) => {
    materialColorsRef.current = colors;
    console.log('[Context] Registered material colors:', colors.length, 'groups');
    // Re-apply all colors to merge
    applyFilterColors();
  }, [applyFilterColors]);

  // Clear registered material colors
  const clearMaterialColors = useCallback(() => {
    materialColorsRef.current = [];
    console.log('[Context] Cleared material colors');
    // Re-apply remaining colors
    applyFilterColors();
  }, [applyFilterColors]);

  // Auto-apply colors when links or diverse selection changes
  // Use a version counter to trigger re-application
  const [colorVersion, setColorVersion] = useState(0);

  useEffect(() => {
    // Increment color version when state changes to trigger re-apply
    setColorVersion(v => v + 1);
  }, [objectSoundLinks, generatedSoundObjectIds, diverseSelectedObjectIds]);

  useEffect(() => {
    if (colorVersion === 0) return; // Skip initial render

    // Small delay to batch rapid changes
    const timeoutId = setTimeout(() => {
      applyFilterColors();
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [colorVersion, applyFilterColors]);

  // Link management
  const linkObjectToSound = useCallback((objectId: string, soundTabIndex: number, hasGeneratedSound = false) => {
    setObjectSoundLinks(prev => {
      // Check if already linked to same index
      if (prev.get(objectId) === soundTabIndex) return prev;
      const next = new Map(prev);
      next.set(objectId, soundTabIndex);
      // Update ref synchronously for immediate access by applyFilterColors
      objectSoundLinksRef.current = next;
      return next;
    });

    // Track generated sound state (upgrade to full pink or downgrade to light pink)
    if (hasGeneratedSound) {
      setGeneratedSoundObjectIds(prev => {
        if (prev.has(objectId)) return prev;
        const next = new Set(prev).add(objectId);
        generatedSoundObjectIdsRef.current = next;
        return next;
      });
    } else {
      // Downgrade: remove from generated set if present (e.g. reset to config)
      setGeneratedSoundObjectIds(prev => {
        if (!prev.has(objectId)) return prev;
        const next = new Set(prev);
        next.delete(objectId);
        generatedSoundObjectIdsRef.current = next;
        return next;
      });
    }

    // Remove from diverse selection if linked (linked takes priority)
    setDiverseSelectedObjectIds(prev => {
      if (!prev.has(objectId)) return prev; // No change needed
      const next = new Set(prev);
      next.delete(objectId);
      // Update ref synchronously
      diverseSelectedObjectIdsRef.current = next;
      return next;
    });

    // Increment version to force re-renders
    setLinkVersion(v => v + 1);
  }, []);

  const unlinkObjectFromSound = useCallback((objectId: string) => {
    setObjectSoundLinks(prev => {
      if (!prev.has(objectId)) return prev; // No change needed
      const next = new Map(prev);
      next.delete(objectId);
      // Update ref synchronously
      objectSoundLinksRef.current = next;
      return next;
    });

    // Also remove from generated sound tracking
    setGeneratedSoundObjectIds(prev => {
      if (!prev.has(objectId)) return prev;
      const next = new Set(prev);
      next.delete(objectId);
      generatedSoundObjectIdsRef.current = next;
      return next;
    });

    // Increment version to force re-renders
    setLinkVersion(v => v + 1);
  }, []);

  // Diverse selection management
  const addToDiverseSelection = useCallback((objectId: string) => {
    setDiverseSelectedObjectIds(prev => {
      console.log('[Context] addToDiverseSelection - prev size:', prev.size, 'adding:', objectId.substring(0, 8));
      if (prev.has(objectId)) return prev; // Already in set
      const next = new Set(prev).add(objectId);
      console.log('[Context] addToDiverseSelection - new size:', next.size);
      // Update ref synchronously
      diverseSelectedObjectIdsRef.current = next;
      return next;
    });
  }, []);

  const removeFromDiverseSelection = useCallback((objectId: string) => {
    setDiverseSelectedObjectIds(prev => {
      if (!prev.has(objectId)) return prev; // Not in set
      const next = new Set(prev);
      next.delete(objectId);
      // Update ref synchronously
      diverseSelectedObjectIdsRef.current = next;
      return next;
    });
  }, []);

  const clearDiverseSelection = useCallback(() => {
    setDiverseSelectedObjectIds(prev => {
      if (prev.size === 0) return prev; // Already empty
      const next = new Set<string>();
      // Update ref synchronously
      diverseSelectedObjectIdsRef.current = next;
      return next;
    });
  }, []);

  const setDiverseSelection = useCallback((objectIds: string[]) => {
    setDiverseSelectedObjectIds(prev => {
      // Compare arrays to avoid unnecessary updates
      const prevArray = Array.from(prev).sort();
      const newArray = [...objectIds].sort();
      if (prevArray.length === newArray.length && prevArray.every((id, i) => id === newArray[i])) {
        return prev; // Same content, no update needed
      }
      const next = new Set(objectIds);
      // Update ref synchronously
      diverseSelectedObjectIdsRef.current = next;
      return next;
    });
  }, []);

  // Get state for a specific object - memoized to avoid recreation
  const getObjectLinkState = useCallback((objectId: string) => {
    const isLinked = objectSoundLinks.has(objectId);
    const isDiverse = diverseSelectedObjectIds.has(objectId);
    const hasGenerated = generatedSoundObjectIds.has(objectId);
    const linkedSoundIndex = objectSoundLinks.get(objectId);

    // Determine color: full pink (linked+generated) > light pink (linked+pending) > green (diverse) > grey (none)
    const linkColor = isLinked
      ? (hasGenerated ? SPECKLE_FILTER_COLORS.SOUND_LINKED : SPECKLE_FILTER_COLORS.SOUND_LINKED_PENDING)
      : isDiverse
        ? SPECKLE_FILTER_COLORS.DIVERSE_SELECTION
        : '#6b7280';

    return {
      isLinked,
      isDiverse,
      linkColor,
      linkedSoundIndex
    };
  }, [objectSoundLinks, diverseSelectedObjectIds, generatedSoundObjectIds]);

  // Memoize linkedObjectIds to avoid creating new Set on every render
  const linkedObjectIds = useMemo(
    () => new Set(objectSoundLinks.keys()),
    [objectSoundLinks]
  );

  const value: SpeckleSelectionModeContextType = useMemo(() => ({
    linkedObjectIds,
    diverseSelectedObjectIds,
    linkVersion,
    selectedEntity,
    setSelectedEntity,
    linkObjectToSound,
    unlinkObjectFromSound,
    addToDiverseSelection,
    removeFromDiverseSelection,
    clearDiverseSelection,
    setDiverseSelection,
    getObjectLinkState,
    setViewer,
    applyFilterColors,
    clearFilterColors,
    registerMaterialColors,
    clearMaterialColors
  }), [
    linkedObjectIds,
    diverseSelectedObjectIds,
    linkVersion,
    selectedEntity,
    linkObjectToSound,
    unlinkObjectFromSound,
    addToDiverseSelection,
    removeFromDiverseSelection,
    clearDiverseSelection,
    setDiverseSelection,
    getObjectLinkState,
    setViewer,
    applyFilterColors,
    clearFilterColors,
    registerMaterialColors,
    clearMaterialColors
  ]);

  return (
    <SpeckleSelectionModeContext.Provider value={value}>
      {children}
    </SpeckleSelectionModeContext.Provider>
  );
}

/**
 * Hook to access Speckle selection mode context
 */
export function useSpeckleSelectionMode() {
  const context = useContext(SpeckleSelectionModeContext);
  if (!context) {
    throw new Error('useSpeckleSelectionMode must be used within SpeckleSelectionModeProvider');
  }
  return context;
}
