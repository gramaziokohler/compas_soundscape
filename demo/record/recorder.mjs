// Demo recorder: drives a real (GPU) Chromium with Playwright, captures it with the
// CDP screencast, draws a presentation cursor in the page and logs every action to
// events.json so the HyperFrames edit can zoom on it.
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURE, CURSOR, MOTION } from './config.mjs';
import { CURSOR_INIT_SCRIPT } from './cursor-overlay.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function startRecording({ url, framesDir }) {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-angle=d3d11',
      '--force-device-scale-factor=1',
      `--window-size=${CAPTURE.width + 16},${CAPTURE.height + 140}`,
    ],
  });
  const context = await browser.newContext({
    viewport: { width: CAPTURE.width, height: CAPTURE.height },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  const frames = [];
  const events = [];
  const cursor = { x: CAPTURE.width / 2, y: CAPTURE.height / 2 };
  let t0 = 0;
  const now = () => (performance.now() - t0) / 1000;

  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    const t = now();
    const file = join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  const log = (type, extra = {}) => events.push({ t: +now().toFixed(3), type, ...extra });

  const api = {
    page,
    log,
    async start() {
      await page.mouse.move(cursor.x, cursor.y);
      t0 = performance.now();
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: CAPTURE.jpegQuality,
        maxWidth: CAPTURE.width,
        maxHeight: CAPTURE.height,
        everyNthFrame: 1,
      });
      // Nudge a repaint so the first frame lands at t≈0.
      await page.evaluate(() => document.body.getBoundingClientRect());
    },
    async hold(ms, label) {
      if (label) log('hold', { label, duration: ms / 1000 });
      await sleep(ms);
    },
    /** Glide the cursor to the centre of `target` (locator) along an eased path. */
    async moveTo(target, { duration = MOTION.moveMs } = {}) {
      const box = await target.boundingBox();
      if (!box) throw new Error('moveTo: target not visible');
      const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const from = { ...cursor };
      const steps = Math.max(2, Math.round(duration / MOTION.stepMs));
      log('move', { from, to, duration: duration / 1000 });
      for (let i = 1; i <= steps; i++) {
        const k = easeInOut(i / steps);
        cursor.x = from.x + (to.x - from.x) * k;
        cursor.y = from.y + (to.y - from.y) * k;
        await page.mouse.move(cursor.x, cursor.y);
        await sleep(MOTION.stepMs);
      }
      return box;
    },
    async click(target, label) {
      const box = await api.moveTo(target);
      await sleep(MOTION.preClickMs);
      log('click', { label, x: cursor.x, y: cursor.y, box });
      await page.mouse.down();
      await sleep(CURSOR.pressMs);
      await page.mouse.up();
      await sleep(MOTION.postClickMs);
    },
    async type(text, label) {
      const target = await page.evaluate(() => {
        const r = document.activeElement?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      });
      log('type', { label, text, box: target, duration: text.length * MOTION.typeMs / 1000 });
      for (const ch of text) {
        await page.keyboard.type(ch);
        await sleep(MOTION.typeMs * (0.6 + Math.random() * 0.8));
      }
    },
    async stop(outDir) {
      await cdp.send('Page.stopScreencast');
      const end = now();
      log('end');
      await browser.close();
      writeFileSync(join(outDir, 'frames.json'), JSON.stringify({ end, frames }, null, 1));
      writeFileSync(join(outDir, 'events.json'), JSON.stringify({ width: CAPTURE.width, height: CAPTURE.height, duration: end, events }, null, 2));
      return { end, frameCount: frames.length };
    },
  };
  return api;
}
