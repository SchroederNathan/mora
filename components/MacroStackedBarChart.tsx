"use client"
import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { getDailyLog } from '@/lib/storage'
import { formatDateKey } from '@/types/nutrition'
import { GlassView } from 'expo-glass-effect'
import { useEffect, useMemo, useState } from 'react'
import { Animated, View, useColorScheme, useWindowDimensions } from 'react-native'

const MACRO_COLORS = {
  protein: '#3b82f6',  // blue
  carbs:   '#f59e0b',  // amber
  fat:     '#ef4444',  // red
}

type DayData = {
  day: string
  date: string
  protein: number
  carbs: number
  fat: number
  calories: number
}

type Props = {
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
}

function AnimatedBar({ height, color, delay }: { height: number; color: string; delay: number }) {
  const anim = useMemo(() => new Animated.Value(0), [])

  useEffect(() => {
    Animated.timing(anim, {
      toValue: height,
      duration: 600,
      delay,
      useNativeDriver: false,
    }).start()
  }, [height, delay, anim])

  return (
    <Animated.View
      style={{
        height: anim,
        backgroundColor: color,
        width: '100%',
      }}
    />
  )
}

export default function MacroStackedBarChart({ proteinGoal, carbsGoal, fatGoal }: Props) {
  const colorScheme = useColorScheme()
  const theme = colors[colorScheme ?? 'light']
  const { width: screenWidth } = useWindowDimensions()
  const [data, setData] = useState<DayData[]>([])

  useEffect(() => {
    const out: DayData[] = []
    const today = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const log = getDailyLog(formatDateKey(d))
      out.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        date: formatDateKey(d),
        protein: log?.totals.protein ?? 0,
        carbs: log?.totals.carbs ?? 0,
        fat: log?.totals.fat ?? 0,
        calories: log?.totals.calories ?? 0,
      })
    }
    setData(out)
  }, [])

  const BAR_HEIGHT = 140
  const maxCals = useMemo(() => {
    if (!data.length) return 1
    const totalGoalCals = proteinGoal * 4 + carbsGoal * 4 + fatGoal * 9
    const maxActual = Math.max(...data.map(d => d.protein * 4 + d.carbs * 4 + d.fat * 9))
    return Math.max(totalGoalCals, maxActual) * 1.1 || 1
  }, [data, proteinGoal, carbsGoal, fatGoal])

  const avgProtein = data.length ? Math.round(data.reduce((s, d) => s + d.protein, 0) / data.length) : 0
  const avgCarbs   = data.length ? Math.round(data.reduce((s, d) => s + d.carbs, 0)   / data.length) : 0
  const avgFat     = data.length ? Math.round(data.reduce((s, d) => s + d.fat, 0)     / data.length) : 0

  if (!data.length) return null

  return (
    <View className="mt-6">
      <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-3">
        7-Day Macros
      </Text>
      <GlassView isInteractive style={{ borderRadius: 16, borderCurve: 'continuous' as any, padding: 16 }}>
        {/* Legend */}
        <View className="flex-row gap-4 mb-4">
          {([['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat']] as const).map(([key, label]) => (
            <View key={key} className="flex-row items-center gap-1.5">
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: MACRO_COLORS[key] }} />
              <Text className="text-muted text-xs">{label}</Text>
            </View>
          ))}
        </View>

        {/* Bar chart */}
        <View style={{ height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          {data.map((d, i) => {
            const proteinH = (d.protein * 4 / maxCals) * BAR_HEIGHT
            const carbsH   = (d.carbs * 4 / maxCals) * BAR_HEIGHT
            const fatH     = (d.fat * 9 / maxCals) * BAR_HEIGHT
            const isEmpty  = d.calories === 0

            return (
              <View key={d.date} style={{ flex: 1, height: BAR_HEIGHT, justifyContent: 'flex-end' }}>
                <View
                  style={{
                    borderRadius: 6,
                    overflow: 'hidden',
                    opacity: isEmpty ? 0.25 : 1,
                    backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  }}
                >
                  {/* Stacked: fat → carbs → protein (bottom to top) */}
                  <AnimatedBar height={fatH}     color={MACRO_COLORS.fat}     delay={i * 40} />
                  <AnimatedBar height={carbsH}   color={MACRO_COLORS.carbs}   delay={i * 40 + 80} />
                  <AnimatedBar height={proteinH} color={MACRO_COLORS.protein} delay={i * 40 + 160} />
                </View>
              </View>
            )
          })}
        </View>

        {/* X-axis labels */}
        <View className="flex-row gap-[6px] mt-2">
          {data.map((d) => (
            <View key={d.date} style={{ flex: 1 }}>
              <Text className="text-muted text-[10px] text-center">{d.day}</Text>
            </View>
          ))}
        </View>

        {/* Weekly averages vs goals */}
        <View
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          }}
        >
          <Text className="text-muted text-xs font-semibold mb-3">Weekly Average vs Goal</Text>
          {([
            { key: 'protein', label: 'Protein', avg: avgProtein, goal: proteinGoal, color: MACRO_COLORS.protein },
            { key: 'carbs',   label: 'Carbs',   avg: avgCarbs,   goal: carbsGoal,   color: MACRO_COLORS.carbs },
            { key: 'fat',     label: 'Fat',      avg: avgFat,     goal: fatGoal,     color: MACRO_COLORS.fat },
          ] as const).map(({ key, label, avg, goal, color }) => {
            const pct = Math.min((avg / Math.max(goal, 1)) * 100, 100)
            return (
              <View key={key} className="mb-3">
                <View className="flex-row justify-between mb-1">
                  <Text className="text-foreground text-xs font-medium">{label}</Text>
                  <Text className="text-muted text-xs">{avg}g / {goal}g</Text>
                </View>
                <View
                  style={{
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      backgroundColor: color,
                      borderRadius: 3,
                    }}
                  />
                </View>
              </View>
            )
          })}
        </View>
      </GlassView>
    </View>
  )
}
