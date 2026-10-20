import { toJpeg } from 'html-to-image';
import { BUG_REPORT } from '@/utils/constants';

/**
 * JPEG data URL of the whole app, minus elements marked with
 * `BUG_REPORT.IGNORE_ATTR` (the bug-report / moment popovers themselves).
 * Shared by the bug report and the research-study Moment capture.
 */
export async function captureAppScreenshot(): Promise<string> {
  return toJpeg(document.body, {
    pixelRatio: BUG_REPORT.SCREENSHOT_PIXEL_RATIO,
    quality: BUG_REPORT.SCREENSHOT_JPEG_QUALITY,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: (node) => !(node instanceof Element && node.hasAttribute(BUG_REPORT.IGNORE_ATTR)),
  });
}
