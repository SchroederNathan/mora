import { GlassContainer, GlassView } from 'expo-glass-effect'
import { forwardRef, type ReactNode, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Platform, Pressable, TextInput, type TextInputProps, useColorScheme, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import Animated, {
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { StaggeredText } from '@/components/ui/StaggeredText'
import { colors } from '@/constants/colors'
import { ArrowUp, Camera, Mic, ScanBarcode } from 'lucide-react-native'

export type AnimatedInputRef = {
  focus: () => void
  blur: () => void
}

const PLACEHOLDER_PHRASES = [
  'Am I getting enough protein?',
  'How am I doing this week?',
  'I just ate an apple',
  'How is my fiber intake?',
]

const BUTTON_SIZE = 40

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView)

export const MIN_INPUT_HEIGHT = 56
export const MAX_INPUT_HEIGHT = 112

export type AnimatedInputProps = TextInputProps & {
  onSend: (text: string) => void
  hasMessages?: boolean
  /** Keyboard height shared value from useReanimatedKeyboardAnimation */
  keyboardHeight?: SharedValue<number>
  /** Called when input focus changes */
  onFocusChange?: (focused: boolean) => void
  /** Content rendered above the input, anchored to its top edge */
  topContent?: ReactNode
  /** Whether the top content should be visible (controls enter/exit animation) */
  topContentVisible?: boolean
  /** When true, disables the input and shows "Answer above to continue..." placeholder */
  disabled?: boolean
  /** Called when mic button is pressed (no text entered) to enter voice mode */
  onVoicePress?: () => void
}

export const AnimatedInput = forwardRef<AnimatedInputRef, AnimatedInputProps>(function AnimatedInput(
  { onSend, value: valueProp, onChangeText, hasMessages = false, keyboardHeight, onFocusChange, topContent, topContentVisible, disabled, onVoicePress, ...textInputProps },
  ref
) {
  const [value, setValue] = useState('')
  const isControlled = valueProp !== undefined
  const inputValue = isControlled ? String(valueProp) : value

  const textInputRef = useRef<TextInput>(null)

  // Expose focus/blur methods via ref
  useImperativeHandle(ref, () => ({
    focus: () => textInputRef.current?.focus(),
    blur: () => textInputRef.current?.blur(),
  }))
  const insets = useSafeAreaInsets()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  // Show animated placeholder when no text and no previous messages
  const showAnimatedPlaceholder = !inputValue.trim() && !hasMessages

  // Tint colors for glass effect
  const containerTint = isDark ? '#27272a' : '#f4f4f5'
  const buttonTint = isDark ? colors.dark.primary : '#2563eb'

  // Top content animation state
  const topContentRef = useRef<ReactNode>(null)
  const [topContentMounted, setTopContentMounted] = useState(false)
  const topContentTranslateY = useSharedValue(0)
  const topContentOpacity = useSharedValue(1)
  const topContentHeightSV = useSharedValue(0)
  const isEnteringRef = useRef(false)

  // Cache content so it persists during exit animation
  if (topContent) topContentRef.current = topContent

  const shouldBeVisible = topContentVisible ?? !!topContent

  // Shared value that mirrors shouldBeVisible — updated synchronously during render
  // so the UI thread sees the change on the same frame React commits
  const topContentVisibleSV = useSharedValue(shouldBeVisible)
  useEffect(() => {
    topContentVisibleSV.value = shouldBeVisible
  }, [shouldBeVisible, topContentVisibleSV])

  // Mount synchronously during render (enter path)
  if (shouldBeVisible && (topContent || topContentRef.current) && !topContentMounted) {
    isEnteringRef.current = true
    setTopContentMounted(true)
  }

  useEffect(() => {
    if (topContentMounted && isEnteringRef.current) {
      topContentTranslateY.value = 1000 // start off-screen until onLayout measures
      topContentOpacity.value = 1
    }
  }, [topContentMounted, topContentTranslateY, topContentOpacity])

  // Exit animation — runs on UI thread immediately when shared value transitions true → false
  useAnimatedReaction(
    () => topContentVisibleSV.value,
    (current, previous) => {
      if (previous === true && current === false) {
        topContentOpacity.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) })
        topContentTranslateY.value = withTiming(
          topContentHeightSV.value,
          { duration: 350, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) {
              runOnJS(setTopContentMounted)(false)
            }
          }
        )
      }
    }
  )

  // Reset refs when fully unmounted
  useEffect(() => {
    if (!topContentMounted && !shouldBeVisible) {
      topContentRef.current = null
      topContentTranslateY.value = 0
      topContentOpacity.value = 1
    }
  }, [topContentMounted, shouldBeVisible, topContentOpacity, topContentTranslateY])

  const handleTopContentLayout = useCallback((e: any) => {
    const height = e.nativeEvent.layout.height
    topContentHeightSV.value = height
    if (isEnteringRef.current) {
      isEnteringRef.current = false
      // Start from below (translated by card height), spring up to 0
      topContentTranslateY.value = height
      topContentTranslateY.value = withSpring(0)
    }
  }, [topContentHeightSV, topContentTranslateY])

  const rTopContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: topContentTranslateY.value }],
    opacity: topContentOpacity.value,
  }))

  const focusProgress = useSharedValue(0)
  const textProgress = useSharedValue(0)

  // Keyboard-aware positioning style
  const rKeyboardStyle = useAnimatedStyle(() => {
    const kbHeight = keyboardHeight?.value ?? 0
    // When keyboard is up, move input up by keyboard height
    // The negative value from useReanimatedKeyboardAnimation needs to be converted
    const translateY = kbHeight // Already negative when keyboard is open
    return {
      transform: [{ translateY }],
    }
  })

  // Animate button collapse when text changes - using useEffect for proper change detection
  const hasText = inputValue.trim().length > 0
  useEffect(() => {
    textProgress.set(withSpring(hasText ? 1 : 0))
  }, [hasText, textProgress])

  // Animated styles for collapsing buttons - each slides to mic position
  const gap = 8 // matches GlassContainer gap

  // Camera needs to move 2 slots to reach mic position
  const rCameraStyle = useAnimatedStyle(() => {
    const translateX = interpolate(textProgress.value, [0, 1], [0, (BUTTON_SIZE + gap) * 2])
    const opacity = interpolate(textProgress.value, [0, 0.5], [1, 0])
    const scale = interpolate(textProgress.value, [0, 1], [1, 0.8])
    return { transform: [{ translateX }, { scale }] as const, opacity }
  })

  // Barcode needs to move 1 slot to reach mic position
  const rBarcodeStyle = useAnimatedStyle(() => {
    const translateX = interpolate(textProgress.value, [0, 1], [0, BUTTON_SIZE + gap])
    const opacity = interpolate(textProgress.value, [0, 0.5], [1, 0])
    const scale = interpolate(textProgress.value, [0, 1], [1, 0.8])
    return { transform: [{ translateX }, { scale }] as const, opacity }
  })

  const rRootContainerStyle = useAnimatedStyle(() => {
    const kbHeight = keyboardHeight?.value ?? 0
    const isKeyboardOpen = Math.abs(kbHeight) > 10
    // When keyboard is open, use less padding (keyboard provides spacing)
    // When closed, include safe area bottom
    const paddingBottom = isKeyboardOpen ? 12 : insets.bottom + 12
    return { paddingBottom }
  })

  const rInputContainerStyle = useAnimatedStyle(() => {
    const height = interpolate(
      focusProgress.get(),
      [0, 1],
      [MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT]
    )
    return { height }
  })

  const handleSend = () => {
    if (!inputValue.trim()) return
    onSend(inputValue.trim())
    onChangeText?.('')
    if (!isControlled) setValue('')
    textInputRef.current?.blur()

    focusProgress.set(withSpring(0))
  }

  const handleFocus = () => {
    focusProgress.set(withSpring(1))
    onFocusChange?.(true)
  }

  const handleBlur = () => {
    focusProgress.set(withSpring(0))
    onFocusChange?.(false)
  }

  return (
    <Animated.View
      style={[
        { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
        rKeyboardStyle,
        rRootContainerStyle,
      ]}

      className="px-3"
    >
      {topContentMounted && (topContent || topContentRef.current) && (
        <Animated.View
          style={[{ zIndex: -1, paddingHorizontal: 4, overflow: 'hidden' }, rTopContentStyle]}
          onLayout={handleTopContentLayout}
        >
          {topContent || topContentRef.current}
        </Animated.View>
      )}
      <Pressable className='z-10' onPress={() => textInputRef.current?.focus()}>
        <AnimatedGlassView
          style={[
            {
              borderCurve: 'continuous',

              borderRadius: MIN_INPUT_HEIGHT / 2

            },
            rInputContainerStyle,
          ]}

          isInteractive
        >
          <View className="flex-row items-center">
            <TextInput
              ref={textInputRef}
              value={inputValue}
              onChangeText={(text) => {
                onChangeText?.(text)
                if (!isControlled) setValue(text)
              }}
              placeholder={disabled ? 'Answer above to continue...' : showAnimatedPlaceholder ? '' : 'Message...'}
              placeholderTextColor="#71717a"
              selectionColor="#ff6900"
              editable={!disabled}
              className="flex-1 px-5 text-foreground text-base"
              style={{
                minHeight: MIN_INPUT_HEIGHT,
                paddingTop: Platform.OS === 'ios' ? 14 : 16,
                paddingBottom: Platform.OS === 'ios' ? 18 : 16,
                fontFamily: 'Sentient Variable',
                opacity: disabled ? 0.5 : 1,
              }}
              multiline
              onFocus={handleFocus}
              onBlur={handleBlur}
              {...textInputProps}
            />
            {showAnimatedPlaceholder && (
              <View
                pointerEvents="none"
                className="absolute left-5"
                style={{ top: Platform.OS === 'ios' ? 16 : 16 }}
              >
                <StaggeredText
                  phrases={PLACEHOLDER_PHRASES}
                  visible={showAnimatedPlaceholder}
                  intervalMs={3500}
                  className="text-base text-muted font-serif"
                />
              </View>
            )}
          </View>

          <View
            className="absolute bottom-0 left-0 right-0 flex-row items-center justify-end px-2"
            style={{ height: MIN_INPUT_HEIGHT }}
          >
            <GlassContainer spacing={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Camera button */}
              <AnimatedGlassView
                style={[
                  {
                    width: BUTTON_SIZE,
                    height: BUTTON_SIZE,
                    borderRadius: BUTTON_SIZE / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  rCameraStyle,
                ]}
                tintColor={containerTint}
                isInteractive
                onTouchEnd={() => Haptics.selection()}
              >
                <Camera size={18} color={isDark ? colors.dark.foreground : colors.light.foreground} strokeWidth={2.5} />
              </AnimatedGlassView>

              {/* Barcode button */}
              <AnimatedGlassView
                style={[
                  {
                    width: BUTTON_SIZE,
                    height: BUTTON_SIZE,
                    borderRadius: BUTTON_SIZE / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  rBarcodeStyle,
                ]}
                tintColor={containerTint}
                isInteractive
                onTouchEnd={() => Haptics.selection()}
              >
                <ScanBarcode size={18} color={isDark ? colors.dark.foreground : colors.light.foreground} strokeWidth={2.5} />
              </AnimatedGlassView>

              {/* Mic / Send button - stays fixed */}
              <GlassView
                style={{
                  width: BUTTON_SIZE,
                  height: BUTTON_SIZE,
                  borderRadius: BUTTON_SIZE / 2,
                  borderCurve: 'continuous',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                tintColor={buttonTint}
                isInteractive
                onTouchEnd={() => {
                  Haptics.selection()
                  if (hasText) handleSend()
                  else onVoicePress?.()
                }}
              >
                {hasText ? (
                  <ArrowUp size={18} color="white" strokeWidth={3} />
                ) : (
                  <Mic size={18} color="white" strokeWidth={2.5} />
                )}
              </GlassView>
            </GlassContainer>
          </View>
        </AnimatedGlassView>
      </Pressable>

    </Animated.View >
  )
})
