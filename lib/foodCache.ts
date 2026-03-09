import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Server-side Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const serviceClient =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type CachedNutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  servingDescription?: string;
  servingGramWeight?: number;
  source: 'usda' | 'perplexity' | 'estimate';
  fdcId?: number;
};

// ---------------------------------------------------------------------------
// In-memory hot cache (1 hr TTL)
// ---------------------------------------------------------------------------
const MEM_TTL_MS = 60 * 60 * 1000; // 1 hour

type MemEntry = { data: CachedNutrition; ts: number };
const memCache = new Map<string, MemEntry>();

function memGet(key: string): CachedNutrition | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > MEM_TTL_MS) {
    memCache.delete(key);
    return null;
  }
  return entry.data;
}

function memSet(key: string, data: CachedNutrition) {
  memCache.set(key, { data, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Key normalization
// ---------------------------------------------------------------------------
export function normalizeQueryKey(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')          // "mcdonald's" → "mcdonalds"
    .replace(/[^a-z0-9\s]/g, '')   // strip punctuation
    .replace(/\s+/g, ' ')          // collapse whitespace
    .split(' ')
    .sort()
    .join(' ');
}

// ---------------------------------------------------------------------------
// Lookup: memory → exact → alias → trigram fuzzy
// ---------------------------------------------------------------------------
export async function lookupFoodCache(
  query: string,
): Promise<CachedNutrition | null> {
  const key = normalizeQueryKey(query);

  // 1. In-memory cache
  const mem = memGet(key);
  if (mem) {
    console.log('[CACHE] Memory hit for:', key);
    return mem;
  }

  if (!serviceClient) return null;

  try {
    // 2. Exact match on normalized_key
    const { data: exact } = await serviceClient
      .from('food_nutrition_cache')
      .select('*')
      .eq('normalized_key', key)
      .maybeSingle();

    if (exact) {
      console.log('[CACHE] Exact DB hit for:', key);
      const result = rowToCache(exact);
      memSet(key, result);
      // Fire-and-forget hit count bump
      serviceClient
        .from('food_nutrition_cache')
        .update({ hit_count: (exact.hit_count ?? 0) + 1 })
        .eq('id', exact.id)
        .then();
      return result;
    }

    // 3. Alias lookup
    const { data: alias } = await serviceClient
      .from('food_cache_aliases')
      .select('cache_id')
      .eq('normalized_key', key)
      .maybeSingle();

    if (alias) {
      const { data: aliasRow } = await serviceClient
        .from('food_nutrition_cache')
        .select('*')
        .eq('id', alias.cache_id)
        .maybeSingle();

      if (aliasRow) {
        console.log('[CACHE] Alias hit for:', key, '→', aliasRow.normalized_key);
        const result = rowToCache(aliasRow);
        memSet(key, result);
        serviceClient
          .from('food_nutrition_cache')
          .update({ hit_count: (aliasRow.hit_count ?? 0) + 1 })
          .eq('id', aliasRow.id)
          .then();
        return result;
      }
    }

    // 4. Trigram fuzzy match
    // 4. Fuzzy match — find rows where all key words appear in the normalized_key
    const { data: fuzzyRows } = await serviceClient
      .from('food_nutrition_cache')
      .select('*')
      .filter('normalized_key', 'ilike', `%${key.split(' ')[0]}%`)
      .limit(5);

    if (fuzzyRows && fuzzyRows.length > 0) {
      const keyWords = key.split(' ');
      const best = fuzzyRows.find((row) => {
        const rowWords = (row.normalized_key ?? '').split(' ');
        return keyWords.every((w) =>
          rowWords.some((rw) => rw.includes(w) || w.includes(rw)),
        );
      });

      if (best) {
        console.log('[CACHE] Fuzzy hit for:', key, '→', best.normalized_key);
        const result = rowToCache(best);
        memSet(key, result);
        serviceClient
          .from('food_cache_aliases')
          .upsert({ normalized_key: key, cache_id: best.id })
          .then();
        serviceClient
          .from('food_nutrition_cache')
          .update({ hit_count: (best.hit_count ?? 0) + 1 })
          .eq('id', best.id)
          .then();
        return result;
      }
    }

    console.log('[CACHE] Miss for:', key);
    return null;
  } catch (err) {
    console.error('[CACHE] Lookup error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write: insert cache row (+ alias if key differs from original)
// ---------------------------------------------------------------------------
export async function writeFoodCache(
  query: string,
  nutrition: CachedNutrition,
  rawResponse?: unknown,
): Promise<void> {
  if (!serviceClient) return;

  const key = normalizeQueryKey(query);

  try {
    const { data: inserted, error } = await serviceClient
      .from('food_nutrition_cache')
      .upsert(
        {
          normalized_key: key,
          original_query: query,
          calories: nutrition.calories,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat,
          fiber: nutrition.fiber,
          sugar: nutrition.sugar,
          serving_description: nutrition.servingDescription,
          serving_gram_weight: nutrition.servingGramWeight,
          source: nutrition.source,
          fdc_id: nutrition.fdcId ?? null,
          raw_response: rawResponse ?? null,
          hit_count: 0,
        },
        { onConflict: 'normalized_key' },
      )
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[CACHE] Write error:', error.message);
      return;
    }

    // Also store in memory
    memSet(key, nutrition);

    console.log('[CACHE] Written:', key, '(source:', nutrition.source, ')');
  } catch (err) {
    console.error('[CACHE] Write error:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rowToCache(row: any): CachedNutrition {
  return {
    calories: Number(row.calories),
    protein: Number(row.protein),
    carbs: Number(row.carbs),
    fat: Number(row.fat),
    fiber: Number(row.fiber ?? 0),
    sugar: Number(row.sugar ?? 0),
    servingDescription: row.serving_description ?? undefined,
    servingGramWeight: row.serving_gram_weight
      ? Number(row.serving_gram_weight)
      : undefined,
    source: row.source,
    fdcId: row.fdc_id ?? undefined,
  };
}
