import type { LoadTab } from "@/types";

interface ModelLoadSectionProps {
  modelEntities: any[];
  activeLoadTab: LoadTab;
  file: File | null;
  isDragging: boolean;
  isUploading: boolean;
  isAnalyzingModel: boolean;
  uploadError: string | null;
  analysisProgress: string;
  useModelAsContext: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onUpload: () => void;
  onLoadSampleIfc: () => void;
  onClearModel: () => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setUseModelAsContext: (value: boolean) => void;
}

export function ModelLoadSection({
  modelEntities,
  activeLoadTab,
  file,
  isDragging,
  isUploading,
  isAnalyzingModel,
  uploadError,
  analysisProgress,
  useModelAsContext,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onUpload,
  onLoadSampleIfc,
  onClearModel,
  setActiveLoadTab,
  setUseModelAsContext
}: ModelLoadSectionProps) {
  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">3D Model (Optional) 

      </p>
      <div>
        {modelEntities.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-xs text-green-800 dark:text-green-300 font-semibold">
                ✓ Model loaded with {modelEntities.length} objects
              </p>
            </div>

            <label className="flex items-center gap-2 px-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={useModelAsContext}
                onChange={(e) => setUseModelAsContext(e.target.checked)}
                className="w-4 h-4 rounded focus:ring-2 accent-primary"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">
                Use model as context for sound generation
              </span>
            </label>

            {!useModelAsContext && (
              <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                ℹ️ Model will be used for positioning only
              </div>
            )}

            <button
              onClick={onClearModel}
              className="w-full rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium py-2 text-xs hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Load Another Model
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setActiveLoadTab('upload')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                  activeLoadTab === 'upload'
                    ? 'bg-primary text-white'
                    : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'
                }`}
              >
                Upload File
              </button>
              <button
                onClick={() => setActiveLoadTab('sample')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                  activeLoadTab === 'sample'
                    ? 'bg-primary text-white'
                    : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'
                }`}
              >
                Sample IFC
              </button>
            </div>

            {activeLoadTab === 'upload' && (
              <div className="flex flex-col gap-2">
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
                        <label
                          htmlFor="file-upload"
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
                          htmlFor="file-upload"
                          className="cursor-pointer font-medium text-xs text-primary hover:text-primary-hover"
                        >
                          Browse (.obj, .stl, .ifc, .3dm)
                        </label>
                      </>
                    )}
                    <input
                      id="file-upload"
                      type="file"
                      onChange={onFileChange}
                      accept=".obj,.stl,.ifc,.3dm"
                      className="hidden"
                    />
                  </div>
                </div>
                <button
                  onClick={onUpload}
                  disabled={isUploading || isAnalyzingModel || !file}
                  className="w-full rounded-md text-white font-medium py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-gray-400 disabled:hover:bg-gray-400 flex items-center justify-center gap-2 transition-colors"
                >
                  {isUploading || isAnalyzingModel ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {isUploading ? "Loading..." : "Analyzing..."}
                    </>
                  ) : (
                    "Load Model"
                  )}
                </button>

                <label className="flex items-center gap-2 px-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useModelAsContext}
                    onChange={(e) => setUseModelAsContext(e.target.checked)}
                    className="w-4 h-4 rounded focus:ring-2 accent-primary"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    Use model as context for sound generation
                  </span>
                </label>

                {isAnalyzingModel && analysisProgress && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                    🔍 {analysisProgress}
                  </div>
                )}

                {!useModelAsContext && file && !isUploading && (
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    ℹ️ Model will be used for positioning only
                  </div>
                )}
              </div>
            )}

            {activeLoadTab === 'sample' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={onLoadSampleIfc}
                  disabled={isUploading || isAnalyzingModel}
                  className="w-full rounded-md text-white font-medium py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-gray-400 disabled:hover:bg-gray-400 flex items-center justify-center gap-2 transition-colors"
                >
                  {isUploading || isAnalyzingModel ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {isUploading ? "Loading..." : "Analyzing..."}
                    </>
                  ) : (
                    "Load Duplex Sample"
                  )}
                </button>

                <label className="flex items-center gap-2 px-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useModelAsContext}
                    onChange={(e) => setUseModelAsContext(e.target.checked)}
                    className="w-4 h-4 rounded focus:ring-2 accent-primary"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    Use model as context for sound generation
                  </span>
                </label>

                {isAnalyzingModel && analysisProgress && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                    🔍 {analysisProgress}
                  </div>
                )}

                {!useModelAsContext && !isUploading && (
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    ℹ️ Model will be used for positioning only
                  </div>
                )}
              </div>
            )}

            {uploadError && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600">
                {uploadError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
