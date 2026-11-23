// Turns the variable-rate screencast frames into a constant-fps H.264 file with ffmpeg.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CAPTURE } from './config.mjs';

export function encodeFrames(outDir, mp4Path) {
  const { end, frames } = JSON.parse(readFileSync(join(outDir, 'frames.json'), 'utf8'));
  if (!frames.length) throw new Error('No frames captured');
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    const start = i === 0 ? 0 : f.t; // first frame covers t=0
    lines.push(`file '${resolve(f.file).replace(/\\/g, '/')}'`, `duration ${Math.max(next - start, 0.001).toFixed(4)}`);
  });
  lines.push(`file '${resolve(frames.at(-1).file).replace(/\\/g, '/')}'`); // concat demuxer needs the last file twice
  const list = join(outDir, 'frames.ffconcat');
  writeFileSync(list, lines.join('\n'));
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${CAPTURE.fps},scale=${CAPTURE.width}:${CAPTURE.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-movflags', '+faststart',
    mp4Path,
  ], { stdio: 'inherit' });
}
