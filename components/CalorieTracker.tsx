import { colors } from '@/constants/colors'
import { useColorScheme, View } from 'react-native'
import { Text } from '@/components/ui/Text'
import { StaggeredText } from '@/components/ui/StaggeredText'
import Svg, { Circle } from 'react-native-svg'
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useEffect } from 'react'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

type CalorieTrackerProps = {
  eaten: number
  target: number
}

export default function CalorieTracker({ eaten, target }: CalorieTrackerProps) {
  const colorScheme = useColorScheme()
  const theme = colorScheme === 'dark' ? colors.dark : colors.light

  const remaining = Math.max(0, target - eaten)
  const progress = Math.min(eaten / target, 1)

  const size = 180
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // Arc spans 75% of circle (270°), leaving gap at bottom
  const arcPercentage = 0.75
  const arcLength = circumference * arcPercentage
  const gapLength = circumference - arcLength

  // Animated progress arc
  const animatedProgress = useSharedValue(progress)

  useEffect(() => {
    animatedProgress.set(
      withSpring(progress)
    )
  }, [progress])

  const animatedProps = useAnimatedProps(() => {
    const progressArcLength = arcLength * animatedProgress.get()
    return {
      strokeDasharray: [progressArcLength, circumference] as unknown as string,
    }
  })

  return (
    <View className="flex-row items-center justify-between px-6 py-6">
      {/* Remaining */}
      <View className="items-center flex-1">
        <StaggeredText
          phrases={[String(remaining)]}
          visible={true}
          mode="oneshot"
          className="text-foreground text-2xl font-semibold"
        />
        <Text className="text-muted text-xs uppercase tracking-wider mt-1">Remaining</Text>
      </View>

      {/* Circle with eaten calories */}
      <View className="items-center justify-center">
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size} style={{ transform: [{ rotate: '135deg' }] }}>
            {/* Background arc */}
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={theme.foreground}
              strokeOpacity={0.1}
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeDasharray={`${arcLength} ${gapLength}`}
              strokeLinecap="round"
            />
            {/* Progress arc */}
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={theme.foreground}
              strokeWidth={strokeWidth}
              fill="transparent"
              animatedProps={animatedProps}
              strokeLinecap="round"
            />
          </Svg>
          <View className="absolute inset-0 items-center justify-center">
            <StaggeredText
              phrases={[String(eaten)]}
              visible={true}
              mode="oneshot"
              className="text-foreground text-4xl font-bold"
            />
            <Text className="text-muted text-xs uppercase tracking-wider text-sans">Eaten</Text>
          </View>
        </View>
      </View>

      {/* Target */}
      <View className="items-center flex-1">
        <StaggeredText
          phrases={[String(target)]}
          visible={true}
          mode="oneshot"
          className="text-foreground text-2xl font-semibold"
        />
        <Text className="text-muted text-xs uppercase tracking-wider mt-1">Target</Text>
      </View>
    </View>
  )
}
