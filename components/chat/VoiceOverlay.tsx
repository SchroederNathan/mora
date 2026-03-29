import { ShimmerText } from './ShimmerText'
import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import type { VoiceState } from '@/hooks/voiceTypes'
import { Mic, MicOff, X } from 'lucide-react-native'
import { Pressable, useColorScheme, View } from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function getProcessingText(
  isThinking: boolean,
  toolName: string | null,
  toolState: string | null,
  foodQuery?: string
): string {
  if (toolState === 'output-available') return 'Finishing up...'
  if (toolName === 'tool-lookup_and_log_food' && foodQuery) return `Looking up ${foodQuery}...`
  if (toolName === 'tool-remove_food_entry' && foodQuery) return `Removing ${foodQuery}...`
  if (toolName === 'tool-update_food_servings' && foodQuery) return `Updating ${foodQuery}...`
  if (toolName) return 'Searching...'
  if (isThinking) return 'Thinking...'
  return 'Processing...'
}

type VoiceOverlayProps = {
  state: VoiceState
  interimTranscript: string
  lastAssistantText: string
  analyserNode: any | null
  toolName: string | null
  toolState: string | null
  foodQuery?: string
  isThinking: boolean
  isMuted: boolean
  onClose: () => void
  onTapInterrupt: () => void
  onToggleMute: () => void
}

export function VoiceOverlay({
  state,
  interimTranscript,
  lastAssistantText,
  toolName,
  toolState,
  foodQuery,
  isThinking,
  isMuted,
  onClose,
  onTapInterrupt,
  onToggleMute,
}: VoiceOverlayProps) {
  const insets = useSafeAreaInsets()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const textColor = isDark ? colors.dark.foreground : colors.light.foreground
  const mutedColor = isDark ? '#a3a3a3' : '#71717a'
  const buttonBg = isDark ? 'rgba(39,39,42,0.8)' : 'rgba(228,228,231,0.8)'

  const MicIcon = isMuted ? MicOff : Mic

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 51,
      }}
      pointerEvents="box-none"
    >
      <Pressable
        style={{ flex: 1 }}
        onPress={() => {
          if (state === 'speaking') {
            Haptics.impact('light')
            onTapInterrupt()
          }
        }}
      >
        {/* Spacer to push content down */}
        <View style={{ flex: 1 }} />

        {/* Text area — lower center, above buttons */}
        <View style={{ paddingHorizontal: 32, alignItems: 'center', minHeight: 80 }}>
          {(state === 'listening' || state === 'idle') && (
            <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center' }}>
              {interimTranscript ? (
                <Text
                  style={{
                    fontSize: 20,
                    color: textColor,
                    textAlign: 'center',
                    fontFamily: 'Sentient Variable',
                  }}
                >
                  {interimTranscript}
                </Text>
              ) : (
                <Text
                  style={{
                    fontSize: 17,
                    color: mutedColor,
                    textAlign: 'center',
                    fontFamily: 'Sentient Variable',
                  }}
                >
                  Listening...
                </Text>
              )}
            </Animated.View>
          )}

          {state === 'connecting' && (
            <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center' }}>
              <ShimmerText
                className="text-base font-medium text-muted"
                highlightColor={isDark ? '#fafafa' : '#71717a'}
              >
                Connecting...
              </ShimmerText>
            </Animated.View>
          )}

          {state === 'processing' && (
            <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center' }}>
              <ShimmerText
                className="text-base font-medium text-muted"
                highlightColor={isDark ? '#fafafa' : '#71717a'}
              >
                {getProcessingText(isThinking, toolName, toolState, foodQuery)}
              </ShimmerText>
            </Animated.View>
          )}

          {state === 'fallback' && (
            <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center' }}>
              <Text
                style={{
                  fontSize: 15,
                  color: mutedColor,
                  textAlign: 'center',
                  fontFamily: 'Sentient Variable',
                }}
              >
                Realtime unavailable. Falling back...
              </Text>
            </Animated.View>
          )}

          {state === 'speaking' && (
            <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center' }}>
              {lastAssistantText ? (
                <Text
                  style={{
                    fontSize: 17,
                    color: textColor,
                    textAlign: 'center',
                    fontFamily: 'Sentient Variable',
                    lineHeight: 24,
                  }}
                  numberOfLines={4}
                >
                  {lastAssistantText}
                </Text>
              ) : null}
              <Text
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: mutedColor,
                  textAlign: 'center',
                }}
              >
                Tap to interrupt
              </Text>
            </Animated.View>
          )}
        </View>

        {/* Bottom buttons — mic mute + close */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 24,
            paddingBottom: insets.bottom + 24,
            paddingTop: 24,
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.selection()
              onToggleMute()
            }}
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: buttonBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MicIcon size={22} color={isMuted ? mutedColor : textColor} strokeWidth={2.5} />
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.selection()
              onClose()
            }}
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: buttonBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={22} color={textColor} strokeWidth={2.5} />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  )
}
