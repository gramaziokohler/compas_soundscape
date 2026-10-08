/**
 * Visibility filtering for 3D-model analysis entities.
 *
 * Shared by the analysis run (analysisStore) and the Analyze card's entity-count
 * warning so both agree on which entities the LLM will receive.
 */

/** Id-bearing fields an extracted Speckle entity may carry. */
export interface AnalysisEntityIds {
  id?: string;
  nodeId?: string;
  modelId?: string;
  applicationId?: string;
  raw?: { id?: string; applicationId?: string } | null;
  ancestorIds?: string[];
  speckle_type?: string;
  type?: string;
}

// Mirrors backend LLMService._prepare_entities: structural/relational nodes are
// dropped server-side, so they don't count towards the analysis entity count.
const NON_GEOMETRY_TOKENS = ['Collection', 'Proxy', 'DataChunk', 'RenderMaterial'];

/** True for entities the backend keeps as real geometry for model analysis. */
export const isAnalysisGeometry = (e: AnalysisEntityIds): boolean => {
  const t = e?.speckle_type || e?.type || '';
  return !!t && !NON_GEOMETRY_TOKENS.some((tok) => t.includes(tok));
};

/**
 * The viewer's filtering IDs and the extracted entity IDs don't always come from
 * the same field (raw.id vs model.id vs applicationId), so match against every
 * candidate ID an entity carries.
 */
export const entityIdCandidates = (e: AnalysisEntityIds): string[] =>
  [e?.id, e?.nodeId, e?.modelId, e?.applicationId, e?.raw?.id, e?.raw?.applicationId].filter(
    Boolean,
  ) as string[];

/**
 * Include the ancestor container/layer IDs so hiding/isolating a layer captures
 * its whole subtree, even if the viewer's leaf-id enumeration is incomplete (the
 * layer node itself is always in the set).
 */
const entityMatchIds = (e: AnalysisEntityIds): string[] => [
  ...entityIdCandidates(e),
  ...(e?.ancestorIds ?? []),
];

/**
 * Keep entities that are neither hidden nor excluded by an active isolation.
 *
 * @param hiddenIds   Live hidden ids from the Object Explorer.
 * @param isolatedIds Resolved isolated ids, or null when no isolation is active.
 */
export function filterVisibleAnalysisEntities<T extends AnalysisEntityIds>(
  entities: T[],
  hiddenIds: Set<string>,
  isolatedIds: string[] | null,
): T[] {
  const isolatedSet = isolatedIds ? new Set(isolatedIds) : null;
  return entities.filter((e) => {
    const ids = entityMatchIds(e);
    if (ids.some((id) => hiddenIds.has(id))) return false;
    return isolatedSet === null || ids.some((id) => isolatedSet.has(id));
  });
}
