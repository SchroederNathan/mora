import { useCallback, useEffect, useRef, useState } from 'react'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import {
  AudioContext,
  AudioManager,
  type AnalyserNode as AnalyserNodeType,
} from 'react-native-audio-api'
import { generateAPIUrl } from '@/utils'
import { fetch as expoFetch } from 'expo/fetch'
import type { VoiceState } from './voiceTypes'

const RESTART_DELAY_MS = 100
const BUSY_RETRY_DELAY_MS = 300
const AUTO_COMMIT_SILENCE_MS = 1100

type UseVoiceChatOptions = {
  onTranscript?: (text: string, isFinal: boolean) => void
  onSpeakingStart?: (text: string) => void
  onSpeakingEnd?: () => void
  onError?: (error: string) => void
}

export function useVoiceChat({
  onTranscript,
  onSpeakingStart,
  onSpeakingEnd,
  onError,
}: UseVoiceChatOptions = {}) {
  const [state, setState] = useState<VoiceState>('idle')
  const [interimTranscript, setInterimTranscript] = useState('')

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNodeType | null>(null)
  const sourceRef = useRef<any>(null)
  const isStoppingRef = useRef(false)
  const isSpeakingRef = useRef(false)
  const hasPermissionsRef = useRef(false)
  const pendingTranscriptRef = useRef('')
  const lastCommittedTranscriptRef = useRef('')
  const autoCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchedSpeechRef = useRef<{ text: string; audioBuffer: any } | null>(null)
  const prefetchPromiseRef = useRef<Promise<any> | null>(null)
  const prefetchTextRef = useRef('')

  const voiceModeActiveRef = useRef(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable callback refs
  const onTranscriptRef = useRef(onTranscript)
  const onSpeakingStartRef = useRef(onSpeakingStart)
  const onSpeakingEndRef = useRef(onSpeakingEnd)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onSpeakingStartRef.current = onSpeakingStart
    onSpeakingEndRef.current = onSpeakingEnd
    onErrorRef.current = onError
  }, [onTranscript, onSpeakingStart, onSpeakingEnd, onError])

  // Initialize AudioContext lazily
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

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const clearAutoCommitTimer = useCallback(() => {
    if (autoCommitTimerRef.current) {
      clearTimeout(autoCommitTimerRef.current)
      autoCommitTimerRef.current = null
    }
  }, [])

  const clearSpeechPrefetch = useCallback(() => {
    prefetchedSpeechRef.current = null
    prefetchPromiseRef.current = null
    prefetchTextRef.current = ''
  }, [])

  const preparePlaybackSession = useCallback(async () => {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playback',
      iosMode: 'spokenAudio',
      iosOptions: ['defaultToSpeaker'],
    })
    try {
      await AudioManager.setAudioSessionActivity(true)
    } catch (error) {
      // During realtime -> fallback handoff iOS can reject immediate reactivation.
      // Playback often still succeeds once the route settles, so don't fail TTS here.
      console.warn('[VOICE] Audio session activation warning:', error)
    }
  }, [])

  const commitTranscript = useCallback((rawTranscript: string) => {
    const transcript = rawTranscript.trim()
    if (!transcript) return
    if (transcript === lastCommittedTranscriptRef.current) return

    clearAutoCommitTimer()
    clearRestartTimer()
    pendingTranscriptRef.current = ''
    lastCommittedTranscriptRef.current = transcript

    try {
      ExpoSpeechRecognitionModule.abort()
    } catch {}

    console.log('[VOICE] Committing transcript:', transcript)
    setInterimTranscript('')
    setState(prev => (prev === 'listening' ? 'processing' : prev))
    onTranscriptRef.current?.(transcript, true)
  }, [clearAutoCommitTimer, clearRestartTimer])

  const scheduleAutoCommit = useCallback((transcript: string) => {
    clearAutoCommitTimer()
    const trimmed = transcript.trim()
    if (!trimmed) return

    autoCommitTimerRef.current = setTimeout(() => {
      if (!voiceModeActiveRef.current || isSpeakingRef.current) return
      if (state !== 'listening') return
      commitTranscript(trimmed)
    }, AUTO_COMMIT_SILENCE_MS)
  }, [clearAutoCommitTimer, commitTranscript, state])

  const fetchSpeechAudioBuffer = useCallback(async (text: string) => {
    const url = generateAPIUrl('/api/speech')
    console.log('[VOICE] Fetching TTS for:', text.substring(0, 60) + '...')
    const response = await expoFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    console.log('[VOICE] Got audio buffer, size:', arrayBuffer.byteLength)
    const ctx = getAudioContext()

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    console.log('[VOICE] Decoded audio, duration:', audioBuffer.duration, 's')
    return audioBuffer
  }, [getAudioContext])

  const prefetchSpeech = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (prefetchedSpeechRef.current?.text === trimmed) return
    if (prefetchTextRef.current === trimmed) return

    prefetchTextRef.current = trimmed
    prefetchPromiseRef.current = fetchSpeechAudioBuffer(trimmed)
      .then(audioBuffer => {
        if (prefetchTextRef.current === trimmed) {
          prefetchedSpeechRef.current = { text: trimmed, audioBuffer }
        }
        return audioBuffer
      })
      .catch(error => {
        if (prefetchTextRef.current === trimmed) {
          prefetchTextRef.current = ''
          prefetchPromiseRef.current = null
        }
        throw error
      })
  }, [fetchSpeechAudioBuffer])

  // Start/restart the recognizer (internal)
  const startRecognizer = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: 'web_search',
        },
      })
    } catch (error: any) {
      if (error?.message?.includes('busy') || error?.code === 'busy') {
        console.log('[VOICE] Recognizer busy, retrying in', BUSY_RETRY_DELAY_MS, 'ms')
        restartTimerRef.current = setTimeout(() => {
          if (voiceModeActiveRef.current) startRecognizer()
        }, BUSY_RETRY_DELAY_MS)
      } else {
        throw error
      }
    }
  }, [])

  // Set up STT event listeners
  useEffect(() => {
    const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      const transcript = event.results[0]?.transcript || ''
      const isFinal = event.isFinal

      if (isFinal) {
        commitTranscript(transcript)
      } else {
        // Show interim for visual feedback
        pendingTranscriptRef.current = transcript
        lastCommittedTranscriptRef.current = ''
        setInterimTranscript(transcript)
        scheduleAutoCommit(transcript)
      }
    })

    const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event) => {
      if (event.error === 'aborted') {
        return
      }

      if (event.error === 'busy') {
        console.log('[VOICE] Recognizer busy on error event, retrying...')
        restartTimerRef.current = setTimeout(() => {
          if (voiceModeActiveRef.current) {
            setState('listening')
            startRecognizer()
          }
        }, BUSY_RETRY_DELAY_MS)
        return
      }

      if (event.error === 'no-speech' || event.error === 'speech-timeout') {
        const pendingTranscript = pendingTranscriptRef.current.trim()
        if (pendingTranscript) {
          commitTranscript(pendingTranscript)
          return
        }
        if (voiceModeActiveRef.current) {
          restartTimerRef.current = setTimeout(() => {
            if (voiceModeActiveRef.current) {
              startRecognizer()
            }
          }, RESTART_DELAY_MS)
        } else {
          setState('idle')
        }
        return
      }

      console.warn('[VOICE] STT error:', event.error, event.message)
      onErrorRef.current?.(event.message || event.error)
      setState('idle')
    })

    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      if (voiceModeActiveRef.current) {
        setState(prev => {
          if (prev === 'listening' || prev === 'idle') {
            restartTimerRef.current = setTimeout(() => {
              if (voiceModeActiveRef.current) {
                startRecognizer()
              }
            }, RESTART_DELAY_MS)
            return 'listening'
          }
          return prev
        })
      } else {
        setState(prev => prev === 'listening' ? 'idle' : prev)
      }
    })

    return () => {
      resultSub.remove()
      errorSub.remove()
      endSub.remove()
    }
  }, [startRecognizer, clearRestartTimer, commitTranscript, scheduleAutoCommit])

  const startListening = useCallback(async () => {
    try {
      if (!hasPermissionsRef.current) {
        const current = await ExpoSpeechRecognitionModule.getPermissionsAsync()
        if (current.granted) {
          hasPermissionsRef.current = true
        } else {
          const requested = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
          if (!requested.granted) {
            onErrorRef.current?.('Microphone permission denied')
            return
          }
          hasPermissionsRef.current = true
        }
      }

      setInterimTranscript('')
      pendingTranscriptRef.current = ''
      lastCommittedTranscriptRef.current = ''
      clearSpeechPrefetch()
      clearAutoCommitTimer()
      clearRestartTimer()
      setState('listening')

      await startRecognizer()
    } catch (error) {
      console.error('[VOICE] Failed to start listening:', error)
      onErrorRef.current?.('Failed to start speech recognition')
      setState('idle')
    }
  }, [startRecognizer, clearAutoCommitTimer, clearRestartTimer, clearSpeechPrefetch])

  const stopListening = useCallback(() => {
    clearAutoCommitTimer()
    clearRestartTimer()
    clearSpeechPrefetch()
    try {
      ExpoSpeechRecognitionModule.stop()
    } catch (error) {
      console.error('[VOICE] Failed to stop listening:', error)
    }
  }, [clearAutoCommitTimer, clearRestartTimer, clearSpeechPrefetch])

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return

    // Stop recognizer before TTS to avoid picking up playback audio
    clearAutoCommitTimer()
    try { ExpoSpeechRecognitionModule.abort() } catch {}

    // Stop any existing playback before starting new speech
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch {}
      sourceRef.current = null
    }

    // Guard against concurrent speak calls
    if (isSpeakingRef.current) return
    isSpeakingRef.current = true

    try {
      setState('processing')

      let audioBuffer: any
      const trimmed = text.trim()

      if (prefetchedSpeechRef.current?.text === trimmed) {
        console.log('[VOICE] Using prefetched TTS audio')
        audioBuffer = prefetchedSpeechRef.current.audioBuffer
      } else if (prefetchTextRef.current === trimmed && prefetchPromiseRef.current) {
        console.log('[VOICE] Waiting for prefetched TTS audio')
        audioBuffer = await prefetchPromiseRef.current
      } else {
        audioBuffer = await fetchSpeechAudioBuffer(trimmed)
      }

      const ctx = getAudioContext()
      await preparePlaybackSession()
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      clearSpeechPrefetch()

      // Create source and connect through analyser
      const source = await ctx.createBufferSource()
      source.buffer = audioBuffer

      const analyser = analyserRef.current!
      source.connect(analyser)
      analyser.connect(ctx.destination)

      sourceRef.current = source

      setState('speaking')
      onSpeakingStartRef.current?.(trimmed)

      // Start playback
      source.start()
      console.log('[VOICE] Playback started')

      // Wait for playback to finish
      const duration = audioBuffer.duration * 1000 // ms
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          sourceRef.current = null
          resolve()
        }, duration + 100) // small buffer
      })

      if (!isStoppingRef.current) {
        setState('idle')
        onSpeakingEndRef.current?.()
      }
    } catch (error) {
      console.error('[VOICE] TTS error:', error)
      setState('idle')
      onSpeakingEndRef.current?.()
    } finally {
      isSpeakingRef.current = false
    }
  }, [
    clearAutoCommitTimer,
    clearSpeechPrefetch,
    fetchSpeechAudioBuffer,
    getAudioContext,
    preparePlaybackSession,
  ])

  const stopSpeaking = useCallback(() => {
    isStoppingRef.current = true
    try {
      if (sourceRef.current) {
        sourceRef.current.stop()
        sourceRef.current = null
      }
    } catch {
      // Source may already be stopped
    }
    setState('idle')
    onSpeakingEndRef.current?.()
    isStoppingRef.current = false
  }, [])

  const setVoiceModeActive = useCallback((active: boolean) => {
    voiceModeActiveRef.current = active
    if (!active) {
      clearAutoCommitTimer()
      clearRestartTimer()
      clearSpeechPrefetch()
    }
  }, [clearAutoCommitTimer, clearRestartTimer, clearSpeechPrefetch])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAutoCommitTimer()
      clearRestartTimer()
      clearSpeechPrefetch()
      try {
        ExpoSpeechRecognitionModule.abort()
      } catch {}
      if (sourceRef.current) {
        try { sourceRef.current.stop() } catch {}
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close() } catch {}
      }
    }
  }, [clearAutoCommitTimer, clearRestartTimer, clearSpeechPrefetch])

  return {
    state,
    interimTranscript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    prefetchSpeech,
    setVoiceModeActive,
    analyserNode: analyserRef.current,
    setState,
  }
}
