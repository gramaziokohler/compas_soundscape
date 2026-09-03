"use client";

import { useCallback, useEffect } from "react";
import type { SoundGenerationConfig, CatalogSoundSelection } from "@/types";
import type { CatalogBrowseState, CatalogBrowseActions } from "@/hooks/useCatalogBrowse";
import { useCatalogBrowse } from "@/hooks/useCatalogBrowse";
import { SearchBar } from "@/components/ui/SearchBar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from '@/components/ui/Spinner';

export interface CatalogModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onCatalogSoundSelect?: (index: number, sound: CatalogSoundSelection) => void;
  /** When provided, CatalogMode uses this shared state instead of its own useCatalogBrowse hook. */
  catalogState?: CatalogBrowseState & CatalogBrowseActions;
}

export function CatalogMode({ config, index, onUpdateConfig, onCatalogSoundSelect, catalogState }: CatalogModeProps) {
  const ownBrowse = useCatalogBrowse();
  const browse = catalogState ?? ownBrowse;

  const {
    categories,
    selectedCategory,
    sounds,
    isLoading,
    error,
    selectCategory,
    goBack,
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearchingAll,
    searchError,
  } = browse;

  const selectedSound = config.selectedCatalogSound;
  const isSearchActive = searchQuery.trim().length > 0;

  useEffect(() => {
    if (config.catalogSelectedCategory && !selectedCategory) {
      selectCategory(config.catalogSelectedCategory);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.catalogSelectedCategory?.id]);

  const handleSelectCategory = useCallback(
    (cat: { id: string; name: string }) => {
      selectCategory(cat);
      onUpdateConfig(index, "catalogSelectedCategory", cat);
    },
    [index, selectCategory, onUpdateConfig],
  );

  const handleGoBack = useCallback(() => {
    goBack();
    onUpdateConfig(index, "catalogSelectedCategory", undefined);
  }, [index, goBack, onUpdateConfig]);

  const handleSoundClick = useCallback(
    (sound: { name: string; url: string; category?: string }) => {
      const categoryName = sound.category || selectedCategory?.name || "";
      const selection: CatalogSoundSelection = {
        name: sound.name,
        url: sound.url,
        category: categoryName,
      };
      onCatalogSoundSelect?.(index, selection);
    },
    [index, selectedCategory, onCatalogSoundSelect],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
    },
    [setSearchQuery],
  );

  return (
    <div className="space-y-2">
      {/* SearchBar: only rendered when not provided by parent via catalogState */}
      {!catalogState && (
        <SearchBar
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search sounds..."
          isLoading={isSearchingAll}
        />
      )}

      {/* Search results */}
      {isSearchActive && (
        <>
          {isSearchingAll && (
            <div className="flex items-center justify-center py-4">
              <Spinner size={16} className="align-middle" />
              <span className="ml-2 text-xs text-secondary-hover">Searching all categories...</span>
            </div>
          )}
          {searchError && (
            <Notice type="error" message={searchError} />
          )}
          {!isSearchingAll && searchResults !== null && searchResults.length > 0 && (
            <div className="rounded-lg max-h-[min(200px,40dvh)] overflow-y-auto">
              <p className="text-xs font-medium text-secondary-hover px-1 mb-1">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-0.5">
                {searchResults.map(({ item }) => {
                  const isSelected = selectedSound?.url === item.url;
                  return (
                    <button
                      key={item.url}
                      onClick={() => handleSoundClick(item)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${isSelected
                        ? "bg-primary text-white"
                        : "bg-secondary-light text-foreground hover:bg-secondary-lighter"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate flex-1">{item.name}</span>
                        {item.category && (
                          <Badge variant="neutral">{item.category}</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!isSearchingAll && searchResults !== null && searchResults.length === 0 && (
            <EmptyState message={`No sounds match "${searchQuery}".`} />
          )}
        </>
      )}

      {/* Normal category browse */}
      {!isSearchActive && (
        <>
          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-1 text-[10px] text-secondary-hover">
            <button
              onClick={handleGoBack}
              disabled={!selectedCategory}
              className={`transition-colors ${selectedCategory
                ? "text-secondary-hover hover:underline cursor-pointer"
                : "font-medium text-foreground cursor-default"
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
              <Spinner size={16} />
              <span className="ml-2 text-xs text-secondary-hover">Loading...</span>
            </div>
          )}

          {error && (
            <Notice type="error" message={error} />
          )}

          {/* Category list */}
          {!selectedCategory && !isLoading && categories.length > 0 && (
            <div className="rounded-lg max-h-[min(200px,40dvh)] overflow-y-auto">
              <div className="space-y-0.5">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => handleSelectCategory(cat)}
                    className="w-full text-left px-2 py-1 rounded-lg text-xs transition-colors bg-secondary-light text-foreground hover:bg-primary"
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty categories */}
          {!selectedCategory && !isLoading && !error && categories.length === 0 && (
            <EmptyState message="No categories found." />
          )}

          {/* Sounds list */}
          {selectedCategory && !isLoading && sounds.length > 0 && (
            <div className="rounded-lg max-h-[min(200px,40dvh)] overflow-y-auto">
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
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${isSelected
                        ? "bg-primary text-white"
                        : "secondary-light text-foreground hover:bg-secondary-lighter"
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
            <EmptyState message="No sounds found in this category." />
          )}
        </>
      )}
    </div>
  );
}
