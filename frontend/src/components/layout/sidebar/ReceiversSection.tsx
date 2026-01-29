/**
 * ReceiversSection Component
 *
 * UI component for managing acoustic receivers.
 *
 * Features:
 * - Create new receiver button (+ icon style) - direct creation at default position
 * - List of created receivers with inline name editing
 * - Go to receiver (activates first-person view mode)
 * - Delete individual receivers
 * - Compact layout without position display
 *
 * Architecture:
 * - Follows SoundGenerationSection UI patterns
 * - Consistent styling with sidebar sections
 * - Inline editing similar to SoundGenerationSection tabs
 * - Direct receiver creation (like sound spheres) - no click-to-place required
 */

import { useState, useRef, useEffect } from 'react';
import type { ReceiverData } from '@/types';
import { UI_COLORS, RECEIVER_CONFIG, GRID_RECEIVERS } from '@/lib/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';

interface ReceiversSectionProps {
  receivers: ReceiverData[];
  onAddReceiver: (type: string) => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
  onGoToReceiver: (id: string) => void;
  onAddGridReceiver: (type: string, n: number) => void;
}

export function ReceiversSection({
  receivers,
  onAddReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onGoToReceiver,
  onAddGridReceiver
}: ReceiversSectionProps) {
  const [editingReceiverId, setEditingReceiverId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Track mode selector dropdown visibility
  const [showModeSelector, setShowModeSelector] = useState(false);
  const modeSelectorRef = useRef<HTMLDivElement>(null);

  // Grid configuration state
  const [config, setConfig] = useState({
    gridResolution: 9
  });

  // Inline name editing handlers
  const handleDoubleClick = (receiver: ReceiverData) => {
    setEditingReceiverId(receiver.id);
    setEditingValue(receiver.name);
  };

  // Close mode selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeSelectorRef.current && !modeSelectorRef.current.contains(event.target as Node)) {
        setShowModeSelector(false);
      }
    };

    if (showModeSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModeSelector]);

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
          onClick={() => setShowModeSelector(!showModeSelector)}
          className="ml-auto w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center"
          style={{
            backgroundColor: receiverColor,
            borderRadius: '8px',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = receiverColor;
          }}
          title="Add receiver"
          aria-label="Add receiver"
        >
          <span className="text-lg leading-none">+</span>
        </button>

          {/* Mode selector dropdown */}
          {showModeSelector && (
            <div
              className="absolute right-0 mt-1 z-10 rounded shadow-lg"
              style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: UI_COLORS.NEUTRAL_300,
                minWidth: '200px'
              }}
            >
              <button
                onClick={() => {
                  onAddReceiver('single');
                  setShowModeSelector(false);
                }}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  borderRadius: '8px 8px 0 0',
                  color: UI_COLORS.NEUTRAL_900
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Add single receiver
              </button>
              <button
                onClick={() => {
                  onAddGridReceiver('multiple', config.gridResolution);
                  setShowModeSelector(false);
                }}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  borderRadius: '0 0 8px 8px',
                  color: UI_COLORS.NEUTRAL_900
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Add grid of receivers
              </button>
            </div>
          )}
      </div>

      {/* Receivers List */}
      {receivers.length > 0 && (
        <div className="space-y-0">
          {receivers.map((receiver) => (
            receiver.type === "single" && (
            <div
              key={receiver.id}
              className="flex items-center justify-between gap-0 p-0"
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
            )
          ))}
        </div>
      )}

    </div>
  );
}
