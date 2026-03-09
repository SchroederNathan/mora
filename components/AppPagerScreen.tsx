import { colors } from '@/constants/colors'
import { PagerNavigationContext, ScrollPositionContext } from '@/contexts/PagerContexts'
import ChatScreen from '@/screens/ChatScreen'
import HistoryScreen from '@/screens/HistoryScreen'
import HomeScreen from '@/screens/HomeScreen'
import { GlassView } from 'expo-glass-effect'
import { MeshGradientView } from 'expo-mesh-gradient'
import { useCallback, useContext, useMemo, useRef } from 'react'
import { StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import PagerView from 'react-native-pager-view'
import Animated, { Extrapolation, interpolate, runOnJS, SharedValue, useAnimatedStyle, useDerivedValue, useEvent, useHandler, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Page indicator constants
const PAGE_NAMES = ['Dashboard', 'Chat', 'History']
const DOT_SIZE = 8
const PILL_HEIGHT = 28

// Approximate pill widths for each page name (text width + padding)
const PILL_WIDTHS: Record<string, number> = {
  Dashboard: 95,
  Chat: 58,
  History: 72,
}

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView)
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView)

// Worklet-based scroll handler for PagerView (runs on UI thread like useAnimatedScrollHandler)
type PageScrollEventData = { position: number; offset: number }

function useAnimatedPagerScrollHandler(
  handlers: { onPageScroll?: (e: PageScrollEventData, ctx: Record<string, unknown>) => void },
  dependencies?: unknown[],
) {
  const { context, doDependenciesDiffer } = useHandler(handlers, dependencies)
  return useEvent<PageScrollEventData>(
    (event) => {
      'worklet'
      if (handlers.onPageScroll) {
        handlers.onPageScroll(event, context)
      }
    },
    ['onPageScroll'],
    doDependenciesDiffer,
  )
}

const CUBE_ANGLE = 70

type CubePageProps = {
  pageIndex: number
  scrollPosition: SharedValue<number>
  children: React.ReactNode
}

function CubePage({ pageIndex, scrollPosition, children }: CubePageProps) {
  const { width: screenWidth } = useWindowDimensions()
  const currentIndex = useDerivedValue(() => {
    return Math.floor(scrollPosition.value)
  })

  const cubeStyle = useAnimatedStyle(() => {
    const progress = scrollPosition.value - currentIndex.value

    const scaleY = interpolate(
      scrollPosition.value,
      [pageIndex - 1, pageIndex, pageIndex + 1],
      [0.95, 1, 0.95],
      Extrapolation.CLAMP,
    )

    // Active card: rotates away on right edge
    if (pageIndex === currentIndex.value) {
      const rotateY = interpolate(progress, [0, 1], [0, -CUBE_ANGLE], Extrapolation.CLAMP)
      return {
        transformOrigin: 'right',
        transform: [
          { perspective: screenWidth * 4 },
          { scaleY },
          { rotateY: `${rotateY}deg` },
        ],
      }
    }

    // Next card: rotates in from left edge
    if (pageIndex === currentIndex.value + 1) {
      const rotateY = interpolate(progress, [0, 1], [CUBE_ANGLE, 0], Extrapolation.CLAMP)
      return {
        transformOrigin: 'left',
        transform: [
          { perspective: screenWidth * 4 },
          { scaleY },
          { rotateY: `${rotateY}deg` },
        ],
      }
    }

    return {}
  })

  return (
    <Animated.View style={[styles.pageContainer, cubeStyle]}>
      {children}
    </Animated.View>
  )
}

type PageIndicatorProps = {
  name: string
  pageIndex: number
  scrollPosition: SharedValue<number>
}

function PageIndicator({ name, pageIndex, scrollPosition }: PageIndicatorProps) {
  const pillWidth = PILL_WIDTHS[name] || 80

  const containerStyle = useAnimatedStyle(() => {
    const distance = Math.abs(scrollPosition.value - pageIndex)
    const progress = Math.max(0, 1 - distance)

    return {
      width: interpolate(progress, [0, 1], [DOT_SIZE, pillWidth]),
      height: interpolate(progress, [0, 1], [DOT_SIZE, PILL_HEIGHT]),
      opacity: interpolate(progress, [0, 1], [0.4, 1]),
    }
  })

  const textStyle = useAnimatedStyle(() => {
    const distance = Math.abs(scrollPosition.value - pageIndex)
    const progress = Math.max(0, 1 - distance)

    return {
      opacity: interpolate(progress, [0, 0.6, 1], [0, 0, 1]),
    }
  })

  return (
    <AnimatedGlassView
      style={[
        {
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
        },
        containerStyle,
      ]}
      isInteractive
    >
      <Animated.Text style={[{ color: 'white', fontSize: 14, fontWeight: '500' }, textStyle]}>
        {name}
      </Animated.Text>
    </AnimatedGlassView>
  )
}

function AnimatedHeaderTitle({ scrollPosition }: { scrollPosition: SharedValue<number> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {PAGE_NAMES.map((name, index) => (
        <PageIndicator key={name} name={name} pageIndex={index} scrollPosition={scrollPosition} />
      ))}
    </View>
  )
}

function AnimatedMeshBackground({ scrollPosition }: { scrollPosition: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    // scrollPosition 0 = Dashboard (fully visible), 1+ = faded out
    opacity: interpolate(scrollPosition.value, [0, 1], [1, 0], 'clamp'),
  }))

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents="none">
      <MeshGradientView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 500 }}
        columns={3}
        rows={3}
        colors={[
          '#3b82f6', '#2563eb', '#1e3a8a30',
          '#1e40af70', '#1e3a8a30', 'transparent',
          'transparent', 'transparent', 'transparent',
        ]}
        points={[
          [0.0, 0.0], [0.5, 0.0], [1.0, 0],
          [0.0, 0.5], [0.5, 0.5], [1, 1],
          [0.0, 1.0], [0.5, 1.0], [1.0, 1.0],
        ]}
      />
    </Animated.View>
  )
}



function PagerContent({ scrollPosition, pagerRef }: { scrollPosition: SharedValue<number>, pagerRef: React.RefObject<PagerView | null> }) {
  const lastHapticPosition = useSharedValue<number | null>(null)

  const triggerHaptic = useCallback(() => {
    Haptics.impact('soft')
  }, [])

  // Runs entirely on UI thread — no JS bridge lag
  const scrollHandler = useAnimatedPagerScrollHandler({
    onPageScroll: (e) => {
      'worklet'
      const effectivePosition = e.position + e.offset
      scrollPosition.value = effectivePosition

      const roundedHalf = Math.round(effectivePosition * 2) / 2

      if (roundedHalf % 1 === 0.5 && lastHapticPosition.value !== roundedHalf) {
        lastHapticPosition.value = roundedHalf
        runOnJS(triggerHaptic)()
      }

      if (e.offset === 0) {
        lastHapticPosition.value = null
      }
    },
  })

  return (
    <AnimatedPagerView
      ref={pagerRef}
      style={{ flex: 1 }}
      initialPage={1}
      onPageScroll={scrollHandler}
    >
      <View key="home" style={{ flex: 1 }}>
        <CubePage pageIndex={0} scrollPosition={scrollPosition}>
          <HomeScreen />
        </CubePage>
      </View>
      <View key="chat" style={{ flex: 1 }}>
        <CubePage pageIndex={1} scrollPosition={scrollPosition}>
          <ChatScreen />
        </CubePage>
      </View>
      <View key="history" style={{ flex: 1 }}>
        <CubePage pageIndex={2} scrollPosition={scrollPosition}>
          <HistoryScreen />
        </CubePage>
      </View>
    </AnimatedPagerView>
  )
}

// Header height constant (safe area top + header content)
const HEADER_HEIGHT = 44

export default function PagerScreen() {
  const scrollPosition = useContext(ScrollPositionContext)!
  const colorScheme = useColorScheme()
  const pagerRef = useRef<PagerView>(null)
  const insets = useSafeAreaInsets()

  const pagerNavigation = useMemo(() => ({
    navigateToPage: (page: number) => {
      pagerRef.current?.setPage(page)
    },
  }), [])

  return (
    <PagerNavigationContext.Provider value={pagerNavigation}>
      <View style={{ flex: 1, backgroundColor: colorScheme === 'dark' ? colors.dark.background : colors.light.background }}>
        <AnimatedMeshBackground scrollPosition={scrollPosition} />

        {/* Custom header with animated page indicators */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
            height: insets.top + HEADER_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          pointerEvents="none"
        >
          <AnimatedHeaderTitle scrollPosition={scrollPosition} />
        </View>

        <PagerContent scrollPosition={scrollPosition} pagerRef={pagerRef} />
      </View>
    </PagerNavigationContext.Provider>
  )
}

const styles = StyleSheet.create({
  pageContainer: {
    flex: 1,
  },
})
