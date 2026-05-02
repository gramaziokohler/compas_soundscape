/**
 * Minimalistic 3D controls info overlay
 * Renders at bottom-left of 3D scene with no background
 */
export function ControlsInfo() {
  return (
    <div className="absolute bottom-6 left-6 pointer-events-none select-none">
      <ul className="text-[10px] space-y-0.5 leading-tight text-neutral-500">
        <li>Left click + drag: Rotate</li>
        <li>Right click + drag: Pan</li>
        <li>Scroll: Zoom</li>
        <li>Double-click cube: First-person</li>
        <li>→ Arrow keys: Rotate view</li>
        <li>→ ESC: Exit First-Person</li>
      </ul>
    </div>
  );
}
