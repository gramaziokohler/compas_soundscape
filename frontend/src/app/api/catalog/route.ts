/**
 * Google Sound Library Catalog API Route
 *
 * Scrapes the Google Assistant Sound Library pages server-side
 * to provide structured JSON data for the frontend catalog browser.
 *
 * - GET /api/catalog              -> list of categories
 * - GET /api/catalog?category=id  -> sounds for a specific category
 *
 * Source: https://developers.google.com/assistant/tools/sound-library
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  CATALOG_BASE_URL,
  CATALOG_CDN_BASE,
  CATALOG_CACHE_TTL_MS,
} from '@/utils/constants';

// ============================================================================
// In-memory cache (lives as long as the Next.js server process)
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const categoryListCache: { entry: CacheEntry<CategoryInfo[]> | null } = { entry: null };
const soundCache = new Map<string, CacheEntry<SoundInfo[]>>();

// ============================================================================
// Types
// ============================================================================

interface CategoryInfo {
  id: string;
  name: string;
}

interface SoundInfo {
  name: string;
  url: string;
}

// ============================================================================
// Scraping Helpers
// ============================================================================

async function fetchCategories(): Promise<CategoryInfo[]> {
  if (categoryListCache.entry && Date.now() < categoryListCache.entry.expiry) {
    return categoryListCache.entry.data;
  }

  const res = await fetch(CATALOG_BASE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SoundCatalogBot/1.0)' },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch sound library index: ${res.status}`);
  }

  const html = await res.text();

  const linkRegex = /\/assistant\/tools\/sound-library\/([a-z][a-z0-9-]+)/g;
  const slugs = new Set<string>();
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const slug = match[1];
    if (slug.length > 1) {
      slugs.add(slug);
    }
  }

  const categories: CategoryInfo[] = Array.from(slugs).map((slug) => ({
    id: slug,
    name: slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  }));

  categoryListCache.entry = { data: categories, expiry: Date.now() + CATALOG_CACHE_TTL_MS };
  return categories;
}

async function fetchSoundsForCategory(categorySlug: string): Promise<SoundInfo[]> {
  const cached = soundCache.get(categorySlug);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  const url = `${CATALOG_BASE_URL}/${categorySlug}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SoundCatalogBot/1.0)' },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch category "${categorySlug}": ${res.status}`);
  }

  const html = await res.text();

  const escaped = CATALOG_CDN_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const oggRegex = new RegExp(`${escaped}/([a-z0-9_]+)/([a-z0-9_]+)\\.ogg`, 'gi');

  const seen = new Set<string>();
  const sounds: SoundInfo[] = [];

  let oggMatch;
  while ((oggMatch = oggRegex.exec(html)) !== null) {
    const fullUrl = oggMatch[0];
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    const filename = oggMatch[2];
    const name = filename
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    sounds.push({ name, url: fullUrl });
  }

  soundCache.set(categorySlug, { data: sounds, expiry: Date.now() + CATALOG_CACHE_TTL_MS });
  return sounds;
}

// ============================================================================
// Route Handler
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (category) {
      const sounds = await fetchSoundsForCategory(category);
      return NextResponse.json({ category, sounds });
    }

    const categories = await fetchCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('[Catalog API]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch catalog' },
      { status: 500 }
    );
  }
}
