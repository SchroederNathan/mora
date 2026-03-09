import { createMMKV } from 'react-native-mmkv';
import type { DailyLog, UserGoals } from '@/types/nutrition';
import type { UIMessage } from 'ai';

// ============================================
// MMKV Instance
// ============================================

export const storage = createMMKV({ id: 'mora-data' });

// ============================================
// Storage Keys
// ============================================

export const STORAGE_KEYS = {
  /** Daily log prefix: log:{yyyy-mm-dd} */
  dailyLog: (date: string) => `log:${date}`,
  /** User goals */
  userGoals: 'user:goals',
  /** Chat messages */
  chatMessages: 'chat:messages',
} as const;

// ============================================
// Generic JSON Helpers
// ============================================

/**
 * Get a JSON value from storage
 */
export function getJSON<T>(key: string): T | null {
  const value = storage.getString(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn(`[storage] Failed to parse JSON for key: ${key}`);
    return null;
  }
}

/**
 * Set a JSON value in storage
 */
export function setJSON<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

/**
 * Remove a key from storage
 */
export function removeKey(key: string): void {
  storage.remove(key);
}

/**
 * Get all keys matching a prefix
 */
function getKeysWithPrefix(prefix: string): string[] {
  return storage.getAllKeys().filter(key => key.startsWith(prefix));
}

// ============================================
// Domain-Specific Accessors
// ============================================

/**
 * Get daily log for a specific date
 */
export function getDailyLog(date: string): DailyLog | null {
  return getJSON<DailyLog>(STORAGE_KEYS.dailyLog(date));
}

/**
 * Save daily log for a specific date
 */
export function saveDailyLog(log: DailyLog): void {
  setJSON(STORAGE_KEYS.dailyLog(log.date), log);
}

/**
 * Get user goals
 */
export function getUserGoals(): UserGoals | null {
  return getJSON<UserGoals>(STORAGE_KEYS.userGoals);
}

/**
 * Save user goals
 */
export function saveUserGoals(goals: UserGoals): void {
  setJSON(STORAGE_KEYS.userGoals, goals);
}

/**
 * Get chat messages
 */
export function getChatMessages(): UIMessage[] | null {
  return getJSON<UIMessage[]>(STORAGE_KEYS.chatMessages);
}

/**
 * Save chat messages
 */
export function saveChatMessages(messages: UIMessage[]): void {
  setJSON(STORAGE_KEYS.chatMessages, messages);
}

/**
 * Clear all chat messages
 */
export function clearChatMessages(): void {
  removeKey(STORAGE_KEYS.chatMessages);
}

/**
 * Clear all app data (for reset functionality)
 */
export function clearAllData(): void {
  storage.clearAll();
}
