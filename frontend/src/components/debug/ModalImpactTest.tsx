/**
 * Modal Impact Test Component
 * 
 * Simple test component to verify modal impact synthesis works.
 * This demonstrates how to use the useModalImpact hook.
 * 
 * Usage: Import and add to a page to test the feature
 */

'use client';

import { useState } from 'react';
import { useModalImpact, createImpactParameters } from '@/hooks/useModalImpact';
import type { ModalAnalysisRequest } from '@/types/modal';

export function ModalImpactTest() {
  const {
    modalState,
    impactState,
    analyzeModal,
    synthesizeImpact,
    playImpact,
    stopImpact,
  } = useModalImpact();

  const [material, setMaterial] = useState<string>('steel');
  const [impactPosition, setImpactPosition] = useState({ x: 0, y: 0, z: 0 });

  // Simple box mesh for testing
  const testMeshRequest: ModalAnalysisRequest = {
    vertices: [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ],
    faces: [
      [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
      [2, 3, 7, 6], [0, 3, 7, 4], [1, 2, 6, 5],
    ],
    num_modes: 10,
    material,
  };

  const handleAnalyze = async () => {
    try {
      await analyzeModal(testMeshRequest);
      console.log('✅ Modal analysis complete!');
    } catch (error) {
      console.error('❌ Analysis failed:', error);
    }
  };

  const handleSynthesize = async () => {
    if (!modalState.result) {
      alert('Please analyze the mesh first');
      return;
    }

    try {
      const params = createImpactParameters(
        impactPosition.x,
        impactPosition.y,
        impactPosition.z,
        5.0,
        material
      );
      await synthesizeImpact(params);
      console.log('✅ Impact sound synthesized!');
    } catch (error) {
      console.error('❌ Synthesis failed:', error);
    }
  };

  const handlePlay = () => {
    if (!impactState.audioBuffer) {
      alert('Please synthesize the sound first');
      return;
    }
    playImpact();
  };

  return (
    <div className="p-6 bg-neutral-800 rounded-lg border border-neutral-700 max-w-2xl">
      <h2 className="text-2xl font-bold mb-4 text-primary">Modal Impact Test</h2>

      {/* Material Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Material</label>
        <select
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="w-full bg-neutral-700 border border-neutral-600 rounded px-3 py-2"
        >
          <option value="steel">Steel (1% damping)</option>
          <option value="aluminum">Aluminum (1.5% damping)</option>
          <option value="concrete">Concrete (5% damping)</option>
          <option value="wood">Wood (3% damping)</option>
          <option value="glass">Glass (0.8% damping)</option>
        </select>
      </div>

      {/* Impact Position */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Impact Position</label>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            value={impactPosition.x}
            onChange={(e) => setImpactPosition({ ...impactPosition, x: parseFloat(e.target.value) })}
            placeholder="X"
            step="0.1"
            className="bg-neutral-700 border border-neutral-600 rounded px-3 py-2"
          />
          <input
            type="number"
            value={impactPosition.y}
            onChange={(e) => setImpactPosition({ ...impactPosition, y: parseFloat(e.target.value) })}
            placeholder="Y"
            step="0.1"
            className="bg-neutral-700 border border-neutral-600 rounded px-3 py-2"
          />
          <input
            type="number"
            value={impactPosition.z}
            onChange={(e) => setImpactPosition({ ...impactPosition, z: parseFloat(e.target.value) })}
            placeholder="Z"
            step="0.1"
            className="bg-neutral-700 border border-neutral-600 rounded px-3 py-2"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleAnalyze}
          disabled={modalState.isAnalyzing}
          className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 rounded font-medium"
        >
          {modalState.isAnalyzing ? 'Analyzing...' : '1. Analyze Mesh'}
        </button>

        <button
          onClick={handleSynthesize}
          disabled={!modalState.result || impactState.isSynthesizing}
          className="px-4 py-2 bg-secondary hover:bg-secondary-hover disabled:opacity-50 rounded font-medium"
        >
          {impactState.isSynthesizing ? 'Synthesizing...' : '2. Synthesize Impact'}
        </button>

        <button
          onClick={handlePlay}
          disabled={!impactState.audioBuffer || impactState.isPlaying}
          className="px-4 py-2 bg-success hover:bg-success-hover disabled:opacity-50 rounded font-medium"
        >
          {impactState.isPlaying ? 'Playing...' : '3. Play Sound'}
        </button>

        <button
          onClick={stopImpact}
          disabled={!impactState.isPlaying}
          className="px-4 py-2 bg-error hover:bg-error-hover disabled:opacity-50 rounded font-medium"
        >
          Stop
        </button>
      </div>

      {/* Results */}
      {modalState.result && (
        <div className="bg-neutral-900 p-4 rounded border border-neutral-700">
          <h3 className="font-bold mb-2 text-secondary">Modal Analysis Results</h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-neutral-400">Modes Computed:</span>{' '}
              <span className="text-white">{modalState.result.num_modes_computed}</span>
            </p>
            <p>
              <span className="text-neutral-400">Fundamental Frequency:</span>{' '}
              <span className="text-white">
                {modalState.result.frequency_response?.fundamental_frequency.toFixed(2)} Hz
              </span>
            </p>
            <p className="text-neutral-400 mt-2">First 5 Modes (Hz):</p>
            <div className="text-white font-mono text-xs">
              {modalState.result.frequencies.slice(0, 5).map((f, i) => (
                <div key={i}>
                  Mode {i + 1}: {f.toFixed(2)} Hz
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {impactState.audioBuffer && (
        <div className="bg-neutral-900 p-4 rounded border border-neutral-700 mt-4">
          <h3 className="font-bold mb-2 text-success">Impact Sound Ready</h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-neutral-400">Duration:</span>{' '}
              <span className="text-white">{impactState.audioBuffer.duration.toFixed(2)}s</span>
            </p>
            <p>
              <span className="text-neutral-400">Sample Rate:</span>{' '}
              <span className="text-white">{impactState.audioBuffer.sampleRate} Hz</span>
            </p>
          </div>
        </div>
      )}

      {(modalState.error || impactState.error) && (
        <div className="bg-error/10 border border-error p-4 rounded mt-4">
          <p className="text-error font-medium">Error:</p>
          <p className="text-sm text-error/80">{modalState.error || impactState.error}</p>
        </div>
      )}
    </div>
  );
}
