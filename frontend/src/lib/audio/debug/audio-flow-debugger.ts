/**
 * Audio Flow Debugger
 *
 * Comprehensive debugging utility to trace audio playback flow through the system.
 * Monitors:
 * - Orchestrator initialization and state
 * - Mode switching and active modes
 * - Audio scheduler playback routing
 * - Source creation and playback
 * - Audio graph connections
 * - Buffer source lifecycle
 *
 * Usage:
 * 1. Import and initialize: audioFlowDebugger.initialize(orchestrator, scheduler)
 * 2. Enable debugging: audioFlowDebugger.enable()
 * 3. Trigger playback and check logs
 * 4. Get summary: audioFlowDebugger.getSummary()
 */

import type { AudioOrchestrator } from '../AudioOrchestrator';
import type { AudioScheduler } from '../../audio-scheduler';
import type { AudioMode } from '@/types/audio';

interface PlaybackEvent {
  timestamp: number;
  soundId: string;
  event: string;
  details: Record<string, any>;
}

interface ModeChangeEvent {
  timestamp: number;
  fromMode: string;
  toMode: string;
  success: boolean;
  error?: string;
}

interface ConnectionInfo {
  sourceId: string;
  hasBuffer: boolean;
  bufferDuration?: number;
  connections: string[];
  isPlaying: boolean;
}

class AudioFlowDebugger {
  private enabled: boolean = false;
  private orchestrator: AudioOrchestrator | null = null;
  private scheduler: AudioScheduler | null = null;
  
  private playbackEvents: PlaybackEvent[] = [];
  private modeChanges: ModeChangeEvent[] = [];
  private connections: Map<string, ConnectionInfo> = new Map();
  
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize debugger with orchestrator and scheduler references
   */
  initialize(orchestrator: AudioOrchestrator | null, scheduler: AudioScheduler | null): void {
    this.orchestrator = orchestrator;
    this.scheduler = scheduler;
    
    if (this.enabled) {
      console.log('[AudioFlowDebugger] 🔧 Initialized with:', {
        hasOrchestrator: !!orchestrator,
        hasScheduler: !!scheduler
      });
    }
  }

  /**
   * Enable debugging (starts monitoring)
   */
  enable(): void {
    this.enabled = true;
    console.log('%c[AudioFlowDebugger] ✅ Debug mode ENABLED', 'color: #00ff00; font-weight: bold');
    this.logCurrentState();
    this.startMonitoring();
  }

  /**
   * Disable debugging
   */
  disable(): void {
    this.enabled = false;
    this.stopMonitoring();
    console.log('%c[AudioFlowDebugger] ⏸️ Debug mode DISABLED', 'color: #ff9900; font-weight: bold');
  }

  /**
   * Toggle debugging
   */
  toggle(): void {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  /**
   * Log current state of orchestrator
   */
  private logCurrentState(): void {
    if (!this.enabled) return;

    console.group('%c[AudioFlowDebugger] 📊 Current State', 'color: #00bfff; font-weight: bold');
    
    // Orchestrator state
    if (this.orchestrator) {
      const status = this.orchestrator.getStatus();
      console.log('🎛️ Orchestrator:', {
        currentMode: status.currentMode,
        ambisonicOrder: status.ambisonicOrder,
        isReceiverModeActive: status.isReceiverModeActive,
        isIRActive: status.isIRActive,
        warnings: this.orchestrator.getWarnings()
      });

      const irState = this.orchestrator.getIRState();
      console.log('📻 IR State:', {
        isImported: irState.isImported,
        isSelected: irState.isSelected
      });
    } else {
      console.warn('❌ No orchestrator reference');
    }

    // Scheduler state
    if (this.scheduler) {
      const scheduled = this.scheduler.getScheduledSounds();
      console.log('⏰ Scheduler:', {
        scheduledCount: scheduled.size,
        sounds: Array.from(scheduled.keys())
      });
    } else {
      console.warn('❌ No scheduler reference');
    }

    console.groupEnd();
  }

  /**
   * Start periodic monitoring
   */
  private startMonitoring(): void {
    if (this.checkInterval) return;

    // Check every 1 second
    this.checkInterval = setInterval(() => {
      this.checkForIssues();
    }, 1000);
  }

  /**
   * Stop periodic monitoring
   */
  private stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for common issues
   */
  private checkForIssues(): void {
    if (!this.enabled) return;

    const issues: string[] = [];

    // Check orchestrator
    if (!this.orchestrator) {
      issues.push('❌ Orchestrator not initialized');
    } else {
      const warnings = this.orchestrator.getWarnings();
      if (warnings.length > 0) {
        issues.push(`⚠️ Orchestrator warnings: ${warnings.join(', ')}`);
      }
    }

    // Check scheduler
    if (!this.scheduler) {
      issues.push('❌ Scheduler not initialized');
    }

    if (issues.length > 0) {
      console.group('%c[AudioFlowDebugger] ⚠️ Issues Detected', 'color: #ff9900; font-weight: bold');
      issues.forEach(issue => console.warn(issue));
      console.groupEnd();
    }
  }

  /**
   * Log a playback event
   */
  logPlayback(soundId: string, event: string, details: Record<string, any> = {}): void {
    if (!this.enabled) return;

    const playbackEvent: PlaybackEvent = {
      timestamp: performance.now(),
      soundId,
      event,
      details
    };

    this.playbackEvents.push(playbackEvent);

    // Color code by event type
    let color = '#00bfff';
    let emoji = '🔊';
    
    if (event.includes('start') || event.includes('play')) {
      color = '#00ff00';
      emoji = '▶️';
    } else if (event.includes('stop')) {
      color = '#ff0000';
      emoji = '⏹️';
    } else if (event.includes('error') || event.includes('fail')) {
      color = '#ff0000';
      emoji = '❌';
    }

    console.log(
      `%c[AudioFlowDebugger] ${emoji} ${event}`,
      `color: ${color}`,
      soundId,
      details
    );

    // Trace the audio graph if this is a playback event
    if (event.includes('play') && this.orchestrator) {
      this.traceAudioGraph(soundId);
    }
  }

  /**
   * Log a mode change
   */
  logModeChange(fromMode: string, toMode: string, success: boolean, error?: string): void {
    if (!this.enabled) return;

    const modeChange: ModeChangeEvent = {
      timestamp: performance.now(),
      fromMode,
      toMode,
      success,
      error
    };

    this.modeChanges.push(modeChange);

    console.log(
      `%c[AudioFlowDebugger] 🔄 Mode Change: ${fromMode} → ${toMode}`,
      success ? 'color: #00ff00' : 'color: #ff0000',
      { success, error }
    );

    // Log new state after mode change
    this.logCurrentState();
  }

  /**
   * Trace the audio graph for a specific source
   */
  private traceAudioGraph(sourceId: string): void {
    if (!this.orchestrator) return;

    console.group(`%c[AudioFlowDebugger] 🔍 Audio Graph Trace: ${sourceId}`, 'color: #00bfff; font-weight: bold');
    
    try {
      const status = this.orchestrator.getStatus();
      console.log('📍 Current Mode:', status.currentMode);
      console.log('�️ Ambisonic Order:', status.ambisonicOrder);
      console.log('📻 IR Active:', status.isIRActive);
      console.log('� Receiver Mode:', status.isReceiverModeActive);
      
    } catch (error) {
      console.error('❌ Error tracing audio graph:', error);
    }
    
    console.groupEnd();
  }

  /**
   * Get a summary of all events
   */
  getSummary(): void {
    console.group('%c[AudioFlowDebugger] 📋 Debug Summary', 'color: #00bfff; font-weight: bold; font-size: 14px');
    
    console.log(`📊 Total Playback Events: ${this.playbackEvents.length}`);
    console.log(`🔄 Total Mode Changes: ${this.modeChanges.length}`);
    
    if (this.playbackEvents.length > 0) {
      console.group('▶️ Recent Playback Events (last 10)');
      this.playbackEvents.slice(-10).forEach(event => {
        console.log(`[${new Date(event.timestamp).toLocaleTimeString()}] ${event.event} - ${event.soundId}`, event.details);
      });
      console.groupEnd();
    }
    
    if (this.modeChanges.length > 0) {
      console.group('🔄 Mode Change History');
      this.modeChanges.forEach(change => {
        console.log(
          `[${new Date(change.timestamp).toLocaleTimeString()}] ${change.fromMode} → ${change.toMode}`,
          change.success ? '✅' : `❌ ${change.error}`
        );
      });
      console.groupEnd();
    }
    
    this.logCurrentState();
    
    console.groupEnd();
  }

  /**
   * Clear all logged events
   */
  clearHistory(): void {
    this.playbackEvents = [];
    this.modeChanges = [];
    this.connections.clear();
    console.log('[AudioFlowDebugger] 🧹 History cleared');
  }

  /**
   * Test audio flow with a mock sound
   */
  async testAudioFlow(soundId: string = 'test-sound'): Promise<void> {
    console.group('%c[AudioFlowDebugger] 🧪 Testing Audio Flow', 'color: #00ff00; font-weight: bold; font-size: 14px');
    
    console.log('1️⃣ Checking orchestrator...');
    if (!this.orchestrator) {
      console.error('❌ FAIL: Orchestrator not available');
      console.groupEnd();
      return;
    }
    console.log('✅ Orchestrator available');
    
    console.log('2️⃣ Getting orchestrator status...');
    const status = this.orchestrator.getStatus();
    console.log('✅ Orchestrator status retrieved');
    
    console.log('3️⃣ Current mode:', status.currentMode);
    console.log('4️⃣ IR Active:', status.isIRActive);
    
    console.log('5️⃣ Testing playSource call...');
    try {
      // Note: This will fail if source doesn't exist, but that's expected
      this.orchestrator.playSource(soundId, false);
      console.log('✅ playSource call succeeded (or source not found, which is expected)');
    } catch (error) {
      console.log('⚠️ playSource call threw error (expected if source not registered):', error);
    }
    
    console.groupEnd();
  }

  /**
   * Export debug data as JSON (for bug reports)
   */
  exportDebugData(): string {
    const data = {
      timestamp: new Date().toISOString(),
      enabled: this.enabled,
      hasOrchestrator: !!this.orchestrator,
      hasScheduler: !!this.scheduler,
      orchestratorStatus: this.orchestrator?.getStatus() || null,
      playbackEvents: this.playbackEvents,
      modeChanges: this.modeChanges,
      warnings: this.orchestrator?.getWarnings() || []
    };

    return JSON.stringify(data, null, 2);
  }
}

// Singleton instance
export const audioFlowDebugger = new AudioFlowDebugger();

// Make it globally available for console access
if (typeof window !== 'undefined') {
  (window as any).audioFlowDebugger = audioFlowDebugger;
}
