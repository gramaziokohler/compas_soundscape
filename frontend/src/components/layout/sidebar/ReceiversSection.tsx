/**
 * ReceiversSection Component
 *
 * UI component for managing acoustic receiver spheres.
 *
 * Features:
 * - Create new receiver button
 * - List of created receivers with inline name editing
 * - Delete individual receivers
 * - Position display (read-only, updated via dragging in 3D scene)
 *
 * Architecture:
 * - Follows existing sidebar section patterns
 * - Consistent styling with AuralizationSection
 * - Inline editing similar to SoundGenerationSection tabs
 */

import { useState } from 'react';
import type { ReceiverData } from '@/types';

interface ReceiversSectionProps {
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
}

export function ReceiversSection({
  receivers,
  isPlacingReceiver,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName
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

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Receivers
      </h3>

      {/* Create Receiver Button */}
      <button
        onClick={onStartPlacingReceiver}
        disabled={isPlacingReceiver}
        className={`w-full py-2 px-4 text-white font-semibold rounded transition-colors ${
          isPlacingReceiver
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-primary hover:bg-primary-hover'
        }`}
      >
        {isPlacingReceiver ? 'Click in 3D to Place (ESC to cancel)' : '+ Create Receiver'}
      </button>

      {/* Receivers List */}
      {receivers.length > 0 && (
        <div className="space-y-2">
          {receivers.map((receiver) => (
            <div
              key={receiver.id}
              className="bg-white dark:bg-gray-800 rounded p-2 border border-gray-200 dark:border-gray-600"
            >
              {/* Receiver Name - Editable */}
              <div className="flex items-center justify-between mb-1">
                {editingReceiverId === receiver.id ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={handleEditSave}
                    onKeyDown={handleEditKeyDown}
                    autoFocus
                    className="flex-1 text-sm font-medium bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <div
                    onDoubleClick={() => handleDoubleClick(receiver)}
                    className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 cursor-pointer hover:text-primary transition-colors group"
                    title="Double-click to edit name"
                  >
                    {receiver.name}
                    <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
                  </div>
                )}

                {/* Delete Button */}
                <button
                  onClick={() => onDeleteReceiver(receiver.id)}
                  className="w-6 h-6 flex items-center justify-center text-lg text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors ml-2"
                  title="Delete receiver"
                >
                  ×
                </button>
              </div>

              {/* Position Display - Read-only */}
              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                Position: ({receiver.position[0].toFixed(2)}, {receiver.position[1].toFixed(2)}, {receiver.position[2].toFixed(2)})
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      {receivers.length === 0 && !isPlacingReceiver && (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          No receivers created. Click the button above, then click in the 3D scene to place a blue receiver sphere. Double-click on it to reset the camera view.
        </p>
      )}
    </div>
  );
}
