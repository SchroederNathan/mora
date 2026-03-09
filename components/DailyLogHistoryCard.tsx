import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { getDailyLog } from '@/lib/storage'
import { formatDateKey } from '@/types/nutrition'
import { useEffect, useState } from 'react'
import { Pressable, View, useColorScheme } from 'react-native'

type DayEntry = {
  label: string
  date: string
  calories: number
  protein: number
  carbs: number
  fat: number
  entryCount: number
}

type Props = {
  calorieGoal: number
  proteinGoal: number
  onDatePress?: (date: string) => void
}

export default function DailyLogHistoryCard({ calorieGoal, proteinGoal, onDatePress }: Props) {
  const colorScheme = useColorScheme()
  const theme = colors[colorScheme ?? 'light']
  const [entries, setEntries] = useState<DayEntry[]>([])

  useEffect(() => {
    const out: DayEntry[] = []
    const today = new Date()
    for (let i = 0; i < 14; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const log = getDailyLog(formatDateKey(d))
      const isToday = i === 0
      const isYesterday = i === 1

      let label: string
      if (isToday) label = 'Today'
      else if (isYesterday) label = 'Yesterday'
      else label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

      out.push({
        label,
        date: formatDateKey(d),
        calories: log?.totals.calories ?? 0,
        protein: log?.totals.protein ?? 0,
        carbs: log?.totals.carbs ?? 0,
        fat: log?.totals.fat ?? 0,
        entryCount: log?.entries.length ?? 0,
      })
    }
    setEntries(out)
  }, [])

  const borderColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'
  const cardBg = colorScheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'

  return (
    <View className="mt-6 mb-8">
      <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-3">
        Log History
      </Text>
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor }}>
        {entries.map((entry, i) => {
          const isEmpty = entry.entryCount === 0
          const pct = Math.min((entry.calories / Math.max(calorieGoal, 1)) * 100, 100)
          const isOver = entry.calories > calorieGoal

          return (
            <Pressable
              key={entry.date}
              onPress={() => !isEmpty && onDatePress?.(entry.date)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                padding: 14,
                backgroundColor: pressed ? (colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : cardBg,
                borderBottomWidth: i < entries.length - 1 ? 1 : 0,
                borderBottomColor: borderColor,
                opacity: isEmpty ? 0.45 : 1,
              })}
            >
              {/* Date + entry count */}
              <View style={{ width: 140 }}>
                <Text className="text-foreground text-sm font-medium">{entry.label}</Text>
                {!isEmpty && (
                  <Text className="text-muted text-xs mt-0.5">{entry.entryCount} item{entry.entryCount !== 1 ? 's' : ''}</Text>
                )}
                {isEmpty && (
                  <Text className="text-muted text-xs mt-0.5">No entries</Text>
                )}
              </View>

              {/* Calorie bar + value */}
              <View className="flex-1 mx-3">
                {!isEmpty ? (
                  <>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: borderColor, overflow: 'hidden' }}>
                      <View
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          backgroundColor: isOver ? '#ef4444' : theme.primary,
                          borderRadius: 2,
                        }}
                      />
                    </View>
                    <View className="flex-row gap-3 mt-2">
                      <Text className="text-muted text-[10px]">P {entry.protein}g</Text>
                      <Text className="text-muted text-[10px]">C {entry.carbs}g</Text>
                      <Text className="text-muted text-[10px]">F {entry.fat}g</Text>
                    </View>
                  </>
                ) : (
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: borderColor }} />
                )}
              </View>

              {/* Calories */}
              <Text
                className="text-sm font-semibold"
                style={{ color: isEmpty ? theme.mutedForeground : (isOver ? '#ef4444' : theme.foreground), minWidth: 46, textAlign: 'right' }}
              >
                {isEmpty ? '—' : `${entry.calories}`}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
