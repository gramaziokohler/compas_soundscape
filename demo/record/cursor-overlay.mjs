// Init script injected into every page: a presentation cursor with a press state and
// a click ripple, plus hiding dev-only chrome (Next.js dev indicator).
import { CURSOR } from './config.mjs';

export const CURSOR_INIT_SCRIPT = `
(() => {
  const SIZE = ${CURSOR.size};
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      nextjs-portal { display: none !important; }
      * { cursor: none !important; }
      #__demo_cursor { position: fixed; left: 0; top: 0; width: \${SIZE}px; height: \${SIZE}px;
        pointer-events: none; z-index: 2147483647; transform-origin: 3px 2px;
        transition: transform 90ms ease-out; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      #__demo_cursor.down { transform: scale(0.82); }
      .__demo_ripple { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
        pointer-events: none; z-index: 2147483646; background: ${CURSOR.rippleColor};
        animation: __demo_ripple ${CURSOR.rippleMs}ms cubic-bezier(.2,.7,.3,1) forwards; }
      @keyframes __demo_ripple { to { transform: scale(4.2); opacity: 0; } }
    \`;
    document.head.appendChild(style);
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="' + SIZE + '" height="' + SIZE + '"><path d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.4 20.4 L10.5 13.7 L16.8 13.7 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    let x = -100, y = -100;
    const place = () => { c.style.left = (x - 3) + 'px'; c.style.top = (y - 2) + 'px'; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(); }, true);
    addEventListener('mousedown', (e) => {
      c.classList.add('down');
      const r = document.createElement('div');
      r.className = '__demo_ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), ${CURSOR.rippleMs + 50});
    }, true);
    addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
`;
