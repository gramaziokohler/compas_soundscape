import { useState, useEffect, useRef } from 'react';
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
  /** Scale the drop zone with the viewport (fluid rem/clamp) instead of fixed sizes. */
  fluid?: boolean;
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
  isUploading = false,
  fluid = false
}: FileUploadAreaProps) {
  const [localLoading, setLocalLoading] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleInternalDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Required synchronously so the browser allows a drop at all.
    e.preventDefault();
    onDragOver(e);
  };

  const handleInternalDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.persist?.();
    // Must run synchronously: awaiting before this lets the browser's default
    // drop action (open/download the file) fire before onDrop is reached.
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) {
      setLocalLoading(true);
      setPendingFileName(files[0].name);
    }
    // Call synchronously: DataTransfer is only valid during the drop dispatch,
    // so the consumer must read e.dataTransfer.files before any await.
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

  const openFilePicker = () => {
    if (isLoading) return;
    inputRef.current?.click();
  };

  // Fluid mode: sizes track the viewport (rem min/max, vw fluid) instead of
  // fixed steps, so the drop zone stays proportional on any screen.
  const paddingClass = fluid ? 'p-[clamp(1rem,1vw,2.25rem)]' : 'p-4';
  const radiusClass = fluid ? 'rounded-[clamp(0.5rem,0.8vw,1rem)]' : 'rounded-lg';
  const gapClass = fluid ? 'gap-[clamp(0.25rem,0.6vw,0.75rem)]' : 'gap-1';
  const iconClass = fluid
    ? 'w-[clamp(1rem,1.5vw,2rem)] h-[clamp(1rem,1.5vw,2rem)]'
    : 'w-6 h-6';
  const textClass = fluid ? 'text-[clamp(0.75rem,0.75vw,1.125rem)]' : 'text-xs';
  const spinnerSize = fluid ? 'clamp(1.25rem,1.5vw,2.25rem)' : 24;

  return (
    <div
      onDragOver={handleInternalDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleInternalDrop}
      onClick={openFilePicker}
      className={`relative border-2 border-dashed ${radiusClass} ${paddingClass} text-center transition-colors border-primary bg-blue-tint text-foreground hover:bg-primary-lighter dark:border-primary-hover dark:bg-primary-light dark:text-on-blue-muted dark:hover:border-primary dark:hover:bg-primary-hover ${
        isLoading ? 'cursor-default' : 'cursor-pointer'
      } ${
        isDragging ? 'border-primary bg-primary-lighter dark:border-primary dark:bg-primary-hover' : ''
      }`}
    >
      <div className={`flex flex-col items-center ${gapClass}`}>
        {isLoading ? (
          <>
            <Spinner size={spinnerSize} />
            <p className={`${textClass} font-medium`}>
              {displayName
                ? `${isUploading ? 'Uploading' : 'Loading'} ${displayName}...`
                : isUploading
                ? 'Uploading...'
                : 'Loading...'}
            </p>
          </>
        ) : file ? (
          <>
            <svg className={`${iconClass} text-success`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className={`${textClass} font-medium text-foreground dark:text-on-blue`}>
              {file.name}
            </p>
            <p className={`${textClass} text-text-3 dark:text-on-blue-muted`}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <span
              className={`font-medium ${textClass} text-blue-text hover:opacity-80 transition-opacity dark:text-primary`}
            >
              Choose different file
            </span>
          </>
        ) : (
          <>
            <svg className={`${iconClass} text-secondary-hover dark:text-on-blue-muted`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className={`${textClass} font-medium`}>
              Drag &amp; drop or
            </p>
            <span
              className={`font-medium ${textClass} text-blue-text hover:opacity-80 transition-opacity dark:text-secondary-hover`}
            >
              Browse ({acceptedExtensions})
            </span>
          </>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          onChange={handleInternalFileChange}
          accept={acceptedFormats}
          multiple={multiple}
          disabled={isLoading}
          className="hidden"
        />
      </div>
    </div>
  );
}