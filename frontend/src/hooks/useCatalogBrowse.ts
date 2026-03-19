import { useState, useCallback, useEffect } from 'react';

/**
 * useCatalogBrowse Hook
 *
 * Manages navigation state for the Google Sound Library catalog browser.
 * Fetches categories and sounds from the Next.js API route that scrapes
 * Google's documentation pages.
 */

// ============================================================================
// Types
// ============================================================================

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogSound {
  name: string;
  url: string;
}

export interface CatalogBrowseState {
  /** Available categories (fetched once) */
  categories: CatalogCategory[];
  /** Currently selected category (null = showing category list) */
  selectedCategory: CatalogCategory | null;
  /** Sounds for the selected category */
  sounds: CatalogSound[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useCatalogBrowse() {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory | null>(null);
  const [sounds, setSounds] = useState<CatalogSound[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch categories on mount
  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/catalog');
        if (!res.ok) throw new Error('Failed to load categories');
        const data = await res.json();
        if (!cancelled) {
          setCategories(data.categories || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load categories');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadCategories();
    return () => { cancelled = true; };
  }, []);

  // Select a category and fetch its sounds
  const selectCategory = useCallback(async (category: CatalogCategory) => {
    setSelectedCategory(category);
    setSounds([]);
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/catalog?category=${encodeURIComponent(category.id)}`);
      if (!res.ok) throw new Error(`Failed to load sounds for "${category.name}"`);
      const data = await res.json();
      setSounds(data.sounds || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sounds');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Navigate back to category list
  const goBack = useCallback(() => {
    setSelectedCategory(null);
    setSounds([]);
    setError(null);
  }, []);

  return {
    categories,
    selectedCategory,
    sounds,
    isLoading,
    error,
    selectCategory,
    goBack,
  };
}
