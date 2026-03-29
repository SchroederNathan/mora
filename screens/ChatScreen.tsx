import { AnimatedInput, type AnimatedInputRef, ClarificationCard, EmptyStateCarousels, FoodConfirmationCard, type FoodConfirmationEntry, MessageBubble, MIN_INPUT_HEIGHT } from '@/components/chat'
import { ThinkingDropdown } from '@/components/chat/ThinkingDropdown'
import { VoiceOverlay } from '@/components/chat/VoiceOverlay'
import { useRealtimeVoiceChat } from '@/hooks/useRealtimeVoiceChat'
import { useVoiceChat } from '@/hooks/useVoiceChat'
import { generateAPIUrl } from '@/utils'
import { getDailyLog, getUserGoals } from '@/lib/storage'
import { formatDateKey } from '@/types/nutrition'
import { useDailyLogStore, useUserStore } from '@/stores'
import { FoodDetailCallbackRegistryContext, PagerNavigationContext } from '@/contexts/PagerContexts'
import { useChat } from '@ai-sdk/react'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import type { UIMessage } from 'ai'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { fetch as expoFetch } from 'expo/fetch'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Haptics } from 'react-native-nitro-haptics'
import { Keyboard, Pressable, useWindowDimensions, View } from 'react-native'
import { Text } from '@/components/ui/Text'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import type { SharedValue } from 'react-native-reanimated'
import Animated, { LinearTransition, SlideInUp, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AudioGradientOrb } from '@/components/chat/AudioGradientOrb'

const listItemTransition = LinearTransition.springify()

/** Generate a creative meal title from food names */
async function generateMealTitle(foodNames: string[]): Promise<string | null> {
  try {
    const url = generateAPIUrl('/api/meal-title')
    console.log('[MEAL TITLE] Fetching:', url)

    const response = await expoFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foodNames }),
    })

    // Check if response is ok before parsing
    if (!response.ok) {
      console.error('[MEAL TITLE] Response not ok:', response.status, response.statusText)
      return null
    }

    const text = await response.text()
    console.log('[MEAL TITLE] Raw response:', text)

    try {
      const data = JSON.parse(text)
      return data.title || null
    } catch {
      console.error('[MEAL TITLE] Failed to parse JSON:', text)
      return null
    }
  } catch (error) {
    console.error('[MEAL TITLE] Error generating title:', error)
    return null
  }
}

/** Animated spacer that adjusts height based on keyboard */
function KeyboardSpacer({ keyboardHeight, baseHeight }: { keyboardHeight: SharedValue<number>, baseHeight: number }) {
  const animatedStyle = useAnimatedStyle(() => ({
    height: baseHeight + Math.abs(keyboardHeight.value),
  }))
  return <Animated.View style={animatedStyle} />
}

type ToolActivity = {
  toolName: string | null
  toolState: string | null
  foodQuery: string | null
}

type VoiceTransport = 'realtime' | 'legacy'

export default function ChatScreen() {
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null)
  const [toolActivity, setToolActivity] = useState<ToolActivity>({
    toolName: null,
    toolState: null,
    foodQuery: null,
  })
  const [pendingEntries, setPendingEntries] = useState<{
    toolCallId: string
    entry: FoodConfirmationEntry
  }[]>([])
  const [showCard, setShowCard] = useState(false)
  const [mealTitle, setMealTitle] = useState<string | null>(null)
  const [isTitleLoading, setIsTitleLoading] = useState(false)
  const [pendingClarification, setPendingClarification] = useState<{
    toolCallId: string
    question: string
    options?: { label: string; value: string }[]
    allowFreeform?: boolean
    context?: string
  } | null>(null)
  const [clarificationDismissing, setClarificationDismissing] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [lastAssistantText, setLastAssistantText] = useState('')
  const [voiceTransport, setVoiceTransport] = useState<VoiceTransport>('realtime')

  const processedToolCallsRef = useRef<Set<string>>(new Set())
  const voiceModeRef = useRef(false)
  const legacySpeakRef = useRef<(text: string) => Promise<void>>()
  const legacyStartListeningRef = useRef<() => Promise<void>>()
  const pendingClarificationRef = useRef<typeof pendingClarification>(null)
  const addToolOutputRef = useRef<typeof addToolOutput>(null as any)
  const spokenToolCallsRef = useRef<Set<string>>(new Set())
  const voiceModeWhenSentRef = useRef(false)
  const voicePrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const realtimeAssistantMessageIdRef = useRef<string | null>(null)
  const realtimeSubmitToolResponseRef = useRef<(toolCallId: string, output: unknown) => void>()
  const listRef = useRef<FlashListRef<any>>(null)
  const inputRef = useRef<AnimatedInputRef>(null)
  const insets = useSafeAreaInsets()
  const headerHeight = insets.top + 44
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  // Keyboard animation for content padding
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()

  // Pager navigation for swipe-to-dashboard after logging
  const pagerNavigation = useContext(PagerNavigationContext)

  // Register pending entry callbacks for FoodDetailScreen
  const callbackRegistry = useContext(FoodDetailCallbackRegistryContext)

  // Zustand stores - destructure functions for stable references
  const { load: loadDailyLog, addMeal } = useDailyLogStore()
  const { load: loadUserStore } = useUserStore()

  // Load stores on mount
  useEffect(() => {
    loadDailyLog()
    loadUserStore()
  }, [loadDailyLog, loadUserStore])

  const buildAssistantContext = useCallback(() => {
    const today = new Date()
    const todayKey = formatDateKey(today)
    const foodHistory = []

    for (let i = 0; i < 14; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateKey = formatDateKey(d)
      const log = getDailyLog(dateKey)
      if (!log || log.entries.length === 0) continue

      foodHistory.push({
        date: log.date,
        entries: log.entries.map(e => ({
          name: e.snapshot.name,
          quantity: e.quantity,
          meal: e.meal,
          nutrients: e.snapshot.nutrients,
        })),
        totals: log.totals,
      })
    }

    const userGoals = getUserGoals()
    console.log(`[BODY] Sending ${foodHistory.length} days of history, userGoals:`, userGoals)

    return {
      voiceMode: voiceModeRef.current,
      foodHistory,
      userGoals,
      todayDateKey: todayKey,
    }
  }, [])

  const { messages, error, sendMessage, addToolOutput, setMessages } = useChat({
    transport: new DefaultChatTransport({
      fetch: expoFetch as unknown as typeof globalThis.fetch,
      api: generateAPIUrl('/api/chat'),
      body: () => {
        const context = buildAssistantContext()
        console.log('[BODY] Building request body, todayDateKey:', context.todayDateKey)
        return context
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: error => {
      console.error(error, 'ERROR')
      setIsThinking(false)
      setToolActivity({ toolName: null, toolState: null, foodQuery: null })
      // Recover voice mode — restart listening so it doesn't get stuck in processing
      if (voiceModeRef.current) {
        setTimeout(() => {
          if (voiceModeRef.current) {
            legacyStartListeningRef.current?.()
          }
        }, 500)
      }
    },
    onFinish: ({ message }) => {
      // Don't clear isThinking if there's an unanswered ask_user — the user
      // still needs to respond and thinking should persist until then.
      const hasUnansweredAskUser = message.parts?.some(
        (p: any) => p.type === 'tool-ask_user' && p.state !== 'output-available'
      )
      if (!hasUnansweredAskUser) {
        setIsThinking(false)
      }
      // Clear tool activity after a short delay to show completion state
      setTimeout(() => {
        setToolActivity({ toolName: null, toolState: null, foodQuery: null })
      }, 1500)

      // Voice mode: speak the assistant's text response
      // Use voiceModeWhenSentRef so speech still fires even if voice UI
      // was soft-exited (e.g. food confirmation card appeared)
      if (voiceModeWhenSentRef.current && message.parts) {
        voiceModeWhenSentRef.current = false
        const hasAskUser = message.parts.some(
          (p: any) => p.type === 'tool-ask_user' && spokenToolCallsRef.current.has(p.toolCallId)
        )
        if (!hasAskUser) {
          const textParts = message.parts
            .filter((p: any) => p.type === 'text' && p.text?.trim())
            .map((p: any) => p.text.trim())
            .join(' ')
          if (textParts) {
            legacySpeakRef.current?.(textParts)
          } else {
            // No speakable text (tool-only response) — restart listening
            setTimeout(() => {
              if (voiceModeRef.current) {
                legacyStartListeningRef.current?.()
              }
            }, 300)
          }
        }
      }
    },
  })

  const createVoiceMessageId = useCallback(
    (role: 'user' | 'assistant') =>
      `voice-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  )

  const appendVoiceUserMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const messageId = createVoiceMessageId('user')
    setMessages(prev => [...prev, {
      id: messageId,
      role: 'user',
      parts: [{ type: 'text', text: trimmed }],
    }])
  }, [createVoiceMessageId, setMessages])

  const updateRealtimeAssistantMessage = useCallback((
    update: (message: UIMessage) => UIMessage,
  ) => {
    let messageId = realtimeAssistantMessageIdRef.current
    if (!messageId) {
      messageId = createVoiceMessageId('assistant')
      realtimeAssistantMessageIdRef.current = messageId
    }

    setMessages(prev => {
      let found = false
      const next = prev.map(message => {
        if (message.id !== messageId) return message
        found = true
        return update(message)
      })

      if (found) return next

      return [...next, update({
        id: messageId,
        role: 'assistant',
        parts: [],
      } as UIMessage)]
    })

    return messageId
  }, [createVoiceMessageId, setMessages])

  const upsertRealtimeAssistantText = useCallback((
    text: string,
    state: 'streaming' | 'done' = 'streaming',
  ) => {
    const trimmed = text.trim()
    if (!trimmed) return

    updateRealtimeAssistantMessage(message => {
      const parts = [...(message.parts || [])]
      const existingIndex = parts.findIndex(part => part.type === 'text')
      const textPart = { type: 'text', text: trimmed, state } as const

      if (existingIndex === -1) {
        parts.unshift(textPart as any)
      } else {
        parts[existingIndex] = textPart as any
      }

      return { ...message, parts }
    })
    setLastAssistantText(trimmed)
  }, [updateRealtimeAssistantMessage])

  const upsertRealtimeToolPart = useCallback((
    toolName: string,
    toolCallId: string,
    patch: Record<string, unknown>,
  ) => {
    updateRealtimeAssistantMessage(message => {
      const parts = [...(message.parts || [])]
      const partType = `tool-${toolName}`
      const existingIndex = parts.findIndex((part: any) =>
        part.type === partType && part.toolCallId === toolCallId)
      const nextPart = {
        ...(existingIndex >= 0 ? parts[existingIndex] as any : {}),
        type: partType,
        toolCallId,
        ...patch,
      }

      if (existingIndex === -1) {
        parts.push(nextPart)
      } else {
        parts[existingIndex] = nextPart
      }

      return { ...message, parts }
    })
  }, [updateRealtimeAssistantMessage])

  const realtimeVoiceChat = useRealtimeVoiceChat({
    getToolContext: buildAssistantContext,
    onTranscript: (text, isFinal) => {
      if (!isFinal || !text.trim()) return

      appendVoiceUserMessage(text)
      realtimeAssistantMessageIdRef.current = null
      setIsThinking(true)
      setThinkingStartTime(Date.now())
      setLastAssistantText('')

      const clarification = pendingClarificationRef.current
      if (clarification) {
        upsertRealtimeToolPart('ask_user', clarification.toolCallId, {
          state: 'output-available',
          input: {
            question: clarification.question,
            options: clarification.options,
            allowFreeform: clarification.allowFreeform,
            context: clarification.context,
          },
          output: text,
        })
        realtimeSubmitToolResponseRef.current?.(clarification.toolCallId, text)
        setPendingClarification(null)
      } else {
        setToolActivity({ toolName: null, toolState: null, foodQuery: null })
      }
    },
    onAssistantTranscript: (text, isFinal) => {
      if (!text.trim()) return
      upsertRealtimeAssistantText(text, isFinal ? 'done' : 'streaming')
    },
    onAssistantTurnComplete: (text) => {
      if (text.trim()) {
        upsertRealtimeAssistantText(text, 'done')
      }
      setTimeout(() => {
        setToolActivity({ toolName: null, toolState: null, foodQuery: null })
      }, 1500)
      setIsThinking(false)
      realtimeAssistantMessageIdRef.current = null
    },
    onToolCallStart: call => {
      upsertRealtimeToolPart(call.name, call.id, {
        state: 'input-available',
        input: call.input,
      })

      const foodQuery =
        typeof call.input.foodQuery === 'string'
          ? call.input.foodQuery
          : typeof call.input.foodName === 'string'
            ? call.input.foodName
            : typeof call.input.question === 'string'
              ? call.input.question
              : null

      setToolActivity({
        toolName: `tool-${call.name}`,
        toolState: 'input-available',
        foodQuery,
      })
      setIsThinking(true)
    },
    onToolCallResult: (call, output) => {
      upsertRealtimeToolPart(call.name, call.id, {
        state: 'output-available',
        input: call.input,
        output,
      })

      const foodQuery =
        typeof call.input.foodQuery === 'string'
          ? call.input.foodQuery
          : typeof call.input.foodName === 'string'
            ? call.input.foodName
            : typeof call.input.question === 'string'
              ? call.input.question
              : null

      setToolActivity({
        toolName: `tool-${call.name}`,
        toolState: 'output-available',
        foodQuery,
      })
    },
    onToolCallError: (call, error) => {
      upsertRealtimeToolPart(call.name, call.id, {
        state: 'output-error',
        input: call.input,
        errorText: error,
      })
      setToolActivity({
        toolName: `tool-${call.name}`,
        toolState: 'output-error',
        foodQuery: null,
      })
      setIsThinking(false)
    },
    onError: error => {
      console.error('[VOICE LIVE] Error:', error)
    },
    onNeedsFallback: reason => {
      console.warn('[VOICE LIVE] Falling back to legacy voice:', reason)
      void fallbackToLegacyVoice()
    },
  })

  // Legacy voice chat hook
  const legacyVoiceChat = useVoiceChat({
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        // If there's a pending clarification, route the answer to addToolOutput
        const clarification = pendingClarificationRef.current
        if (clarification) {
          setIsThinking(true)
          setThinkingStartTime(Date.now())
          voiceModeWhenSentRef.current = true
          addToolOutputRef.current?.({
            tool: 'ask_user',
            toolCallId: clarification.toolCallId,
            output: text,
          })
          setPendingClarification(null)
        } else {
          setIsThinking(true)
          setThinkingStartTime(Date.now())
          voiceModeWhenSentRef.current = true
          setToolActivity({ toolName: null, toolState: null, foodQuery: null })
          sendMessage({ text })
        }
      }
    },
    onSpeakingStart: (text) => {
      setLastAssistantText(text)
    },
    onSpeakingEnd: () => {
      // Auto-resume listening after TTS finishes
      if (voiceModeRef.current) {
        setTimeout(() => {
          if (voiceModeRef.current) {
            legacyStartListeningRef.current?.()
          }
        }, 300)
      }
    },
  })

  // Keep function refs in sync
  useEffect(() => {
    legacySpeakRef.current = legacyVoiceChat.speak
    legacyStartListeningRef.current = legacyVoiceChat.startListening
    realtimeSubmitToolResponseRef.current = realtimeVoiceChat.submitToolResponse
  }, [
    legacyVoiceChat.speak,
    legacyVoiceChat.startListening,
    realtimeVoiceChat.submitToolResponse,
  ])

  useEffect(() => {
    addToolOutputRef.current = addToolOutput
  }, [addToolOutput])

  const fallbackToLegacyVoice = useCallback(async () => {
    if (!voiceModeRef.current) return

    realtimeVoiceChat.disconnect()
    setVoiceTransport('legacy')
    legacyVoiceChat.setVoiceModeActive(true)
    await legacyVoiceChat.startListening()
  }, [legacyVoiceChat, realtimeVoiceChat])

  useEffect(() => {
    return () => {
      if (voicePrefetchTimerRef.current) {
        clearTimeout(voicePrefetchTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    pendingClarificationRef.current = pendingClarification
  }, [pendingClarification])

  // Keep voiceModeRef in sync
  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  useEffect(() => {
    if (!voiceModeWhenSentRef.current) return
    if (voiceTransport !== 'legacy') return

    const lastUserMessageIndex = messages.findLastIndex(m => m.role === 'user')
    if (lastUserMessageIndex === -1) return

    const assistantMessagesAfterUser = messages
      .slice(lastUserMessageIndex + 1)
      .filter(m => m.role === 'assistant')
    const lastAssistantMessage = assistantMessagesAfterUser[assistantMessagesAfterUser.length - 1]
    if (!lastAssistantMessage?.parts) return

    const textParts = lastAssistantMessage.parts
      .filter((p: any) => p.type === 'text' && p.text?.trim())
      .map((p: any) => p.text.trim())
      .join(' ')

    if (!textParts) return

    if (voicePrefetchTimerRef.current) {
      clearTimeout(voicePrefetchTimerRef.current)
    }

    voicePrefetchTimerRef.current = setTimeout(() => {
      legacyVoiceChat.prefetchSpeech(textParts)
    }, 150)
  }, [legacyVoiceChat, messages, voiceTransport])

  const enterVoiceMode = useCallback(async () => {
    Keyboard.dismiss()
    setVoiceMode(true)
    setIsMuted(false)
    setLastAssistantText('')
    voiceModeRef.current = true
    legacyVoiceChat.setVoiceModeActive(false)
    setVoiceTransport('realtime')

    const connected = await realtimeVoiceChat.connect()
    if (!connected) {
      setVoiceTransport('legacy')
      legacyVoiceChat.setVoiceModeActive(true)
      await legacyVoiceChat.startListening()
    }
  }, [legacyVoiceChat, realtimeVoiceChat])

  const exitVoiceMode = useCallback(() => {
    setVoiceMode(false)
    setIsMuted(false)
    voiceModeRef.current = false
    realtimeVoiceChat.disconnect()
    legacyVoiceChat.setVoiceModeActive(false)
    legacyVoiceChat.stopListening()
    legacyVoiceChat.stopSpeaking()
  }, [legacyVoiceChat, realtimeVoiceChat])

  // Soft exit: close UI and stop listening, but let TTS finish
  const softExitVoiceMode = useCallback(() => {
    setVoiceMode(false)
    setIsMuted(false)
    voiceModeRef.current = false
    if (voiceTransport === 'realtime') {
      realtimeVoiceChat.disconnect()
    } else {
      legacyVoiceChat.setVoiceModeActive(false)
      legacyVoiceChat.stopListening()
    }
  }, [legacyVoiceChat, realtimeVoiceChat, voiceTransport])

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      if (!prev) {
        if (voiceTransport === 'realtime') {
          realtimeVoiceChat.mute()
        } else {
          legacyVoiceChat.stopListening()
        }
      } else {
        if (voiceTransport === 'realtime') {
          realtimeVoiceChat.unmute()
        } else {
          legacyVoiceChat.startListening()
        }
      }
      return !prev
    })
  }, [legacyVoiceChat, realtimeVoiceChat, voiceTransport])

  // Fade out chat content when voice mode is active
  const chatOpacity = useSharedValue(1)
  useEffect(() => {
    chatOpacity.value = withTiming(voiceMode ? 0 : 1, { duration: 250 })
  }, [voiceMode, chatOpacity])
  const chatFadeStyle = useAnimatedStyle(() => ({
    opacity: chatOpacity.value,
  }))

  const handleVoiceInterrupt = useCallback(() => {
    if (voiceTransport === 'realtime') {
      realtimeVoiceChat.interrupt()
      return
    }

    legacyVoiceChat.stopSpeaking()
    setTimeout(() => {
      if (voiceModeRef.current) {
        legacyVoiceChat.startListening()
      }
    }, 200)
  }, [legacyVoiceChat, realtimeVoiceChat, voiceTransport])

  // Watch messages for tool activity and results
  useEffect(() => {
    // Find the last user message index
    const lastUserMessageIndex = messages.findLastIndex(m => m.role === 'user')

    // Only look at assistant messages AFTER the last user message
    const assistantMessagesAfterUser = messages.slice(lastUserMessageIndex + 1).filter(m => m.role === 'assistant')
    const lastAssistantMessage = assistantMessagesAfterUser[assistantMessagesAfterUser.length - 1]

    if (!lastAssistantMessage?.parts) {
      // No assistant message after last user message - clear tool activity
      if (lastUserMessageIndex === messages.length - 1) {
        // Keep isThinking true while waiting — don't clear toolActivity
        // so the indicator persists through auto-send gaps
      }
      return
    }

    // Find the latest tool part in the last assistant message
    let latestToolPart: any = null
    for (const part of lastAssistantMessage.parts) {
      if (part.type.startsWith('tool-')) {
        latestToolPart = part
      }
    }

    // Update tool activity state based on latest tool
    if (latestToolPart) {
      const partAny = latestToolPart as any
      const foodQuery = partAny.input?.foodQuery || partAny.input?.foodName || partAny.input?.question || null
      const newState = partAny.state

      setToolActivity({
        toolName: latestToolPart.type,
        toolState: newState,
        foodQuery,
      })

      // Keep isThinking true while tool is in progress
      if (newState !== 'output-available') {
        setIsThinking(true)
      }
    } else {
      // Assistant message has no tool parts - clear tool activity
      setToolActivity({ toolName: null, toolState: null, foodQuery: null })
    }

    // Process tool results for logging (check all messages to avoid missing any)
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.parts) continue

      for (const part of message.parts) {
        const partAny = part as any
        const toolCallId = partAny.toolCallId
        if (!toolCallId) continue

        // Skip if already processed
        if (processedToolCallsRef.current.has(toolCallId)) continue

        // Handle ask_user BEFORE the output-available guard — this tool has no
        // server-side execute, so it arrives with state 'input-available' and
        // waits for the client to supply a result via addToolOutput.
        if (part.type === 'tool-ask_user') {
          if (partAny.state === 'input-available' && !partAny.output) {
            const input = partAny.input as {
              question: string
              options?: { label: string; value: string }[]
              allowFreeform?: boolean
              context?: string
            }
            console.log('[ASK_USER] Showing clarification card:', input.question)
            const clarificationData = {
              toolCallId,
              question: input.question,
              options: input.options,
              allowFreeform: input.allowFreeform,
              context: input.context,
            }
            setPendingClarification(clarificationData)

            // Voice mode: speak the full assistant text (includes context + question)
            if (voiceModeRef.current && !spokenToolCallsRef.current.has(toolCallId)) {
              spokenToolCallsRef.current.add(toolCallId)
              // Extract ALL text parts from this message for full context
              const textParts = message.parts
                .filter((p: any) => p.type === 'text' && p.text?.trim())
                .map((p: any) => p.text.trim())
                .join(' ')
              const spokenText = textParts || input.question
              setLastAssistantText(spokenText)
              if (voiceTransport === 'legacy') {
                legacySpeakRef.current?.(spokenText)
              }
            }
          } else if (partAny.state === 'output-available') {
            processedToolCallsRef.current.add(toolCallId)
            setPendingClarification(prev =>
              prev?.toolCallId === toolCallId ? null : prev
            )
          }
          continue
        }

        // Only process completed tool calls (tools with server-side execute)
        if (partAny.state !== 'output-available' || !partAny.output) continue

        if (part.type === 'tool-lookup_and_log_food') {
          const result = partAny.output as {
            success?: boolean
            estimated?: boolean
            entry?: {
              name: string
              quantity: number
              serving: { amount: number; unit: string; gramWeight: number }
              nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber?: number; sugar?: number }
              meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
              fdcId?: number
            }
          }

          if (result.success && result.entry) {
            processedToolCallsRef.current.add(toolCallId)

            setShowCard(true)
            setPendingEntries(prev => [...prev, {
              toolCallId,
              entry: {
                name: result.entry.name,
                quantity: result.entry.quantity,
                serving: result.entry.serving,
                nutrients: result.entry.nutrients,
                meal: result.entry.meal,
                fdcId: result.entry.fdcId,
                estimated: result.estimated,
              },
            }])

            console.log('Food ready for confirmation:', result.entry.name, result.entry.nutrients.calories, 'cal')
          }
        } else if (part.type === 'tool-remove_food_entry') {
          const result = partAny.output as { success?: boolean; foodName?: string }

          if (result.success && result.foodName) {
            processedToolCallsRef.current.add(toolCallId)
            const nameToRemove = result.foodName.toLowerCase()

            setPendingEntries(prev => {
              const idx = prev.findIndex(p => p.entry.name.toLowerCase() === nameToRemove)
              if (idx === -1) return prev
              const next = prev.filter((_, i) => i !== idx)
              if (next.length === 0) setShowCard(false)
              return next
            })

            console.log('Food removed from draft:', result.foodName)
          }
        } else if (part.type === 'tool-update_food_servings') {
          const result = partAny.output as { success?: boolean; foodName?: string; newQuantity?: number }

          if (result.success && result.foodName && result.newQuantity != null) {
            processedToolCallsRef.current.add(toolCallId)
            const nameToUpdate = result.foodName.toLowerCase()

            setPendingEntries(prev => prev.map(p =>
              p.entry.name.toLowerCase() === nameToUpdate
                ? { ...p, entry: { ...p.entry, quantity: result.newQuantity! } }
                : p
            ))

            console.log('Food servings updated:', result.foodName, 'to', result.newQuantity)
          }
        }
      }
    }
  }, [messages, voiceTransport])

  // Base bottom padding: input height + safe area + some margin
  const cardVisible = showCard
  const [cardHeight, setCardHeight] = useState(0)
  const baseBottomPadding = MIN_INPUT_HEIGHT + insets.bottom + 40 + cardHeight

  // Reset card height when card hides
  useEffect(() => {
    if (!cardVisible) setCardHeight(0)
  }, [cardVisible])

  // Scroll to bottom helper - no deps on messages.length for stable reference
  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated })
  }, [])


  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay to ensure content is rendered
      requestAnimationFrame(() => {
        scrollToBottom(true)
      })
    }
  }, [messages.length, scrollToBottom])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    setIsThinking(true)
    setThinkingStartTime(Date.now())
    setToolActivity({ toolName: null, toolState: null, foodQuery: null })
    sendMessage({ text: input })
    // Scroll to bottom after sending
    requestAnimationFrame(() => {
      scrollToBottom(true)
    })
  }, [input, sendMessage, scrollToBottom])

  const handleCarouselSelect = useCallback((text: string) => {
    setIsThinking(true)
    setThinkingStartTime(Date.now())
    setToolActivity({ toolName: null, toolState: null, foodQuery: null })
    sendMessage({ text })
  }, [sendMessage])

  const handleClarificationDismiss = useCallback(() => {
    setClarificationDismissing(true)
  }, [])

  const handleClarificationAnswer = useCallback((answer: string) => {
    if (!pendingClarification) return
    Haptics.selection()
    setIsThinking(true)
    setThinkingStartTime(Date.now())
    if (voiceModeRef.current && voiceTransport === 'realtime') {
      appendVoiceUserMessage(answer)
      upsertRealtimeToolPart('ask_user', pendingClarification.toolCallId, {
        state: 'output-available',
        input: {
          question: pendingClarification.question,
          options: pendingClarification.options,
          allowFreeform: pendingClarification.allowFreeform,
          context: pendingClarification.context,
        },
        output: answer,
      })
      realtimeSubmitToolResponseRef.current?.(pendingClarification.toolCallId, answer)
      realtimeAssistantMessageIdRef.current = null
    } else {
      addToolOutput({
        tool: 'ask_user',
        toolCallId: pendingClarification.toolCallId,
        output: answer,
      })
    }
    setPendingClarification(null)
    setClarificationDismissing(false)
  }, [
    addToolOutput,
    appendVoiceUserMessage,
    pendingClarification,
    upsertRealtimeToolPart,
    voiceTransport,
  ])

  // Helper to get default meal based on time of day
  const getDefaultMeal = (): 'breakfast' | 'lunch' | 'dinner' | 'snack' => {
    const hour = new Date().getHours()
    if (hour < 10) return 'breakfast'
    if (hour < 14) return 'lunch'
    if (hour < 20) return 'dinner'
    return 'snack'
  }

  // Handle confirming and logging all pending food entries
  const handleConfirmLog = useCallback(() => {
    if (pendingEntries.length === 0) return

    // Add all entries as a meal group
    const entries = pendingEntries.map(pending => ({
      quantity: pending.entry.quantity,
      snapshot: {
        name: pending.entry.name,
        serving: pending.entry.serving,
        nutrients: pending.entry.nutrients,
        fdcId: pending.entry.fdcId,
        estimated: pending.entry.estimated,
      },
      meal: pending.entry.meal || getDefaultMeal(),
    } as const))

    const logged = addMeal(entries, mealTitle)
    for (const entry of logged) {
      console.log('Food logged:', entry.snapshot.name, entry.snapshot.nutrients.calories, 'cal')
    }

    setShowCard(false)
    setMealTitle(null)
    setIsTitleLoading(false)
    // Delay clearing entries so card exits with full content visible
    setTimeout(() => setPendingEntries([]), 400)

    // Clear chat messages after successful log
    setMessages([])

    // Dismiss keyboard and swipe to Dashboard
    Keyboard.dismiss()
    pagerNavigation?.navigateToPage(0)
  }, [pendingEntries, addMeal, mealTitle, pagerNavigation, setMessages])

  // Handle removing a specific entry from the pending list
  const handleRemoveEntry = useCallback((index: number) => {
    Haptics.selection()
    setPendingEntries(prev => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) setShowCard(false)
      return next
    })
  }, [])

  // Handle quantity changes from edit mode
  const handleQuantityChange = useCallback((index: number, newQuantity: number) => {
    if (newQuantity < 1) {
      handleRemoveEntry(index)
    } else {
      setPendingEntries(prev => prev.map((p, i) =>
        i === index ? { ...p, entry: { ...p.entry, quantity: newQuantity } } : p
      ))
    }
  }, [handleRemoveEntry])

  // Register callbacks for FoodDetailScreen to update pending entries
  useEffect(() => {
    if (callbackRegistry) {
      callbackRegistry.setCallbacks({
        onPendingEntryUpdate: (index, updates) => {
          handleQuantityChange(index, updates.quantity)
        },
        onPendingEntryRemove: (index) => {
          handleRemoveEntry(index)
        },
      })
    }
    return () => {
      callbackRegistry?.setCallbacks(null)
    }
  }, [callbackRegistry, handleQuantityChange, handleRemoveEntry])

  // Auto-exit voice mode when food confirmation card appears (soft exit — let TTS finish)
  useEffect(() => {
    if (showCard && voiceMode) {
      softExitVoiceMode()
    }
  }, [showCard, voiceMode, softExitVoiceMode])

  // Generate meal title when entries change (2+ items)
  useEffect(() => {
    if (pendingEntries.length >= 2) {
      setIsTitleLoading(true)
      generateMealTitle(pendingEntries.map(e => e.entry.name))
        .then(title => {
          setMealTitle(title)
          setIsTitleLoading(false)
        })
    } else {
      setMealTitle(null)
      setIsTitleLoading(false)
    }
  }, [pendingEntries])

  // Build list data: messages + a thinking sentinel inserted after the last user message.
  // Always insert the sentinel when messages exist — ThinkingDropdown handles its own
  // visibility internally (returns null when not needed). This avoids unmount/remount
  // cycles that would lose accumulated step state.
  type ListItem =
    | { type: 'message'; message: UIMessage }
    | { type: 'thinking' }

  const listData = useMemo<ListItem[]>(() => {
    if (messages.length === 0) {
      return []
    }

    // Find the last user message index
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }

    const items: ListItem[] = []
    for (let i = 0; i < messages.length; i++) {
      items.push({ type: 'message', message: messages[i] })
      if (i === lastUserIdx) {
        items.push({ type: 'thinking' })
      }
    }
    // If no user message found (edge case), append at end
    if (lastUserIdx === -1) {
      items.push({ type: 'thinking' })
    }
    return items
  }, [messages])

  // Footer component with keyboard-aware spacer
  const ListFooter = useMemo(() => (
    <KeyboardSpacer keyboardHeight={keyboardHeight} baseHeight={baseBottomPadding} />
  ), [keyboardHeight, baseBottomPadding])

  // Scroll to bottom when card becomes visible
  useEffect(() => {
    if (cardVisible) {
      requestAnimationFrame(() => {
        scrollToBottom(false)
        setTimeout(() => {
          scrollToBottom(false)
        }, 16)
      })
    }
  }, [cardVisible, scrollToBottom])

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'thinking') {
      return (
        <Animated.View layout={listItemTransition} className="px-4 py-2">
          <ThinkingDropdown
            isThinking={isThinking}
            thinkingStartTime={thinkingStartTime}
            toolName={toolActivity.toolName}
            toolState={toolActivity.toolState}
            foodQuery={toolActivity.foodQuery || undefined}
          />
        </Animated.View>
      )
    }
    return (
      <Animated.View layout={listItemTransition}>
        <MessageBubble message={item.message} />
      </Animated.View>
    )
  }, [isThinking, thinkingStartTime, toolActivity])

  const activeVoiceState =
    voiceTransport === 'realtime' ? realtimeVoiceChat.state : legacyVoiceChat.state
  const activeVoiceTranscript =
    voiceTransport === 'realtime'
      ? realtimeVoiceChat.interimTranscript
      : legacyVoiceChat.interimTranscript
  const activeAnalyserNode =
    voiceTransport === 'realtime'
      ? realtimeVoiceChat.analyserNode
      : legacyVoiceChat.analyserNode

  if (error) return <Text>{error.message}</Text>

  return (
    <View className="flex-1">
      {/* Orb — behind chat when normal, above when voice mode */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: voiceMode ? 50 : 0,
        }}
      >
        <AudioGradientOrb
          voiceMode={voiceMode}
          voiceState={activeVoiceState}
          analyserNode={activeAnalyserNode}
          width={screenWidth}
          height={screenHeight}
        />
      </View>

      {/* Chat content — fades out when voice mode activates */}
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }, chatFadeStyle]} pointerEvents={voiceMode ? 'none' : 'auto'}>
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
          {messages.length === 0 && (
            <Animated.View
              entering={SlideInUp.springify().delay(100)}
              style={{ paddingTop: headerHeight + 8 }}
            >
              <EmptyStateCarousels onSelectItem={handleCarouselSelect} />
            </Animated.View>
          )}
          <FlashList
            ref={listRef}
            data={listData}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
            getItemType={(item: any) => item.type}
            estimatedItemSize={60}
            contentContainerStyle={{
              paddingTop: headerHeight + 8,
            }}
            onContentSizeChange={() => {
              if (messages.length > 0) {
                scrollToBottom(false)
              }
            }}
            ListFooterComponent={ListFooter}
          />
        </Pressable>

        <AnimatedInput
          ref={inputRef}
          value={input}
          onChangeText={setInput}
          onSend={handleSend}
          hasMessages={messages.length > 0}
          keyboardHeight={keyboardHeight}
          disabled={!!pendingClarification}
          topContent={pendingClarification ? (
            <View onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
              <ClarificationCard
                question={pendingClarification.question}
                options={pendingClarification.options}
                allowFreeform={pendingClarification.allowFreeform}
                context={pendingClarification.context}
                onSubmit={handleClarificationAnswer}
                onDismiss={handleClarificationDismiss}
              />
            </View>
          ) : pendingEntries.length > 0 ? (
            <View onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
              <FoodConfirmationCard
                entries={pendingEntries.map(p => p.entry)}
                mealTitle={mealTitle}
                isTitleLoading={isTitleLoading}
                onConfirm={handleConfirmLog}
                onRemove={handleRemoveEntry}
                onQuantityChange={handleQuantityChange}
              />
            </View>
          ) : undefined}
          topContentVisible={(!!pendingClarification && !clarificationDismissing) || cardVisible}
          onVoicePress={enterVoiceMode}
        />
      </Animated.View>

      {/* Voice mode overlay */}
      {voiceMode && (
        <VoiceOverlay
          state={activeVoiceState}
          interimTranscript={activeVoiceTranscript}
          lastAssistantText={lastAssistantText}
          analyserNode={activeAnalyserNode}
          toolName={toolActivity.toolName}
          toolState={toolActivity.toolState}
          foodQuery={toolActivity.foodQuery || undefined}
          isThinking={isThinking}
          isMuted={isMuted}
          onClose={exitVoiceMode}
          onTapInterrupt={handleVoiceInterrupt}
          onToggleMute={toggleMute}
        />
      )}
    </View>
  )
}
