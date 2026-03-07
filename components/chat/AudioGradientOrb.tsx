import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia'
import { useEffect, useRef } from 'react'
import { useColorScheme } from 'react-native'
import { colors } from '@/constants/colors'
import type { VoiceState } from '@/hooks/useVoiceChat'
import {
  useSharedValue,
  useDerivedValue,
  withSpring,
  useFrameCallback,
} from 'react-native-reanimated'

function hexToRGB(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

const effect = Skia.RuntimeEffect.Make(`
uniform float2 resolution;
uniform float time;
uniform float radius;
uniform float amplitude;
uniform float3 color;
uniform float centerY;
uniform float opacity;

half4 main(float2 fragCoord) {
  float2 center = float2(resolution.x * 0.5, resolution.y * centerY);
  float s = min(resolution.x, resolution.y);
  float2 uv = (fragCoord - center) / s;
  float dist = length(uv);
  float angle = atan(uv.y, uv.x);

  float baseR = radius / s;

  // Outer layer — faint, wide
  float r1 = baseR * 1.15;
  float d1 = sin(angle * 3.0 + time * 0.4) * 0.03
           + sin(angle * 5.0 - time * 0.3 + 0.5) * 0.02;
  d1 *= 1.0 + amplitude * 2.0;
  float e1 = smoothstep(r1 + d1, r1 + d1 - r1 * 0.7, dist);

  // Middle layer
  float r2 = baseR * 0.95;
  float d2 = sin(angle * 4.0 + time * 0.5 + 1.0) * 0.025
           + sin(angle * 3.0 - time * 0.25 + 3.1) * 0.015;
  d2 *= 1.0 + amplitude * 2.5;
  float e2 = smoothstep(r2 + d2, r2 + d2 - r2 * 0.6, dist);

  // Inner core — brightest
  float r3 = baseR * 0.78;
  float d3 = sin(angle * 5.0 + time * 0.6 + 3.0) * 0.02
           + sin(angle * 3.0 - time * 0.5 + 1.5) * 0.015;
  d3 *= 1.0 + amplitude * 3.0;
  float e3 = smoothstep(r3 + d3, r3 + d3 - r3 * 0.55, dist);

  // Varying brightness per layer — shades of primary
  float a = e1 * 0.20 + e2 * 0.40 + e3 * 0.65;
  float3 col = color * (e1 * 0.35 + e2 * 0.55 + e3 * 0.75);

  return half4(col * opacity, a * opacity);
}
`)!

type AudioGradientOrbProps = {
  voiceMode: boolean
  voiceState: VoiceState
  analyserNode: any | null
  width: number
  height: number
}

export function AudioGradientOrb({
  voiceMode,
  voiceState,
  analyserNode,
  width,
  height,
}: AudioGradientOrbProps) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const primaryHex = isDark ? colors.dark.primary : colors.light.primary
  const rgb = hexToRGB(primaryHex)

  const timeSV = useSharedValue(0)
  const amplitudeSV = useSharedValue(0)
  const radiusSV = useSharedValue(50)
  const centerYSV = useSharedValue(1.0)
  const opacitySV = useSharedValue(0.5)

  // Continuously increment time on UI thread
  useFrameCallback((info) => {
    if (info.timeSincePreviousFrame) {
      timeSV.value += info.timeSincePreviousFrame / 1000
    }
  })

  // Spring radius & center when voice mode toggles
  useEffect(() => {
    radiusSV.value = withSpring(voiceMode ? 140 : 280)
    centerYSV.value = withSpring(voiceMode ? 0.5 : 1.15)
    opacitySV.value = withSpring(voiceMode ? 1.0 : 0.5)
  }, [voiceMode, radiusSV, centerYSV, opacitySV])

  // Read analyser frequency data on JS thread → update amplitudeSV
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (voiceState !== 'speaking' || !analyserNode) {
      // Smooth decay when not speaking
      const decay = () => {
        if (amplitudeSV.value > 0.001) {
          amplitudeSV.value *= 0.9
          rafRef.current = requestAnimationFrame(decay)
        } else {
          amplitudeSV.value = 0
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(decay)
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    }

    const bufferLength = analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const update = () => {
      analyserNode.getByteFrequencyData(dataArray)

      let sum = 0
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 255
        sum += v * v
      }
      const rms = Math.sqrt(sum / bufferLength)

      // Smooth toward target (70 % previous, 30 % new)
      amplitudeSV.value = amplitudeSV.value * 0.7 + rms * 0.3

      rafRef.current = requestAnimationFrame(update)
    }

    rafRef.current = requestAnimationFrame(update)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [voiceState, analyserNode, amplitudeSV])

  const uniforms = useDerivedValue(() => ({
    resolution: [width, height] as const,
    time: timeSV.value,
    radius: radiusSV.value,
    amplitude: amplitudeSV.value,
    color: rgb as readonly [number, number, number],
    centerY: centerYSV.value,
    opacity: opacitySV.value,
  }))

  return (
    <Canvas style={{ width, height }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  )
}
