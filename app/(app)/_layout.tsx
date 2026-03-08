import { FoodDetailCallbackContext, type FoodDetailCallbacks } from '@/contexts/FoodDetailCallbackContext'
import { FoodDetailCallbackRegistryContext, ScrollPositionContext } from '@/contexts/PagerContexts'
import { Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import { useSharedValue } from 'react-native-reanimated'

export default function AppLayout() {
  const scrollPosition = useSharedValue(1)
  const [foodDetailCallbacks, setFoodDetailCallbacks] = useState<FoodDetailCallbacks | null>(null)

  const callbackRegistry = useMemo(() => ({
    setCallbacks: setFoodDetailCallbacks,
  }), [])

  return (
    <ScrollPositionContext.Provider value={scrollPosition}>
      <FoodDetailCallbackRegistryContext.Provider value={callbackRegistry}>
        <FoodDetailCallbackContext.Provider value={foodDetailCallbacks}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen
              name="food-detail"
              options={{
                presentation: 'formSheet',
                headerShown: false,
                sheetGrabberVisible: true,
                sheetAllowedDetents: 'fitToContents',
              }}
            />
            <Stack.Screen
              name="food-search"
              options={{
                presentation: 'fullScreenModal',
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="settings"
              options={{
                presentation: 'fullScreenModal',
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
        </FoodDetailCallbackContext.Provider>
      </FoodDetailCallbackRegistryContext.Provider>
    </ScrollPositionContext.Provider>
  )
}
