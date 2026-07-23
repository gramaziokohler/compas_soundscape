import { useState, useCallback, useEffect, useMemo } from "react";
import Fuse from "fuse.js";

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogSound {
  name: string;
  url: string;
  category?: string;
}

export interface CatalogBrowseState {
  categories: CatalogCategory[];
  selectedCategory: CatalogCategory | null;
  sounds: CatalogSound[];
  isLoading: boolean;
  error: string | null;
}

export interface CatalogBrowseActions {
  selectCategory: (category: CatalogCategory) => Promise<void>;
  goBack: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: ReturnType<typeof Fuse.prototype.search> | null;
  isSearchingAll: boolean;
  searchError: string | null;
  resetSearch: () => void;
  clearSearchCache: () => void;
}

const FUSE_OPTIONS = {
  keys: [
    { name: "name", weight: 0.6 },
    { name: "category", weight: 0.4 },
  ],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
};

let _searchCache: CatalogSound[] | null = null;
let _searchInFlight = false;

export function useCatalogBrowse() {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory | null>(null);
  const [sounds, setSounds] = useState<CatalogSound[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [allSounds, setAllSounds] = useState<CatalogSound[]>(() => _searchCache ?? []);
  const [isSearchingAll, setIsSearchingAll] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const fuse = useMemo(() => {
    if (allSounds.length === 0) return null;
    return new Fuse(allSounds, FUSE_OPTIONS);
  }, [allSounds]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !fuse) return null;
    return fuse.search(searchQuery.trim());
  }, [fuse, searchQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/catalog");
        if (!res.ok) throw new Error("Failed to load categories");
        const data = await res.json();
        if (!cancelled) {
          setCategories(data.categories || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load categories");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadCategories();
    return () => { cancelled = true; };
  }, []);

  const selectCategory = useCallback(async (category: CatalogCategory) => {
    setSelectedCategory(category);
    setSounds([]);
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/catalog?category=${encodeURIComponent(category.id)}`);
      if (!res.ok) throw new Error(`Failed to load sounds for "${category.name}"`);
      const data = await res.json();
      const raw = (data.sounds || []) as CatalogSound[];
      const seen = new Set<string>();
      const unique = raw.filter((s) => {
        if (!s.url || !s.name || seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });
      setSounds(unique);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sounds");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const goBack = useCallback(() => {
    setSelectedCategory(null);
    setSounds([]);
    setError(null);
  }, []);

  const fetchAllSounds = useCallback(async () => {
    if (_searchInFlight) return;
    if (_searchCache) {
      setAllSounds(_searchCache);
      return;
    }
    _searchInFlight = true;
    setIsSearchingAll(true);
    setSearchError(null);

    let cats = categories.length > 0 ? categories : [];

    if (cats.length === 0) {
      setIsSearchingAll(false);
      _searchInFlight = false;
      return;
    }

    try {
      const urlMap = new Map<string, CatalogSound>();
      const batchSize = 6;
      for (let i = 0; i < cats.length; i += batchSize) {
        const batch = cats.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (cat: CatalogCategory) => {
            const res = await fetch(`/api/catalog?category=${encodeURIComponent(cat.id)}`);
            if (!res.ok) throw new Error("Failed");
            const data = await res.json();
            return (data.sounds || []).map((s: CatalogSound) => ({
              ...s,
              category: cat.name,
            }));
          }),
        );
        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            for (const s of result.value) {
              if (!urlMap.has(s.url)) {
                urlMap.set(s.url, s);
              }
            }
          }
        }
      }
      const unique = Array.from(urlMap.values());
      _searchCache = unique;
      setAllSounds(unique);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Failed to load sounds for search");
    } finally {
      setIsSearchingAll(false);
      _searchInFlight = false;
    }
  }, [categories]);

  useEffect(() => {
    if (searchQuery.trim() && categories.length > 0 && !_searchCache) {
      fetchAllSounds();
    }
  }, [searchQuery, categories, fetchAllSounds]);

  const resetSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  const clearSearchCache = useCallback(() => {
    _searchCache = null;
    _searchInFlight = false;
    setAllSounds([]);
    setSearchError(null);
  }, []);

  return {
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
    resetSearch,
    clearSearchCache,
  };
}
