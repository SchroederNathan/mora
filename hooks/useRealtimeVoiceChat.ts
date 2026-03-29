import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetch as expoFetch } from 'expo/fetch'
import { GoogleGenAI } from '@/lib/googleGenAIWeb'
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  type AnalyserNode as AnalyserNodeType,
} from 'react-native-audio-api'
import { Buffer } from 'buffer'
import { generateAPIUrl } from '@/utils'
import type { VoiceState } from './voiceTypes'

const INPUT_SAMPLE_RATE = 16000
const INPUT_BUFFER_LENGTH = 2048
const INPUT_CHANNEL_COUNT = 1
const DEFAULT_OUTPUT_SAMPLE_RATE = 24000
const TRANSCRIPT_STARTUP_TIMEOUT_MS = 1800
const TRANSCRIPT_STALL_TIMEOUT_MS = 2200
const SPEECH_RMS_THRESHOLD = 0.02
const LOUD_FRAME_THRESHOLD = 8

type VoiceToolContext = {
  voiceMode?: boolean
  foodHistory?: unknown[]
  userGoals?: unknown
  todayDateKey?: string
}

type RealtimeFunctionCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

type SessionResponse = {
  token: string
  model: string
  fallbackModel?: string
  config?: Record<string, unknown>
}

type UseRealtimeVoiceChatOptions = {
  getToolContext: () => VoiceToolContext
  onTranscript?: (text: string, isFinal: boolean) => void
  onAssistantTranscript?: (text: string, isFinal: boolean) => void
  onAssistantTurnComplete?: (text: string) => void
  onToolCallStart?: (call: RealtimeFunctionCall) => void
  onToolCallResult?: (call: RealtimeFunctionCall, output: unknown) => void
  onToolCallError?: (call: RealtimeFunctionCall, error: string) => void
  onError?: (error: string) => void
  onNeedsFallback?: (reason: string) => void
}

function parseSampleRateFromMimeType(mimeType?: string) {
  if (!mimeType) return DEFAULT_OUTPUT_SAMPLE_RATE
  const match = mimeType.match(/rate=(\d+)/i)
  return match ? Number(match[1]) : DEFAULT_OUTPUT_SAMPLE_RATE
}

function pcm16ToFloat32(bytes: Uint8Array) {
  const frameCount = Math.floor(bytes.byteLength / 2)
  const output = new Float32Array(frameCount)

  for (let i = 0; i < frameCount; i++) {
    const sample = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16 >> 16
    output[i] = sample / 32768
  }

  return output
}

function float32ToPcm16Buffer(float32: Float32Array) {
  const buffer = new ArrayBuffer(float32.length * 2)
  const view = new DataView(buffer)

  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true)
  }

  return buffer
}

export function useRealtimeVoiceChat({
  getToolContext,
  onTranscript,
  onAssistantTranscript,
  onAssistantTurnComplete,
  onToolCallStart,
  onToolCallResult,
  onToolCallError,
  onError,
  onNeedsFallback,
}: UseRealtimeVoiceChatOptions) {
  const [state, setState] = useState<VoiceState>('idle')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [assistantTranscript, setAssistantTranscript] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isFallback, setIsFallback] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNodeType | null>(null)
  const playbackSourceRef = useRef<any>(null)
  const playbackStartedRef = useRef(false)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const sessionRef = useRef<any>(null)
  const clientRef = useRef<GoogleGenAI | null>(null)
  const isMutedRef = useRef(false)
  const ignoreAssistantAudioRef = useRef(false)
  const deferredToolCallsRef = useRef<Map<string, string>>(new Map())
  const assistantTranscriptRef = useRef('')
  const assistantTextFallbackRef = useRef('')
  const fallbackTriggeredRef = useRef(false)
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loudFrameCountRef = useRef(0)
  const lastTranscriptAtRef = useRef(0)

  const onTranscriptRef = useRef(onTranscript)
  const onAssistantTranscriptRef = useRef(onAssistantTranscript)
  const onAssistantTurnCompleteRef = useRef(onAssistantTurnComplete)
  const onToolCallStartRef = useRef(onToolCallStart)
  const onToolCallResultRef = useRef(onToolCallResult)
  const onToolCallErrorRef = useRef(onToolCallError)
  const onErrorRef = useRef(onError)
  const onNeedsFallbackRef = useRef(onNeedsFallback)
  const getToolContextRef = useRef(getToolContext)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onAssistantTranscriptRef.current = onAssistantTranscript
    onAssistantTurnCompleteRef.current = onAssistantTurnComplete
    onToolCallStartRef.current = onToolCallStart
    onToolCallResultRef.current = onToolCallResult
    onToolCallErrorRef.current = onToolCallError
    onErrorRef.current = onError
    onNeedsFallbackRef.current = onNeedsFallback
    getToolContextRef.current = getToolContext
  }, [
    getToolContext,
    onAssistantTranscript,
    onAssistantTurnComplete,
    onError,
    onNeedsFallback,
    onToolCallError,
    onToolCallResult,
    onToolCallStart,
    onTranscript,
  ])

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
      const analyser = audioContextRef.current.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current = analyser
    }

    return audioContextRef.current
  }, [])

  const clearPlaybackQueue = useCallback(() => {
    if (playbackSourceRef.current) {
      try {
        playbackSourceRef.current.stop()
      } catch {}
      try {
        playbackSourceRef.current.clearBuffers()
      } catch {}
      playbackSourceRef.current = null
    }

    playbackStartedRef.current = false
  }, [])

  const clearStartupTimer = useCallback(() => {
    if (startupTimerRef.current) {
      clearTimeout(startupTimerRef.current)
      startupTimerRef.current = null
    }
  }, [])

  const triggerFallback = useCallback((reason: string) => {
    if (fallbackTriggeredRef.current) return
    fallbackTriggeredRef.current = true
    clearStartupTimer()
    onNeedsFallbackRef.current?.(reason)
  }, [clearStartupTimer])

  const ensurePlaybackSource = useCallback(async () => {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    if (!playbackSourceRef.current) {
      const queueSource = ctx.createBufferQueueSource()
      const analyser = analyserRef.current!
      queueSource.connect(analyser)
      analyser.connect(ctx.destination)
      queueSource.onEnded = () => {
        playbackStartedRef.current = false
        if (isConnected && !ignoreAssistantAudioRef.current) {
          setState('listening')
        }
      }
      playbackSourceRef.current = queueSource
    }

    return playbackSourceRef.current
  }, [getAudioContext, isConnected])

  const enqueueAssistantAudio = useCallback(async (base64: string, mimeType?: string) => {
    if (ignoreAssistantAudioRef.current) {
      return
    }

    const bytes = Buffer.from(base64, 'base64')
    const ctx = getAudioContext()
    const queueSource = await ensurePlaybackSource()

    let audioBuffer: any
    if (mimeType?.includes('audio/pcm')) {
      const sampleRate = parseSampleRateFromMimeType(mimeType)
      const float32 = pcm16ToFloat32(bytes)
      audioBuffer = ctx.createBuffer(1, float32.length, sampleRate)
      audioBuffer.copyToChannel(float32, 0)
    } else {
      audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ))
    }

    queueSource.enqueueBuffer(audioBuffer)
    if (!playbackStartedRef.current) {
      playbackStartedRef.current = true
      setState('speaking')
      queueSource.start()
    }
  }, [ensurePlaybackSource, getAudioContext])

  const executeToolCall = useCallback(async (call: RealtimeFunctionCall) => {
    if (call.name === 'ask_user') {
      deferredToolCallsRef.current.set(call.id, call.name)
      return
    }

    try {
      const response = await expoFetch(generateAPIUrl('/api/voice/tool'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: call.name,
          input: call.input,
          ...getToolContextRef.current(),
        }),
      })

      if (!response.ok) {
        throw new Error(`Tool request failed: ${response.status}`)
      }

      const data = await response.json()
      onToolCallResultRef.current?.(call, data.output)
      sessionRef.current?.sendToolResponse({
        functionResponses: [{
          id: call.id,
          name: call.name,
          response: { output: data.output },
        }],
      })
    } catch (error: any) {
      const message = error?.message || 'Tool execution failed'
      onToolCallErrorRef.current?.(call, message)
      sessionRef.current?.sendToolResponse({
        functionResponses: [{
          id: call.id,
          name: call.name,
          response: { error: message },
        }],
      })
    }
  }, [])

  const handleServerMessage = useCallback(async (message: any) => {
    if (message.setupComplete) {
      setIsConnected(true)
      setIsFallback(false)
      setState('listening')
      return
    }

    const voiceActivity = message.voiceActivity?.voiceActivityType
    if (voiceActivity === 'ACTIVITY_START') {
      setState('listening')
    } else if (voiceActivity === 'ACTIVITY_END' && !assistantTranscriptRef.current) {
      setState('processing')
    }

    if (message.toolCall?.functionCalls?.length) {
      for (const rawCall of message.toolCall.functionCalls) {
        if (!rawCall?.id || !rawCall?.name) continue
        const call = {
          id: rawCall.id,
          name: rawCall.name,
          input: rawCall.args || {},
        }

        onToolCallStartRef.current?.(call)
        void executeToolCall(call)
      }
    }

    const serverContent = message.serverContent
    if (!serverContent) return

    if (serverContent.interrupted) {
      clearPlaybackQueue()
      setState('listening')
    }

    const inputText = serverContent.inputTranscription?.text?.trim()
    if (inputText) {
      lastTranscriptAtRef.current = Date.now()
      loudFrameCountRef.current = 0
      clearStartupTimer()
      setInterimTranscript(inputText)
      onTranscriptRef.current?.(inputText, !!serverContent.inputTranscription?.finished)

      if (serverContent.inputTranscription?.finished) {
        ignoreAssistantAudioRef.current = false
        setInterimTranscript('')
        setState('processing')
      } else {
        setState('listening')
      }
    }

    const outputText = serverContent.outputTranscription?.text?.trim()
    if (outputText) {
      assistantTranscriptRef.current = outputText
      setAssistantTranscript(outputText)
      onAssistantTranscriptRef.current?.(
        outputText,
        !!serverContent.outputTranscription?.finished,
      )
    }

    const parts = serverContent.modelTurn?.parts || []
    if (parts.length > 0) {
      for (const part of parts) {
        const text = part?.text?.trim()
        if (text && !outputText) {
          assistantTextFallbackRef.current =
            `${assistantTextFallbackRef.current} ${text}`.trim()
          setAssistantTranscript(assistantTextFallbackRef.current)
          onAssistantTranscriptRef.current?.(assistantTextFallbackRef.current, false)
        }

        const inlineData = part?.inlineData
        if (inlineData?.data) {
          await enqueueAssistantAudio(inlineData.data, inlineData.mimeType)
        }
      }
    }

    if (serverContent.turnComplete || serverContent.generationComplete) {
      const finalText =
        assistantTranscriptRef.current || assistantTextFallbackRef.current
      if (finalText) {
        onAssistantTurnCompleteRef.current?.(finalText)
        onAssistantTranscriptRef.current?.(finalText, true)
      }

      if (!playbackStartedRef.current) {
        setState('listening')
      }

      ignoreAssistantAudioRef.current = false
      assistantTranscriptRef.current = ''
      assistantTextFallbackRef.current = ''
    }
  }, [clearPlaybackQueue, clearStartupTimer, enqueueAssistantAudio, executeToolCall])

  const startMicrophone = useCallback(async () => {
    if (isMutedRef.current || !sessionRef.current) {
      return true
    }

    const permission = await AudioManager.checkRecordingPermissions()
    const granted =
      permission === 'Granted'
        ? permission
        : await AudioManager.requestRecordingPermissions()

    if (granted !== 'Granted') {
      throw new Error('Microphone permission denied')
    }

    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP', 'allowBluetoothHFP'],
    })
    await AudioManager.setAudioSessionActivity(true)

    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder()
    }

    const recorder = recorderRef.current
    recorder.clearOnAudioReady()
    recorder.onError(error => {
      console.error('[VOICE LIVE] Recorder error:', error)
      triggerFallback(error.message || 'Realtime microphone failed')
    })
    recorder.onAudioReady({
      sampleRate: INPUT_SAMPLE_RATE,
      bufferLength: INPUT_BUFFER_LENGTH,
      channelCount: INPUT_CHANNEL_COUNT,
    }, ({ buffer }) => {
      if (isMutedRef.current || !sessionRef.current) {
        return
      }

      const float32 = buffer.getChannelData(0)
      const rms = Math.sqrt(
        float32.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(float32.length, 1),
      )
      if (rms > SPEECH_RMS_THRESHOLD) {
        loudFrameCountRef.current += 1
      } else if (loudFrameCountRef.current > 0) {
        loudFrameCountRef.current = Math.max(0, loudFrameCountRef.current - 1)
      }

      if (
        loudFrameCountRef.current >= LOUD_FRAME_THRESHOLD &&
        lastTranscriptAtRef.current > 0 &&
        Date.now() - lastTranscriptAtRef.current > TRANSCRIPT_STALL_TIMEOUT_MS
      ) {
        console.warn('[VOICE LIVE] Speech detected but no transcript received, falling back')
        triggerFallback('Realtime voice stalled while listening')
        return
      }

      const pcmBuffer = float32ToPcm16Buffer(float32)
      sessionRef.current.sendRealtimeInput({
        audio: {
          data: Buffer.from(pcmBuffer).toString('base64'),
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      })
    })

    if (!recorder.isRecording()) {
      const result = recorder.start()
      if (result.status === 'error') {
        throw new Error(result.message || 'Failed to start microphone')
      }
    }

    return true
  }, [triggerFallback])

  const stopMicrophone = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return

    recorder.clearOnAudioReady()
    recorder.onError(() => {})
    if (recorder.isRecording()) {
      try {
        recorder.stop()
      } catch {}
    }
  }, [])

  const connect = useCallback(async () => {
    try {
      setState('connecting')
      setIsFallback(false)
      ignoreAssistantAudioRef.current = false
      fallbackTriggeredRef.current = false
      loudFrameCountRef.current = 0
      lastTranscriptAtRef.current = 0
      clearPlaybackQueue()
      clearStartupTimer()
      setInterimTranscript('')
      setAssistantTranscript('')

      const response = await expoFetch(generateAPIUrl('/api/voice/session'), {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`Voice session failed: ${response.status}`)
      }

      const sessionData = await response.json() as SessionResponse

      clientRef.current = new GoogleGenAI({
        apiKey: sessionData.token,
        apiVersion: 'v1alpha',
      })

      const session = await clientRef.current.live.connect({
        model: sessionData.model,
        config: sessionData.config as any,
        callbacks: {
          onopen: () => {},
          onmessage: (event: any) => {
            void handleServerMessage(event)
          },
          onerror: (event: any) => {
            console.error('[VOICE LIVE] Socket error:', event)
            onErrorRef.current?.('Realtime voice connection failed')
          },
          onclose: () => {
            setIsConnected(false)
            stopMicrophone()
            clearPlaybackQueue()
            setState(prev => (prev === 'fallback' ? prev : 'idle'))
          },
        },
      })

      sessionRef.current = session
      await startMicrophone()
      startupTimerRef.current = setTimeout(() => {
        if (lastTranscriptAtRef.current === 0) {
          console.warn('[VOICE LIVE] No realtime transcription after connect, falling back')
          triggerFallback('Realtime voice did not start transcribing')
        }
      }, TRANSCRIPT_STARTUP_TIMEOUT_MS)
      setIsConnected(true)
      setState('listening')
      return true
    } catch (error: any) {
      console.error('[VOICE LIVE] Failed to connect:', error)
      setIsConnected(false)
      setIsFallback(true)
      setState('fallback')
      onErrorRef.current?.(error?.message || 'Failed to start realtime voice')
      return false
    }
  }, [
    clearPlaybackQueue,
    clearStartupTimer,
    handleServerMessage,
    startMicrophone,
    stopMicrophone,
    triggerFallback,
  ])

  const disconnect = useCallback(() => {
    stopMicrophone()
    ignoreAssistantAudioRef.current = false
    fallbackTriggeredRef.current = false
    loudFrameCountRef.current = 0
    lastTranscriptAtRef.current = 0
    clearStartupTimer()
    clearPlaybackQueue()
    deferredToolCallsRef.current.clear()
    setInterimTranscript('')
    setAssistantTranscript('')
    setIsConnected(false)
    setIsFallback(false)

    if (sessionRef.current) {
      try {
        sessionRef.current.close()
      } catch {}
      sessionRef.current = null
    }

    AudioManager.setAudioSessionOptions({
      iosCategory: 'playback',
      iosMode: 'spokenAudio',
      iosOptions: ['defaultToSpeaker'],
    })
    setState('idle')
  }, [clearPlaybackQueue, clearStartupTimer, stopMicrophone])

  const interrupt = useCallback(() => {
    ignoreAssistantAudioRef.current = true
    clearPlaybackQueue()
    setState('listening')
  }, [clearPlaybackQueue])

  const mute = useCallback(() => {
    isMutedRef.current = true
    stopMicrophone()
    setState('idle')
  }, [stopMicrophone])

  const unmute = useCallback(async () => {
    isMutedRef.current = false
    if (sessionRef.current) {
      await startMicrophone()
      setState('listening')
    }
  }, [startMicrophone])

  const submitToolResponse = useCallback((toolCallId: string, output: unknown) => {
    const toolName = deferredToolCallsRef.current.get(toolCallId)
    if (!toolName || !sessionRef.current) {
      return
    }

    deferredToolCallsRef.current.delete(toolCallId)
    ignoreAssistantAudioRef.current = false
    sessionRef.current.sendToolResponse({
      functionResponses: [{
        id: toolCallId,
        name: toolName,
        response: { output },
      }],
    })
    assistantTranscriptRef.current = ''
    assistantTextFallbackRef.current = ''
    setState('processing')
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close()
        } catch {}
      }
    }
  }, [disconnect])

  return useMemo(() => ({
    state,
    interimTranscript,
    assistantTranscript,
    isConnected,
    isFallback,
    connect,
    disconnect,
    interrupt,
    mute,
    unmute,
    submitToolResponse,
    analyserNode: analyserRef.current,
  }), [
    assistantTranscript,
    connect,
    disconnect,
    interrupt,
    isConnected,
    isFallback,
    interimTranscript,
    mute,
    state,
    submitToolResponse,
    unmute,
  ])
}
