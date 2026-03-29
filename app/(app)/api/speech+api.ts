import { GoogleGenAI, Modality } from '@google/genai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Aoede'
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'iP95p4xoKVk53GoZ742B'

function pcm16ToWav(pcmData: Buffer, sampleRate: number, channelCount = 1) {
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = pcmData.length
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  pcmData.copy(buffer, 44)

  return buffer
}

function normalizeGeminiAudio(base64Data: string, mimeType: string | undefined) {
  const audioBuffer = Buffer.from(base64Data, 'base64')
  if (mimeType?.startsWith('audio/wav')) {
    return { body: audioBuffer, mimeType: 'audio/wav' }
  }

  const rateMatch = mimeType?.match(/rate=(\d+)/i)
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000
  return {
    body: pcm16ToWav(audioBuffer, sampleRate),
    mimeType: 'audio/wav',
  }
}

async function generateWithGemini(text: string) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! })
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: text,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: TTS_VOICE,
          },
        },
      },
    },
  })

  const candidate: any = response.candidates?.[0]
  const inlineData = candidate?.content?.parts?.find((part: any) => part.inlineData)?.inlineData
  const audioData = inlineData?.data || response.data
  const mimeType = inlineData?.mimeType

  if (!audioData) {
    throw new Error('Gemini TTS response did not include audio data')
  }

  return normalizeGeminiAudio(audioData, mimeType)
}

async function generateWithElevenLabs(text: string) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_22050_32`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    },
  )

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${errorText}`)
  }

  const audioBuffer = await res.arrayBuffer()
  return {
    body: Buffer.from(audioBuffer),
    mimeType: 'audio/mpeg',
  }
}

export async function POST(req: Request) {
  const { text }: { text: string } = await req.json()

  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: 'No text provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!GEMINI_API_KEY && !ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: 'No speech provider API key configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    let normalized: { body: Buffer; mimeType: string }

    if (GEMINI_API_KEY) {
      try {
        normalized = await generateWithGemini(text)
      } catch (error) {
        console.error('[SPEECH] Gemini TTS failed, falling back:', error)
        if (!ELEVENLABS_API_KEY) {
          throw error
        }
        normalized = await generateWithElevenLabs(text)
      }
    } else {
      normalized = await generateWithElevenLabs(text)
    }

    return new Response(normalized.body, {
      headers: {
        'Content-Type': normalized.mimeType,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[SPEECH] TTS error:', error)
    return new Response(JSON.stringify({ error: 'Speech generation failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
