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
  inputId = 'file-upload'
}: FileUploadAreaProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        isDragging
          ? 'border-primary bg-primary-light'
          : 'border-gray-300 dark:border-gray-600 hover:border-primary'
      }`}
    >
      <div className="flex flex-col items-center gap-1">
        {file ? (
          <>
            <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {file.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs text-primary hover:text-primary-hover"
            >
              Choose different file
            </label>
          </>
        ) : (
          <>
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Drag & drop or
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs text-primary hover:text-primary-hover"
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
          className="hidden"
        />
      </div>
    </div>
  );
}
