export function ControlsInfo() {
  return (
    <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold mb-2">3D Controls</h3>
      <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
        <li>• Left click + drag: Rotate view</li>
        <li>• Right click + drag: Pan view</li>
        <li>• Scroll: Zoom in/out</li>
        <li>• Left click on sound sphere: Play/Pause sound</li>
        <li>• Click sound sphere to show UI overlay</li>
      </ul>
    </div>
  );
}
