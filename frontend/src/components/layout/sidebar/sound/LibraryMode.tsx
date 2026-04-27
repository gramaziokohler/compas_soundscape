'use client';

import type { SoundGenerationConfig, LibrarySearchResult } from '@/types';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';

/**
 * LibraryMode Component
 *
 * Configuration UI for searching and selecting sounds from the BBC Sound Effects library.
 */

export interface LibraryModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onLibrarySearch?: (index: number) => Promise<void>;
  onLibrarySoundSelect?: (index: number, sound: LibrarySearchResult) => void;
}

export function LibraryMode({
  config,
  index,
  onUpdateConfig,
  onLibrarySearch,
  onLibrarySoundSelect,
}: LibraryModeProps) {
  const isSearching = config.librarySearchState?.isSearching;
  const results = config.librarySearchState?.results;
  const searchError = config.librarySearchState?.error;

  return (
    <div className="space-y-2">
      {/* Search input and button */}
      <div className="flex gap-2">
        <textarea
          value={config.prompt}
          onChange={(e) => onUpdateConfig(index, 'prompt', e.target.value)}
          onFocus={() => pauseStore('soundscape')}
          onBlur={() => setTimeout(() => commitStore('soundscape'), 0)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
              e.preventDefault();
              commitStore('soundscape');
              globalUndo();
              pauseStore('soundscape');
            }
            if ((e.ctrlKey || e.metaKey) && (e.shiftKey ? e.key === 'z' : e.key === 'y')) {
              e.preventDefault();
              commitStore('soundscape');
              globalRedo();
              pauseStore('soundscape');
            }
          }}
          placeholder="e.g., Urban traffic, birds chirping, footsteps"
          className="flex-1 h-12 p-2 text-xs rounded-lg bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          rows={2}
        />
        <button
          onClick={() => onLibrarySearch?.(index)}
          disabled={!config.prompt.trim() || isSearching}
          className="px-2 py-2 text-xs font-medium text-white rounded-lg bg-primary disabled:bg-secondary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Search results */}
      {results && results.length > 0 && (
        <div className="rounded-lg max-h-50 overflow-y-auto bg-background">
          <p className="text-xs font-medium text-secondary-hover">
            Found {results.length} results:
          </p>
          <div className="space-y-1">
            {results.map((result) => (
              <button
                key={result.location}
                onClick={() => onLibrarySoundSelect?.(index, result)}
                className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                  config.selectedLibrarySound?.location === result.location
                    ? 'bg-primary text-white'
                    : 'bg-secondary-lighter text-foreground hover:bg-secondary-light'
                }`}
              >
                <div className="font-medium truncate">{result.description}</div>
                <div className="text-[10px] opacity-75 flex justify-between mt-0.5">
                  <span>{result.category}</span>
                  <span>{result.duration}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No results message */}
      {results && results.length === 0 && !isSearching && (
        <p className="text-xs text-center py-4 text-secondary-hover">
          No sounds found. Try a different search term.
        </p>
      )}

      {/* Search error */}
      {searchError && (
        <p className="text-xs rounded-lg p-2 bg-error-light border border-error text-error">
          {searchError}
        </p>
      )}

      {/* Initial help text
      {!results && !isSearching && (
        <p className="text-xs italic text-secondary-hover">
          Enter search terms and click "Search" to find sounds from the BBC Sound Effects library
        </p>
      )} */}
    </div>
  );
}
