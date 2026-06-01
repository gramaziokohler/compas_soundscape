interface UploadedFileLike {
  name: string;
  size: number;
}

interface FileUploadAreaProps {
  file: UploadedFileLike | null;
  isDragging: boolean;
  acceptedFormats: string;
  acceptedExtensions: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  inputId?: string;
  multiple?: boolean;
}

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
      className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        isDragging
          ? ''
          : 'border-neutral-300'
      }`}
      style={{
        borderColor: isDragging ? 'var(--color-secondary))' : 'var(--color-secondary-hover)',
        backgroundColor: isDragging ? 'var(--color-primary-light))' : 'var(--color-primary)',
        borderRadius: '8px'
      }}
      onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.borderColor = 'var(--color-secondary)'; }}
      onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.borderColor = 'var(--color-secondary-hover)'; }}
    >
      <div className="flex flex-col items-center gap-1">
        {file ? (
          <>
            <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-medium text-neutral-700">
              {file.name}
            </p>
            <p className="text-xs text-neutral-500">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-primary))' }}
            >
              Choose different file
            </label>
          </>
        ) : (
          <>
            <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs font-medium text-neutral-300">
              Drag &amp; drop or
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-secondary-hover))' }}
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
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
    </div>
  );
}