import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { getDailyLog } from '@/lib/storage'
import { formatDateKey } from '@/types/nutrition'
import { GlassView } from 'expo-glass-effect'
import { useEffect, useState } from 'react'
import { View, useColorScheme } from 'react-native'

type Props = { calorieGoal: number }

export default function StreakCounter({ calorieGoal }: Props) {
  const colorScheme = useColorScheme()
  const theme = colors[colorScheme ?? 'light']
  const [streak, setStreak] = useState(0)
  const [longestStreak, setLongestStreak] = useState(0)
  const [loggedDays, setLoggedDays] = useState(0)

  useEffect(() => {
    let current = 0
    let longest = 0
    let total = 0
    const today = new Date()

    // Check up to 60 days back for streak
    for (let i = 0; i < 60; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const log = getDailyLog(formatDateKey(d))
      const hasEntries = (log?.entries.length ?? 0) > 0

      if (hasEntries) {
        total++
        if (i < 30) {
          if (current === i || i === 0) current = i + 1
        }
      } else if (i > 0) {
        // gap found — stop current streak count
        if (current > 0 && longest < current) longest = current
        if (i === 1) current = 0 // broke yesterday
      }
    }

    setLoggedDays(total)
    setStreak(current)
    setLongestStreak(Math.max(longest, current))
  }, [])

  const fire = streak >= 7 ? '🔥' : streak >= 3 ? '✨' : '📅'

  return (
    <GlassView isInteractive style={{ borderRadius: 16, borderCurve: 'continuous' as any, padding: 16 }}>
      <View className="flex-row items-center gap-2 mb-3">
        <Text style={{ fontSize: 18 }}>{fire}</Text>
        <Text className="text-foreground font-semibold text-base">Logging Streak</Text>
      </View>
      <View className="flex-row gap-4">
        <View className="flex-1 items-center">
          <Text className="font-bold text-3xl" style={{ color: theme.primary }}>{streak}</Text>
          <Text className="text-muted text-xs mt-0.5">Current</Text>
        </View>
        <View
          style={{
            width: 1,
            backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          }}
        />
        <View className="flex-1 items-center">
          <Text className="font-bold text-3xl text-foreground">{longestStreak}</Text>
          <Text className="text-muted text-xs mt-0.5">Best</Text>
        </View>
        <View
          style={{
            width: 1,
            backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          }}
        />
        <View className="flex-1 items-center">
          <Text className="font-bold text-3xl text-foreground">{loggedDays}</Text>
          <Text className="text-muted text-xs mt-0.5">Total Days</Text>
        </View>
      </View>
    </GlassView>
  )
}
