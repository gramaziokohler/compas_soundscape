// 10-second test scene: describe a sound scene in the composer and generate it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_URL, PATHS } from '../config.mjs';
import { encodeFrames } from '../encode.mjs';
import { startRecording } from '../recorder.mjs';

const PROMPT = 'A quiet library on a rainy afternoon, pages turning, rain on tall windows';

const rec = await startRecording({ url: APP_URL, framesDir: PATHS.framesDir });
const { page } = rec;
await page.waitForTimeout(2500); // let the viewer settle before rolling

await rec.start();
await rec.hold(900);
await rec.click(page.getByPlaceholder(/quiet library/i), 'composer');
await rec.type(PROMPT, 'prompt');
await rec.hold(400);
await rec.click(page.getByRole('button', { name: 'Generate scene' }), 'generate');
await rec.hold(9000, 'generating');
const { end, frameCount } = await rec.stop(PATHS.outDir);
console.log(`captured ${frameCount} frames over ${end.toFixed(2)} s`);

mkdirSync(PATHS.videoAssets, { recursive: true });
encodeFrames(PATHS.outDir, join(PATHS.videoAssets, 'capture.mp4'));
copyFileSync(join(PATHS.outDir, 'events.json'), join(PATHS.videoAssets, 'events.json'));
console.log('wrote video/assets/capture.mp4 + events.json');
