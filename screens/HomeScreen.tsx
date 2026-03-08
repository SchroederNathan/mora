import CalorieTracker from "@/components/CalorieTracker"
import DatePicker from "@/components/DatePicker"
import { FoodHistory } from "@/components/FoodEntryCard"
import MacroProgress from "@/components/MacroProgress"
import { colors } from "@/constants/colors"
import { useDailyLogStore, useUserStore } from "@/stores"
import { useRouter } from "expo-router"
import { Plus, Settings } from "lucide-react-native"
import { useCallback, useEffect } from "react"
import { Pressable, ScrollView, useColorScheme, View } from "react-native"
import { Haptics } from "react-native-nitro-haptics"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export default function HomeScreen() {
    const insets = useSafeAreaInsets()
    const headerHeight = insets.top + 44
    const router = useRouter()
    const colorScheme = useColorScheme()
    const isDark = colorScheme === 'dark'

    // Subscribe to specific values from stores (this ensures re-renders)
    const calories = useDailyLogStore(state => state.log.totals.calories)
    const protein = useDailyLogStore(state => state.log.totals.protein)
    const carbs = useDailyLogStore(state => state.log.totals.carbs)
    const fat = useDailyLogStore(state => state.log.totals.fat)
    const currentDate = useDailyLogStore(state => state.currentDate)
    const loadDailyLog = useDailyLogStore(state => state.load)
    const targetCalories = useUserStore(state => state.goals.calories)
    const proteinGoal = useUserStore(state => state.goals.protein)
    const carbsGoal = useUserStore(state => state.goals.carbs)
    const fatGoal = useUserStore(state => state.goals.fat)
    const entries = useDailyLogStore(state => state.log.entries)
    const loadUserGoals = useUserStore(state => state.load)

    // Load stores on mount
    useEffect(() => {
        loadDailyLog()
        loadUserGoals()
    }, [loadDailyLog, loadUserGoals])

    // Debug
    useEffect(() => {
        console.log('[HomeScreen] calories:', calories, 'target:', targetCalories)
    }, [calories, targetCalories])

    const handleDateSelect = useCallback((date: string) => {
        loadDailyLog(date)
    }, [loadDailyLog])

    const handleOpenFoodSearch = useCallback(() => {
        Haptics.impact('light')
        router.push('/(app)/food-search')
    }, [router])

    const handleOpenSettings = useCallback(() => {
        Haptics.impact('light')
        router.push('/(app)/settings')
    }, [router])

    return (
        <View className="flex-1">
            {/* Settings button — top right */}
            <Pressable
                onPress={handleOpenSettings}
                hitSlop={8}
                style={{
                    position: 'absolute',
                    top: insets.top + 10,
                    right: 16,
                    zIndex: 10,
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Settings size={20} color={isDark ? colors.dark.foreground : colors.light.foreground} />
            </Pressable>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: insets.bottom + 20 }}
                showsVerticalScrollIndicator={false}
            >
                <DatePicker
                    selectedDate={currentDate}
                    calorieGoal={targetCalories}
                    currentDateCalories={calories}
                    onSelectDate={handleDateSelect}
                />
                <CalorieTracker
                    eaten={calories}
                    target={targetCalories}
                />
                <MacroProgress
                    carbs={carbs}
                    carbsGoal={carbsGoal}
                    protein={protein}
                    proteinGoal={proteinGoal}
                    fat={fat}
                    fatGoal={fatGoal}
                />
                <View className="px-4 mt-6 pb-4">
                    <FoodHistory entries={entries} />
                    {/* <WeeklyCalorieChart calorieGoal={targetCalories} /> */}
                </View>
            </ScrollView>

            {/* FAB: Quick Add Food */}
            <Pressable
                onPress={handleOpenFoodSearch}
                style={{
                    position: 'absolute',
                    right: 20,
                    bottom: insets.bottom + 20,
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: isDark ? colors.dark.primary : colors.light.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: isDark ? colors.dark.primary : colors.light.primary,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.4,
                    shadowRadius: 8,
                    elevation: 8,
                }}
            >
                <Plus size={26} color="#fff" strokeWidth={2.5} />
            </Pressable>
        </View>
    )
}
