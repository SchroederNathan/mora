import { FC, useEffect, useRef, useState } from 'react'
import { Text } from '@/components/ui/Text'
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

type AnimatedCharProps = {
  char: string
  index: number
  totalCount: number
  progress: SharedValue<number>
  className?: string
}

const AnimatedChar: FC<AnimatedCharProps> = ({ index, char, progress, totalCount, className }) => {
  const charProgress = useDerivedValue(() => {
    const delayMs = index * 15

    return withDelay(
      delayMs,
      withSpring(progress.value, {
        damping: 100,
        stiffness: 1400,
      })
    )
  }, [])

  const rContainerStyle = useAnimatedStyle(() => {
    const progress = charProgress.get()
    const translateX = interpolate(progress, [0, 1], [-2, 0])
    const translateY = interpolate(progress, [0, 1], [12 - index * (6 / Math.max(totalCount - 1, 1)), 0])
    const scale = interpolate(progress, [0, 1], [0.8, 1])
    
    return {
      opacity: progress,
      transform: [
        { translateX },
        { translateY },
        { scale },
      ] as const,
    }
  })

  return (
    <Animated.View style={rContainerStyle}>
      <Text className={className}>{char}</Text>
    </Animated.View>
  )
}

type StaggeredTextProps = {
  phrases: string[]
  visible: boolean
  /** 'cycle' rotates through phrases on interval; 'oneshot' animates in once and re-animates when phrases[0] changes */
  mode?: 'cycle' | 'oneshot'
  intervalMs?: number
  className?: string
  /** Delay in ms before the initial animation starts */
  initialDelay?: number
}

export const StaggeredText: FC<StaggeredTextProps> = ({
  phrases,
  visible,
  mode = 'cycle',
  intervalMs = 3000,
  className = 'text-base text-muted',
  initialDelay = 100,
}) => {
  const progress = useSharedValue(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [displayPhrase, setDisplayPhrase] = useState(phrases[0])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isTransitioning = useRef(false)
  const prevPhraseRef = useRef(phrases[0])
  const isMountedRef = useRef(true)

  // Oneshot mode: animate in on mount, re-animate when phrases[0] changes
  useEffect(() => {
    if (mode !== 'oneshot' || !visible) return
    isMountedRef.current = true

    const newPhrase = phrases[0]
    if (prevPhraseRef.current === newPhrase) {
      // Initial mount — just show immediately
      setDisplayPhrase(newPhrase)
      progress.set(1)
      return
    }

    // Value changed — fade out, swap, fade in
    prevPhraseRef.current = newPhrase
    isTransitioning.current = true
    progress.set(withTiming(0, { duration: 150 }))

    const timeout = setTimeout(() => {
      if (!isMountedRef.current) return
      setDisplayPhrase(newPhrase)
      setTimeout(() => {
        if (!isMountedRef.current) return
        progress.set(1)
        isTransitioning.current = false
      }, 50)
    }, 180)

    return () => {
      isMountedRef.current = false
      clearTimeout(timeout)
    }
  }, [mode, visible, phrases[0], progress])

  // Cycle mode: rotate through phrases on interval
  useEffect(() => {
    if (mode !== 'cycle') return
    if (visible) {
      // Show initial text
      const showTimeout = setTimeout(() => {
        progress.set(1)
      }, initialDelay)

      // Start cycling through phrases
      intervalRef.current = setInterval(() => {
        if (isTransitioning.current) return
        isTransitioning.current = true

        // Fade out
        progress.set(withTiming(0, { duration: 200 }))

        // Update text after fade out
        setTimeout(() => {
          setCurrentIndex((prev) => (prev + 1) % phrases.length)

          // Fade in after text update
          setTimeout(() => {
            progress.set(1)
            isTransitioning.current = false
          }, 50)
        }, 250)
      }, intervalMs)

      return () => {
        clearTimeout(showTimeout)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } else {
      progress.set(0)
      setCurrentIndex(0)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [mode, visible, phrases.length, intervalMs, progress, initialDelay])

  if (!visible) return null

  const currentPhrase = mode === 'oneshot' ? displayPhrase : phrases[currentIndex]

  return (
    <Animated.View className="flex-row flex-wrap">
      {currentPhrase.split('').map((char, charIdx) => (
        <AnimatedChar
          key={`${currentPhrase}-${charIdx}`}
          char={char}
          index={charIdx}
          totalCount={currentPhrase.length}
          progress={progress}
          className={className}
        />
      ))}
    </Animated.View>
  )
}
