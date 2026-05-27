import type { Viewer } from '@speckle/viewer';
import { captureSceneScreenshots } from './captureSceneScreenshots';
import { apiService, type ModelAnalysisResponse } from '@/services/api';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Captures up to 3 screenshots from the live Speckle viewer, then enqueues
 * a 3D model analysis job on the backend and polls until complete.
 *
 * Screenshots are optional: if `viewer` is null/undefined or capture fails,
 * the analysis falls back to metadata-only mode gracefully.
 *
 * @param viewer      Live Speckle Viewer instance (may be null)
 * @param entities    Array of Speckle entity objects (id, name, speckle_type, …)
 * @param userContext Optional free-text description of the space/context
 * @param llmModel    LLM model key (e.g. "gemini-2.5-flash", "openai", "anthropic")
 * @param onProgress  Optional callback invoked with (progress 0-100, status string)
 *                    on each poll cycle
 * @returns Resolved ModelAnalysisResponse with objects, high_confidence, low_confidence
 */
export async function captureAndAnalyzeModel(
  viewer: Viewer | null | undefined,
  entities: any[],
  userContext?: string,
  llmModel?: string,
  onProgress?: (progress: number, status: string) => void,
  liveScreenshots?: string[],
): Promise<ModelAnalysisResponse> {
  // ── Step 1: Capture screenshots (optional) ──────────────────────────────
  let screenshots: string[] = [];
  if (viewer) {
    try {
      screenshots = await captureSceneScreenshots(viewer);
    } catch (err) {
      console.warn(
        '[captureAndAnalyzeModel] Screenshot capture failed — proceeding without images:',
        err,
      );
    }
  }
  // Append all live html-to-image captures after the 3 programmatic shots
  if (liveScreenshots && liveScreenshots.length > 0) {
    screenshots.push(...liveScreenshots);
  }

  // ── Step 2: Enqueue analysis job ─────────────────────────────────────────
  const { analysis_id } = await apiService.startModelAnalysis({
    entities,
    screenshots: screenshots.length > 0 ? screenshots : null,
    user_context: userContext ?? null,
    llm_model: llmModel,
  });

  // ── Step 3: Poll until complete ──────────────────────────────────────────
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const status = await apiService.getModelAnalysisStatus(analysis_id);
    onProgress?.(status.progress, status.status);

    if (status.cancelled) {
      throw new Error('Model analysis was cancelled');
    }
    if (status.error) {
      throw new Error(`Model analysis failed: ${status.error}`);
    }
    if (status.completed && status.result) {
      return status.result;
    }
  }

  // Timed out — cancel the job and surface the error
  await apiService.cancelModelAnalysis(analysis_id).catch(() => {});
  throw new Error('Model analysis timed out after 2 minutes');
}
