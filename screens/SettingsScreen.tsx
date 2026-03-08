import { MACRO_COLORS, SegmentedMacroBar } from '@/components/SegmentedMacroBar'
import { Text } from '@/components/ui/Text'
import { colors } from '@/constants/colors'
import { useUserStore } from '@/stores'
import { calculateBMR } from '@/stores/userStore'
import { DEFAULT_USER_GOALS, type UserGoals } from '@/types/nutrition'
import { useRouter } from 'expo-router'
import { ChevronLeft, RotateCcw, Zap } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'
import { Haptics } from 'react-native-nitro-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// ── Helper: Section Header ─────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="mb-3 mt-6">
      <Text className="text-foreground text-base font-semibold">{title}</Text>
      {subtitle ? (
        <Text className="text-muted text-xs mt-0.5">{subtitle}</Text>
      ) : null}
    </View>
  )
}

// ── Helper: Card container ─────────────────────────

function Card({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  return (
    <View
      style={{
        backgroundColor: isDark ? colors.dark.card : colors.light.card,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: isDark ? colors.dark.border : colors.light.border,
      }}
    >
      {children}
    </View>
  )
}

// ── Helper: Row separator ──────────────────────────

function Divider({ isDark }: { isDark: boolean }) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        marginLeft: 16,
      }}
    />
  )
}

// ── PillButton ─────────────────────────────────────

function PillButton({
  label,
  isActive,
  onPress,
  isDark,
  small,
}: {
  label: string
  isActive: boolean
  onPress: () => void
  isDark: boolean
  small?: boolean
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impact('light')
        onPress()
      }}
      style={{
        paddingHorizontal: small ? 12 : 14,
        paddingVertical: small ? 6 : 8,
        borderRadius: 20,
        backgroundColor: isActive
          ? isDark ? colors.dark.primary : colors.light.primary
          : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      }}
    >
      <Text
        style={{
          fontSize: small ? 12 : 13,
          fontWeight: '600',
          color: isActive ? '#fff' : isDark ? colors.dark.foreground : colors.light.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

// ── Numeric row with +/- ───────────────────────────

function MacroRow({
  label,
  value,
  unit,
  color,
  isDark,
  onChange,
}: {
  label: string
  value: number
  unit: string
  color: string
  isDark: boolean
  onChange: (val: number) => void
}) {
  const [text, setText] = useState(String(value))

  // Sync when value changes from outside (e.g. "Apply Calculated")
  useEffect(() => {
    setText(String(value))
  }, [value])

  const handleBlur = () => {
    const parsed = parseInt(text, 10)
    if (!isNaN(parsed) && parsed > 0) {
      onChange(parsed)
    } else {
      setText(String(value))
    }
  }

  const adjust = (delta: number) => {
    Haptics.impact('light')
    const next = Math.max(1, value + delta)
    onChange(next)
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      {/* Color dot */}
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 10 }} />
      <Text style={{ color: isDark ? colors.dark.foreground : colors.light.foreground, fontSize: 14, fontWeight: '600', width: 72 }}>
        {label}
      </Text>

      {/* minus */}
      <Pressable
        onPress={() => adjust(-5)}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 18, color: isDark ? colors.dark.foreground : colors.light.foreground, lineHeight: 22 }}>−</Text>
      </Pressable>

      {/* Input */}
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={handleBlur}
        keyboardType="numeric"
        style={{
          width: 60,
          textAlign: 'center',
          fontSize: 18,
          fontWeight: '700',
          color: isDark ? colors.dark.foreground : colors.light.foreground,
          marginHorizontal: 4,
        }}
      />

      {/* plus */}
      <Pressable
        onPress={() => adjust(5)}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 18, color: isDark ? colors.dark.foreground : colors.light.foreground, lineHeight: 22 }}>+</Text>
      </Pressable>

      <Text style={{ marginLeft: 8, color: isDark ? colors.dark.muted : colors.light.mutedForeground, fontSize: 13 }}>
        {unit}
      </Text>
    </View>
  )
}

// ── Number input row (for body stats) ─────────────

function StatInputRow({
  label,
  value,
  placeholder,
  unit,
  isDark,
  onChange,
  trailing,
}: {
  label: string
  value: string
  placeholder: string
  unit?: string
  isDark: boolean
  onChange: (val: string) => void
  trailing?: React.ReactNode
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: isDark ? colors.dark.foreground : colors.light.foreground, fontSize: 14, flex: 1 }}>
        {label}
      </Text>
      {trailing}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 6,
          minWidth: 80,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={isDark ? colors.dark.muted : colors.light.mutedForeground}
          keyboardType="numeric"
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: isDark ? colors.dark.foreground : colors.light.foreground,
            minWidth: 40,
            textAlign: 'right',
          }}
        />
        {unit ? (
          <Text style={{ fontSize: 13, color: isDark ? colors.dark.muted : colors.light.mutedForeground, marginLeft: 4 }}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// ── Main Screen ────────────────────────────────────

type WeightUnit = 'kg' | 'lbs'
type HeightUnit = 'cm' | 'ftin'

export default function SettingsScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const goals = useUserStore(s => s.goals)
  const setGoals = useUserStore(s => s.setGoals)
  const resetGoals = useUserStore(s => s.resetGoals)

  // ── Local unit toggles ──
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm')

  // ── Body stat local strings ──
  const [ageStr, setAgeStr] = useState(goals.age ? String(goals.age) : '')
  const [weightStr, setWeightStr] = useState(() => {
    if (!goals.weightKg) return ''
    return weightUnit === 'kg'
      ? String(Math.round(goals.weightKg))
      : String(Math.round(goals.weightKg * 2.20462))
  })
  const [heightStr, setHeightStr] = useState(() => {
    if (!goals.heightCm) return ''
    return heightUnit === 'cm'
      ? String(Math.round(goals.heightCm))
      : String(Math.round(goals.heightCm / 2.54))
  })
  const [heightFtStr, setHeightFtStr] = useState(() => {
    if (!goals.heightCm) return ''
    const totalIn = goals.heightCm / 2.54
    return String(Math.floor(totalIn / 12))
  })
  const [heightInStr, setHeightInStr] = useState(() => {
    if (!goals.heightCm) return ''
    const totalIn = goals.heightCm / 2.54
    return String(Math.round(totalIn % 12))
  })

  // ── Macro targets (local, so user can override) ──
  const [calories, setCalories] = useState(goals.calories)
  const [protein, setProtein] = useState(goals.protein)
  const [carbs, setCarbs] = useState(goals.carbs)
  const [fat, setFat] = useState(goals.fat)

  // ── Sync macro state when goals change from outside ──
  useEffect(() => {
    setCalories(goals.calories)
    setProtein(goals.protein)
    setCarbs(goals.carbs)
    setFat(goals.fat)
  }, [goals.calories, goals.protein, goals.carbs, goals.fat])

  // ── Computed weight in kg ──
  const computedWeightKg = useMemo(() => {
    const w = parseFloat(weightStr)
    if (isNaN(w) || w <= 0) return undefined
    return weightUnit === 'kg' ? w : w / 2.20462
  }, [weightStr, weightUnit])

  // ── Computed height in cm ──
  const computedHeightCm = useMemo(() => {
    if (heightUnit === 'cm') {
      const h = parseFloat(heightStr)
      return isNaN(h) || h <= 0 ? undefined : h
    }
    const ft = parseInt(heightFtStr, 10)
    const inch = parseInt(heightInStr, 10)
    if (isNaN(ft) && isNaN(inch)) return undefined
    return ((isNaN(ft) ? 0 : ft) * 12 + (isNaN(inch) ? 0 : inch)) * 2.54
  }, [heightUnit, heightStr, heightFtStr, heightInStr])

  // ── BMR computation ──
  const calculatedBMR = useMemo(() => {
    const age = parseInt(ageStr, 10)
    if (isNaN(age) || age < 15 || age > 80) return null
    return calculateBMR({
      ...goals,
      age,
      weightKg: computedWeightKg,
      heightCm: computedHeightCm,
    })
  }, [ageStr, computedWeightKg, computedHeightCm, goals])

  // ── Persist body stats on change ──
  const persistBodyStats = useCallback(() => {
    const age = parseInt(ageStr, 10)
    setGoals({
      age: !isNaN(age) && age >= 15 && age <= 80 ? age : undefined,
      weightKg: computedWeightKg,
      heightCm: computedHeightCm,
    })
  }, [ageStr, computedWeightKg, computedHeightCm, setGoals])

  // ── Apply calculated goals ──
  const handleApplyCalculated = useCallback(() => {
    if (!calculatedBMR) return
    Haptics.impact('light')
    setCalories(calculatedBMR.targetCalories)
    setProtein(calculatedBMR.protein)
    setFat(calculatedBMR.fat)
    setCarbs(calculatedBMR.carbs)
    setGoals({
      calories: calculatedBMR.targetCalories,
      protein: calculatedBMR.protein,
      fat: calculatedBMR.fat,
      carbs: calculatedBMR.carbs,
    })
  }, [calculatedBMR, setGoals])

  // ── Save macro targets ──
  const handleSaveMacros = useCallback(() => {
    Haptics.notification('success')
    setGoals({ calories, protein, fat, carbs })
    router.back()
  }, [calories, protein, fat, carbs, setGoals, router])

  // ── Reset ──
  const handleReset = useCallback(() => {
    Alert.alert(
      'Reset Goals',
      'This will reset all macro goals and body stats to defaults.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Haptics.notification('warning')
            resetGoals()
            setAgeStr('')
            setWeightStr('')
            setHeightStr('')
            setHeightFtStr('')
            setHeightInStr('')
            setCalories(DEFAULT_USER_GOALS.calories)
            setProtein(DEFAULT_USER_GOALS.protein)
            setCarbs(DEFAULT_USER_GOALS.carbs)
            setFat(DEFAULT_USER_GOALS.fat)
          },
        },
      ]
    )
  }, [resetGoals])

  // ── Unit toggle helpers ──
  const handleWeightUnitToggle = (unit: WeightUnit) => {
    if (unit === weightUnit) return
    Haptics.impact('light')
    // Convert displayed value
    const w = parseFloat(weightStr)
    if (!isNaN(w) && w > 0) {
      setWeightStr(
        unit === 'kg'
          ? String(Math.round(w / 2.20462))
          : String(Math.round(w * 2.20462))
      )
    }
    setWeightUnit(unit)
  }

  const handleHeightUnitToggle = (unit: HeightUnit) => {
    if (unit === heightUnit) return
    Haptics.impact('light')
    const h = parseFloat(heightStr)
    if (!isNaN(h) && h > 0) {
      if (unit === 'ftin') {
        const totalIn = h / 2.54
        setHeightFtStr(String(Math.floor(totalIn / 12)))
        setHeightInStr(String(Math.round(totalIn % 12)))
      } else {
        const totalIn = parseInt(heightFtStr, 10) * 12 + parseInt(heightInStr, 10)
        setHeightStr(String(Math.round(totalIn * 2.54)))
      }
    }
    setHeightUnit(unit)
  }

  const bgColor = isDark ? colors.dark.background : colors.light.background
  const primaryColor = isDark ? colors.dark.primary : colors.light.primary

  // Activity level options
  const activityOptions: Array<{ value: UserGoals['activityLevel']; label: string }> = [
    { value: 'sedentary', label: 'Sedentary' },
    { value: 'light', label: 'Light' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'active', label: 'Active' },
    { value: 'very_active', label: 'Very Active' },
  ]

  const activityDescriptions: Record<string, string> = {
    sedentary: 'Desk job, no exercise',
    light: '1–3x/week',
    moderate: '3–5x/week',
    active: '6–7x/week',
    very_active: 'Athlete / physical job',
  }

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
            }}
          >
            <ChevronLeft size={20} color={isDark ? '#fff' : '#000'} />
          </Pressable>
          <Text className="text-foreground text-xl font-semibold font-serif">
            Goals & Settings
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* ─────────────────────────────────────── */}
        {/* SECTION A: Body Stats */}
        {/* ─────────────────────────────────────── */}
        <SectionHeader
          title="Body Stats"
          subtitle="Used to estimate your daily calorie needs"
        />

        <Card isDark={isDark}>
          {/* Age */}
          <StatInputRow
            label="Age"
            value={ageStr}
            placeholder="—"
            unit="yrs"
            isDark={isDark}
            onChange={(v) => {
              setAgeStr(v)
            }}
          />
          <Divider isDark={isDark} />

          {/* Weight */}
          <StatInputRow
            label="Weight"
            value={weightStr}
            placeholder="—"
            unit={weightUnit}
            isDark={isDark}
            onChange={setWeightStr}
            trailing={
              <View style={{ flexDirection: 'row', gap: 4, marginRight: 8 }}>
                {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
                  <PillButton
                    key={u}
                    label={u}
                    isActive={weightUnit === u}
                    onPress={() => handleWeightUnitToggle(u)}
                    isDark={isDark}
                    small
                  />
                ))}
              </View>
            }
          />
          <Divider isDark={isDark} />

          {/* Height */}
          {heightUnit === 'cm' ? (
            <StatInputRow
              label="Height"
              value={heightStr}
              placeholder="—"
              unit="cm"
              isDark={isDark}
              onChange={setHeightStr}
              trailing={
                <View style={{ flexDirection: 'row', gap: 4, marginRight: 8 }}>
                  {(['cm', 'ftin'] as HeightUnit[]).map((u) => (
                    <PillButton
                      key={u}
                      label={u === 'ftin' ? 'ft/in' : u}
                      isActive={heightUnit === u}
                      onPress={() => handleHeightUnitToggle(u)}
                      isDark={isDark}
                      small
                    />
                  ))}
                </View>
              }
            />
          ) : (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: isDark ? colors.dark.foreground : colors.light.foreground, fontSize: 14, flex: 1 }}>
                Height
              </Text>
              <View style={{ flexDirection: 'row', gap: 4, marginRight: 8 }}>
                {(['cm', 'ftin'] as HeightUnit[]).map((u) => (
                  <PillButton
                    key={u}
                    label={u === 'ftin' ? 'ft/in' : u}
                    isActive={heightUnit === u}
                    onPress={() => handleHeightUnitToggle(u)}
                    isDark={isDark}
                    small
                  />
                ))}
              </View>
              {/* ft / in inputs */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <TextInput
                    value={heightFtStr}
                    onChangeText={setHeightFtStr}
                    placeholder="5"
                    placeholderTextColor={isDark ? colors.dark.muted : colors.light.mutedForeground}
                    keyboardType="numeric"
                    style={{
                      fontSize: 15,
                      fontWeight: '600',
                      color: isDark ? colors.dark.foreground : colors.light.foreground,
                      width: 28,
                      textAlign: 'right',
                    }}
                  />
                  <Text style={{ fontSize: 13, color: isDark ? colors.dark.muted : colors.light.mutedForeground, marginLeft: 2 }}>ft</Text>
                </View>
                <View
                  style={{
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <TextInput
                    value={heightInStr}
                    onChangeText={setHeightInStr}
                    placeholder="10"
                    placeholderTextColor={isDark ? colors.dark.muted : colors.light.mutedForeground}
                    keyboardType="numeric"
                    style={{
                      fontSize: 15,
                      fontWeight: '600',
                      color: isDark ? colors.dark.foreground : colors.light.foreground,
                      width: 28,
                      textAlign: 'right',
                    }}
                  />
                  <Text style={{ fontSize: 13, color: isDark ? colors.dark.muted : colors.light.mutedForeground, marginLeft: 2 }}>in</Text>
                </View>
              </View>
            </View>
          )}
          <Divider isDark={isDark} />

          {/* Sex selector */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: isDark ? colors.dark.foreground : colors.light.foreground, fontSize: 14, marginBottom: 8 }}>
              Sex
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['male', 'female'] as const).map((s) => (
                <PillButton
                  key={s}
                  label={s === 'male' ? 'Male' : 'Female'}
                  isActive={goals.sex === s}
                  onPress={() => {
                    persistBodyStats()
                    setGoals({ sex: s })
                  }}
                  isDark={isDark}
                />
              ))}
            </View>
          </View>
        </Card>

        {/* Activity Level */}
        <SectionHeader title="Activity Level" />
        <Card isDark={isDark}>
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {activityOptions.map((opt) => (
                <PillButton
                  key={opt.value}
                  label={opt.label}
                  isActive={goals.activityLevel === opt.value}
                  onPress={() => {
                    persistBodyStats()
                    setGoals({ activityLevel: opt.value })
                  }}
                  isDark={isDark}
                />
              ))}
            </View>
            {goals.activityLevel && (
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: isDark ? colors.dark.muted : colors.light.mutedForeground,
                }}
              >
                {activityDescriptions[goals.activityLevel]}
              </Text>
            )}
          </View>
        </Card>

        {/* Goal selector */}
        <SectionHeader title="Goal" />
        <Card isDark={isDark}>
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([
                { value: 'lose', label: 'Lose Weight' },
                { value: 'maintain', label: 'Maintain' },
                { value: 'gain', label: 'Gain Muscle' },
              ] as const).map((opt) => (
                <PillButton
                  key={opt.value}
                  label={opt.label}
                  isActive={goals.goal === opt.value}
                  onPress={() => {
                    persistBodyStats()
                    setGoals({ goal: opt.value })
                  }}
                  isDark={isDark}
                />
              ))}
            </View>
          </View>
        </Card>

        {/* ─────────────────────────────────────── */}
        {/* SECTION B: Macro Targets */}
        {/* ─────────────────────────────────────── */}
        <SectionHeader
          title="Macro Targets"
          subtitle="Auto-calculated from your stats, or set manually"
        />

        {/* BMR info card */}
        {calculatedBMR && (
          <View
            style={{
              backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : 'rgba(37,99,235,0.08)',
              borderRadius: 14,
              padding: 14,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(59,130,246,0.3)' : 'rgba(37,99,235,0.2)',
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <Zap size={16} color={primaryColor} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: primaryColor, marginBottom: 2 }}>
                Calculated from your stats
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? colors.dark.muted : colors.light.mutedForeground }}>
                BMR: {calculatedBMR.bmr} kcal · TDEE: {calculatedBMR.tdee} kcal · Target: {calculatedBMR.targetCalories} kcal
              </Text>
            </View>
          </View>
        )}

        <Card isDark={isDark}>
          {/* Calories row */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: isDark ? colors.dark.foreground : colors.light.foreground, fontSize: 14, fontWeight: '600' }}>
                Calories
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  onPress={() => { Haptics.impact('light'); setCalories(c => Math.max(500, c - 50)) }}
                  style={{
                    width: 32, height: 32, borderRadius: 16,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 18, color: isDark ? colors.dark.foreground : colors.light.foreground, lineHeight: 22 }}>−</Text>
                </Pressable>
                <TextInput
                  value={String(calories)}
                  onChangeText={(t) => { const n = parseInt(t, 10); if (!isNaN(n) && n > 0) setCalories(n) }}
                  keyboardType="numeric"
                  style={{
                    width: 70, textAlign: 'center', fontSize: 20, fontWeight: '700',
                    color: isDark ? colors.dark.foreground : colors.light.foreground,
                  }}
                />
                <Pressable
                  onPress={() => { Haptics.impact('light'); setCalories(c => c + 50) }}
                  style={{
                    width: 32, height: 32, borderRadius: 16,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 18, color: isDark ? colors.dark.foreground : colors.light.foreground, lineHeight: 22 }}>+</Text>
                </Pressable>
                <Text style={{ marginLeft: 6, color: isDark ? colors.dark.muted : colors.light.mutedForeground, fontSize: 13 }}>kcal</Text>
              </View>
            </View>
          </View>

          <Divider isDark={isDark} />

          {/* Macro bar preview */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <SegmentedMacroBar protein={protein} carbs={carbs} fat={fat} height={12} gap={2} animated />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MACRO_COLORS.protein }} />
                <Text style={{ fontSize: 11, color: isDark ? colors.dark.muted : colors.light.mutedForeground }}>Protein {protein * 4} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MACRO_COLORS.carbs }} />
                <Text style={{ fontSize: 11, color: isDark ? colors.dark.muted : colors.light.mutedForeground }}>Carbs {carbs * 4} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MACRO_COLORS.fat }} />
                <Text style={{ fontSize: 11, color: isDark ? colors.dark.muted : colors.light.mutedForeground }}>Fat {fat * 9} kcal</Text>
              </View>
            </View>
          </View>

          <Divider isDark={isDark} />

          <MacroRow
            label="Protein"
            value={protein}
            unit="g"
            color={MACRO_COLORS.protein}
            isDark={isDark}
            onChange={setProtein}
          />
          <Divider isDark={isDark} />
          <MacroRow
            label="Carbs"
            value={carbs}
            unit="g"
            color={MACRO_COLORS.carbs}
            isDark={isDark}
            onChange={setCarbs}
          />
          <Divider isDark={isDark} />
          <MacroRow
            label="Fat"
            value={fat}
            unit="g"
            color={MACRO_COLORS.fat}
            isDark={isDark}
            onChange={setFat}
          />
        </Card>

        {/* Apply calculated button */}
        {calculatedBMR && (
          <Pressable
            onPress={handleApplyCalculated}
            style={{
              marginTop: 12,
              backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(37,99,235,0.10)',
              borderRadius: 14,
              height: 48,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(59,130,246,0.35)' : 'rgba(37,99,235,0.25)',
            }}
          >
            <Zap size={16} color={primaryColor} />
            <Text style={{ color: primaryColor, fontSize: 15, fontWeight: '600' }}>
              Apply Calculated Goals
            </Text>
          </Pressable>
        )}

        {/* Save button */}
        <Pressable
          onPress={handleSaveMacros}
          style={{
            marginTop: 12,
            backgroundColor: primaryColor,
            borderRadius: 16,
            height: 52,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            Save Goals
          </Text>
        </Pressable>

        {/* ─────────────────────────────────────── */}
        {/* SECTION C: Reset */}
        {/* ─────────────────────────────────────── */}
        <SectionHeader title="Danger Zone" />

        <Pressable
          onPress={handleReset}
          style={{
            backgroundColor: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.08)',
            borderRadius: 14,
            height: 50,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            borderWidth: 1,
            borderColor: isDark ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.2)',
          }}
        >
          <RotateCcw size={16} color="#ef4444" />
          <Text style={{ color: '#ef4444', fontSize: 15, fontWeight: '600' }}>
            Reset to Defaults
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}
