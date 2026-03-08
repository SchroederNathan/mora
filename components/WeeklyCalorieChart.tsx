import { ScrollPositionContext } from '@/contexts/PagerContexts'
import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { getDailyLog } from '@/lib/storage'
import { formatDateKey } from '@/types/nutrition'
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia'
import { GlassView } from 'expo-glass-effect'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { View, useColorScheme, useWindowDimensions } from 'react-native'
import {
  Easing,
  type SharedValue,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'

const CHART_HEIGHT = 160
const PAD = { top: 20, right: 16, bottom: 4, left: 16 }
const DOT_R = 4

function smoothPath(pts: { x: number; y: number }[]) {
  const p = Skia.Path.Make()
  if (pts.length === 0) return p
  p.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2
    p.cubicTo(mx, pts[i - 1].y, mx, pts[i].y, pts[i].x, pts[i].y)
  }
  return p
}

function Dot({
  cx, cy, color, index, total, progress,
}: {
  cx: number; cy: number; color: string
  index: number; total: number; progress: SharedValue<number>
}) {
  const opacity = useDerivedValue(() => {
    const t = index / Math.max(total - 1, 1)
    return Math.min(1, Math.max(0, (progress.value - t + 0.08) / 0.08))
  })
  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={DOT_R} color={color} />
    </Group>
  )
}

type Props = { calorieGoal: number }

export default function WeeklyCalorieChart({ calorieGoal }: Props) {
  const { width: screenWidth } = useWindowDimensions()
  const colorScheme = useColorScheme()
  const theme = colors[colorScheme ?? 'light']
  const scrollPosition = useContext(ScrollPositionContext)

  const chartW = screenWidth - 64
  const drawW = chartW - PAD.left - PAD.right
  const drawH = CHART_HEIGHT - PAD.top - PAD.bottom

  const [data, setData] = useState<{ day: string; cal: number }[]>([])

  useEffect(() => {
    const out: { day: string; cal: number }[] = []
    const today = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const log = getDailyLog(formatDateKey(d))
      out.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        cal: log?.totals.calories ?? 0,
      })
    }
    setData(out)
  }, [])

  const { pts, avgPts } = useMemo(() => {
    if (data.length === 0) return { pts: [], avgPts: [], goalY: 0 }
    const ceil = Math.max(...data.map(d => d.cal), calorieGoal) * 1.15 || 1

    const pts = data.map((d, i) => ({
      x: PAD.left + (i / 6) * drawW,
      y: PAD.top + drawH - (d.cal / ceil) * drawH,
    }))

    const avgPts = data.map((_, i) => {
      const slice = data.slice(Math.max(0, i - 2), i + 1)
      const avg = slice.reduce((s, w) => s + w.cal, 0) / slice.length
      return {
        x: PAD.left + (i / 6) * drawW,
        y: PAD.top + drawH - (avg / ceil) * drawH,
      }
    })

    return { pts, avgPts, goalY: PAD.top + drawH - (calorieGoal / ceil) * drawH }
  }, [data, calorieGoal, drawW, drawH])

  const mainPath = useMemo(() => smoothPath(pts), [pts])
  const rollingPath = useMemo(() => smoothPath(avgPts), [avgPts])

  // Linear goal trend: cumulative goal vs cumulative actual over 7 days
  // Shows a line from day 1's goal to day 7's goal (calorieGoal * 1 → calorieGoal * 7)
  const { goalTrendPath, goalEndY } = useMemo(() => {
    if (data.length === 0) return { goalTrendPath: Skia.Path.Make(), goalStartY: 0, goalEndY: 0 }
    const ceil = Math.max(...data.map(d => d.cal), calorieGoal) * 1.15 || 1
    const startY = PAD.top + drawH - (calorieGoal / ceil) * drawH
    const endY = startY // flat reference line — same daily target each day
    const p = Skia.Path.Make()
    p.moveTo(PAD.left, startY)
    p.lineTo(chartW - PAD.right, endY)
    return { goalTrendPath: p, goalStartY: startY, goalEndY: endY }
  }, [data, calorieGoal, drawH, chartW])

  // Animation
  const progress = useSharedValue(0)
  const shimmerPos = useSharedValue(0)
  const fired = useRef(false)

  const fire = useCallback(() => {
    if (fired.current) return
    fired.current = true
    // Line draws in over 1400ms
    progress.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) })
    // Shimmer starts 250ms later, runs faster (1150ms), finishes at same time
    shimmerPos.value = withDelay(250, withTiming(1, { duration: 1150, easing: Easing.out(Easing.cubic) }))
  }, [progress, shimmerPos])

  useAnimatedReaction(
    () => scrollPosition?.value ?? 1,
    (v) => { if (v < 0.1) runOnJS(fire)() },
  )

  const end = useDerivedValue(() => progress.value)

  // Shimmer: a bright band that sweeps across the line
  const SHIMMER_BAND = 40
  const shimmerGradStart = useDerivedValue(() => {
    const x = PAD.left + shimmerPos.value * drawW - SHIMMER_BAND
    return vec(x, 0)
  })
  const shimmerGradEnd = useDerivedValue(() => {
    const x = PAD.left + shimmerPos.value * drawW + SHIMMER_BAND
    return vec(x, 0)
  })
  const shimmerOpacity = useDerivedValue(() => {
    const p = shimmerPos.value
    if (p <= 0) return 0
    if (p < 0.1) return (p / 0.1) * 0.8   // fade in
    if (p > 0.85) return ((1 - p) / 0.15) * 0.8 // fade out at end
    return 0.8
  })

  const lineCol = theme.primary
  const avgCol = colorScheme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)'
  const goalCol = colorScheme === 'dark' ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.4)'

  if (data.length === 0) return null

  return (
    <View className="mt-6">
      <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-3">
        Weekly Trend
      </Text>
      <GlassView isInteractive style={{ borderRadius: 16, borderCurve: 'continuous' as any, padding: 16 }}>
        <View style={{ height: CHART_HEIGHT }}>
          <Canvas className="flex-1">
            {/* Goal reference line */}
            <Path path={goalTrendPath} style="stroke" strokeWidth={1} color={goalCol}>
              <DashPathEffect intervals={[6, 4]} />
            </Path>

            {/* Daily calories line */}
            <Path
              path={mainPath}
              style="stroke"
              strokeWidth={2.5}
              color={lineCol}
              start={0}
              end={end}
              strokeCap="round"
              strokeJoin="round"
            />

            {/* Shimmer sweep — bright band that races across the line */}
            <Group opacity={shimmerOpacity}>
              <Path
                path={mainPath}
                style="stroke"
                strokeWidth={4}
                start={0}
                end={end}
                strokeCap="round"
                strokeJoin="round"
              >
                <LinearGradient
                  start={shimmerGradStart}
                  end={shimmerGradEnd}
                  colors={['transparent', 'rgba(255,255,255,0.7)', 'transparent']}
                />
              </Path>
            </Group>

            {/* Rolling average */}
            <Path
              path={rollingPath}
              style="stroke"
              strokeWidth={1.5}
              color={avgCol}
              start={0}
              end={end}
              strokeCap="round"
              strokeJoin="round"
            >
              <DashPathEffect intervals={[4, 3]} />
            </Path>

            {/* Data dots */}
            {pts.map((pt, i) => (
              <Dot key={`dot-${pt.x}-${pt.y}`} cx={pt.x} cy={pt.y} color={lineCol} index={i} total={pts.length} progress={progress} />
            ))}
          </Canvas>

          {/* Goal label */}
          <View className="absolute" style={{ right: PAD.right + 4, top: goalEndY - 14 }}>
            <Text className="text-[10px] font-semibold" style={{ color: goalCol }}>Goal</Text>
          </View>
        </View>

        {/* X-axis labels */}
        <View className="flex-row justify-between mt-1" style={{ paddingHorizontal: PAD.left }}>
          {data.map((d) => (
            <Text key={d.day} className="text-muted text-[10px] text-center w-[30px]">
              {d.day}
            </Text>
          ))}
        </View>
      </GlassView>
    </View>
  )
}
