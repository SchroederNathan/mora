import { MacroDetail } from '@/components/MacroDetail'
import { MACRO_COLORS, SegmentedMacroBar } from '@/components/SegmentedMacroBar'
import { AnimatedValue } from '@/components/ui/AnimatedValue'
import { GradientBorderCard } from '@/components/ui/GradientBorderCard'
import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { ChevronDown, Minus, Plus, X } from 'lucide-react-native'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, useColorScheme, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import Animated, {
  FadeInUp,
  FadeOutDown,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { ShimmerText } from './ShimmerText'
import type { FoodConfirmationEntry } from '@/types/nutrition'

// Re-export from canonical location
export type { FoodConfirmationEntry } from '@/types/nutrition'

const entryLayoutTransition = LinearTransition.springify()

type FoodConfirmationCardProps = {
  entries: FoodConfirmationEntry[]
  mealTitle?: string | null
  isTitleLoading?: boolean
  onConfirm: () => void
  onRemove: (index: number) => void
  onQuantityChange?: (index: number, newQuantity: number) => void
}

function getDefaultMeal(): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date().getHours()
  if (hour < 10) return 'breakfast'
  if (hour < 14) return 'lunch'
  if (hour < 20) return 'dinner'
  return 'snack'
}

function formatMealName(meal: string): string {
  return meal.charAt(0).toUpperCase() + meal.slice(1)
}

function formatServing(quantity: number, serving: { amount: number; unit: string }): string {
  const total = quantity * serving.amount
  if (total === 1 && serving.unit.toLowerCase() === 'serving') return '1 serving'
  if (total === 1) return `${total} ${serving.unit}`
  return `${total} × ${serving.unit}`
}

// Edit mode entry row
type EditEntryRowProps = {
  entry: FoodConfirmationEntry
  index: number
  themeColor: string
  onRemove: (index: number) => void
  onQuantityChange: (index: number, newQuantity: number) => void
}

const EditEntryRow = memo(function EditEntryRow({
  entry,
  index,
  themeColor,
  onRemove,
  onQuantityChange,
}: EditEntryRowProps) {
  const handleRemove = useCallback(() => {
    Haptics.selection()
    onRemove(index)
  }, [index, onRemove])

  const handleDecrement = useCallback(() => {
    Haptics.selection()
    onQuantityChange(index, entry.quantity - 1)
  }, [index, entry.quantity, onQuantityChange])

  const handleIncrement = useCallback(() => {
    Haptics.selection()
    onQuantityChange(index, entry.quantity + 1)
  }, [index, entry.quantity, onQuantityChange])

  return (
    <Animated.View
      entering={FadeInUp.duration(250)}
      exiting={FadeOutDown.duration(150)}
      layout={entryLayoutTransition}
      className="flex-row items-center py-2"
      style={{ borderTopWidth: index > 0 ? 1 : 0, borderTopColor: themeColor + '30' }}
    >
      <View className="flex-1 mr-2">
        <Text className="text-foreground text-base font-medium" numberOfLines={1}>
          {entry.name}
        </Text>
        <Text className="text-muted text-base">
          {formatServing(entry.quantity, entry.serving)}
        </Text>
      </View>

      {/* Quantity controls */}
      <View className="flex-row items-center gap-2 mr-3">
        <Pressable
          onPress={handleDecrement}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="w-7 h-7 items-center justify-center rounded-full bg-muted/20"
        >
          <Minus size={14} color={themeColor} />
        </Pressable>
        <Text className="text-foreground text-base font-semibold w-6 text-center">
          {entry.quantity}
        </Text>
        <Pressable
          onPress={handleIncrement}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="w-7 h-7 items-center justify-center rounded-full bg-muted/20"
        >
          <Plus size={14} color={themeColor} />
        </Pressable>
      </View>

      {/* Remove button */}
      <Pressable
        onPress={handleRemove}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="w-7 h-7 items-center justify-center rounded-full bg-red-500/20"
      >
        <X size={14} color="#EF4444" />
      </Pressable>
    </Animated.View>
  )
})

export function FoodConfirmationCard({
  entries,
  mealTitle,
  isTitleLoading,
  onConfirm,
  onRemove,
  onQuantityChange,
}: FoodConfirmationCardProps) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const theme = isDark ? colors.dark : colors.light
  const [isExpanded, setIsExpanded] = useState(false)
  const chevronRotation = useSharedValue(0)
  const expandProgress = useSharedValue(0)

  const expandStyle = useAnimatedStyle(() => ({
    maxHeight: interpolate(expandProgress.value, [0, 1], [0, 500]),
    opacity: interpolate(expandProgress.value, [0, 0.3, 1], [0, 0, 1]),
    overflow: 'hidden' as const,
  }))

  const isEmpty = entries.length === 0
  const meal = entries[0]?.meal || getDefaultMeal()

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(chevronRotation.value, [0, 1], [0, 180])}deg` }],
  }))

  const handleToggleExpand = useCallback(() => {
    if (isEmpty) return
    Haptics.selection()
    setIsExpanded((prev) => {
      const next = !prev
      chevronRotation.value = withSpring(next ? 1 : 0)
      expandProgress.value = withSpring(next ? 1 : 0)
      return next
    })
  }, [isEmpty, chevronRotation, expandProgress])

  // Calculate totals
  const { totalCalories, totalProtein, totalCarbs, totalFat } = useMemo(() => {
    const totals = entries.reduce(
      (acc, entry) => ({
        calories: acc.calories + entry.nutrients.calories * entry.quantity,
        protein: acc.protein + entry.nutrients.protein * entry.quantity,
        carbs: acc.carbs + entry.nutrients.carbs * entry.quantity,
        fat: acc.fat + entry.nutrients.fat * entry.quantity,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    )
    return {
      totalCalories: Math.round(totals.calories),
      totalProtein: Math.round(totals.protein),
      totalCarbs: Math.round(totals.carbs),
      totalFat: Math.round(totals.fat),
    }
  }, [entries])

  // Default meal name based on entries
  const defaultMealName = useMemo(() => {
    if (entries.length === 0) return formatMealName(meal)
    if (entries.length === 1) return entries[0].name
    return formatMealName(meal)
  }, [entries, meal])

  const displayTitle = mealTitle || defaultMealName

  const handleConfirm = useCallback(() => {
    if (isEmpty) return
    Haptics.selection()
    onConfirm()
  }, [isEmpty, onConfirm])

  const handleQuantityChange = useCallback((index: number, newQuantity: number) => {
    if (onQuantityChange) {
      onQuantityChange(index, newQuantity)
    }
  }, [onQuantityChange])

  const handleRemove = useCallback((index: number) => {
    onRemove(index)
  }, [onRemove])

  // Collapse when entries become empty
  useEffect(() => {
    if (entries.length === 0) {
      setIsExpanded(false)
      chevronRotation.value = withSpring(0)
      expandProgress.value = withSpring(0)
    }
  }, [entries.length, chevronRotation, expandProgress])

  return (
    <View className="mx-1 -mb-2">
      <GradientBorderCard
        borderRadius={{ topLeft: 20, topRight: 20, bottomLeft: 0, bottomRight: 0 }}
        padding={{ padding: 16, paddingBottom: 24 }}
      >
        {/* Header: Title + Expand chevron */}
        <Pressable onPress={handleToggleExpand}>
        <View className="flex-row justify-between items-center mb-8">
          {isEmpty ? (
            <Text className="text-muted text-lg">Add food to continue...</Text>
          ) : (
            <View className="flex-1 mr-2">
              {isTitleLoading ? (
                <ShimmerText
                  className="text-foreground text-lg font-semibold"
                  highlightColor={theme.muted}
                >
                  <Text>Generating title...</Text>
                </ShimmerText>
              ) : (
                <AnimatedValue
                  value={displayTitle}
                  className="text-foreground text-lg font-semibold"
                />
              )}
            </View>
          )}
          {!isEmpty && (
            <Animated.View style={chevronStyle}>
              <ChevronDown size={20} color={theme.primary} />
            </Animated.View>
          )}
        </View>
        </Pressable>

        {/* Large Calories */}
        {!isEmpty && (
          <View className="mb-8 flex-row items-end gap-2">
            <AnimatedValue
              value={totalCalories}
              className="text-foreground text-5xl font-bold"
            />
            <Text className="text-muted text-xl mb-2">kcal</Text>
          </View>
        )}

        {/* Segmented Macro Bar */}
        {!isEmpty && (
          <View className="mb-4">
            <SegmentedMacroBar
              protein={totalProtein}
              carbs={totalCarbs}
              fat={totalFat}
              animated
            />
          </View>
        )}

        {/* Macro Detail Row */}
        {!isEmpty && (
          <View className="flex-row justify-between mb-8">
            <MacroDetail label="Protein" value={totalProtein} color={MACRO_COLORS.protein} animated />
            <MacroDetail label="Carbs" value={totalCarbs} color={MACRO_COLORS.carbs} animated />
            <MacroDetail label="Fats" value={totalFat} color={MACRO_COLORS.fat} animated />
          </View>
        )}

        {/* Expandable Entry List */}
        {!isEmpty && (
          <Animated.View
            style={[
              expandStyle,
              {
                borderTopWidth: 1,
                borderTopColor: theme.border,
              },
            ]}
          >
            <View style={{ paddingTop: 8, paddingBottom: 32 }}>
              {entries.map((entry, index) => (
                <EditEntryRow
                  key={`${entry.name}-${entry.fdcId ?? index}`}
                  entry={entry}
                  index={index}
                  themeColor={theme.muted}
                  onRemove={handleRemove}
                  onQuantityChange={handleQuantityChange}
                />
              ))}
            </View>
          </Animated.View>
        )}

        {/* Log Button */}
        <View>
          <Pressable
            onPress={handleConfirm}
            disabled={isEmpty}
            style={{
              borderRadius: 12,
              borderCurve: 'continuous',
              paddingVertical: 12,
              alignItems: 'center',
              opacity: isEmpty ? 0.5 : 1,
              backgroundColor: isEmpty ? undefined : theme.primary,
            }}
          >
            <Text className={`text-base font-semibold ${isEmpty ? 'text-muted' : 'text-white'}`}>
              Log
            </Text>
          </Pressable>
        </View>
      </GradientBorderCard>
    </View>
  )
}
