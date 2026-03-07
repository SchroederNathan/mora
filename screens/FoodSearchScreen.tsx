import { MACRO_COLORS, SegmentedMacroBar } from '@/components/SegmentedMacroBar'
import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { useDailyLogStore } from '@/stores'
import type { MacroTotals } from '@/types/nutrition'
import { useRouter } from 'expo-router'
import { Beef, Check, ChevronLeft, Droplet, Search, Wheat, X } from 'lucide-react-native'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// ── Open Food Facts types ──────────────────────────

type OFFProduct = {
  code: string
  product_name?: string
  brands?: string
  nutriments?: {
    'energy-kcal_100g'?: number
    proteins_100g?: number
    carbohydrates_100g?: number
    fat_100g?: number
    fiber_100g?: number
    sugars_100g?: number
  }
  serving_quantity?: number
  serving_size?: string
}

type OFFSearchResponse = {
  count: number
  products: OFFProduct[]
}

// ── Helpers ────────────────────────────────────────

function extractMacrosPer100g(product: OFFProduct): MacroTotals {
  const n = product.nutriments ?? {}
  return {
    calories: Math.round(n['energy-kcal_100g'] ?? 0),
    protein: Math.round((n.proteins_100g ?? 0) * 10) / 10,
    carbs: Math.round((n.carbohydrates_100g ?? 0) * 10) / 10,
    fat: Math.round((n.fat_100g ?? 0) * 10) / 10,
    fiber: Math.round((n.fiber_100g ?? 0) * 10) / 10,
    sugar: Math.round((n.sugars_100g ?? 0) * 10) / 10,
  }
}

function scaleMacrosByGrams(per100g: MacroTotals, grams: number): MacroTotals {
  const factor = grams / 100
  return {
    calories: Math.round(per100g.calories * factor),
    protein: Math.round(per100g.protein * factor * 10) / 10,
    carbs: Math.round(per100g.carbs * factor * 10) / 10,
    fat: Math.round(per100g.fat * factor * 10) / 10,
    fiber: per100g.fiber ? Math.round(per100g.fiber * factor * 10) / 10 : undefined,
    sugar: per100g.sugar ? Math.round(per100g.sugar * factor * 10) / 10 : undefined,
  }
}

// ── Preset serving sizes ───────────────────────────

type ServingPreset = { label: string; grams: number }

const DEFAULT_PRESETS: ServingPreset[] = [
  { label: '100g', grams: 100 },
  { label: '150g', grams: 150 },
  { label: '200g', grams: 200 },
  { label: '1 cup', grams: 240 },
  { label: '1 tbsp', grams: 15 },
]

function getPresetsForProduct(product: OFFProduct): ServingPreset[] {
  const presets: ServingPreset[] = []

  // Add product's own serving size if available
  if (product.serving_quantity && product.serving_quantity > 0 && product.serving_size) {
    presets.push({
      label: product.serving_size,
      grams: product.serving_quantity,
    })
  }

  // Add defaults, avoiding duplicates
  for (const preset of DEFAULT_PRESETS) {
    if (!presets.some(p => p.grams === preset.grams)) {
      presets.push(preset)
    }
  }

  return presets
}

// ── Search result card ─────────────────────────────

function SearchResultCard({
  product,
  index,
  onSelect,
}: {
  product: OFFProduct
  index: number
  onSelect: (product: OFFProduct) => void
}) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const macros = useMemo(() => extractMacrosPer100g(product), [product])

  const name = product.product_name || 'Unknown Product'
  const brand = product.brands

  return (
    <Animated.View entering={FadeInDown.duration(250).delay(index * 40)}>
      <Pressable
        onPress={() => {
          Haptics.selection()
          onSelect(product)
        }}
        className="px-4 py-3.5"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        }}
      >
        <View className="flex-row items-start justify-between mb-1.5">
          <View className="flex-1 mr-3">
            <Text className="text-foreground text-base font-medium" numberOfLines={2}>
              {name}
            </Text>
            {brand ? (
              <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>
                {brand}
              </Text>
            ) : null}
          </View>
          <View className="items-end">
            <Text className="text-foreground text-lg font-bold">{macros.calories}</Text>
            <Text className="text-muted text-xs">kcal/100g</Text>
          </View>
        </View>

        <View className="flex-row items-center gap-3 mt-1">
          <View className="flex-row items-center gap-1">
            <Beef size={11} color={MACRO_COLORS.protein} />
            <Text className="text-muted text-xs">{macros.protein}g</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Wheat size={11} color={MACRO_COLORS.carbs} />
            <Text className="text-muted text-xs">{macros.carbs}g</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Droplet size={11} color={MACRO_COLORS.fat} />
            <Text className="text-muted text-xs">{macros.fat}g</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

// ── Serving size picker ────────────────────────────

function ServingPicker({
  product,
  onConfirm,
  onCancel,
}: {
  product: OFFProduct
  onConfirm: (product: OFFProduct, grams: number) => void
  onCancel: () => void
}) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const insets = useSafeAreaInsets()
  const presets = useMemo(() => getPresetsForProduct(product), [product])
  const macrosPer100g = useMemo(() => extractMacrosPer100g(product), [product])
  const [selectedGrams, setSelectedGrams] = useState(presets[0]?.grams ?? 100)
  const [customGrams, setCustomGrams] = useState('')
  const [isCustom, setIsCustom] = useState(false)

  const activeGrams = isCustom ? (parseFloat(customGrams) || 0) : selectedGrams
  const scaled = useMemo(() => scaleMacrosByGrams(macrosPer100g, activeGrams), [macrosPer100g, activeGrams])

  return (
    <Animated.View
      entering={SlideInDown.duration(300).springify()}
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: isDark ? colors.dark.card : colors.light.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: 20,
        paddingTop: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 20,
      }}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-1 mr-3">
          <Text className="text-foreground text-lg font-semibold font-serif" numberOfLines={1}>
            {product.product_name || 'Unknown Product'}
          </Text>
          {product.brands ? (
            <Text className="text-muted text-xs mt-0.5">{product.brands}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          className="w-8 h-8 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10"
        >
          <X size={16} color={isDark ? '#fff' : '#000'} />
        </Pressable>
      </View>

      {/* Serving presets */}
      <Text className="text-muted text-xs uppercase tracking-wider font-bold mb-2">
        Serving Size
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-3">
        {presets.map(preset => {
          const isActive = !isCustom && selectedGrams === preset.grams
          return (
            <Pressable
              key={`${preset.label}-${preset.grams}`}
              onPress={() => {
                Haptics.selection()
                setIsCustom(false)
                setSelectedGrams(preset.grams)
              }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: isActive
                  ? (isDark ? colors.dark.primary : colors.light.primary)
                  : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: isActive ? '#fff' : (isDark ? colors.dark.foreground : colors.light.foreground),
                }}
              >
                {preset.label}
              </Text>
            </Pressable>
          )
        })}
        <Pressable
          onPress={() => {
            Haptics.selection()
            setIsCustom(true)
          }}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: isCustom
              ? (isDark ? colors.dark.primary : colors.light.primary)
              : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '600',
              color: isCustom ? '#fff' : (isDark ? colors.dark.foreground : colors.light.foreground),
            }}
          >
            Custom
          </Text>
        </Pressable>
      </View>

      {/* Custom grams input */}
      {isCustom && (
        <Animated.View entering={FadeIn.duration(200)} className="mb-3">
          <View
            className="flex-row items-center rounded-xl px-3"
            style={{
              height: 44,
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            }}
          >
            <TextInput
              value={customGrams}
              onChangeText={setCustomGrams}
              placeholder="Enter grams"
              placeholderTextColor={isDark ? colors.dark.muted : colors.light.mutedForeground}
              keyboardType="numeric"
              autoFocus
              style={{
                flex: 1,
                fontSize: 16,
                color: isDark ? colors.dark.foreground : colors.light.foreground,
              }}
            />
            <Text className="text-muted text-sm ml-2">g</Text>
          </View>
        </Animated.View>
      )}

      {/* Macro preview */}
      <View className="py-3 mb-3" style={{ borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
        <View className="flex-row items-end gap-1.5 mb-3">
          <Text className="text-foreground text-3xl font-bold font-serif">{scaled.calories}</Text>
          <Text className="text-muted text-sm mb-1">kcal</Text>
        </View>

        <View style={{ marginBottom: 10 }}>
          <SegmentedMacroBar protein={scaled.protein} carbs={scaled.carbs} fat={scaled.fat} height={14} gap={2} />
        </View>

        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center gap-1">
            <Beef size={12} color={MACRO_COLORS.protein} />
            <Text className="text-muted text-xs">{scaled.protein}g</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Wheat size={12} color={MACRO_COLORS.carbs} />
            <Text className="text-muted text-xs">{scaled.carbs}g</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Droplet size={12} color={MACRO_COLORS.fat} />
            <Text className="text-muted text-xs">{scaled.fat}g</Text>
          </View>
        </View>
      </View>

      {/* Confirm button */}
      <Pressable
        onPress={() => {
          if (activeGrams <= 0) return
          Haptics.notification('success')
          onConfirm(product, activeGrams)
        }}
        disabled={activeGrams <= 0}
        style={{
          backgroundColor: activeGrams > 0
            ? (isDark ? colors.dark.primary : colors.light.primary)
            : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
          borderRadius: 16,
          height: 52,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
        }}
      >
        <Check size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
          Add to Log
        </Text>
      </Pressable>
    </Animated.View>
  )
}

// ── Main Screen ────────────────────────────────────

export default function FoodSearchScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const addEntry = useDailyLogStore(s => s.addEntry)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OFFProduct[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<OFFProduct | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchFoods = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim()
    if (trimmed.length < 2) {
      setResults([])
      setHasSearched(false)
      return
    }

    setIsLoading(true)
    setHasSearched(true)

    try {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(trimmed)}&json=1&page_size=20`
      const res = await fetch(url)
      const data = (await res.json()) as OFFSearchResponse

      // Filter out products with no name or no nutrient data
      const filtered = data.products.filter(
        p => p.product_name && p.nutriments && (p.nutriments['energy-kcal_100g'] ?? 0) > 0
      )
      setResults(filtered)
    } catch (error) {
      console.error('[FoodSearch] API error:', error)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchFoods(text), 400)
  }, [searchFoods])

  const handleSelectProduct = useCallback((product: OFFProduct) => {
    Keyboard.dismiss()
    setSelectedProduct(product)
  }, [])

  const handleConfirm = useCallback((product: OFFProduct, grams: number) => {
    const macrosPer100g = extractMacrosPer100g(product)
    const scaled = scaleMacrosByGrams(macrosPer100g, grams)

    addEntry({
      quantity: 1,
      snapshot: {
        name: product.product_name || 'Unknown Product',
        serving: {
          amount: grams,
          unit: 'g',
          gramWeight: grams,
        },
        nutrients: scaled,
        estimated: false,
      },
    })

    router.back()
  }, [addEntry, router])

  const handleCancelPicker = useCallback(() => {
    setSelectedProduct(null)
  }, [])

  const bgColor = isDark ? colors.dark.background : colors.light.background

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
          backgroundColor: bgColor,
        }}
      >
        <View className="flex-row items-center gap-3 mb-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="w-9 h-9 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10"
          >
            <ChevronLeft size={20} color={isDark ? '#fff' : '#000'} />
          </Pressable>
          <Text className="text-foreground text-xl font-semibold font-serif">
            Add Food
          </Text>
        </View>

        {/* Search bar */}
        <View
          className="flex-row items-center rounded-xl px-3"
          style={{
            height: 44,
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          }}
        >
          <Search size={18} color={isDark ? colors.dark.muted : colors.light.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Search foods..."
            placeholderTextColor={isDark ? colors.dark.muted : colors.light.mutedForeground}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => searchFoods(query)}
            style={{
              flex: 1,
              marginLeft: 10,
              fontSize: 16,
              color: isDark ? colors.dark.foreground : colors.light.foreground,
            }}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                setQuery('')
                setResults([])
                setHasSearched(false)
              }}
              hitSlop={8}
            >
              <X size={18} color={isDark ? colors.dark.muted : colors.light.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Results */}
      <View style={{ flex: 1 }}>
        {isLoading && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} className="items-center py-12">
            <ActivityIndicator size="large" color={isDark ? colors.dark.primary : colors.light.primary} />
            <Text className="text-muted text-sm mt-3">Searching foods...</Text>
          </Animated.View>
        )}

        {!isLoading && hasSearched && results.length === 0 && (
          <Animated.View entering={FadeIn.duration(200)} className="items-center py-12 px-6">
            <Text className="text-muted text-base text-center">
              No results found for "{query}"
            </Text>
            <Text className="text-muted text-sm text-center mt-1">
              Try a different search term
            </Text>
          </Animated.View>
        )}

        {!isLoading && !hasSearched && (
          <Animated.View entering={FadeIn.duration(200)} className="items-center py-16 px-6">
            <Search size={40} color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'} />
            <Text className="text-muted text-base text-center mt-4">
              Search for a food to add
            </Text>
            <Text className="text-muted text-sm text-center mt-1">
              Powered by Open Food Facts
            </Text>
          </Animated.View>
        )}

        {!isLoading && results.length > 0 && (
          <FlatList
            data={results}
            keyExtractor={(item) => item.code}
            renderItem={({ item, index }) => (
              <SearchResultCard
                product={item}
                index={index}
                onSelect={handleSelectProduct}
              />
            )}
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: selectedProduct ? 340 : insets.bottom + 20 }}
          />
        )}
      </View>

      {/* Serving size picker overlay */}
      {selectedProduct && (
        <>
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
            }}
          >
            <Pressable style={{ flex: 1 }} onPress={handleCancelPicker} />
          </Animated.View>
          <ServingPicker
            product={selectedProduct}
            onConfirm={handleConfirm}
            onCancel={handleCancelPicker}
          />
        </>
      )}
    </View>
  )
}
