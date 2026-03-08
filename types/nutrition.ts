import { z } from 'zod';

// ============================================
// Core Types
// ============================================

/** Macro nutrient totals */
export type MacroTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
};

/** Serving size info */
export type ServingInfo = {
  amount: number;
  unit: string;
  gramWeight: number;
};

/** Food log entry snapshot */
export type FoodSnapshot = {
  name: string;
  serving: ServingInfo;
  nutrients: MacroTotals;
  fdcId?: number;
  rawUsda?: unknown;
  estimated?: boolean;  // true if LLM estimate, false/undefined if from USDA
};

/** Individual food log entry */
export type FoodLogEntry = {
  id: string;
  consumedAt: number;
  quantity: number;
  snapshot: FoodSnapshot;
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
};

/** Pending food entry awaiting user confirmation in chat */
export type FoodConfirmationEntry = {
  name: string;
  quantity: number;
  serving: { amount: number; unit: string; gramWeight: number };
  nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber?: number };
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  fdcId?: number;
  estimated?: boolean;
};

/** Daily log stored at log:{yyyy-mm-dd} */
export type DailyLog = {
  date: string;
  entries: FoodLogEntry[];
  totals: MacroTotals;
};

/** User nutrition goals */
export type UserGoals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  // Body metrics (optional — used for BMR calc)
  age?: number;
  weightKg?: number;
  heightCm?: number;
  sex?: 'male' | 'female';
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal?: 'lose' | 'maintain' | 'gain';
};

// ============================================
// USDA API Response Types
// ============================================

/** USDA food nutrient */
export type USDANutrient = {
  nutrientId: number;
  nutrientName: string;
  unitName: string;
  value: number;
};

/** USDA food portion */
export type USDAFoodPortion = {
  id: number;
  amount: number;
  gramWeight: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: {
    id: number;
    name: string;
    abbreviation: string;
  };
};

/** USDA search result item */
export type USDASearchItem = {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: Array<{
    nutrientId: number;
    nutrientName: string;
    unitName: string;
    value: number;
  }>;
};

/** USDA search response */
export type USDASearchResponse = {
  totalHits: number;
  currentPage: number;
  totalPages: number;
  foods: USDASearchItem[];
};

/** USDA full food details */
export type USDAFoodFull = {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients: USDANutrient[];
  foodPortions?: USDAFoodPortion[];
};

// ============================================
// Zod Schemas for AI Tool Validation
// ============================================

/** Schema for get_usda_food_full tool params */
export const GetUSDAFoodFullSchema = z.object({
  fdcId: z.number().describe('FDC ID from search results'),
});

/** Schema for log_food_entry tool params */
export const LogFoodEntrySchema = z.object({
  name: z.string().describe('Food name to display'),
  quantity: z.number().describe('Number of servings consumed'),
  serving: z.object({
    amount: z.number().describe('Serving size amount'),
    unit: z.string().describe('Serving size unit (e.g., "g", "cup", "piece")'),
    gramWeight: z.number().describe('Weight in grams for this serving'),
  }).describe('Serving size information'),
  nutrients: z.object({
    calories: z.number().describe('Calories per serving'),
    protein: z.number().describe('Protein in grams per serving'),
    carbs: z.number().describe('Carbohydrates in grams per serving'),
    fat: z.number().describe('Fat in grams per serving'),
    fiber: z.number().optional().describe('Fiber in grams per serving'),
    sugar: z.number().optional().describe('Sugar in grams per serving'),
  }).describe('Nutritional values per serving'),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional().describe('Meal category'),
  fdcId: z.number().optional().describe('USDA FDC ID if available'),
});

/** Schema for get_daily_summary tool params */
export const GetDailySummarySchema = z.object({
  date: z.string().optional().describe('Date in yyyy-mm-dd format. Defaults to today.'),
});

/** Schema for get_user_goals tool params (no params needed) */
export const GetUserGoalsSchema = z.object({});

// ============================================
// Helper Constants
// ============================================

/** USDA nutrient IDs for extracting macros */
export const USDA_NUTRIENT_IDS = {
  ENERGY: 1008,      // Energy (kcal)
  PROTEIN: 1003,     // Protein (g)
  FAT: 1004,         // Total lipid/fat (g)
  CARBS: 1005,       // Carbohydrate, by difference (g)
  FIBER: 1079,       // Fiber, total dietary (g)
  SUGAR: 2000,       // Sugars, total including NLEA (g)
  SUGAR_ALT: 1063,   // Sugars, total (g) - alternative ID
} as const;

/** Default user goals */
export const DEFAULT_USER_GOALS: UserGoals = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
};

/** Empty macro totals */
export const EMPTY_MACRO_TOTALS: MacroTotals = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
};

// ============================================
// Utility Functions
// ============================================

/** Generate a unique ID for entries */
export function generateEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Format date as yyyy-mm-dd in local timezone */
export function formatDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Extract macros from USDA nutrients array */
export function extractMacrosFromUSDA(nutrients: USDANutrient[]): MacroTotals {
  const findNutrient = (id: number) =>
    nutrients.find(n => n.nutrientId === id)?.value ?? 0;

  return {
    calories: Math.round(findNutrient(USDA_NUTRIENT_IDS.ENERGY)),
    protein: Math.round(findNutrient(USDA_NUTRIENT_IDS.PROTEIN) * 10) / 10,
    carbs: Math.round(findNutrient(USDA_NUTRIENT_IDS.CARBS) * 10) / 10,
    fat: Math.round(findNutrient(USDA_NUTRIENT_IDS.FAT) * 10) / 10,
    fiber: Math.round(findNutrient(USDA_NUTRIENT_IDS.FIBER) * 10) / 10,
    sugar: Math.round((findNutrient(USDA_NUTRIENT_IDS.SUGAR) || findNutrient(USDA_NUTRIENT_IDS.SUGAR_ALT)) * 10) / 10,
  };
}

/** Scale macros by quantity */
export function scaleMacros(macros: MacroTotals, quantity: number): MacroTotals {
  return {
    calories: Math.round(macros.calories * quantity),
    protein: Math.round(macros.protein * quantity * 10) / 10,
    carbs: Math.round(macros.carbs * quantity * 10) / 10,
    fat: Math.round(macros.fat * quantity * 10) / 10,
    fiber: macros.fiber ? Math.round(macros.fiber * quantity * 10) / 10 : undefined,
    sugar: macros.sugar ? Math.round(macros.sugar * quantity * 10) / 10 : undefined,
  };
}

/** Sum multiple macro totals */
export function sumMacros(entries: Array<{ quantity: number; snapshot: { nutrients: MacroTotals } }>): MacroTotals {
  return entries.reduce((acc, entry) => {
    const scaled = scaleMacros(entry.snapshot.nutrients, entry.quantity);
    return {
      calories: acc.calories + scaled.calories,
      protein: Math.round((acc.protein + scaled.protein) * 10) / 10,
      carbs: Math.round((acc.carbs + scaled.carbs) * 10) / 10,
      fat: Math.round((acc.fat + scaled.fat) * 10) / 10,
      fiber: Math.round(((acc.fiber ?? 0) + (scaled.fiber ?? 0)) * 10) / 10,
      sugar: Math.round(((acc.sugar ?? 0) + (scaled.sugar ?? 0)) * 10) / 10,
    };
  }, { ...EMPTY_MACRO_TOTALS });
}
