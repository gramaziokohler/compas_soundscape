import { useState, useCallback } from "react";
import type { AuralizationConfig } from "@/types/auralization";
import { parseWAVFile, createAudioBufferFromWAV } from "@/lib/audio/wav-parser";

// Re-export for backwards compatibility
export type { AuralizationConfig };

// Alias for backwards compatibility within this file
const parseWavFile = parseWAVFile;

// Note: Old parseWavFile function removed - now imported from @/lib/audio/wav-parser
// The function below is kept temporarily for reference but not used
/*
function parseWavFile_OLD(arrayBuffer: ArrayBuffer) {
  const view = new DataView(arrayBuffer);
  
  // Check RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }
  
  // Check WAVE format
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') {
    throw new Error('Not a valid WAV file (missing WAVE format)');
  }
  
  let offset = 12;
  let fmt: any = null;
  let dataOffset = 0;
  let dataSize = 0;
  
  // Parse chunks
  while (offset < view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    
    if (chunkId === 'fmt ') {
      // Parse format chunk
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        numberOfChannels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true)
      };
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    
    offset += 8 + chunkSize;
  }
  
  if (!fmt) {
    throw new Error('WAV file missing format chunk');
  }
  
  if (dataOffset === 0) {
    throw new Error('WAV file missing data chunk');
  }
  
  // Only support PCM format (audioFormat = 1)
  if (fmt.audioFormat !== 1) {
    throw new Error(`Unsupported WAV format: ${fmt.audioFormat} (only PCM is supported)`);
  }
  
  console.log('[WAV Parser] Format:', fmt);
  console.log('[WAV Parser] Data offset:', dataOffset, 'size:', dataSize);
  
  // Calculate number of samples
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numberOfChannels * bytesPerSample;
  const numSamples = Math.floor(dataSize / blockAlign);
  
  console.log('[WAV Parser] Samples per channel:', numSamples);
  
  // Extract audio data for each channel
  const audioData: Float32Array[] = [];
  for (let ch = 0; ch < fmt.numberOfChannels; ch++) {
    audioData.push(new Float32Array(numSamples));
  }
  
  // Read interleaved samples
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < fmt.numberOfChannels; ch++) {
      const sampleOffset = dataOffset + (i * blockAlign) + (ch * bytesPerSample);
      let sample = 0;
      
      if (fmt.bitsPerSample === 16) {
        sample = view.getInt16(sampleOffset, true) / 32768.0;
      } else if (fmt.bitsPerSample === 24) {
        const byte1 = view.getUint8(sampleOffset);
        const byte2 = view.getUint8(sampleOffset + 1);
        const byte3 = view.getInt8(sampleOffset + 2);
        sample = ((byte3 << 16) | (byte2 << 8) | byte1) / 8388608.0;
      } else if (fmt.bitsPerSample === 32) {
        sample = view.getInt32(sampleOffset, true) / 2147483648.0;
      } else {
        throw new Error(`Unsupported bit depth: ${fmt.bitsPerSample}`);
      }
      
      audioData[ch][i] = sample;
    }
  }
  
  return {
    sampleRate: fmt.sampleRate,
    numberOfChannels: fmt.numberOfChannels,
    bitsPerSample: fmt.bitsPerSample,
    audioData
  };
}
*/

/**
 * Auralization Hook
 *
 * Manages auralization state and impulse response loading for spatial audio.
 * Following the modular architecture pattern:
 * - Single Responsibility: Only manages auralization state
 * - Separation of Concerns: UI logic separated from audio processing
 * - Reusable: Can be composed in any component
 *
 * Features:
 * - Import custom impulse responses
 * - Custom WAV parser for multi-channel files (up to 16+ channels)
 * - Sample rate conversion
 * - Multi-channel support (extracts first 2 channels)
 * - Normalization option
 * - Auto-enable on IR load
 *
 * @returns Auralization state and control functions
 */
export function useAuralization() {
  const [config, setConfig] = useState<AuralizationConfig>({
    enabled: false,
    impulseResponseUrl: null,
    impulseResponseBuffer: null,
    impulseResponseFilename: null,
    normalize: false
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load and decode impulse response from file
   * Handles multi-channel WAV files and extracts first 2 channels
   */
  const loadImpulseResponse = useCallback(async (file: File, audioContext: AudioContext) => {
    console.log('[useAuralization] loadImpulseResponse called with file:', file.name);
    setIsLoading(true);
    setError(null);

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      console.log('[useAuralization] File loaded, size:', arrayBuffer.byteLength);

      let audioBuffer: AudioBuffer;
      
      // Try browser's native decoder first
      try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        console.log('[useAuralization] Decoded using native browser decoder');
        
        // Check channel count after native decoding
        if (audioBuffer.numberOfChannels > 4) {
          throw new Error(`Audio file has ${audioBuffer.numberOfChannels} channels. Maximum supported is 4 channels.`);
        }
      } catch (decodeError) {
        console.log('[useAuralization] Native decoder failed, trying custom WAV parser...');
        
        // Try custom WAV parser for multi-channel files
        try {
          const wavData = parseWavFile(arrayBuffer);
          console.log('[useAuralization] Successfully parsed WAV file');
          
          // Check channel count limit
          if (wavData.numberOfChannels > 4) {
            throw new Error(`Audio file has ${wavData.numberOfChannels} channels. Maximum supported is 4 channels. Please use a file with 1-4 channels.`);
          }
          
          // Use all available channels (up to 4)
          const channelsToUse = wavData.numberOfChannels;
          
          // Create AudioBuffer with the parsed data
          audioBuffer = audioContext.createBuffer(
            channelsToUse,
            wavData.audioData[0].length,
            wavData.sampleRate
          );
          
          // Copy channel data
          for (let ch = 0; ch < channelsToUse; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            channelData.set(wavData.audioData[ch]);
          }
          
          console.log(`[useAuralization] Loaded ${channelsToUse} channel(s)`);
        } catch (wavError) {
          // Re-throw if it's our channel limit error
          if (wavError instanceof Error && wavError.message.includes('Maximum supported')) {
            throw wavError;
          }
          throw new Error("Failed to decode audio file. Please use a valid WAV, MP3, or OGG format.");
        }
      }

      // Validate audio buffer
      if (audioBuffer.length === 0) {
        throw new Error("Impulse response is empty");
      }

      // Handle sample rate mismatch
      if (audioBuffer.sampleRate !== audioContext.sampleRate) {
        console.warn(
          `[Auralization] Sample rate mismatch: IR=${audioBuffer.sampleRate}Hz, Context=${audioContext.sampleRate}Hz. ` +
          "Audio will be automatically resampled by the browser."
        );
      }

      console.log(`[Auralization] Loaded impulse response:`);
      console.log(`  - Duration: ${audioBuffer.duration.toFixed(2)}s`);
      console.log(`  - Sample Rate: ${audioBuffer.sampleRate}Hz`);
      console.log(`  - Channels: ${audioBuffer.numberOfChannels}`);
      console.log(`  - Length: ${audioBuffer.length} samples`);

      setConfig(prev => ({
        ...prev,
        impulseResponseUrl: URL.createObjectURL(file),
        impulseResponseBuffer: audioBuffer,
        impulseResponseFilename: file.name,
        enabled: true // Auto-enable auralization when IR is loaded
      }));

      console.log('[useAuralization] Auralization auto-enabled after loading IR');
      setIsLoading(false);
      return audioBuffer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error loading impulse response";
      setError(errorMessage);
      setIsLoading(false);
      console.error("[Auralization] Error loading impulse response:", err);
      throw err;
    }
  }, []);

  /**
   * Enable/disable auralization
   */
  const toggleAuralization = useCallback((enabled: boolean) => {
    console.log('[useAuralization] toggleAuralization called:', enabled);
    setConfig(prev => {
      console.log('[useAuralization] Previous config:', prev);
      const newConfig = { ...prev, enabled };
      console.log('[useAuralization] New config:', newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Toggle normalization
   */
  const toggleNormalize = useCallback((normalize: boolean) => {
    console.log('[useAuralization] toggleNormalize called:', normalize);
    setConfig(prev => ({ ...prev, normalize }));
  }, []);

  /**
   * Clear impulse response
   */
  const clearImpulseResponse = useCallback(() => {
    if (config.impulseResponseUrl) {
      URL.revokeObjectURL(config.impulseResponseUrl);
    }
    setConfig(prev => ({
      ...prev,
      impulseResponseUrl: null,
      impulseResponseBuffer: null,
      impulseResponseFilename: null
    }));
  }, [config.impulseResponseUrl]);

  /**
   * Set impulse response buffer directly (for default HRTF loading)
   */
  const setImpulseResponseBuffer = useCallback((buffer: AudioBuffer, name: string = "default") => {
    console.log('[useAuralization] setImpulseResponseBuffer called:', {
      name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels
    });
    setConfig(prev => ({
      ...prev,
      impulseResponseUrl: name,
      impulseResponseBuffer: buffer,
      impulseResponseFilename: name
    }));
  }, []);

  /**
   * Reset to default state
   */
  const reset = useCallback(() => {
    if (config.impulseResponseUrl) {
      URL.revokeObjectURL(config.impulseResponseUrl);
    }
    setConfig({
      enabled: false,
      impulseResponseUrl: null,
      impulseResponseBuffer: null,
      impulseResponseFilename: null,
      normalize: false
    });
    setError(null);
  }, [config.impulseResponseUrl]);

  return {
    config,
    isLoading,
    error,
    loadImpulseResponse,
    setImpulseResponseBuffer,
    toggleAuralization,
    toggleNormalize,
    clearImpulseResponse,
    reset
  };
}