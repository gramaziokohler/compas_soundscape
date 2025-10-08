import { useState, useCallback } from 'react';
import { apiService } from '@/services/api';
import { validateFileExtension, calculateGeometryBounds, calculateScaleForSounds } from '@/lib/utils';
import { VALID_FILE_EXTENSIONS } from '@/lib/constants';
import type { CompasGeometry } from '@/types';

export function useFileUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [geometryData, setGeometryData] = useState<CompasGeometry | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [modelEntities, setModelEntities] = useState<any[]>([]);
  const [isAnalyzingModel, setIsAnalyzingModel] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [geometryBounds, setGeometryBounds] = useState<{min: number[], max: number[]} | null>(null);
  const [scaleForSounds, setScaleForSounds] = useState(1.0);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files ? e.target.files[0] : null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      if (validateFileExtension(droppedFile.name, VALID_FILE_EXTENSIONS)) {
        setFile(droppedFile);
        setUploadError(null);
      } else {
        setUploadError(`Invalid file type. Please upload ${VALID_FILE_EXTENSIONS.join(', ')} files only.`);
      }
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

  const analyzeModel = useCallback(async (uploadedFile: File) => {
    const is3dm = uploadedFile.name.toLowerCase().endsWith('.3dm');
    const isIfc = uploadedFile.name.toLowerCase().endsWith('.ifc');

    if (is3dm) {
      setIsAnalyzingModel(true);
      setAnalysisProgress('Analyzing 3DM entities...');
      try {
        const analyzed = await apiService.analyze3dm(uploadedFile);
        setModelEntities(analyzed.entities);
        setAnalysisProgress(`Found ${analyzed.entities.length} entities`);
        console.log('3DM analysis complete:', analyzed.entities.length, 'entities');
      } catch (error) {
        console.error('3DM analysis error:', error);
        setAnalysisProgress('Failed to analyze 3DM file');
      } finally {
        setIsAnalyzingModel(false);
      }
    } else if (isIfc) {
      setIsAnalyzingModel(true);
      setAnalysisProgress('Analyzing IFC entities...');
      try {
        const analyzed = await apiService.analyzeIfc();
        setModelEntities(analyzed.entities);
        setAnalysisProgress(`Found ${analyzed.entities.length} entities`);
        console.log('IFC analysis complete:', analyzed.entities.length, 'entities');
      } catch (error) {
        console.error('IFC analysis error:', error);
        setAnalysisProgress('Failed to analyze IFC file');
      } finally {
        setIsAnalyzingModel(false);
      }
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) {
      setUploadError("Please select a file first.");
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    setIsAnalyzingModel(false);
    setAnalysisProgress('');
    setModelEntities([]);

    try {
      const geometry = await apiService.uploadFile(file);
      processGeometry(geometry);
      await analyzeModel(file);
    } catch (err: any) {
      setUploadError(err.message);
      setIsAnalyzingModel(false);
    } finally {
      setIsUploading(false);
    }
  }, [file, processGeometry, analyzeModel]);

  const handleLoadSampleIfc = useCallback(async () => {
    setIsUploading(true);
    setIsAnalyzingModel(false);
    setAnalysisProgress('');
    setUploadError(null);
    setModelEntities([]);

    try {
      const geometry = await apiService.loadSampleIfc();
      processGeometry(geometry);

      setIsAnalyzingModel(true);
      setAnalysisProgress('Analyzing IFC entities...');
      const analyzed = await apiService.analyzeIfc();
      setModelEntities(analyzed.entities);
      setAnalysisProgress(`Found ${analyzed.entities.length} entities`);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
      setIsAnalyzingModel(false);
    }
  }, [processGeometry]);

  const clearModel = useCallback(() => {
    setModelEntities([]);
    setGeometryData(null);
    setFile(null);
    setAnalysisProgress('');
  }, []);

  return {
    file,
    geometryData,
    uploadError,
    isUploading,
    isDragging,
    modelEntities,
    isAnalyzingModel,
    analysisProgress,
    geometryBounds,
    scaleForSounds,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleUpload,
    handleLoadSampleIfc,
    clearModel,
    setFile
  };
}
