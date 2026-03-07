import { AnimatedInput, type AnimatedInputRef, ClarificationCard, EmptyStateCarousels, FoodConfirmationCard, type FoodConfirmationEntry, MessageBubble, MIN_INPUT_HEIGHT, ToolActivityIndicator } from '@/components/chat'
import { VoiceOverlay } from '@/components/chat/VoiceOverlay'
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
import Animated, { SlideInUp, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AudioGradientOrb } from '@/components/chat/AudioGradientOrb'

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

export default function ChatScreen() {
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
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
  const prevMessageCountRef = useRef(0)
  const processedToolCallsRef = useRef<Set<string>>(new Set())
  const voiceModeRef = useRef(false)
  const voiceSpeakRef = useRef<(text: string) => Promise<void>>()
  const voiceStartListeningRef = useRef<() => Promise<void>>()
  const pendingClarificationRef = useRef<typeof pendingClarification>(null)
  const addToolOutputRef = useRef<typeof addToolOutput>(null as any)
  const spokenToolCallsRef = useRef<Set<string>>(new Set())
  const voiceModeWhenSentRef = useRef(false)
  const listRef = useRef<FlashListRef<UIMessage>>(null)
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
  const { load: loadDailyLog, addEntry } = useDailyLogStore()
  const { load: loadUserStore } = useUserStore()

  // Load stores on mount
  useEffect(() => {
    loadDailyLog()
    loadUserStore()
  }, [loadDailyLog, loadUserStore])

  const { messages, error, sendMessage, addToolOutput, setMessages } = useChat({
    transport: new DefaultChatTransport({
      fetch: expoFetch as unknown as typeof globalThis.fetch,
      api: generateAPIUrl('/api/chat'),
      body: () => {
        const today = new Date()
        const todayKey = formatDateKey(today)
        console.log('[BODY] Building request body, todayDateKey:', todayKey)
        const foodHistory = []
        for (let i = 0; i < 14; i++) {
          const d = new Date(today)
          d.setDate(d.getDate() - i)
          const dateKey = formatDateKey(d)
          const log = getDailyLog(dateKey)
          if (log && log.entries.length > 0) {
            console.log(`[BODY] Found log for ${dateKey}: ${log.entries.length} entries, totals:`, log.totals)
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
        }
        const goals = getUserGoals()
        console.log(`[BODY] Sending ${foodHistory.length} days of history, userGoals:`, goals)
        return {
          voiceMode: voiceModeRef.current,
          foodHistory,
          userGoals: goals,
          todayDateKey: todayKey,
        }
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
            voiceStartListeningRef.current?.()
          }
        }, 500)
      }
    },
    onFinish: ({ message }) => {
      setIsThinking(false)
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
            setLastAssistantText(textParts)
            voiceSpeakRef.current?.(textParts)
          } else {
            // No speakable text (tool-only response) — restart listening
            setTimeout(() => {
              if (voiceModeRef.current) {
                voiceStartListeningRef.current?.()
              }
            }, 300)
          }
        }
      }
    },
  })

  // Voice chat hook
  const voiceChat = useVoiceChat({
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        // If there's a pending clarification, route the answer to addToolOutput
        const clarification = pendingClarificationRef.current
        if (clarification) {
          setIsThinking(true)
          voiceModeWhenSentRef.current = true
          addToolOutputRef.current?.({
            tool: 'ask_user',
            toolCallId: clarification.toolCallId,
            output: text,
          })
          setPendingClarification(null)
        } else {
          setIsThinking(true)
          voiceModeWhenSentRef.current = true
          setToolActivity({ toolName: null, toolState: null, foodQuery: null })
          sendMessage({ text })
        }
      }
    },
    onSpeakingEnd: () => {
      // Auto-resume listening after TTS finishes
      if (voiceModeRef.current) {
        setTimeout(() => {
          if (voiceModeRef.current) {
            voiceStartListeningRef.current?.()
          }
        }, 300)
      }
    },
  })

  // Keep function refs in sync
  useEffect(() => {
    voiceSpeakRef.current = voiceChat.speak
    voiceStartListeningRef.current = voiceChat.startListening
  }, [voiceChat.speak, voiceChat.startListening])

  useEffect(() => {
    addToolOutputRef.current = addToolOutput
  }, [addToolOutput])

  useEffect(() => {
    pendingClarificationRef.current = pendingClarification
  }, [pendingClarification])

  // Keep voiceModeRef in sync
  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  const enterVoiceMode = useCallback(() => {
    Keyboard.dismiss()
    setVoiceMode(true)
    voiceModeRef.current = true
    voiceChat.setVoiceModeActive(true)
    voiceChat.startListening()
  }, [voiceChat])

  const exitVoiceMode = useCallback(() => {
    setVoiceMode(false)
    setIsMuted(false)
    voiceModeRef.current = false
    voiceChat.setVoiceModeActive(false)
    voiceChat.stopListening()
    voiceChat.stopSpeaking()
  }, [voiceChat])

  // Soft exit: close UI and stop listening, but let TTS finish
  const softExitVoiceMode = useCallback(() => {
    setVoiceMode(false)
    setIsMuted(false)
    voiceModeRef.current = false
    voiceChat.setVoiceModeActive(false)
    voiceChat.stopListening()
  }, [voiceChat])

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      if (!prev) {
        voiceChat.stopListening()
      } else {
        voiceChat.startListening()
      }
      return !prev
    })
  }, [voiceChat])

  // Fade out chat content when voice mode is active
  const chatOpacity = useSharedValue(1)
  useEffect(() => {
    chatOpacity.value = withTiming(voiceMode ? 0 : 1, { duration: 250 })
  }, [voiceMode, chatOpacity])
  const chatFadeStyle = useAnimatedStyle(() => ({
    opacity: chatOpacity.value,
  }))

  const handleVoiceInterrupt = useCallback(() => {
    voiceChat.stopSpeaking()
    // Start listening again after interrupting
    setTimeout(() => {
      if (voiceModeRef.current) {
        voiceChat.startListening()
      }
    }, 200)
  }, [voiceChat])

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
      const foodQuery = partAny.input?.foodQuery || partAny.input?.foodName || null
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
              voiceSpeakRef.current?.(spokenText)
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
  }, [messages])

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


  // Track when assistant responds with actual TEXT content (not just tool activity)
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'assistant' && lastMessage.parts) {
      // Check if there's any text content in the message
      const hasTextContent = lastMessage.parts.some(
        (part: any) => part.type === 'text' && part.text?.trim()
      )
      if (hasTextContent) {
        setIsThinking(false)
        setToolActivity({ toolName: null, toolState: null, foodQuery: null })
      }
    }
    prevMessageCountRef.current = messages.length
  }, [messages])

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
    setToolActivity({ toolName: null, toolState: null, foodQuery: null })
    sendMessage({ text: input })
    // Scroll to bottom after sending
    requestAnimationFrame(() => {
      scrollToBottom(true)
    })
  }, [input, sendMessage, scrollToBottom])

  const handleCarouselSelect = useCallback((text: string) => {
    setIsThinking(true)
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
    addToolOutput({
      tool: 'ask_user',
      toolCallId: pendingClarification.toolCallId,
      output: answer,
    })
    setPendingClarification(null)
    setClarificationDismissing(false)
  }, [pendingClarification, addToolOutput])

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

    // Add all entries to daily log store
    for (const pending of pendingEntries) {
      const entry = addEntry({
        quantity: pending.entry.quantity,
        snapshot: {
          name: pending.entry.name,
          serving: pending.entry.serving,
          nutrients: pending.entry.nutrients,
          fdcId: pending.entry.fdcId,
          estimated: pending.entry.estimated,
        },
        meal: pending.entry.meal || getDefaultMeal(),
      })
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
  }, [pendingEntries, addEntry, pagerNavigation, setMessages])

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

  // Show activity indicator while thinking or tool is active
  const showActivityIndicator = isThinking || toolActivity.toolName !== null

  // Footer component with keyboard-aware spacer
  const ListFooter = useMemo(() => (
    <>
      {/* Tool activity indicator - inline with messages */}
      {showActivityIndicator && (
        <View className="px-4 py-2">
          <ToolActivityIndicator
            isThinking={isThinking}
            toolName={toolActivity.toolName}
            toolState={toolActivity.toolState}
            foodQuery={toolActivity.foodQuery || undefined}
          />
        </View>
      )}

      {/* Spacer that grows with keyboard to keep content above it */}
      <KeyboardSpacer keyboardHeight={keyboardHeight} baseHeight={baseBottomPadding} />
    </>
  ), [showActivityIndicator, toolActivity, keyboardHeight, baseBottomPadding, isThinking])

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

  const renderItem = useCallback(({ item }: { item: UIMessage }) => (
    <MessageBubble message={item} />
  ), [])

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
          voiceState={voiceChat.state}
          analyserNode={voiceChat.analyserNode}
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
            data={messages}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
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
          state={voiceChat.state}
          interimTranscript={voiceChat.interimTranscript}
          lastAssistantText={lastAssistantText}
          analyserNode={voiceChat.analyserNode}
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
