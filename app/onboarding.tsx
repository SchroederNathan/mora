import { Text } from '@/components/ui/Text'
import { useAuth } from '@/contexts/AuthContext'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'

export default function OnboardingScreen() {
  const { signInAnonymously } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGetStarted = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await signInAnonymously()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setIsLoading(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 justify-between px-6 py-16 bg-background">
        <View className="flex-1 justify-center items-center">
          <Text className="text-foreground text-5xl font-bold mb-4 text-center">
            Mora
          </Text>
          <Text className="text-muted-foreground text-lg text-center">
            Your AI-powered macro tracking companion
          </Text>
        </View>

        <View className="pb-5">
          {error && (
            <Text className="text-red-500 text-center mb-4">{error}</Text>
          )}
          <Pressable
            onPress={handleGetStarted}
            disabled={isLoading}
            className={`py-4 px-8 rounded-xl items-center justify-center bg-primary ${isLoading ? 'opacity-80' : 'active:opacity-80'}`}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-lg font-semibold">
                Get Started
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </>
  )
}
