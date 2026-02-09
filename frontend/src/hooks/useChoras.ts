// src/services/simulationService.ts
import {
  Material,
  ModelInfo,
  SimulationCreatePayload
} from '../types/Choras'; // Adjust path as needed
import {
  CHORAS_API_BASE,
  CHORAS_POLL_INTERVAL,
  CHORAS_INITIAL_POLL_DELAY,
  CHORAS_POLL_TIMEOUT,
  CHORAS_RUN_TIMEOUT,
  CHORAS_MAX_POLL_RETRIES,
  CHORAS_TIMEOUT
} from '../utils/constants';

const API_BASE = CHORAS_API_BASE;

/**
 * Extract error message from Choras backend response
 * Handles various error response formats
 */
async function extractErrorMessage(response: Response, defaultMessage: string): Promise<string> {
  try {
    const contentType = response.headers.get('content-type');

    // Try to parse as JSON first (most common format)
    if (contentType?.includes('application/json')) {
      const errorData = await response.json();

      // Check for common error message fields
      if (errorData.detail) {
        return errorData.detail;
      }
      if (errorData.message) {
        return errorData.message;
      }
      if (errorData.error) {
        return errorData.error;
      }

      // Return the whole JSON if no standard field found
      return JSON.stringify(errorData);
    }

    // Try text format
    const errorText = await response.text();
    if (errorText && errorText.trim()) {
      return errorText;
    }

    return defaultMessage;
  } catch {
    // If parsing fails, return default message
    return defaultMessage;
  }
}

// Helper for generating UUIDs
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments if needed
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};


/**
 * Fetch available materials from DB
 */
export async function getMaterials(): Promise<Material[]> {
  try {
    const res = await fetch(`${API_BASE}/materials`);
    if (!res.ok) {
      const errorMsg = await extractErrorMessage(res, 'Failed to fetch materials');
      throw new Error(`Failed to fetch materials: ${errorMsg}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Could not load materials", err);
    return [];
  }
}

/**
 * Main Function: Runs the full workflow
 */
export async function runFullSimulation(
  fileObject: File,
  materialId: number,
  simulationName: string = "Auto-Sim-2",
  onProgress?: (percentage: number, message: string) => void,
  onSimulationCreated?: (simulationId: number, simulationRunId: number) => void,
  receivers?: any[],
  soundscapeData?: any[],
  simulationSettings?: {
    de_c0: number;
    de_ir_length: number;
    de_lc: number;
    edt: number;
    sim_len_type: 'ir_length' | 'edt';
  },
  excludedLayers?: string[]
): Promise<any> {
  try {
    console.log('=== Starting Choras Simulation ===');
    console.log('Receivers:', receivers);
    console.log('Sound sources:', soundscapeData);
    console.log('Excluded layers:', excludedLayers);

    // --- STEP 1: Upload File ---
    console.log("1. Uploading File...");
    const slotRes = await fetch(`${API_BASE}/files`);
    if (!slotRes.ok) {
      const errorMsg = await extractErrorMessage(slotRes, 'Failed to get upload slot');
      throw new Error(`Failed to get upload slot: ${errorMsg}. Is the Choras backend running at ${API_BASE}?`);
    }
    const { id: slot } = await slotRes.json(); // The API returns "id", not "slot"

    // Create a unique filename by appending timestamp to ensure fresh upload each time
    const timestamp = Date.now();
    const originalName = fileObject.name;
    const nameParts = originalName.split('.');
    const extension = nameParts.pop();
    const baseName = nameParts.join('.');
    const uniqueFilename = `${baseName}_${timestamp}.${extension}`;

    // Create a new File object with unique name
    const uniqueFile = new File([fileObject], uniqueFilename, { type: fileObject.type });

    const formData = new FormData();
    formData.append("file", uniqueFile);

    const uploadRes = await fetch(`${API_BASE}/files?slot=${slot}`, {
      method: "POST",
      body: formData
    });

    if (!uploadRes.ok) {
      const errorMsg = await extractErrorMessage(uploadRes, 'File upload failed');
      throw new Error(`File upload failed (${uploadRes.status}): ${errorMsg}`);
    }
    const fileData = await uploadRes.json();
    const fileId: number = fileData.id;

    // --- STEP 2: Geometry Check (convert .obj to .geo) ---
    console.log("2. Running Geometry Check...");
    const geoCheckRes = await fetch(`${API_BASE}/geometryCheck?fileUploadId=${fileId}`, {
      method: "POST"
    });

    if (!geoCheckRes.ok) {
      const errorMsg = await extractErrorMessage(geoCheckRes, 'Geometry check failed');
      throw new Error(`Geometry check failed (${geoCheckRes.status}): ${errorMsg}`);
    }

    const geoCheckData = await geoCheckRes.json();
    console.log('Geometry check response:', geoCheckData);
    console.log('Geometry check response keys:', Object.keys(geoCheckData));

    // Extract the processed model ID from geometry check
    const outputModelId = geoCheckData.outputModelId;
    if (!outputModelId) {
      throw new Error('Geometry check did not return an outputModelId');
    }
    console.log('Using output model ID from geometry check:', outputModelId);

    // --- STEP 2.5: Fetch and parse .geo file to extract surface UUIDs ---
    console.log("2.5. Fetching .geo file to extract surface UUIDs...");

    // Get the file URL for the output model
    const fileUrlRes = await fetch(`${API_BASE}/files/${outputModelId}`);
    if (!fileUrlRes.ok) {
      throw new Error(`Failed to fetch file URL: ${fileUrlRes.status}`);
    }
    const fileUrl = await fileUrlRes.text();
    const cleanFileUrl = fileUrl.replace(/"/g, '').trim(); // Remove all quotes and whitespace
    console.log('File URL:', cleanFileUrl);

    // Extract filename from URL (e.g., "MeasurementRoom_hash")
    const filenameMatch = cleanFileUrl.match(/([^\/]+)\.(zip|obj|3dm|geo)$/);
    if (!filenameMatch) {
      console.error('Failed to match filename. URL:', cleanFileUrl);
      throw new Error(`Could not extract filename from file URL: ${cleanFileUrl}`);
    }
    const baseFilename = filenameMatch[1]; // e.g., "MeasurementRoom_84cc8241a9644990897fffbd39a61c23"
    console.log('Extracted base filename:', baseFilename);

    // Fetch the .geo file
    const geoFileUrl = `${API_BASE}/uploads/${baseFilename}.geo`;
    console.log('Fetching .geo file from:', geoFileUrl);
    const geoFileRes = await fetch(geoFileUrl);
    if (!geoFileRes.ok) {
      throw new Error(`Failed to fetch .geo file: ${geoFileRes.status}`);
    }
    const geoFileContent = await geoFileRes.text();

    // Parse Physical Surface definitions to extract UUIDs
    const surfaceRegex = /Physical Surface\("([a-f0-9-]+)"\)/g;
    const surfaceUUIDs: string[] = [];
    let match;
    while ((match = surfaceRegex.exec(geoFileContent)) !== null) {
      surfaceUUIDs.push(match[1]);
    }

    console.log(`Found ${surfaceUUIDs.length} surfaces in .geo file:`, surfaceUUIDs);

    if (surfaceUUIDs.length === 0) {
      throw new Error('No surfaces found in .geo file. Cannot create simulation without surfaces.');
    }

    // --- STEP 3: Get available project ID ---
    console.log("3. Fetching available projects...");
    const projectsRes = await fetch(`${API_BASE}/projects`);
    if (!projectsRes.ok) {
      throw new Error(`Failed to fetch projects: ${projectsRes.status}`);
    }
    const projects = await projectsRes.json();
    if (!projects || projects.length === 0) {
      throw new Error('No projects found. Please create a project in Choras first.');
    }
    const projectId = projects[0].id;
    console.log(`Using project ID: ${projectId}`);

    // --- STEP 4: Create Model in database ---
    // Use the .geo file (outputModelId from geometry check) as the sourceFileId
    console.log("4. Creating Model in database...");
    const modelRes = await fetch(
      `${API_BASE}/models?name=${encodeURIComponent(simulationName)}&projectId=${projectId}&sourceFileId=${outputModelId}`,
      { method: "POST" }
    );

    if (!modelRes.ok) {
      const errorMsg = await extractErrorMessage(modelRes, 'Model creation failed');
      throw new Error(`Model creation failed (${modelRes.status}): ${errorMsg}`);
    }
    const modelData = await modelRes.json();
    console.log('Model creation response:', modelData);
    const modelId: number = modelData.id;

    // --- STEP 4.5: Delete all old simulations for this model to prevent conflicts ---
    console.log("4.5. Cleaning up old simulations for this model...");
    try {
      const oldSimsRes = await fetch(`${API_BASE}/simulations?modelId=${modelId}`);
      if (oldSimsRes.ok) {
        const oldSimulations = await oldSimsRes.json();
        if (oldSimulations.length > 0) {
          console.log(`Found ${oldSimulations.length} old simulations, deleting them...`);
          for (const oldSim of oldSimulations) {
            try {
              await fetch(`${API_BASE}/simulations/${oldSim.id}`, {
                method: 'DELETE'
              });
              console.log(`Deleted simulation ${oldSim.id}`);
            } catch (deleteError) {
              console.warn(`Failed to delete simulation ${oldSim.id}:`, deleteError);
            }
          }
          console.log('Old simulations cleanup complete');
        } else {
          console.log('No old simulations found for this model');
        }
      }
    } catch (cleanupError) {
      console.warn('Failed to cleanup old simulations (continuing anyway):', cleanupError);
    }

    // --- STEP 5: Create Simulation WITH material mappings from parsed surfaces ---
    console.log(`5. Creating simulation with ${surfaceUUIDs.length} surfaces assigned to material ${materialId}...`);

    // Map all surfaces to the selected material
    const layerIdByMaterialId: Record<string, number> = {};
    surfaceUUIDs.forEach((uuid) => {
      layerIdByMaterialId[uuid] = materialId;
    });

    // Log positions for debugging
    console.log('Source positions (ThreeJS Y-up):', soundscapeData?.map(s => s.position));
    console.log('Receiver positions (ThreeJS Y-up):', receivers?.map(r => r.position));

    // Transform coordinates from ThreeJS (Y-up) to Choras backend coordinate system
    // ThreeJS: X-right, Y-up, Z-forward (towards viewer)
    // Backend uses rotate_y_up_to_z_up: (x, y, z)_file -> (x, z, -y)_backend
    // So we need: (x, y, z)_threejs -> (x, -z, y)_choras to match the rotated mesh
    const transformCoords = (pos: [number, number, number]): { x: number, y: number, z: number } => {
      return {
        x: pos[0],      // X unchanged
        y: -pos[2],     // ThreeJS Z -> -Z (negated)
        z: pos[1]       // ThreeJS Y -> Z (up direction)
      };
    };

    const initialPayload: SimulationCreatePayload = {
      modelId: modelId,
      name: simulationName,
      description: excludedLayers && excludedLayers.length > 0 
        ? `Created via Next.js API. Excluded layers: ${excludedLayers.join(', ')}`
        : "Created via Next.js API",
      taskType: "DE",
      layerIdByMaterialId: layerIdByMaterialId, // Pre-populated with surfaces from .geo file

      solverSettings: {
        simulationSettings: simulationSettings || {
           de_c0: 343,
           de_ir_length: 0.1,
           de_lc: 1,
           edt: 35,
           sim_len_type: "ir_length"
        }
      },
      // Sources: Use sound sphere positions or default
      sources: soundscapeData && soundscapeData.length > 0
        ? soundscapeData.map((sound, index) => {
            const coords = transformCoords(sound.position);
            const source = {
              id: generateUUID(),
              isValid: true,
              label: `Source ${index + 1}`,
              orderNumber: index + 1,
              ...coords
            };
            console.log(`Source ${index + 1} transformed:`, source);
            return source;
          })
        : [{
            id: generateUUID(),
            isValid: true,
            label: "Source 1",
            orderNumber: 1,
            x: 1.0, y: 1.0, z: 1.0
          }],
      // Receivers: Use receiver positions or default
      receivers: receivers && receivers.length > 0
        ? receivers.map((receiver, index) => {
            const coords = transformCoords(receiver.position);
            const rec = {
              id: generateUUID(),
              isValid: true,
              label: receiver.name || `Receiver ${index + 1}`,
              orderNumber: index + 1,
              ...coords
            };
            console.log(`Receiver ${index + 1} transformed:`, rec);
            return rec;
          })
        : [{
            id: generateUUID(),
            isValid: true,
            label: "Receiver 1",
            orderNumber: 1,
            x: 3.0, y: 3.0, z: 1.0
          }]
    };

    console.log('Simulation payload:', JSON.stringify(initialPayload, null, 2));

    const simRes = await fetch(`${API_BASE}/simulations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialPayload)
    });

    if (!simRes.ok) {
        const errorMsg = await extractErrorMessage(simRes, 'Simulation creation failed');
        throw new Error(`Simulation creation failed: ${errorMsg}`);
    }

    const simData = await simRes.json();
    const simulationId = simData.id;
    console.log(`Simulation created with ID: ${simulationId}, with ${surfaceUUIDs.length} surfaces pre-assigned`);

    // --- STEP 6: Run simulation ---
    console.log("6. Starting simulation run...");

    const runController = new AbortController();
    const runTimeoutId = setTimeout(() => runController.abort(), CHORAS_RUN_TIMEOUT);

    const runRes = await fetch(`${API_BASE}/simulations/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulationId: simulationId }),
      signal: runController.signal
    });
    clearTimeout(runTimeoutId);

    if (!runRes.ok) {
      const errorMsg = await extractErrorMessage(runRes, 'Run command failed');
      throw new Error(`Run command failed (${runRes.status}): ${errorMsg}`);
    }

    const runData = await runRes.json();
    const simulationRunId = runData.id;
    console.log('Simulation started successfully. Run ID:', simulationRunId);

    // Notify parent component that simulation is created (for cancellation support)
    onSimulationCreated?.(simulationId, simulationRunId);

    // --- STEP 7: Poll for progress ---
    console.log("7. Monitoring simulation progress...");

    let isComplete = false;
    let currentPercentage = 0;
    let resultData = null;
    let pollAttempts = 0;
    let isFirstPoll = true; // Track if this is the very first poll
    const maxPollAttempts = CHORAS_MAX_POLL_RETRIES;

    while (!isComplete) {
      // Wait before polling (8s for first poll, then regular interval)
      const waitTime = isFirstPoll ? CHORAS_INITIAL_POLL_DELAY : CHORAS_POLL_INTERVAL;
      if (isFirstPoll) {
        console.log(`Waiting ${CHORAS_INITIAL_POLL_DELAY / 1000}s before first poll to let Choras initialize...`);
      }
      await new Promise(resolve => setTimeout(resolve, waitTime));
      isFirstPoll = false; // No longer the first poll

      try {
        // Fetch all running simulations to get live percentage updates
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CHORAS_POLL_TIMEOUT);

        const runsRes = await fetch(`${API_BASE}/simulations/run`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!runsRes.ok) {
          const errorMsg = await extractErrorMessage(runsRes, 'Failed to fetch simulation runs');
          throw new Error(`Failed to fetch simulation runs (${runsRes.status}): ${errorMsg}`);
        }

        const allRuns = await runsRes.json();
        pollAttempts = 0; // Reset retry counter on success

        // Find our simulation run by ID
        const runInfo = allRuns.find((run: any) => run.id === simulationRunId);

        if (!runInfo) {
          console.log('Simulation run not found in active runs...');
          // Check if completed by fetching individual simulation
          const statusRes = await fetch(`${API_BASE}/simulations/${simulationId}`);
          if (statusRes.ok) {
            const simStatus = await statusRes.json();
            if (simStatus.simulationRun?.status === 'Completed' || simStatus.simulationRun?.completedAt) {
              isComplete = true;
              continue;
            }
          }
          continue;
        }

        console.log('Polling status:', {
          status: runInfo.status,
          percentage: runInfo.percentage,
          completedAt: runInfo.completedAt
        });

        const newPercentage = runInfo.percentage || 0;
        if (newPercentage !== currentPercentage) {
          currentPercentage = newPercentage;
          console.log(`Progress update: ${currentPercentage}%`);
          // Report actual backend progress
          onProgress?.(newPercentage, `Running simulation: ${newPercentage}%`);
        }

        // Check if simulation is complete
        if (runInfo.status === 'Completed' || runInfo.completedAt) {
          isComplete = true;
          console.log('Simulation completed!');
        } else if (runInfo.status === 'Error') {
          // Try to get detailed error information before throwing
          console.warn('Simulation error detected. Fetching details...');
          try {
            const statusRes = await fetch(`${API_BASE}/simulations/${simulationId}`);
            if (statusRes.ok) {
              const simStatus = await statusRes.json();
              console.log('Error simulation details:', simStatus);

              // Try multiple fields where error might be stored
              const errorMsg = simStatus.simulationRun?.error ||
                              simStatus.simulationRun?.errorMessage ||
                              simStatus.error ||
                              simStatus.message ||
                              'Simulation failed. Check backend logs for details.';

              throw new Error(`Choras simulation failed: ${errorMsg}`);
            }
          } catch (fetchError) {
            console.warn('Could not fetch error details:', fetchError);
          }

          // Fallback error if we couldn't get details
          throw new Error('Simulation failed. Check Choras backend logs for detailed error message (e.g., "Source or receiver points are outside the room mesh").');
        }

        // Safety timeout check
        if (currentPercentage === 0 && Date.now() - runData.createdAt > CHORAS_TIMEOUT) {
          throw new Error(`Simulation timeout - no progress after ${CHORAS_TIMEOUT / 60000} minutes`);
        }

      } catch (pollError: any) {
        // Handle polling errors with retry logic
        pollAttempts++;

        // Check if it's a network error (backend crash/empty response)
        const isNetworkError = pollError.message?.includes('Failed to fetch') ||
                               pollError.message?.includes('ERR_EMPTY_RESPONSE');

        if (isNetworkError) {
          console.warn(`⚠️ Polling attempt ${pollAttempts} - Backend returned empty response (likely crashed). Checking simulation status...`);
        } else {
          console.warn(`Polling attempt ${pollAttempts} failed:`, pollError.message);
        }

        // Always check simulation status directly when we have errors
        // This can reveal backend errors even before max retries
        let hasErrorDetails = false;
        try {
          const statusRes = await fetch(`${API_BASE}/simulations/${simulationId}`);
          if (statusRes.ok) {
            const simStatus = await statusRes.json();
            console.log('Direct status check:', simStatus);

            // Check if simulation has error details
            if (simStatus.simulationRun?.status === 'Error') {
              hasErrorDetails = true;
              // Try multiple fields where error might be stored
              const backendError = simStatus.simulationRun?.error ||
                                  simStatus.simulationRun?.errorMessage ||
                                  simStatus.error ||
                                  simStatus.message ||
                                  'Simulation failed. Check backend logs for details (e.g., "Source or receiver points are outside the room mesh").';

              // Don't throw here - save the error and throw after the try-catch
              // This prevents the "Could not check simulation status directly" error
              throw new Error(`Choras simulation error: ${backendError}`);
            }

            // Check if completed
            if (simStatus.simulationRun?.status === 'Completed' || simStatus.simulationRun?.completedAt) {
              console.log('✓ Simulation completed (confirmed via direct status check)');
              isComplete = true;
              continue;
            }

            // If still running, log current state
            console.log(`Simulation status: ${simStatus.simulationRun?.status || 'Unknown'}`);
          }
        } catch (statusError: any) {
          // If we found error details, re-throw to propagate the actual error
          if (hasErrorDetails || statusError.message?.includes('Choras simulation error')) {
            throw statusError;
          }
          console.warn('Could not check simulation status directly:', statusError.message);
        }

        if (pollAttempts >= maxPollAttempts) {
          // After max retries, give up with detailed error
          const errorContext = isNetworkError
            ? 'The Choras backend appears to have crashed or is not responding. Check the backend logs for errors (e.g., missing files, invalid geometry).'
            : `Last error: ${pollError.message}`;

          throw new Error(`Failed to poll simulation status after ${maxPollAttempts} attempts. ${errorContext}`);
        }

        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Save results to backend/temp directory via our backend API
    // (Do this AFTER the polling loop completes, regardless of how completion was detected)
    try {
      console.log('Saving results to backend/temp...');
      const saveRes = await fetch('http://localhost:8000/choras/save-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulationId })
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        console.log('Results saved successfully:', saveData);
        resultData = { saved: true, paths: saveData };
      } else {
        console.warn('Failed to save results:', saveRes.status);
        const errorText = await saveRes.text();
        console.warn('Error details:', errorText);
      }
    } catch (saveError) {
      console.error('Error saving results:', saveError);
    }

    return {
      simulationId,
      simulationRunId,
      modelId,
      percentage: currentPercentage,
      status: 'Completed',
      results: resultData
    };

  } catch (err: any) {
    console.error("Workflow failed:", err);
    // Add more context for common errors
    if (err.message?.includes('Failed to fetch')) {
      throw new Error(`Cannot connect to Choras backend at ${API_BASE}. Please ensure it's running.`);
    }
    throw err;
  }
}

/**
 * Stop a running simulation
 */
export async function stopSimulation(simulationId: number): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/simulations/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulationId })
    });

    if (!res.ok) {
      const errorMsg = await extractErrorMessage(res, 'Failed to cancel simulation');
      throw new Error(`Failed to cancel simulation (${res.status}): ${errorMsg}`);
    }

    console.log(`Simulation ${simulationId} cancelled successfully`);
  } catch (err: any) {
    console.error("Failed to stop simulation:", err);
    throw err;
  }
}