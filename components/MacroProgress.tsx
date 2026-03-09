import { View } from 'react-native'
import { Text } from '@/components/ui/Text'
import { StaggeredText } from '@/components/ui/StaggeredText'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useEffect } from 'react'

type MacroProgressProps = {
  carbs: number
  carbsGoal: number
  protein: number
  proteinGoal: number
  fat: number
  fatGoal: number
}

type MacroBarProps = {
  label: string
  current: number
  goal: number
}

function MacroBar({ label, current, goal }: MacroBarProps) {
  const progress = Math.min(current / goal, 1)

  const animatedWidth = useSharedValue(progress)

  useEffect(() => {
    animatedWidth.set(withSpring(progress))
  }, [progress])

  const barStyle = useAnimatedStyle(() => ({
    width: `${animatedWidth.get() * 100}%`,
  }))

  return (
    <View className="flex-1 items-center">
      <Text className="text-foreground text-xs uppercase tracking-wider mb-2">{label}</Text>
      <View className="w-full h-1 bg-foreground/10 rounded-full overflow-hidden">
        <Animated.View
          className="h-full bg-foreground rounded-full"
          style={barStyle}
        />
      </View>
      <View className="flex-row mt-2">
        <StaggeredText
          phrases={[`${Math.round(current)}`]}
          visible={true}
          mode="oneshot"
          className="text-foreground text-sm"
        />
        <Text className="text-foreground text-sm"> / {goal}g</Text>
      </View>
    </View>
  )
}

export default function MacroProgress({
  carbs,
  carbsGoal,
  protein,
  proteinGoal,
  fat,
  fatGoal,
}: MacroProgressProps) {
  return (
    <View className="flex-row px-6 gap-8">
      <MacroBar label="CARBS" current={carbs} goal={carbsGoal} />
      <MacroBar label="PROTEIN" current={protein} goal={proteinGoal} />
      <MacroBar label="FAT" current={fat} goal={fatGoal} />
    </View>
  )
}
