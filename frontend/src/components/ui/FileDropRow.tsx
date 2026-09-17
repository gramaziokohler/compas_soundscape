"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

export interface FileDropRowProps {
  /** Unique id for the hidden file input (also used as the label's htmlFor). */
  inputId: string;
  /** `accept` attribute for the file input, e.g. ".wav,.flac". */
  accept: string;
  /** Short human-readable extensions shown in the row, e.g. "wav, flac". */
  acceptLabel: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  /** True while a file is hovered over this row. */
  isDragging?: boolean;
  /** True while an upload is in flight — disables interaction and shows a spinner. */
  isUploading?: boolean;
  /** Renders with on-blue tokens when the row sits on a solid generated card. */
  onBlueBackground?: boolean;
  /** Optional primary label shown before the drop hint. */
  label?: string;
  className?: string;
}

/**
 * FileDropRow Component
 *
 * A compact, single-row drag-and-drop file target used inside dense card lists
 * (e.g. impulse-response slots) where a full dashed upload box per item would be
 * too heavy. The whole row is a drop target and clicking it opens the file picker.
 *
 * Themed entirely through CSS custom properties; pass `onBlueBackground` when the
 * row renders on a solid generated (`.card-generated`) card so chrome and type
 * switch to on-blue tokens in both light and dark mode.
 *
 * Usage:
 * ```tsx
 * <FileDropRow
 *   inputId="pair-ir-src1-rcv1"
 *   accept=".wav,.flac,.aif,.aiff,.ogg"
 *   acceptLabel="wav, flac, aiff, ogg"
 *   onFileChange={handleFile}
 *   onDragOver={handleDragOver}
 *   onDragLeave={handleDragLeave}
 *   onDrop={handleDrop}
 *   onBlueBackground
 * />
 * ```
 */
export function FileDropRow({
  inputId,
  accept,
  acceptLabel,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragging = false,
  isUploading = false,
  onBlueBackground = false,
  label,
  className = "",
}: FileDropRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPending, setLocalPending] = useState(false);

  const isLoading = isUploading || localPending;

  const openPicker = () => {
    if (isLoading) return;
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setLocalPending(true);
    try {
      await onFileChange(e);
    } finally {
      setLocalPending(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDragOver(e);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalPending(true);
    try {
      await onDrop(e);
    } finally {
      setLocalPending(false);
    }
  };

  const baseStyle: React.CSSProperties = onBlueBackground
    ? isDragging
      ? { borderColor: "var(--color-on-blue)", backgroundColor: "var(--color-blue-chip-bg)" }
      : { borderColor: "var(--color-on-blue-faint)", backgroundColor: "transparent" }
    : isDragging
      ? { borderColor: "var(--color-primary)", backgroundColor: "var(--color-primary-lighter)" }
      : { borderColor: "var(--color-border-strong)", backgroundColor: "transparent" };

  const textColor = onBlueBackground
    ? "var(--color-on-blue-muted)"
    : "var(--color-secondary-hover)";
  const accentColor = onBlueBackground
    ? "var(--color-on-blue)"
    : "var(--color-primary)";

  return (
    <div
      role="button"
      tabIndex={isLoading ? -1 : 0}
      aria-label={label ? `${label} — import file` : "Import file"}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      className={`flex items-center gap-1.5 w-full rounded border border-dashed px-2 py-1.5 transition-colors ${
        isLoading ? "cursor-default" : "cursor-pointer"
      } ${className}`}
      style={baseStyle}
    >
      {isLoading ? (
        <>
          <Spinner size={12} />
          <span className="text-[10px] truncate" style={{ color: textColor }}>
            {label ? `Uploading ${label}…` : "Uploading…"}
          </span>
        </>
      ) : (
        <>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            style={{ color: accentColor }}
          >
            <path d="M12 3v12" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 21h14" />
          </svg>
          <span className="text-[10px] font-medium truncate" style={{ color: accentColor }}>
            {label ? `Import ${label}` : "Import IR"}
          </span>
          <span className="text-[9px] truncate ml-auto shrink-0" style={{ color: textColor }}>
            drop or browse · {acceptLabel}
          </span>
        </>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={isLoading}
        className="hidden"
      />
    </div>
  );
}
