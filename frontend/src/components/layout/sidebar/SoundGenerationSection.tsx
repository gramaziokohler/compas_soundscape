import { SoundGenerationConfig } from "@/types";

interface SoundGenerationSectionProps {
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  isSoundGenerating: boolean;
  soundGenError: string | null;
  onAddConfig: () => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onSetActiveTab: (index: number) => void;
  onGenerate: () => void;
  generatedSounds: any[];
  soundscapeState: 'playing' | 'paused' | 'stopped';
  onPlayAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
}

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onSetActiveTab,
  onGenerate,
  generatedSounds,
  soundscapeState,
  onPlayAll,
  onPauseAll,
  onStopAll
}: SoundGenerationSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">Generate sounds from text descriptions</p>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {soundConfigs.map((_, index) => (
          <button
            key={index}
            onClick={() => onSetActiveTab(index)}
            className={`px-3 py-1 text-xs font-medium rounded-t transition-colors whitespace-nowrap ${
              activeSoundConfigTab === index
                ? 'bg-[#F500B8] text-white'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500'
            }`}
          >
            Sound {index + 1}
          </button>
        ))}
        <button
          onClick={onAddConfig}
          className="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-700 rounded-t hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          title="Add new sound"
        >
          +
        </button>
      </div>

      {soundConfigs[activeSoundConfigTab] && (
        <div className="p-3 border rounded bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold">Sound {activeSoundConfigTab + 1}</span>
            {soundConfigs.length > 1 && (
              <button
                onClick={() => onRemoveConfig(activeSoundConfigTab)}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Remove
              </button>
            )}
          </div>

          <textarea
            value={soundConfigs[activeSoundConfigTab].prompt}
            onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'prompt', e.target.value)}
            placeholder="e.g., Hammer hitting wooden table"
            className="w-full h-16 p-2 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 mb-2"
            rows={2}
          />

          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="text-xs block mb-1">Duration: {soundConfigs[activeSoundConfigTab].duration}s</label>
              <input
                type="range"
                value={soundConfigs[activeSoundConfigTab].duration}
                onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'duration', parseInt(e.target.value))}
                className="w-full"
                min="1"
                max="30"
              />
            </div>
            <div>
              <label className="text-xs block mb-1">Guidance: {(soundConfigs[activeSoundConfigTab].guidance_scale / 10).toFixed(1)}</label>
              <input
                type="range"
                value={soundConfigs[activeSoundConfigTab].guidance_scale}
                onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'guidance_scale', parseFloat(e.target.value))}
                className="w-full"
                min="0"
                max="10"
                step="0.5"
              />
            </div>
          </div>

          <div className="mb-2">
            <label className="text-xs block mb-1">Seed Copies: {soundConfigs[activeSoundConfigTab].seed_copies}</label>
            <input
              type="range"
              value={soundConfigs[activeSoundConfigTab].seed_copies}
              onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'seed_copies', parseInt(e.target.value))}
              className="w-full"
              min="1"
              max="5"
            />
          </div>

          <div>
            <label className="text-xs block mb-1">Negative Prompt (optional)</label>
            <input
              type="text"
              value={soundConfigs[activeSoundConfigTab].negative_prompt}
              onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'negative_prompt', e.target.value)}
              placeholder="e.g., noisy, distorted"
              className="w-full p-1 text-xs border rounded bg-white dark:bg-gray-800"
            />
          </div>
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={isSoundGenerating}
        className="w-full py-2 px-4 bg-[#F500B8] hover:bg-[#d600a0] disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold rounded transition-colors"
      >
        {isSoundGenerating ? 'Generating Sounds...' : 'Generate Sounds'}
      </button>

      {soundGenError && (
        <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          {soundGenError}
        </div>
      )}

      {generatedSounds.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="text-sm font-semibold">Playback Controls</div>
          <div className="flex gap-2">
            <button
              onClick={onPlayAll}
              disabled={soundscapeState === 'playing'}
              className="flex-1 py-1.5 px-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded transition-colors"
            >
              Play All
            </button>
            <button
              onClick={onPauseAll}
              disabled={soundscapeState !== 'playing'}
              className="flex-1 py-1.5 px-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded transition-colors"
            >
              Pause All
            </button>
            <button
              onClick={onStopAll}
              disabled={soundscapeState === 'stopped'}
              className="flex-1 py-1.5 px-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded transition-colors"
            >
              Stop All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
