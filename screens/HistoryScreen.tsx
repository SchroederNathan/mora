import DailyLogHistoryCard from '@/components/DailyLogHistoryCard'
import MacroStackedBarChart from '@/components/MacroStackedBarChart'
import StreakCounter from '@/components/StreakCounter'
import WeeklyCalorieChart from '@/components/WeeklyCalorieChart'
import { Text } from '@/components/ui/Text'
import { useDailyLogStore, useUserStore } from '@/stores'
import { useCallback, useEffect } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function HistoryScreen() {
  const insets = useSafeAreaInsets()
  const headerHeight = insets.top + 44

  const loadDailyLog = useDailyLogStore(state => state.load)
  const loadUserGoals = useUserStore(state => state.load)

  const calorieGoal = useUserStore(state => state.goals.calories)
  const proteinGoal = useUserStore(state => state.goals.protein)
  const carbsGoal   = useUserStore(state => state.goals.carbs)
  const fatGoal     = useUserStore(state => state.goals.fat)

  useEffect(() => {
    loadDailyLog()
    loadUserGoals()
  }, [loadDailyLog, loadUserGoals])

  const handleDatePress = useCallback((date: string) => {
    loadDailyLog(date)
    // In a real nav setup, this would push to HomeScreen filtered to that date.
    // For now just loads that day's log into the store.
  }, [loadDailyLog])

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingTop: headerHeight + 8,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View className="mb-6">
        <Text className="text-foreground text-2xl font-bold">History</Text>
        <Text className="text-muted text-sm mt-1">Your macro trends over time</Text>
      </View>

      {/* Streak */}
      <StreakCounter calorieGoal={calorieGoal} />

      {/* Weekly calorie trend line chart */}
      <WeeklyCalorieChart calorieGoal={calorieGoal} />

      {/* Weekly macro stacked bar chart */}
      <MacroStackedBarChart
        proteinGoal={proteinGoal}
        carbsGoal={carbsGoal}
        fatGoal={fatGoal}
      />

      {/* Daily log history list */}
      <DailyLogHistoryCard
        calorieGoal={calorieGoal}
        proteinGoal={proteinGoal}
        onDatePress={handleDatePress}
      />
    </ScrollView>
  )
}
