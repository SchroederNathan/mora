import {
  buildAssistantSystemPrompt,
  getAssistantFunctionDeclarations,
} from '@/lib/assistantRuntime'
import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
} from '@google/genai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
const DEFAULT_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
const FALLBACK_LIVE_MODEL =
  process.env.GEMINI_LIVE_FALLBACK_MODEL || 'gemini-2.5-flash-live-preview'
const DEFAULT_LIVE_VOICE = process.env.GEMINI_LIVE_VOICE || 'Aoede'

const liveConfig = {
  responseModalities: [Modality.AUDIO, Modality.TEXT],
  systemInstruction: buildAssistantSystemPrompt({ voiceMode: true }),
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  realtimeInputConfig: {
    activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
  },
  speechConfig: {
    languageCode: 'en-US',
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: DEFAULT_LIVE_VOICE,
      },
    },
  },
  tools: [{ functionDeclarations: getAssistantFunctionDeclarations() }],
} as const

function createClient() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not configured')
  }

  return new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    apiVersion: 'v1alpha',
  })
}

export async function POST() {
  try {
    const ai = createClient()
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        liveConnectConstraints: {
          model: DEFAULT_LIVE_MODEL,
          config: liveConfig,
        },
      },
    })

    return Response.json({
      token: token.name,
      model: DEFAULT_LIVE_MODEL,
      fallbackModel: FALLBACK_LIVE_MODEL,
      config: liveConfig,
      mode: 'realtime-audio',
    })
  } catch (error) {
    console.error('[VOICE SESSION] Failed to create auth token:', error)
    return new Response(
      JSON.stringify({
        error: 'Failed to create voice session',
        model: DEFAULT_LIVE_MODEL,
        fallbackModel: FALLBACK_LIVE_MODEL,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
