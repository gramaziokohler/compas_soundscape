/**
 * File Upload Store
 *
 * Replaces useFileUpload. Manages model/audio file state and the Speckle upload
 * workflow. Errors are reported through errorsStore so no hook dependency is needed.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { calculateGeometryBounds, calculateScaleForSounds } from '@/utils/utils';
import { useErrorsStore } from './errorsStore';
import type { CompasGeometry } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function is3DModelFile(filename: string) {
  return /\.(ifc|3dm|obj)$/i.test(filename);
}

function isAudioFile(filename: string) {
  return /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(filename);
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface FileUploadStoreState {
  // ── Files ──────────────────────────────────────────────────────────────────
  modelFile: File | null;
  audioFile: File | null;
  geometryData: CompasGeometry | null;
  uploadError: string | null;
  isUploading: boolean;
  isDragging: boolean;
  modelEntities: any[];
  isAnalyzingModel: boolean;
  analysisProgress: string;
  geometryBounds: { min: [number, number, number]; max: [number, number, number] } | null;
  scaleForSounds: number;
  useModelAsContext: boolean;

  // ── Speckle ────────────────────────────────────────────────────────────────
  speckleModelUrl: string | null;
  speckleObjectId: string | null;

  // ── File selection ─────────────────────────────────────────────────────────
  /** Call from an <input onChange> handler */
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Call from onDragOver / onDrop area */
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  // ── Upload ─────────────────────────────────────────────────────────────────
  handleUploadModel: () => Promise<void>;

  // ── Misc ───────────────────────────────────────────────────────────────────
  clearModel: () => void;
  clearAudio: () => void;
  setModelFile: (file: File | null) => void;
  setModelEntities: (entities: any[]) => void;
  setUseModelAsContext: (use: boolean) => void;
  processGeometry: (geometry: CompasGeometry) => void;
  setSpeckleModelUrl: (url: string | null) => void;
  setSpeckleObjectId: (id: string | null) => void;
}

export const useFileUploadStore = create<FileUploadStoreState>()(
  devtools(
    (set, get) => ({
      // ── Initial state ──
      modelFile: null,
      audioFile: null,
      geometryData: null,
      uploadError: null,
      isUploading: false,
      isDragging: false,
      modelEntities: [],
      isAnalyzingModel: false,
      analysisProgress: '',
      geometryBounds: null,
      scaleForSounds: 1.0,
      useModelAsContext: true,
      speckleModelUrl: null,
      speckleObjectId: null,

      // ── File selection ─────────────────────────────────────────────────────
      handleFileChange: (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (is3DModelFile(file.name)) {
          set(
            { modelFile: file, modelEntities: [], geometryData: null, analysisProgress: '', uploadError: null },
            false,
            'fileUpload/selectModelFile',
          );
        } else if (isAudioFile(file.name)) {
          set({ audioFile: file, uploadError: null }, false, 'fileUpload/selectAudioFile');
        } else {
          set(
            { uploadError: 'Invalid file type. Please upload .ifc, .3dm, .wav, or .mp3 files.' },
            false,
            'fileUpload/invalidFileType',
          );
        }
      },

      handleDragOver: (e) => {
        e.preventDefault();
        e.stopPropagation();
        set({ isDragging: true }, false, 'fileUpload/dragOver');
      },

      handleDragLeave: (e) => {
        e.preventDefault();
        e.stopPropagation();
        set({ isDragging: false }, false, 'fileUpload/dragLeave');
      },

      handleDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files?.[0];
        set({ isDragging: false }, false, 'fileUpload/drop');
        if (!file) return;
        if (is3DModelFile(file.name)) {
          set(
            { modelFile: file, modelEntities: [], geometryData: null, analysisProgress: '', uploadError: null },
            false,
            'fileUpload/dropModelFile',
          );
        } else if (isAudioFile(file.name)) {
          set({ audioFile: file, uploadError: null }, false, 'fileUpload/dropAudioFile');
        } else {
          set(
            { uploadError: 'Invalid file type. Please upload .ifc, .3dm, .wav, or .mp3 files.' },
            false,
            'fileUpload/dropInvalidType',
          );
        }
      },

      // ── Upload ─────────────────────────────────────────────────────────────
      handleUploadModel: async () => {
        const { modelFile, useModelAsContext, processGeometry } = get();
        if (!modelFile) {
          set({ uploadError: 'Please select a model file first.' }, false, 'fileUpload/noFile');
          return;
        }

        set(
          { uploadError: null, isUploading: true, isAnalyzingModel: false, analysisProgress: '', modelEntities: [] },
          false,
          'fileUpload/uploadStart',
        );

        try {
          const response = await apiService.uploadFile(modelFile);

          const hasSpeckle = 'speckle' in response;
          const hasGeometry = 'geometry' in response;

          if (hasSpeckle && response.speckle) {
            set(
              { speckleModelUrl: response.speckle.url, speckleObjectId: response.speckle.object_id },
              false,
              'fileUpload/speckleData',
            );
          }

          const geometry = hasGeometry ? response.geometry : response;
          if (geometry && 'vertices' in geometry && 'faces' in geometry) {
            processGeometry(geometry);
          }

          if (useModelAsContext) {
            set({ analysisProgress: 'Model analysis via Speckle workflow' }, false, 'fileUpload/analysisHint');
          } else {
            set({ analysisProgress: 'Model loaded for positioning only' }, false, 'fileUpload/positioningHint');
          }
        } catch (err: any) {
          const msg = err.message || 'Failed to upload file';
          set({ uploadError: msg, isAnalyzingModel: false }, false, 'fileUpload/uploadError');
          useErrorsStore.getState().addError(msg);
        } finally {
          set({ isUploading: false }, false, 'fileUpload/uploadDone');
        }
      },

      // ── Misc ───────────────────────────────────────────────────────────────
      clearModel: () =>
        set(
          { modelEntities: [], geometryData: null, modelFile: null, analysisProgress: '' },
          false,
          'fileUpload/clearModel',
        ),

      clearAudio: () => set({ audioFile: null }, false, 'fileUpload/clearAudio'),

      setModelFile: (file) => set({ modelFile: file }, false, 'fileUpload/setModelFile'),

      setModelEntities: (entities) =>
        set({ modelEntities: entities }, false, 'fileUpload/setModelEntities'),

      setUseModelAsContext: (use) =>
        set({ useModelAsContext: use }, false, 'fileUpload/setUseModelAsContext'),

      processGeometry: (geometry) => {
        const bounds =
          geometry.vertices && geometry.vertices.length > 0
            ? calculateGeometryBounds(geometry.vertices)
            : null;
        set(
          {
            geometryData: geometry,
            ...(bounds
              ? { geometryBounds: bounds, scaleForSounds: calculateScaleForSounds(bounds) }
              : {}),
          },
          false,
          'fileUpload/processGeometry',
        );
      },

      setSpeckleModelUrl: (url) =>
        set({ speckleModelUrl: url }, false, 'fileUpload/setSpeckleModelUrl'),

      setSpeckleObjectId: (id) =>
        set({ speckleObjectId: id }, false, 'fileUpload/setSpeckleObjectId'),
    }),
    { name: 'fileUploadStore' },
  ),
);
