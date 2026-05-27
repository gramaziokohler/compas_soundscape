import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * POST /api/screenshot
 *
 * Saves a browser-captured screenshot (html-to-image base64 data URI) as a
 * timestamped PNG file under backend/temp/.
 *
 * Body: { image: string }  — a "data:image/...;base64,..." URI
 * Response: { image: string, savedPath: string }
 *
 * GET /api/screenshot
 *
 * Returns ALL saved screenshots (sorted oldest-first) as an array of base64
 * data URIs.  Responds 404 if no captures have been saved yet.
 *
 * Response: { images: string[], count: number }
 *
 * DELETE /api/screenshot
 *
 * Removes all saved live_capture_*.png files from the temp directory.
 * Response: { deleted: number }
 */

// Use the BACKEND_DIR env variable set in next.config.ts (resolved once at
// startup from next.config.ts where process.cwd() is reliably frontend/).
// Fallback to process.cwd()-relative path for non-Next.js environments.
const BACKEND_DIR = process.env.BACKEND_DIR ?? path.resolve(process.cwd(), '..', 'backend');
const SCREENSHOTS_DIR = path.join(BACKEND_DIR, 'temp');
const CAPTURE_PREFIX = 'live_capture_';

/** Return all live_capture_*.png files sorted chronologically (by name). */
function listCaptureFiles(): string[] {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return [];
  return fs
    .readdirSync(SCREENSHOTS_DIR)
    .filter((f) => f.startsWith(CAPTURE_PREFIX) && f.endsWith('.png'))
    .sort(); // timestamp in name → lexicographic = chronological
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).image !== 'string' ||
    !(body as Record<string, string>).image.startsWith('data:image/')
  ) {
    return NextResponse.json(
      { error: 'Body must contain an "image" field with a data URI' },
      { status: 400 },
    );
  }

  const { image } = body as { image: string };

  // Strip the data URI prefix and write raw PNG bytes to disk with a unique name
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const filename = `${CAPTURE_PREFIX}${Date.now()}.png`;
  const filePath = path.join(SCREENSHOTS_DIR, filename);
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  } catch (err) {
    console.error('[/api/screenshot] Failed to save file:', err);
    return NextResponse.json({ error: 'Failed to save screenshot to disk' }, { status: 500 });
  }

  return NextResponse.json({ image, savedPath: filePath });
}

export async function GET() {
  const files = listCaptureFiles();
  if (files.length === 0) {
    return NextResponse.json({ error: 'No screenshots saved yet' }, { status: 404 });
  }
  try {
    const images = files.map((f) => {
      const data = fs.readFileSync(path.join(SCREENSHOTS_DIR, f));
      return `data:image/png;base64,${data.toString('base64')}`;
    });
    return NextResponse.json({ images, count: images.length });
  } catch (err) {
    console.error('[/api/screenshot] Failed to read files:', err);
    return NextResponse.json({ error: 'Failed to read screenshots from disk' }, { status: 500 });
  }
}

export async function DELETE() {
  const files = listCaptureFiles();
  for (const f of files) {
    try {
      fs.unlinkSync(path.join(SCREENSHOTS_DIR, f));
    } catch {
      // best-effort
    }
  }
  return NextResponse.json({ deleted: files.length });
}
