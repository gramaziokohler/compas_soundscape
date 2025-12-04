'use client';

import React, { useState, useEffect } from 'react';
import { getMaterials, runFullSimulation, stopSimulation } from '../../hooks/useChoras';
import { Material } from '../../types/Choras';
import { useFileUpload } from '../../hooks/useFileUpload';

export default function SimulationPage() {
  // Use the centralized file upload hook
  const {
    modelFile,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isDragging,
    uploadError
  } = useFileUpload();

  // Strongly typed state
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedMatId, setSelectedMatId] = useState<number | "">("");
  const [status, setStatus] = useState<string>("Idle");
  const [progress, setProgress] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentSimulationId, setCurrentSimulationId] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const data = await getMaterials();
      setMaterials(data);
      if (data.length > 0) {
        setSelectedMatId(data[0].id);
      }
    }
    load();
  }, []);

  const handleMaterialChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMatId(Number(e.target.value));
  };

  const handleRun = async () => {
    if (!modelFile || selectedMatId === "") {
      alert("Please select a file and a material");
      return;
    }

    setStatus("Setting up simulation...");
    setIsRunning(true);
    setProgress(0);
    setCurrentSimulationId(null);

    try {
      // Start the simulation and monitor progress
      const result = await runFullSimulation(
        modelFile,
        Number(selectedMatId),
        "User Test TS",
        (percentage, message) => {
          setStatus(message);
          if (percentage > 0) {
            setProgress(percentage);
          }
        },
        (simulationId) => {
          // Store simulation ID as soon as it's created (for cancellation)
          setCurrentSimulationId(simulationId);
        }
      );

      setProgress(100);
      setIsRunning(false);
      setStatus("Complete!");
      setCurrentSimulationId(null);

      console.log('Simulation finished:', result);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setIsRunning(false);
      setProgress(0);
      setCurrentSimulationId(null);
    }
  };

  return (
    <div className="p-6 border rounded shadow-md max-w-lg mx-auto mt-10 bg-white">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Run CHORAS Sim</h2>

      {/* File Input with Drag & Drop */}
      <div className="mb-5">
        <label className="block text-sm font-semibold mb-2 text-gray-700">
          1. Geometry (.obj)
        </label>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-4 transition-colors ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
          }`}
        >
          <input
            type="file"
            accept=".obj"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
          {modelFile && (
            <p className="mt-2 text-xs text-green-600">
              ✓ Selected: {modelFile.name}
            </p>
          )}
          {uploadError && (
            <p className="mt-2 text-xs text-red-600">
              ✗ {uploadError}
            </p>
          )}
        </div>
      </div>

      {/* Material Select */}
      <div className="mb-6">
        <label className="block text-sm font-semibold mb-2 text-gray-700">
          2. Surface Material
        </label>
        <select 
          value={selectedMatId} 
          onChange={handleMaterialChange}
          className="block w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
        >
          {materials.map((mat) => (
            <option key={mat.id} value={mat.id}>
              {mat.name}
            </option>
          ))}
        </select>
        {selectedMatId !== "" && (
           <p className="text-xs text-gray-500 mt-2 italic">
             {materials.find(m => m.id === selectedMatId)?.description}
           </p>
        )}
      </div>

      {/* Action Buttons */}
      <button
        onClick={handleRun}
        disabled={!modelFile || isRunning}
        className={`w-full py-2 px-4 rounded font-bold text-white transition-colors
          ${(!modelFile || isRunning)
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"}`}
      >
        {isRunning ? "Processing..." : "Start Simulation"}
      </button>

      {/* Stop Simulation Button - Only show when simulation is running */}
      {isRunning && currentSimulationId && (
        <button
          onClick={async () => {
            try {
              await stopSimulation(currentSimulationId);
              setIsRunning(false);
              setStatus("Simulation cancelled by user");
              setProgress(0);
              setCurrentSimulationId(null);
            } catch (e: any) {
              setStatus(`Error stopping simulation: ${e.message}`);
            }
          }}
          className="w-full py-2 px-4 rounded font-bold text-white bg-red-600 hover:bg-red-700 transition-colors mt-2"
        >
          Stop Simulation
        </button>
      )}

      {/* Progress Bar - Only show when simulation is actually running */}
      {isRunning && progress > 0 && (
        <div className="mt-4">
          <div className="flex justify-between mb-1 text-sm text-gray-700">
            <span>Simulation Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Status Output */}
      <div className={`mt-4 p-3 rounded text-sm text-center
        ${status.startsWith("Error") ? "bg-red-100 text-red-700" :
          status.includes("Complete") ? "bg-green-100 text-green-700" :
          "bg-gray-100 text-gray-800"}`}>
        {status}
      </div>
    </div>
  );
}