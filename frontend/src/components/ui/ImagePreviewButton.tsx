'use client';

import { useState, type ReactNode } from 'react';
import { ModalShell } from '@/components/ui/ModalShell';
import { IMAGE_PREVIEW, UI_BORDER_RADIUS } from '@/utils/constants';

export interface ImagePreviewButtonProps {
  /** Image source (data URI or URL). */
  src: string;
  /** Shown as the window title and tooltip. */
  name?: string;
  /** Thumbnail height in px (width follows the aspect ratio unless `square`). */
  size: number;
  /** Crop the thumbnail to a square (compact chips). */
  square?: boolean;
  /** Content after the thumbnail inside the clickable area (e.g. a chip's file name). */
  children?: ReactNode;
  /** Classes of the clickable area (defaults to a bare thumbnail button). */
  className?: string;
}

/**
 * ImagePreviewButton Component
 *
 * A clickable image thumbnail that opens the full image in a window
 * (`ModalShell`: Escape or a backdrop click closes it). Renders nothing when
 * the image cannot be loaded (e.g. a saved file missing on the server).
 *
 * Usage:
 * ```tsx
 * <ImagePreviewButton src={image.dataUrl} name={image.name} size={48} />
 * ```
 */
export function ImagePreviewButton({ src, name, size, square, children, className }: ImagePreviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = name || 'Reference image';
  if (failedSrc === src) return null;

  return (
    <>
      <button
        type="button"
        className={className ?? 'inline-flex shrink-0 cursor-zoom-in'}
        onClick={(e) => {
          // Keep the click from reaching chips / rows that react to it.
          e.stopPropagation();
          setOpen(true);
        }}
        title={`${label} — click to enlarge`}
        aria-label={`Enlarge ${label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          onError={() => setFailedSrc(src)}
          height={size}
          width={square ? size : undefined}
          style={{
            height: size,
            width: square ? size : 'auto',
            maxWidth: square ? size : size * 2,
            objectFit: 'cover',
            borderRadius: UI_BORDER_RADIUS.SM,
          }}
        />
        {children}
      </button>
      {open && (
        <ModalShell title={label} onClose={() => setOpen(false)} width={IMAGE_PREVIEW.MODAL_WIDTH}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            className="block mx-auto"
            style={{
              maxWidth: '100%',
              maxHeight: IMAGE_PREVIEW.IMAGE_MAX_HEIGHT,
              objectFit: 'contain',
              borderRadius: UI_BORDER_RADIUS.SM,
            }}
          />
        </ModalShell>
      )}
    </>
  );
}
