import { MacroDetail } from '@/components/MacroDetail'
import { SegmentedMacroBar } from '@/components/SegmentedMacroBar'
import { Text } from '@/components/ui/Text'
import { useFoodDetailCallbacks } from '@/contexts/FoodDetailCallbackContext'
import { useDailyLogStore } from '@/stores'
import type { FoodConfirmationEntry, FoodLogEntry } from '@/types/nutrition'
import { scaleMacros, sumMacros } from '@/types/nutrition'
import { GlassView } from 'expo-glass-effect'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Beef, Droplet, Minus, Plus, Trash2, Wheat } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, useColorScheme, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function PendingEntryRow({
  entry,
  index,
  isDark,
  onQuantityChange,
  onRemove,
}: {
  entry: FoodConfirmationEntry
  index: number
  isDark: boolean
  onQuantityChange: (index: number, quantity: number) => void
  onRemove: (index: number) => void
}) {
  const handleDecrement = useCallback(() => {
    if (entry.quantity <= 1) return
    Haptics.selection()
    onQuantityChange(index, entry.quantity - 1)
  }, [entry.quantity, index, onQuantityChange])

  const handleIncrement = useCallback(() => {
    Haptics.selection()
    onQuantityChange(index, entry.quantity + 1)
  }, [entry.quantity, index, onQuantityChange])

  const handleRemove = useCallback(() => {
    Haptics.notification('warning')
    onRemove(index)
  }, [index, onRemove])

  const scaled = useMemo(() => ({
    calories: Math.round(entry.nutrients.calories * entry.quantity),
    protein: Math.round(entry.nutrients.protein * entry.quantity),
    carbs: Math.round(entry.nutrients.carbs * entry.quantity),
    fat: Math.round(entry.nutrients.fat * entry.quantity),
  }), [entry.nutrients, entry.quantity])

  return (
    <GlassView
      isInteractive
      className="rounded-2xl p-3.5"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-foreground text-base font-medium flex-1 mr-2" numberOfLines={1}>
          {entry.name}
        </Text>
        <Text className="text-muted text-xs">
          {entry.serving.amount * entry.quantity} {entry.serving.unit}
        </Text>
      </View>

      <View className="flex-row items-end gap-1 mb-3">
        <Text className="text-foreground text-xl font-bold">{scaled.calories}</Text>
        <Text className="text-muted text-sm mb-0.5">kcal</Text>
      </View>

      <View className="flex-row items-center gap-3 mb-3">
        <View className="flex-row items-center gap-1">
          <Beef size={12} color="#22C55E" />
          <Text className="text-muted text-xs">{scaled.protein}g</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Wheat size={12} color="#FBBF24" />
          <Text className="text-muted text-xs">{scaled.carbs}g</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Droplet size={12} color="#3B82F6" />
          <Text className="text-muted text-xs">{scaled.fat}g</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between pt-3 border-t border-black/[0.08] dark:border-white/10">
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleDecrement}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="w-8 h-8 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10"
          >
            <Minus size={16} color={isDark ? '#fff' : '#000'} />
          </Pressable>
          <Text className="text-foreground text-lg font-semibold w-8 text-center">
            {entry.quantity}
          </Text>
          <Pressable
            onPress={handleIncrement}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="w-8 h-8 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10"
          >
            <Plus size={16} color={isDark ? '#fff' : '#000'} />
          </Pressable>
        </View>

        <Pressable
          onPress={handleRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="w-8 h-8 items-center justify-center rounded-full bg-red-500/15"
        >
          <Trash2 size={16} color="#EF4444" />
        </Pressable>
      </View>
    </GlassView>
  )
}

function MealEntryRow({ entry }: { entry: FoodLogEntry }) {
  const scaled = useMemo(
    () => scaleMacros(entry.snapshot.nutrients, entry.quantity),
    [entry.snapshot.nutrients, entry.quantity]
  )

  return (
    <GlassView
      isInteractive
      className="rounded-2xl p-3.5"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-foreground text-base font-medium flex-1 mr-2" numberOfLines={1}>
          {entry.snapshot.name}
        </Text>
        <Text className="text-muted text-xs">
          {entry.snapshot.serving.amount * entry.quantity} {entry.snapshot.serving.unit}
        </Text>
      </View>

      <View className="flex-row items-end gap-1 mb-3">
        <Text className="text-foreground text-xl font-bold">{scaled.calories}</Text>
        <Text className="text-muted text-sm mb-0.5">kcal</Text>
      </View>

      <View className="flex-row items-center gap-3">
        <View className="flex-row items-center gap-1">
          <Beef size={12} color="#22C55E" />
          <Text className="text-muted text-xs">{scaled.protein}g</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Wheat size={12} color="#FBBF24" />
          <Text className="text-muted text-xs">{scaled.carbs}g</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Droplet size={12} color="#3B82F6" />
          <Text className="text-muted text-xs">{scaled.fat}g</Text>
        </View>
      </View>
    </GlassView>
  )
}

export default function FoodDetailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ mode: string; entryId?: string; entries?: string; mealGroupId?: string }>()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const insets = useSafeAreaInsets()
  const callbacks = useFoodDetailCallbacks()

  const mode = params.mode as 'logged' | 'pending' | 'meal'

  const updateEntry = useDailyLogStore(s => s.updateEntry)
  const removeEntry = useDailyLogStore(s => s.removeEntry)
  const removeMeal = useDailyLogStore(s => s.removeMeal)

  const pendingEntries: FoodConfirmationEntry[] = useMemo(() => {
    if (mode !== 'pending' || !params.entries) return []
    try {
      return JSON.parse(params.entries)
    } catch {
      return []
    }
  }, [mode, params.entries])

  const storeEntry = useDailyLogStore(s =>
    mode === 'logged' && params.entryId
      ? s.log.entries.find(e => e.id === params.entryId)
      : undefined
  )

  const mealEntries = useDailyLogStore(s =>
    mode === 'meal' && params.mealGroupId
      ? s.log.entries.filter(e => e.mealGroupId === params.mealGroupId)
      : []
  )

  const mealTitle = mealEntries.length > 0 ? mealEntries[0].mealTitle : undefined

  const mealTotals = useMemo(() => {
    if (mode !== 'meal' || mealEntries.length === 0) return null
    return sumMacros(mealEntries)
  }, [mode, mealEntries])

  const [loggedQuantity, setLoggedQuantity] = useState(storeEntry?.quantity ?? 1)

  const scaled = useMemo(() => {
    if (!storeEntry) return null
    return scaleMacros(storeEntry.snapshot.nutrients, loggedQuantity)
  }, [storeEntry, loggedQuantity])

  const pendingTotals = useMemo(() => {
    if (mode !== 'pending') return null
    return pendingEntries.reduce(
      (acc, e) => ({
        calories: acc.calories + Math.round(e.nutrients.calories * e.quantity),
        protein: acc.protein + Math.round(e.nutrients.protein * e.quantity),
        carbs: acc.carbs + Math.round(e.nutrients.carbs * e.quantity),
        fat: acc.fat + Math.round(e.nutrients.fat * e.quantity),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    )
  }, [mode, pendingEntries])

  const handleLoggedDelete = useCallback(() => {
    if (!storeEntry) return
    Haptics.notification('warning')
    removeEntry(storeEntry.id)
    router.back()
  }, [storeEntry, removeEntry, router])

  const handleMealDelete = useCallback(() => {
    if (!params.mealGroupId) return
    Haptics.notification('warning')
    removeMeal(params.mealGroupId)
    router.back()
  }, [params.mealGroupId, removeMeal, router])

  const handleLoggedIncrement = useCallback(() => {
    if (!storeEntry) return
    Haptics.selection()
    const newQ = loggedQuantity + 1
    setLoggedQuantity(newQ)
    updateEntry(storeEntry.id, { quantity: newQ })
  }, [storeEntry, loggedQuantity, updateEntry])

  const handleLoggedDecrement = useCallback(() => {
    if (!storeEntry || loggedQuantity <= 1) return
    Haptics.selection()
    const newQ = loggedQuantity - 1
    setLoggedQuantity(newQ)
    updateEntry(storeEntry.id, { quantity: newQ })
  }, [storeEntry, loggedQuantity, updateEntry])

  const handlePendingQuantityChange = useCallback((index: number, newQuantity: number) => {
    if (newQuantity < 1) {
      callbacks?.onPendingEntryRemove(index)
    } else {
      callbacks?.onPendingEntryUpdate(index, { quantity: newQuantity })
    }
  }, [callbacks])

  const handlePendingRemove = useCallback((index: number) => {
    callbacks?.onPendingEntryRemove(index)
  }, [callbacks])

  useEffect(() => {
    if (mode === 'logged' && params.entryId && !storeEntry) {
      router.back()
    }
    if (mode === 'meal' && params.mealGroupId && mealEntries.length === 0) {
      router.back()
    }
  }, [storeEntry, mode, params.entryId, params.mealGroupId, mealEntries.length, router])

  return (
    <View className="px-5 pt-8" style={{ paddingBottom: insets.bottom + 24 }}>
      {/* LOGGED MODE */}
      {mode === 'logged' && storeEntry && scaled && (
        <View>
          <Text className="text-foreground text-2xl font-semibold mb-2 font-serif">
            {storeEntry.snapshot.name}
          </Text>

          {storeEntry.meal ? (
            <Text className="text-muted text-sm mb-6 font-serif">
              {storeEntry.meal.charAt(0).toUpperCase() + storeEntry.meal.slice(1)}
            </Text>
          ) : null}

          <View className="flex-row items-end gap-2 mb-6">
            <Text className="text-foreground text-5xl font-bold font-serif">
              {scaled.calories}
            </Text>
            <Text className="text-muted text-xl mb-2 font-serif">
              kcal
            </Text>
          </View>

          <View className="mb-4">
            <SegmentedMacroBar protein={scaled.protein} carbs={scaled.carbs} fat={scaled.fat} />
          </View>

          <View className="flex-row justify-between mb-8">
            <View>
              <View className="flex-row items-center gap-1.5 mb-0.5">
                <Beef size={14} color="#22C55E" />
                <Text className="text-muted text-sm">Protein</Text>
              </View>
              <Text className="text-foreground text-3xl font-semibold font-serif">
                {scaled.protein}g
              </Text>
            </View>
            <View>
              <View className="flex-row items-center gap-1.5 mb-0.5">
                <Wheat size={14} color="#FBBF24" />
                <Text className="text-muted text-sm">Carbs</Text>
              </View>
              <Text className="text-foreground text-3xl font-semibold font-serif">
                {scaled.carbs}g
              </Text>
            </View>
            <View>
              <View className="flex-row items-center gap-1.5 mb-0.5">
                <Droplet size={14} color="#3B82F6" />
                <Text className="text-muted text-sm">Fats</Text>
              </View>
              <Text className="text-foreground text-3xl font-semibold font-serif">
                {scaled.fat}g
              </Text>
            </View>
          </View>

          <View className="mb-6 pt-4 border-t border-black/[0.08] dark:border-white/10">
            <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-2">Serving</Text>
            <Text className="text-foreground text-base">
              {storeEntry.snapshot.serving.amount * loggedQuantity} {storeEntry.snapshot.serving.unit}
              {loggedQuantity > 1 ? ` (${loggedQuantity} × ${storeEntry.snapshot.serving.amount} ${storeEntry.snapshot.serving.unit})` : ''}
            </Text>
          </View>

          <View className="flex-row items-center justify-between pt-4 border-t border-black/[0.08] dark:border-white/10">
            <View className="flex-row items-center gap-4">
              <Pressable
                onPress={handleLoggedDecrement}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                className="w-10 h-10 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10"
              >
                <Minus size={18} color={isDark ? '#fff' : '#000'} />
              </Pressable>
              <Text className="text-foreground text-2xl font-bold w-10 text-center">
                {loggedQuantity}
              </Text>
              <Pressable
                onPress={handleLoggedIncrement}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                className="w-10 h-10 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10"
              >
                <Plus size={18} color={isDark ? '#fff' : '#000'} />
              </Pressable>
            </View>

            <Pressable
              onPress={handleLoggedDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="w-10 h-10 items-center justify-center rounded-full bg-red-500/15"
            >
              <Trash2 size={18} color="#EF4444" />
            </Pressable>
          </View>
        </View>
      )}

      {/* MEAL MODE */}
      {mode === 'meal' && mealTotals && mealEntries.length > 0 && (
        <>
          <View className="mb-4">
            <Text className="text-foreground text-2xl font-semibold mb-1 font-serif">
              {mealTitle ?? 'Meal'}
            </Text>
            <Text className="text-muted text-sm mb-6 font-serif">
              {mealEntries.length} {mealEntries.length === 1 ? 'item' : 'items'}
              {mealEntries[0].meal ? ` · ${mealEntries[0].meal.charAt(0).toUpperCase() + mealEntries[0].meal.slice(1)}` : ''}
            </Text>

            <View className="flex-row items-end gap-2 mb-6">
              <Text className="text-foreground text-5xl font-bold font-serif">{mealTotals.calories}</Text>
              <Text className="text-muted text-xl mb-2 font-serif">kcal</Text>
            </View>

            <View className="mb-4">
              <SegmentedMacroBar protein={mealTotals.protein} carbs={mealTotals.carbs} fat={mealTotals.fat} />
            </View>

            <View className="flex-row justify-between">
              <MacroDetail label="Protein" value={mealTotals.protein} color="#22C55E" />
              <MacroDetail label="Carbs" value={mealTotals.carbs} color="#FBBF24" />
              <MacroDetail label="Fats" value={mealTotals.fat} color="#3B82F6" />
            </View>
          </View>

          <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-3 ml-1">
            Items
          </Text>
          <View className="gap-2.5">
            {mealEntries.map((entry) => (
              <MealEntryRow key={entry.id} entry={entry} />
            ))}
          </View>

          <View className="items-center mt-6">
            <Pressable
              onPress={handleMealDelete}
              className="flex-row items-center gap-2 px-5 py-3 rounded-full bg-red-500/15"
            >
              <Trash2 size={16} color="#EF4444" />
              <Text className="text-red-500 text-sm font-medium">Delete Meal</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* PENDING MODE */}
      {mode === 'pending' && pendingTotals && (
        <>
          <View className="mb-4">
            <Text className="text-foreground text-lg font-semibold mb-6">
              {pendingEntries.length} {pendingEntries.length === 1 ? 'item' : 'items'}
            </Text>

            <View className="flex-row items-end gap-2 mb-6">
              <Text className="text-foreground text-5xl font-bold">{pendingTotals.calories}</Text>
              <Text className="text-muted text-xl mb-2">kcal</Text>
            </View>

            <View className="mb-4">
              <SegmentedMacroBar protein={pendingTotals.protein} carbs={pendingTotals.carbs} fat={pendingTotals.fat} />
            </View>

            <View className="flex-row justify-between">
              <MacroDetail label="Protein" value={pendingTotals.protein} color="#22C55E" />
              <MacroDetail label="Carbs" value={pendingTotals.carbs} color="#FBBF24" />
              <MacroDetail label="Fats" value={pendingTotals.fat} color="#3B82F6" />
            </View>
          </View>

          <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-3 ml-1">
            Items
          </Text>
          <View className="gap-2.5">
            {pendingEntries.map((pendingEntry, index) => (
              <PendingEntryRow
                key={`${pendingEntry.name}-${pendingEntry.fdcId ?? index}`}
                entry={pendingEntry}
                index={index}
                isDark={isDark}
                onQuantityChange={handlePendingQuantityChange}
                onRemove={handlePendingRemove}
              />
            ))}
          </View>
        </>
      )}
    </View>
  )
}
