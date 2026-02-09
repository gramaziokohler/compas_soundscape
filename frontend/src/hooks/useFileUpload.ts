import { useState, useCallback } from 'react';
import { apiService } from '@/services/api';
import { calculateGeometryBounds, calculateScaleForSounds } from '@/lib/utils';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';
import type { CompasGeometry } from '@/types';

export function useFileUpload() {
  const handleError = useApiErrorHandler();
  // Separate states for 3D model and audio files
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [geometryData, setGeometryData] = useState<CompasGeometry | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingModel, setIsDraggingModel] = useState(false);
  const [modelEntities, setModelEntities] = useState<any[]>([]);
  const [isAnalyzingModel, setIsAnalyzingModel] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [geometryBounds, setGeometryBounds] = useState<{min: [number, number, number], max: [number, number, number]} | null>(null);
  const [scaleForSounds, setScaleForSounds] = useState(1.0);
  const [useModelAsContext, setUseModelAsContext] = useState(true);
  
  // Speckle-specific state
  const [speckleModelUrl, setSpeckleModelUrl] = useState<string | null>(null);
  const [speckleObjectId, setSpeckleObjectId] = useState<string | null>(null);

  // Helper functions to check file types
  const is3DModelFile = (filename: string) => {
    return /\.(ifc|3dm|obj)$/i.test(filename);
  };

  const isAudioFile = (filename: string) => {
    return /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(filename);
  };

  // Single file handler that determines type and stores appropriately
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (is3DModelFile(selectedFile.name)) {
      // Clear old model data when selecting a new model file
      setModelEntities([]);
      setGeometryData(null);
      setAnalysisProgress('');
      setModelFile(selectedFile);
      setUploadError(null);
    } else if (isAudioFile(selectedFile.name)) {
      setAudioFile(selectedFile);
      setUploadError(null);
    } else {
      setUploadError('Invalid file type. Please upload .ifc, .3dm, .wav, or .mp3 files.');
    }
  }, []);

  // Single drag handlers
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingModel(true); // Reuse for general dragging state
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingModel(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingModel(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    if (is3DModelFile(droppedFile.name)) {
      // Clear old model data when dropping a new model file
      setModelEntities([]);
      setGeometryData(null);
      setAnalysisProgress('');
      setModelFile(droppedFile);
      setUploadError(null);
    } else if (isAudioFile(droppedFile.name)) {
      setAudioFile(droppedFile);
      setUploadError(null);
    } else {
      setUploadError('Invalid file type. Please upload .ifc, .3dm, .wav, or .mp3 files.');
    }
  }, []);

  const processGeometry = useCallback((geometry: CompasGeometry) => {
    setGeometryData(geometry);

    if (geometry.vertices && geometry.vertices.length > 0) {
      const bounds = calculateGeometryBounds(geometry.vertices);
      setGeometryBounds(bounds);
      setScaleForSounds(calculateScaleForSounds(bounds));
    }
  }, []);

  // DEPRECATED: Legacy model analysis removed - Speckle workflow is now the primary path
  // Entities are extracted from Speckle WorldTree instead of backend analysis
  const analyzeModel = useCallback(async (_uploadedFile: File) => {
    console.warn('[useFileUpload] analyzeModel is deprecated - use Speckle workflow instead');
    setAnalysisProgress('Model analysis via Speckle workflow');
  }, []);

  const handleUploadModel = useCallback(async () => {
    if (!modelFile) {
      setUploadError("Please select a model file first.");
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    setIsAnalyzingModel(false);
    setAnalysisProgress('');
    setModelEntities([]);

    try {
      const response = await apiService.uploadFile(modelFile);
      
      // Check if response has Speckle data
      const hasSpeckle = 'speckle' in response;
      const hasGeometry = 'geometry' in response;
      
      // Store Speckle data if available
      if (hasSpeckle && response.speckle) {
        setSpeckleModelUrl(response.speckle.url);
        setSpeckleObjectId(response.speckle.object_id);
      }
      
      // Process geometry for legacy compatibility
      // If response has geometry field, use it; otherwise treat entire response as geometry
      const geometry = hasGeometry ? response.geometry : response;
      if (geometry && 'vertices' in geometry && 'faces' in geometry) {
        processGeometry(geometry);
      }

      // Only analyze model if useModelAsContext is true
      if (useModelAsContext) {
        await analyzeModel(modelFile);
      } else {
        setAnalysisProgress('Model loaded for positioning only');
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to upload file';
      setUploadError(errorMessage);
      handleError(err, errorMessage);
      setIsAnalyzingModel(false);
    } finally {
      setIsUploading(false);
    }
  }, [modelFile, processGeometry, analyzeModel, useModelAsContext, handleError]);

  // DEPRECATED: Legacy sample IFC loading removed - use file upload with Speckle workflow instead
  const handleLoadSampleIfc = useCallback(async () => {
    console.warn('[useFileUpload] handleLoadSampleIfc is deprecated - use file upload with Speckle workflow');
    setUploadError('Sample IFC loading is deprecated. Please upload a file directly via the right sidebar.');
  }, []);

  const clearModel = useCallback(() => {
    setModelEntities([]);
    setGeometryData(null);
    setModelFile(null);
    setAnalysisProgress('');
  }, []);

  const clearAudio = useCallback(() => {
    setAudioFile(null);
  }, []);

  return {
    // File state
    modelFile,
    audioFile,
    geometryData,
    uploadError,
    isUploading,
    isDragging: isDraggingModel, // Reuse as general dragging state
    modelEntities,
    isAnalyzingModel,
    analysisProgress,
    geometryBounds,
    scaleForSounds,
    useModelAsContext,
    // Speckle state
    speckleModelUrl,
    speckleObjectId,
    // File handlers (single upload area)
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleUploadModel,
    // Other handlers
    handleLoadSampleIfc,
    clearModel,
    clearAudio,
    setModelFile,
    setAudioFile,
    setUseModelAsContext,
    setModelEntities,
    setGeometryData
  };
}
