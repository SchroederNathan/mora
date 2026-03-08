import { MACRO_COLORS, SegmentedMacroBar } from '@/components/SegmentedMacroBar'
import { GradientBorderCard } from '@/components/ui/GradientBorderCard'
import { Text } from '@/components/ui/Text'
import { scaleMacros, sumMacros, type FoodLogEntry } from '@/types/nutrition'

import { useRouter } from 'expo-router'
import { Beef, Droplet, Wheat } from 'lucide-react-native'
import { memo, useCallback, useMemo } from 'react'
import { Pressable, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import Animated, {
  FadeInUp,
  LinearTransition,
} from 'react-native-reanimated'

const cardLayoutTransition = LinearTransition.springify()

// ============================================
// Meal Grouping
// ============================================

export type MealGroup = {
  key: string
  mealGroupId?: string
  mealTitle?: string
  entries: FoodLogEntry[]
}

/** Group entries by mealGroupId. Entries without one become solo groups. */
export function groupEntriesIntoMeals(entries: FoodLogEntry[]): MealGroup[] {
  const groups = new Map<string, FoodLogEntry[]>()
  const solos: FoodLogEntry[] = []

  for (const entry of entries) {
    if (entry.mealGroupId) {
      const existing = groups.get(entry.mealGroupId)
      if (existing) {
        existing.push(entry)
      } else {
        groups.set(entry.mealGroupId, [entry])
      }
    } else {
      solos.push(entry)
    }
  }

  const result: MealGroup[] = []

  for (const [mealGroupId, groupEntries] of groups) {
    result.push({
      key: mealGroupId,
      mealGroupId,
      mealTitle: groupEntries[0].mealTitle,
      entries: groupEntries,
    })
  }

  for (const entry of solos) {
    result.push({
      key: entry.id,
      entries: [entry],
    })
  }

  // Sort by consumedAt descending (newest first)
  result.sort((a, b) => b.entries[0].consumedAt - a.entries[0].consumedAt)

  return result
}

// ============================================
// MealCard
// ============================================

type MealCardProps = {
  group: MealGroup
  index: number
}

const MealCard = memo(function MealCard({ group, index }: MealCardProps) {
  const router = useRouter()
  const isMeal = group.entries.length > 1

  const totals = useMemo(
    () => sumMacros(group.entries),
    [group.entries]
  )

  const soloScaled = useMemo(
    () => !isMeal ? scaleMacros(group.entries[0].snapshot.nutrients, group.entries[0].quantity) : null,
    [isMeal, group.entries]
  )

  const displayMacros = isMeal ? totals : soloScaled!

  const handlePress = useCallback(() => {
    Haptics.selection()
    if (isMeal && group.mealGroupId) {
      router.push({ pathname: '/(app)/food-detail', params: { mode: 'meal', mealGroupId: group.mealGroupId } })
    } else {
      router.push({ pathname: '/(app)/food-detail', params: { mode: 'logged', entryId: group.entries[0].id } })
    }
  }, [router, isMeal, group.mealGroupId, group.entries])

  const title = isMeal ? (group.mealTitle ?? 'Meal') : group.entries[0].snapshot.name
  const meal = group.entries[0].meal

  return (
    <Animated.View
      entering={FadeInUp.duration(300).delay(index * 50)}
      layout={cardLayoutTransition}
    >
      <Pressable onPress={handlePress}>
        <GradientBorderCard borderRadius={16} padding={14}>
          {/* Top row: name + meal/item count */}
          <View className="flex-row items-center justify-between mb-2">
            <Text
              className="text-foreground text-base font-medium flex-1 mr-2 font-serif"
              numberOfLines={1}
            >
              {title}
            </Text>
            <View className="flex-row items-center gap-2">
              {isMeal ? (
                <View className="bg-black/[0.06] dark:bg-white/10 rounded-full px-2 py-0.5">
                  <Text className="text-muted text-xs">{group.entries.length} items</Text>
                </View>
              ) : null}
              {meal ? (
                <Text className="text-muted text-xs">
                  {meal.charAt(0).toUpperCase() + meal.slice(1)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Calories */}
          <View className="flex-row items-end gap-1 mb-3">
            <Text className="text-foreground text-2xl font-bold font-serif">
              {displayMacros.calories}
            </Text>
            <Text className="text-muted text-sm mb-0.5">
              kcal
            </Text>
          </View>

          {/* Macro bar */}
          <View style={{ marginBottom: 12 }}>
            <SegmentedMacroBar protein={displayMacros.protein} carbs={displayMacros.carbs} fat={displayMacros.fat} height={16} gap={2} />
          </View>

          {/* Bottom row: macro chips */}
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center gap-1">
              <Beef size={12} color={MACRO_COLORS.protein} />
              <Text className="text-muted text-xs">{displayMacros.protein}g</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Wheat size={12} color={MACRO_COLORS.carbs} />
              <Text className="text-muted text-xs">{displayMacros.carbs}g</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Droplet size={12} color={MACRO_COLORS.fat} />
              <Text className="text-muted text-xs">{displayMacros.fat}g</Text>
            </View>
          </View>
        </GradientBorderCard>
      </Pressable>
    </Animated.View>
  )
})

// ============================================
// FoodHistory
// ============================================

type FoodHistoryProps = {
  entries: FoodLogEntry[]
}

export function FoodHistory({ entries }: FoodHistoryProps) {
  const mealGroups = useMemo(() => groupEntriesIntoMeals(entries), [entries])

  if (entries.length === 0) {
    return (
      <View className="items-center py-8">
        <Text className="text-muted text-sm">No food logged yet</Text>
      </View>
    )
  }

  return (
    <View>
      <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-3">
        Food Log
      </Text>
      <View style={{ gap: 10 }}>
        {mealGroups.map((group, index) => (
          <MealCard
            key={group.key}
            group={group}
            index={index}
          />
        ))}
      </View>
    </View>
  )
}
