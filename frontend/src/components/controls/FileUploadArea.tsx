import { useState, useEffect } from 'react';
import { Spinner } from '@/components/ui/Spinner';

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
  isUploading?: boolean;
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
  multiple = false,
  isUploading = false
}: FileUploadAreaProps) {
  const [localLoading, setLocalLoading] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);

  useEffect(() => {
    if (file) {
      setLocalLoading(false);
      setPendingFileName(null);
    }
  }, [file]);

  useEffect(() => {
    if (!isUploading) {
      setLocalLoading(false);
    }
  }, [isUploading]);

  const handleInternalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.persist?.();
    const files = e.target.files;
    if (files && files.length > 0) {
      setLocalLoading(true);
      setPendingFileName(files[0].name);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      await onFileChange(e);
    } catch (error) {
      console.error('Error handling file change:', error);
    } finally {
      setLocalLoading(false);
      setPendingFileName(null);
    }
  };

  const handleInternalDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.persist?.();
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) {
      setLocalLoading(true);
      setPendingFileName(files[0].name);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      await onDrop(e);
    } catch (error) {
      console.error('Error handling file drop:', error);
    } finally {
      setLocalLoading(false);
      setPendingFileName(null);
    }
  };

  const isLoading = isUploading || localLoading;
  const displayName = file?.name || pendingFileName;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleInternalDrop}
      className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors border-primary bg-blue-tint text-foreground hover:bg-primary-lighter dark:border-primary-hover dark:bg-primary-light dark:text-on-blue-muted dark:hover:border-primary dark:hover:bg-primary-hover ${
        isDragging ? 'border-primary bg-primary-lighter dark:border-primary dark:bg-primary-hover' : ''
      }`}
    >
      <div className="flex flex-col items-center gap-1">
        {isLoading ? (
          <>
            <Spinner size={24} />
            <p className="text-xs font-medium">
              {displayName
                ? `${isUploading ? 'Uploading' : 'Loading'} ${displayName}...`
                : isUploading
                ? 'Uploading...'
                : 'Loading...'}
            </p>
          </>
        ) : file ? (
          <>
            <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-medium text-foreground dark:text-on-blue">
              {file.name}
            </p>
            <p className="text-xs text-text-3 dark:text-on-blue-muted">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs text-blue-text hover:opacity-80 transition-opacity dark:text-primary"
            >
              Choose different file
            </label>
          </>
        ) : (
          <>
            <svg className="w-6 h-6 text-secondary-hover dark:text-on-blue-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs font-medium">
              Drag &amp; drop or
            </p>
            <label
              htmlFor={inputId}
              className="cursor-pointer font-medium text-xs text-blue-text hover:opacity-80 transition-opacity dark:text-secondary-hover"
            >
              Browse ({acceptedExtensions})
            </label>
          </>
        )}
        <input
          id={inputId}
          type="file"
          onChange={handleInternalFileChange}
          accept={acceptedFormats}
          multiple={multiple}
          disabled={isLoading}
          className={`absolute inset-0 w-full h-full opacity-0 z-10 ${isLoading ? 'cursor-default pointer-events-none' : 'cursor-pointer'}`}
        />
      </div>
    </div>
  );
}