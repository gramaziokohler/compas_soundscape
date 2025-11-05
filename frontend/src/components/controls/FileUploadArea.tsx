import { UI_COLORS } from "@/lib/constants";

interface FileUploadAreaProps {
  file: File | null;
  isDragging: boolean;
  acceptedFormats: string;
  acceptedExtensions: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  inputId?: string;
  multiple?: boolean; // New: Allow multiple file selection
}

/**
 * Reusable file upload component with drag-and-drop support
 *
 * Features:
 * - Drag and drop file upload
 * - Click to browse files
 * - Visual feedback for dragging state
 * - Shows selected file name
 * - Configurable accepted file types
 *
 * Usage:
 * ```tsx
 * <FileUploadArea
 *   file={file}
 *   isDragging={isDragging}
 *   acceptedFormats="audio/*"
 *   acceptedExtensions=".wav, .mp3, .ogg"
 *   onFileChange={handleFileChange}
 *   onDragOver={handleDragOver}
 *   onDragLeave={handleDragLeave}
 *   onDrop={handleDrop}
 * />
 * ```
 */
export function FileUploadArea({
  file,
  isDragging,
  acceptedFormats,
  acceptedExtensions,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  inputId = 'file-upload',
  multiple = false
}: FileUploadAreaProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        isDragging
          ? 'border-primary'
          : 'border-gray-300 dark:border-gray-600 hover:border-primary'
      }`}
      style={{
        backgroundColor: isDragging ? `${UI_COLORS.PRIMARY}10` : 'transparent',
        borderRadius: '8px'
      }}
    >
      <div className="flex flex-col items-center gap-1">
        {file ? (
          <>
            <svg className="w-6 h-6" style={{ color: UI_COLORS.SUCCESS }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              {file.name}
            </p>
            <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs hover:opacity-80 transition-opacity"
              style={{ color: UI_COLORS.PRIMARY }}
            >
              Choose different file
            </label>
          </>
        ) : (
          <>
            <svg className="w-6 h-6" style={{ color: UI_COLORS.NEUTRAL_400 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Drag & drop or
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs hover:opacity-80 transition-opacity"
              style={{ color: UI_COLORS.PRIMARY }}
            >
              Browse ({acceptedExtensions})
            </label>
          </>
        )}
        <input
          id={inputId}
          type="file"
          onChange={onFileChange}
          accept={acceptedFormats}
          multiple={multiple}
          className="hidden"
        />
      </div>
    </div>
  );
}
