'use client';

import type { SceneChatMessage, SceneEditTurn } from '@/types/sceneEdit';
import { Badge } from '@/components/ui/Badge';
import { ThinkingDisclosure } from '@/components/ui/ThinkingDisclosure';

export interface SceneChatMessageItemProps {
  message: SceneChatMessage;
  /** The scene's running turn when this message is its pending reply. */
  turn: SceneEditTurn | null;
}

const INTERRUPTED = 'Interrupted before it finished — send the request again if needed.';

/**
 * One chat bubble of the scene edit chat: the user's request, or the assistant's
 * reply with the applied changes as badges, warnings, and the live phase while
 * its turn runs.
 *
 * Usage:
 * ```tsx
 * <SceneChatMessageItem message={m} turn={turn?.turnId === m.id ? turn : null} />
 * ```
 */
export function SceneChatMessageItem({ message, turn }: SceneChatMessageItemProps) {
  if (message.role === 'user') {
    return <div className="scene-chat__msg scene-chat__msg--user">{message.text}</div>;
  }
  // A pending reply with no running turn lost its turn (page closed mid-plan).
  const interrupted = message.status === 'pending' && !turn;
  const failed = message.status === 'failed';
  return (
    <div className="scene-chat__msg scene-chat__msg--assistant">
      {message.text && <div>{message.text}</div>}
      {!!message.changes?.length && (
        <div className="scene-chat__changes">
          {message.changes.map((label, i) => (
            <Badge key={i} variant="primary">{label}</Badge>
          ))}
        </div>
      )}
      {turn && (
        <>
          <div className="scene-chat__meta">{turn.status}</div>
          <ThinkingDisclosure text={turn.thinking} />
        </>
      )}
      {!!message.warnings?.length && (
        <div className="scene-chat__meta">{message.warnings.join(' · ')}</div>
      )}
      {interrupted && <div className="scene-chat__meta">{INTERRUPTED}</div>}
      {failed && <div className="scene-chat__meta scene-chat__meta--error">Not applied</div>}
    </div>
  );
}
