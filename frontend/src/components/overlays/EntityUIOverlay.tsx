import type { EntityOverlay } from "@/types";

interface EntityUIOverlayProps {
  overlay: EntityOverlay;
}

export function EntityUIOverlay({ overlay }: EntityUIOverlayProps) {
  if (!overlay.visible) return null;

  const { entity, x, y } = overlay;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm border border-gray-300 rounded-lg shadow-lg p-3 mb-2 min-w-[200px]">
        <div className="text-sm space-y-1">
          <div className="font-semibold text-gray-900 border-b border-gray-200 pb-1 mb-2">
            Entity Information
          </div>

          {entity.name && (
            <div className="flex justify-between">
              <span className="text-gray-600">Name:</span>
              <span className="text-gray-900 font-medium">{entity.name}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-gray-600">Type:</span>
            <span className="text-gray-900 font-medium">{entity.type}</span>
          </div>

          {entity.layer && (
            <div className="flex justify-between">
              <span className="text-gray-600">Layer:</span>
              <span className="text-gray-900 font-medium">{entity.layer}</span>
            </div>
          )}

          {entity.material && (
            <div className="flex justify-between">
              <span className="text-gray-600">Material:</span>
              <span className="text-gray-900 font-medium">{entity.material}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-gray-600">Index:</span>
            <span className="text-gray-900 font-medium">{entity.index}</span>
          </div>

          <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
            Position: ({entity.position[0].toFixed(2)}, {entity.position[1].toFixed(2)}, {entity.position[2].toFixed(2)})
          </div>
        </div>
      </div>
    </div>
  );
}
