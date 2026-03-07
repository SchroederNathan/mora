import { colors } from '@/constants/colors'
import ChatScreen from '@/screens/ChatScreen'
import HistoryScreen from '@/screens/HistoryScreen'
import HomeScreen from '@/screens/HomeScreen'
import { NavigationContainer, NavigationIndependentTree, useNavigation } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { BlurView } from 'expo-blur'
import { GlassView } from 'expo-glass-effect'
import { MeshGradientView } from 'expo-mesh-gradient'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { ColorSchemeName, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import PagerView, { PagerViewOnPageScrollEventData } from 'react-native-pager-view'
import Animated, { interpolate, SharedValue, useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'

// Context to share scroll position between PagerContent and header
export const ScrollPositionContext = createContext<SharedValue<number> | null>(null)

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
      isInteractive
      style={[
        {
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
        },
        containerStyle,
      ]}
    >
      <Animated.Text className="text-white text-sm font-medium" style={textStyle}>
        {name}
      </Animated.Text>
    </AnimatedGlassView>
  )
}

function AnimatedHeaderTitle() {
  const scrollPosition = useContext(ScrollPositionContext)
  if (!scrollPosition) return null

  return (
    <View className="flex-row items-center justify-center gap-2">
      {PAGE_NAMES.map((name, index) => (
        <PageIndicator key={name} name={name} pageIndex={index} scrollPosition={scrollPosition} />
      ))}
    </View>
  )
}

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView)

const MAX_BLUR = 10

type BlurredPageProps = {
  pageIndex: number
  scrollPosition: SharedValue<number>
  children: React.ReactNode
  colorScheme: ColorSchemeName
}

function BlurredPage({ pageIndex, scrollPosition, children, colorScheme }: BlurredPageProps) {
  const animatedProps = useAnimatedProps(() => {
    const distance = Math.abs(scrollPosition.value - pageIndex)
    const intensity = Math.min(distance * MAX_BLUR, MAX_BLUR)
    return { intensity }
  })

  return (
    <View className="flex-1 overflow-hidden">
      {children}
      <AnimatedBlurView
        animatedProps={animatedProps}
        style={StyleSheet.absoluteFill}
        tint={colorScheme === 'dark' ? 'dark' : 'light'}
        pointerEvents="none"
      />
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
          '#3b82f6', '#2563eb', '#1e3a8a10',
          '#1e40af70', '#1e3a8a30', '#1e3a8a10',
          'transparent', 'transparent', 'transparent',
        ]}
        points={[
          [0.0, 0.0], [0.5, 0.0], [1.0, 0.0],
          [0.0, 0.5], [0.5, 0.5], [1.0, 0.5],
          [0.0, 1.0], [0.5, 1.0], [1.0, 1.0],
        ]}
      />
    </Animated.View>
  )
}


const AppStack = createNativeStackNavigator()

function PagerContent({ scrollPosition }: { scrollPosition: SharedValue<number> }) {
  const navigation = useNavigation()
  const pagerRef = useRef<PagerView>(null)
  const colorScheme = useColorScheme()
  const lastHapticPosition = useRef<number | null>(null)

  const handlePageSelected = useCallback((e: { nativeEvent: { position: number } }) => {
    const page = e.nativeEvent.position

    navigation.setOptions({
      unstable_headerRightItems: () => {
        if (page === 0) {
          // Home page - calendar and gear
          return [
            {
              type: 'menu',
              label: 'Calendar',
              icon: { type: 'sfSymbol', name: 'calendar' },
              menu: {
                title: 'Calendar',
                items: [
                  { type: 'action', label: 'Today', icon: { type: 'sfSymbol', name: 'sun.max' }, onPress: () => console.log('Today') },
                  { type: 'action', label: 'This Week', icon: { type: 'sfSymbol', name: 'calendar.badge.clock' }, onPress: () => console.log('This Week') },
                ],
              },
            },
            {
              type: 'menu',
              label: 'Settings',
              icon: { type: 'sfSymbol', name: 'gearshape' },
              menu: {
                title: 'Settings',
                items: [
                  { type: 'action', label: 'Goals', icon: { type: 'sfSymbol', name: 'target' }, onPress: () => console.log('Goals') },
                  { type: 'action', label: 'Profile', icon: { type: 'sfSymbol', name: 'person.circle' }, onPress: () => console.log('Profile') },
                ],
              },
            },
          ]
        } else if (page === 1) {
          // Chat page - sparkles and ellipsis
          return [
            {
              type: 'menu',
              label: 'AI',
              icon: { type: 'sfSymbol', name: 'sparkles' },
              menu: {
                title: 'AI Options',
                items: [
                  { type: 'action', label: 'New Chat', icon: { type: 'sfSymbol', name: 'plus.bubble' }, onPress: () => console.log('New Chat') },
                  { type: 'action', label: 'Clear History', icon: { type: 'sfSymbol', name: 'trash' }, onPress: () => console.log('Clear') },
                ],
              },
            },
            {
              type: 'menu',
              label: 'More',
              icon: { type: 'sfSymbol', name: 'ellipsis.circle' },
              menu: {
                title: 'More',
                items: [
                  { type: 'action', label: 'Share', icon: { type: 'sfSymbol', name: 'square.and.arrow.up' }, onPress: () => console.log('Share') },
                  { type: 'action', label: 'Help', icon: { type: 'sfSymbol', name: 'questionmark.circle' }, onPress: () => console.log('Help') },
                ],
              },
            },
          ]
        } else {
          // History page - filter and chart
          return [
            {
              type: 'menu',
              label: 'Filter',
              icon: { type: 'sfSymbol', name: 'line.3.horizontal.decrease.circle' },
              menu: {
                title: 'Filter',
                items: [
                  { type: 'action', label: 'All Time', icon: { type: 'sfSymbol', name: 'infinity' }, onPress: () => console.log('All Time') },
                  { type: 'action', label: 'This Month', icon: { type: 'sfSymbol', name: 'calendar' }, onPress: () => console.log('This Month') },
                ],
              },
            },
            {
              type: 'menu',
              label: 'Stats',
              icon: { type: 'sfSymbol', name: 'chart.bar' },
              menu: {
                title: 'Statistics',
                items: [
                  { type: 'action', label: 'Weekly Report', icon: { type: 'sfSymbol', name: 'doc.text' }, onPress: () => console.log('Weekly') },
                  { type: 'action', label: 'Export Data', icon: { type: 'sfSymbol', name: 'arrow.down.doc' }, onPress: () => console.log('Export') },
                ],
              },
            },
          ]
        }
      },
    })
  }, [navigation])

  // Set initial header for page 1 (Chat) on mount
  useEffect(() => {
    handlePageSelected({ nativeEvent: { position: 1 } })
  }, [handlePageSelected])

  const handlePageScroll = useCallback((e: { nativeEvent: PagerViewOnPageScrollEventData }) => {
    const { position, offset } = e.nativeEvent

    // Calculate effective position (position + offset gives us a continuous value)
    const effectivePosition = position + offset

    // Update shared value for blur animation
    scrollPosition.set(effectivePosition)

    // Round to nearest 0.5 to detect crossing the halfway point
    const roundedHalf = Math.round(effectivePosition * 2) / 2

    // Only trigger haptic when crossing a .5 boundary (halfway between pages)
    if (roundedHalf % 1 === 0.5 && lastHapticPosition.current !== roundedHalf) {
      lastHapticPosition.current = roundedHalf
      Haptics.impact('soft')
    }

    // Reset when we land on a page
    if (offset === 0) {
      lastHapticPosition.current = null
    }
  }, [scrollPosition])

  return (
    <PagerView
      ref={pagerRef}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      initialPage={1}
      onPageScroll={handlePageScroll}
      onPageSelected={handlePageSelected}
    >
      <View key="home" className="flex-1">
        <BlurredPage pageIndex={0} scrollPosition={scrollPosition} colorScheme={colorScheme}>
          <HomeScreen />
        </BlurredPage>
      </View>
      <View key="chat" className="flex-1">
        <BlurredPage pageIndex={1} scrollPosition={scrollPosition} colorScheme={colorScheme}>
          <ChatScreen />
        </BlurredPage>
      </View>
      <View key="history" className="flex-1">
        <BlurredPage pageIndex={2} scrollPosition={scrollPosition} colorScheme={colorScheme}>
          <HistoryScreen />
        </BlurredPage>
      </View>
    </PagerView>
  )
}

export default function PagerScreen() {
  const scrollPosition = useSharedValue(1) // Start at initial page (Chat)
  const colorScheme = useColorScheme()

  return (
    <ScrollPositionContext.Provider value={scrollPosition}>
      <View style={{ flex: 1, backgroundColor: colorScheme === 'dark' ? colors.dark.background : colors.light.background }}>
        <AnimatedMeshBackground scrollPosition={scrollPosition} />
        <NavigationIndependentTree>
          <NavigationContainer>
            <AppStack.Navigator id="app">
              <AppStack.Screen
                name="Main"
                options={{
                  headerTransparent: true,
                  headerLargeStyle: { backgroundColor: 'transparent' },
                  headerShadowVisible: false,        // iOS: hide bottom shadow
                  headerBlurEffect: undefined,
                  headerTitle: () => <AnimatedHeaderTitle />,
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              >
                {() => <PagerContent scrollPosition={scrollPosition} />}
              </AppStack.Screen>
            </AppStack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </View>
    </ScrollPositionContext.Provider>
  )
}

