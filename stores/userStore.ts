import { create } from 'zustand';
import { getUserGoals, saveUserGoals } from '@/lib/storage';
import { type UserGoals, DEFAULT_USER_GOALS } from '@/types/nutrition';

// ============================================
// BMR / TDEE Calculation Utilities
// ============================================

export type BMRResult = {
  bmr: number;
  tdee: number;
  targetCalories: number;
  protein: number;
  fat: number;
  carbs: number;
};

const ACTIVITY_MULTIPLIERS: Record<NonNullable<UserGoals['activityLevel']>, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENTS: Record<NonNullable<UserGoals['goal']>, number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
};

/**
 * Calculate BMR → TDEE → macro targets using Mifflin-St Jeor.
 * Returns null if required fields are missing.
 */
export function calculateBMR(goals: UserGoals): BMRResult | null {
  const { age, weightKg, heightCm, sex, activityLevel, goal } = goals;

  if (!age || !weightKg || !heightCm || !sex || !activityLevel || !goal) {
    return null;
  }

  // Mifflin-St Jeor BMR
  const bmr =
    sex === 'male'
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;

  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel];
  const adjustment = GOAL_ADJUSTMENTS[goal];

  const tdee = bmr * multiplier;
  const targetCalories = Math.round(tdee + adjustment);

  // Macros
  const protein = Math.max(Math.round(2 * weightKg), 100);
  const fat = Math.round((targetCalories * 0.25) / 9);
  const proteinCalories = protein * 4;
  const fatCalories = fat * 9;
  const carbCalories = targetCalories - proteinCalories - fatCalories;
  const carbs = Math.max(Math.round(carbCalories / 4), 0);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetCalories,
    protein,
    fat,
    carbs,
  };
}

// ============================================
// Types
// ============================================

interface UserState {
  /** User's nutrition goals */
  goals: UserGoals;
  /** Loading state */
  isLoading: boolean;
}

interface UserActions {
  /** Load goals from storage */
  load: () => void;
  /** Update user goals */
  setGoals: (goals: Partial<UserGoals>) => void;
  /** Reset to default goals */
  resetGoals: () => void;
}

type UserStore = UserState & UserActions;

// ============================================
// Store
// ============================================

export const useUserStore = create<UserStore>((set, get) => ({
  // Initial state with defaults
  goals: { ...DEFAULT_USER_GOALS },
  isLoading: false,

  // Actions
  load: () => {
    set({ isLoading: true });

    const savedGoals = getUserGoals();
    const goals = savedGoals ?? { ...DEFAULT_USER_GOALS };

    set({ goals, isLoading: false });
  },

  setGoals: (partialGoals) => {
    const { goals } = get();
    const newGoals: UserGoals = {
      ...goals,
      ...partialGoals,
    };

    // Persist to MMKV
    saveUserGoals(newGoals);
    set({ goals: newGoals });
  },

  resetGoals: () => {
    const newGoals = { ...DEFAULT_USER_GOALS };
    saveUserGoals(newGoals);
    set({ goals: newGoals });
  },
}));
