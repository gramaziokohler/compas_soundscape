'use client';

import { useCallback, useEffect } from 'react';
import type { SoundGenerationConfig, CatalogSoundSelection } from '@/types';
import { useCatalogBrowse } from '@/hooks/useCatalogBrowse';

/**
 * CatalogMode Component
 *
 * Configuration UI for browsing and selecting sounds from the
 * Google Assistant Sound Library catalog.
 *
 * Navigation: Categories list -> Sounds list -> Select & import
 */

export interface CatalogModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onCatalogSoundSelect?: (index: number, sound: CatalogSoundSelection) => void;
}

export function CatalogMode({ config, index, onUpdateConfig, onCatalogSoundSelect }: CatalogModeProps) {
  const {
    categories,
    selectedCategory,
    sounds,
    isLoading,
    error,
    selectCategory,
    goBack,
  } = useCatalogBrowse();

  const selectedSound = config.selectedCatalogSound;

  // Restore selected category from the store config (so undo works)
  useEffect(() => {
    if (config.catalogSelectedCategory && !selectedCategory) {
      selectCategory(config.catalogSelectedCategory);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.catalogSelectedCategory?.id]);

  const handleSelectCategory = useCallback(
    (cat: { id: string; name: string }) => {
      selectCategory(cat);
      onUpdateConfig(index, 'catalogSelectedCategory', cat);
    },
    [index, selectCategory, onUpdateConfig],
  );

  const handleGoBack = useCallback(() => {
    goBack();
    onUpdateConfig(index, 'catalogSelectedCategory', undefined);
  }, [index, goBack, onUpdateConfig]);

  const handleSoundClick = useCallback(
    (sound: { name: string; url: string }) => {
      if (!selectedCategory) return;
      const selection: CatalogSoundSelection = {
        name: sound.name,
        url: sound.url,
        category: selectedCategory.name,
      };
      onCatalogSoundSelect?.(index, selection);
    },
    [index, selectedCategory, onCatalogSoundSelect]
  );

  return (
    <div className="space-y-2">
      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-1 text-[10px] text-secondary-hover">
        <button
          onClick={handleGoBack}
          disabled={!selectedCategory}
          className={`transition-colors ${
            selectedCategory
              ? 'text-primary hover:underline cursor-pointer'
              : 'font-medium text-foreground cursor-default'
          }`}
        >
          Categories
        </button>
        {selectedCategory && (
          <>
            <span>/</span>
            <span className="font-medium text-foreground truncate">
              {selectedCategory.name}
            </span>
          </>
        )}
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div
            className="w-4 h-4 border-2 rounded-full animate-spin"
            style={{
              borderColor: 'var(--color-primary-light)',
              borderTopColor: 'var(--color-primary)',
            }}
          />
          <span className="ml-2 text-xs text-secondary-hover">Loading...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs rounded-lg p-2 bg-error-light border border-error text-error">
          {error}
        </p>
      )}

      {/* Category list */}
      {!selectedCategory && !isLoading && categories.length > 0 && (
        <div className="rounded-lg max-h-50 overflow-y-auto bg-white">
          <div className="space-y-0.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleSelectCategory(cat)}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors bg-primary-lighter text-foreground hover:bg-primary-light"
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty categories */}
      {!selectedCategory && !isLoading && !error && categories.length === 0 && (
        <p className="text-xs text-center py-4 text-secondary-hover">
          No categories found.
        </p>
      )}

      {/* Sounds list */}
      {selectedCategory && !isLoading && sounds.length > 0 && (
        <div className="rounded-lg max-h-50 overflow-y-auto bg-white">
          <p className="text-xs font-medium text-secondary-hover px-1 mb-1">
            {sounds.length} sounds
          </p>
          <div className="space-y-0.5">
            {sounds.map((sound) => {
              const isSelected = selectedSound?.url === sound.url;
              return (
                <button
                  key={sound.url}
                  onClick={() => handleSoundClick(sound)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? 'bg-primary text-white'
                      : 'bg-primary-lighter text-foreground hover:bg-primary-light'
                  }`}
                >
                  <span className="truncate block">{sound.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* No sounds */}
      {selectedCategory && !isLoading && !error && sounds.length === 0 && (
        <p className="text-xs text-center py-4 text-secondary-hover">
          No sounds found in this category.
        </p>
      )}

      {/* Selected sound confirmation */}
      {selectedSound && (
        <div
          className="rounded-lg p-2 text-xs border"
          style={{
            backgroundColor: 'var(--color-primary-lighter)',
            borderColor: 'var(--color-primary-light)',
            color: 'var(--color-primary)',
          }}
        >
          <div className="font-medium truncate">{selectedSound.name}</div>
          <div className="opacity-75 text-[10px]">{selectedSound.category}</div>
        </div>
      )}
    </div>
  );
}
