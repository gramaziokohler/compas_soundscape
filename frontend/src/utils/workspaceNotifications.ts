/**
 * Workspace-related notifications shared by the bootstrap (?model_id=) and
 * model-load paths in page.tsx.
 */

import { notifyError } from '@/store/errorsStore';
import { useUIStore } from '@/store/uiStore';
import { WORKSPACE_MESSAGES } from '@/utils/constants';

/**
 * The opened model's soundscape lives in someone else's private workspace. The
 * user stays in their own workspace (as owner) on their own version; clicking
 * the notification opens Advanced settings → Workspaces.
 */
export function notifyPrivateWorkspaceModel(): void {
  notifyError(WORKSPACE_MESSAGES.PRIVATE_MODEL_NOTICE, 'info', {
    label: WORKSPACE_MESSAGES.PRIVATE_MODEL_ACTION,
    onClick: () => useUIStore.getState().openAdvancedSettingsAt('workspaces'),
  });
}
