/**
 * ReceiversSection Component
 *
 * UI component for managing acoustic receiver spheres.
 *
 * Features:
 * - Create new receiver button (+ icon style)
 * - List of created receivers with inline name editing
 * - Go to receiver (activates first-person view mode)
 * - Delete individual receivers
 * - Compact layout without position display
 *
 * Architecture:
 * - Follows SoundGenerationSection UI patterns
 * - Consistent styling with sidebar sections
 * - Inline editing similar to SoundGenerationSection tabs
 */

import { useState } from 'react';
import type { ReceiverData } from '@/types';
import { UI_COLORS, RECEIVER_CONFIG } from '@/lib/constants';

interface ReceiversSectionProps {
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
  onGoToReceiver: (id: string) => void;
}

export function ReceiversSection({
  receivers,
  isPlacingReceiver,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onGoToReceiver
}: ReceiversSectionProps) {
  const [editingReceiverId, setEditingReceiverId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Inline name editing handlers
  const handleDoubleClick = (receiver: ReceiverData) => {
    setEditingReceiverId(receiver.id);
    setEditingValue(receiver.name);
  };

  const handleEditSave = () => {
    if (editingReceiverId && editingValue.trim()) {
      onUpdateReceiverName(editingReceiverId, editingValue.trim());
    }
    setEditingReceiverId(null);
  };

  const handleEditCancel = () => {
    setEditingReceiverId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  };

  // Calculate receiver color from constants
  const receiverColor = `#${RECEIVER_CONFIG.COLOR.toString(16).padStart(6, '0')}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Receiver status and + button */}
      <div className="flex items-center text-xs w-full gap-1" style={{ color: UI_COLORS.NEUTRAL_600 }}>
        {receivers.length} receiver{receivers.length !== 1 ? 's' : ''}

        {/* Add Receiver button with + icon */}
        <button
          onClick={onStartPlacingReceiver}
          disabled={isPlacingReceiver}
          className="ml-auto w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center"
          style={{
            backgroundColor: isPlacingReceiver ? UI_COLORS.NEUTRAL_400 : receiverColor,
            borderRadius: '8px',
            opacity: isPlacingReceiver ? 0.4 : 1,
            cursor: isPlacingReceiver ? 'not-allowed' : 'pointer'
          }}
          onMouseEnter={(e) => {
            if (!isPlacingReceiver) {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400;
            }
          }}
          onMouseLeave={(e) => {
            if (!isPlacingReceiver) {
              e.currentTarget.style.backgroundColor = receiverColor;
            }
          }}
          title={isPlacingReceiver ? "Click in 3D to place (ESC to cancel)" : "Add receiver"}
          aria-label="Add receiver"
        >
          <span className="text-lg leading-none">+</span>
        </button>
      </div>

      {/* Receivers List */}
      {receivers.length > 0 && (
        <div className="space-y-2">
          {receivers.map((receiver) => (
            <div
              key={receiver.id}
              className="flex items-center justify-between gap-2 p-2 rounded"
              style={{
                backgroundColor: 'white',
                borderColor: UI_COLORS.NEUTRAL_200,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '8px'
              }}
            >
              {/* Receiver Name - Editable */}
              {editingReceiverId === receiver.id ? (
                <input
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={handleEditSave}
                  onKeyDown={handleEditKeyDown}
                  autoFocus
                  className="flex-1 text-sm font-medium px-2 py-1 rounded outline-none focus:ring-1"
                  style={{
                    backgroundColor: UI_COLORS.NEUTRAL_100,
                    borderColor: receiverColor,
                    borderRadius: '8px'
                  }}
                />
              ) : (
                <div
                  onDoubleClick={() => handleDoubleClick(receiver)}
                  onMouseEnter={(e) => e.currentTarget.style.color = receiverColor}
                  onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.NEUTRAL_800}
                  className="flex-1 text-sm font-medium cursor-pointer transition-colors group"
                  style={{ color: UI_COLORS.NEUTRAL_800 }}
                  title="Double-click to edit name"
                >
                  {receiver.name}
                  <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
                </div>
              )}

              {/* Button group */}
              <div className="flex gap-1">
                {/* Go To button */}
                <button
                  onClick={() => onGoToReceiver(receiver.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'white';
                    e.currentTarget.style.backgroundColor = receiverColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = receiverColor;
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded transition-colors"
                  style={{
                    color: receiverColor,
                    borderRadius: '6px'
                  }}
                  title="Go to receiver (first-person view)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>

                {/* Delete Button */}
                <button
                  onClick={() => onDeleteReceiver(receiver.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'white';
                    e.currentTarget.style.backgroundColor = UI_COLORS.ERROR;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = UI_COLORS.ERROR;
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded transition-colors"
                  style={{
                    color: UI_COLORS.ERROR,
                    borderRadius: '6px'
                  }}
                  title="Delete receiver"
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
