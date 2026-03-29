import {
  type USDAFoodFull,
  type USDASearchResponse,
} from '@/types/nutrition'
import { lookupFoodCache, writeFoodCache } from '@/lib/foodCache'
import { z } from 'zod'

const USDA_API_KEY = process.env.USDA_API_KEY
const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1'
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY

export type AssistantHistoryDay = {
  date: string
  entries: {
    name: string
    quantity: number
    meal?: string
    nutrients: {
      calories: number
      protein: number
      carbs: number
      fat: number
      fiber?: number
      sugar?: number
    }
  }[]
  totals: {
    calories: number
    protein: number
    carbs: number
    fat: number
    fiber?: number
    sugar?: number
  }
}

export type AssistantGoals = {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type AssistantRuntimeContext = {
  voiceMode?: boolean
  foodHistory?: AssistantHistoryDay[]
  userGoals?: AssistantGoals | null
  todayDateKey?: string
}

export const assistantToolSchemas = {
  lookup_and_log_food: z.object({
    foodQuery: z
      .string()
      .describe(
        'The food to search for (e.g., "banana", "grilled chicken breast")',
      ),
    displayName: z
      .string()
      .describe(
        'A friendly, human-readable name for the food (e.g., "Banana", "Grilled Chicken Breast", "Greek Yogurt")',
      ),
    quantity: z.number().default(1).describe('Number of servings (default 1)'),
    meal: z
      .enum(['breakfast', 'lunch', 'dinner', 'snack'])
      .optional()
      .describe('Meal type if mentioned'),
    estimatedCalories: z
      .number()
      .optional()
      .describe('Your estimated calories per serving if USDA lookup fails'),
    estimatedProtein: z
      .number()
      .optional()
      .describe('Your estimated protein (g) per serving if USDA lookup fails'),
    estimatedCarbs: z
      .number()
      .optional()
      .describe('Your estimated carbs (g) per serving if USDA lookup fails'),
    estimatedFat: z
      .number()
      .optional()
      .describe('Your estimated fat (g) per serving if USDA lookup fails'),
    estimatedFiber: z
      .number()
      .optional()
      .describe('Your estimated fiber (g) per serving if USDA lookup fails'),
    estimatedSugar: z
      .number()
      .optional()
      .describe('Your estimated sugar (g) per serving if USDA lookup fails'),
    servingUnit: z
      .string()
      .optional()
      .describe(
        'The serving unit the user specified (e.g., "cup", "oz", "slice", "tbsp"). Extract from user input like "1 cup milk" → "cup".',
      ),
  }),
  remove_food_entry: z.object({
    foodName: z
      .string()
      .describe(
        'The exact display name of the food to remove (e.g., "Banana", "Grilled Chicken Breast")',
      ),
  }),
  update_food_servings: z.object({
    foodName: z
      .string()
      .describe(
        'The exact display name of the food to update (e.g., "Banana", "Grilled Chicken Breast")',
      ),
    newQuantity: z.number().min(1).describe('The new number of servings'),
  }),
  get_food_history: z.object({
    period: z
      .enum(['today', 'yesterday', 'week', 'two_weeks'])
      .describe('Time period to retrieve'),
  }),
  get_user_goals: z.object({}),
  ask_user: z.object({
    question: z.string().describe('The question to ask'),
    options: z
      .array(
        z.object({
          label: z.string().describe('Display text'),
          value: z.string().describe('Value when selected'),
        }),
      )
      .optional()
      .describe('Quick-select options'),
    allowFreeform: z
      .boolean()
      .default(true)
      .describe('Show text input for custom answers'),
    context: z
      .string()
      .optional()
      .describe('Additional context for display'),
  }),
} as const

const assistantToolDescriptions: Record<keyof typeof assistantToolSchemas, string> = {
  lookup_and_log_food:
    'Look up a food in the USDA database and log it. Use this when the user says they ate something. If the food is not found in USDA, provide your best estimate for the macros.',
  remove_food_entry:
    'Remove a food item from the pending draft. Use when the user says "remove the X", "delete X", "take off the X", or "nevermind on the X".',
  update_food_servings:
    'Update the quantity/servings of a food item in the pending draft. Use when the user says "I had 2, not 3", "change to 1 serving", "actually just 1", or any quantity correction.',
  get_food_history:
    "Get the user's food log history. Use when the user asks about what they ate, their intake, progress, or trends.",
  get_user_goals:
    "Get the user's daily nutrition goals/targets. Use when comparing intake to goals or answering questions about targets.",
  ask_user:
    'Ask the user a clarifying question when more information is needed to accurately look up food. Use when food is ambiguous (e.g., "sushi roll", "sandwich", "coffee").',
}

type LookupAndLogFoodInput = z.infer<typeof assistantToolSchemas.lookup_and_log_food>
type RemoveFoodEntryInput = z.infer<typeof assistantToolSchemas.remove_food_entry>
type UpdateFoodServingsInput = z.infer<typeof assistantToolSchemas.update_food_servings>
type GetFoodHistoryInput = z.infer<typeof assistantToolSchemas.get_food_history>

async function searchPerplexityNutrition(foodQuery: string): Promise<{
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  servingDescription?: string
} | null> {
  if (!PERPLEXITY_API_KEY) return null

  try {
    console.log('[PERPLEXITY] Searching for:', foodQuery)
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content:
              'You are a nutrition data lookup tool. Return ONLY valid JSON with no other text. Search for accurate nutrition information for the requested food.',
          },
          {
            role: 'user',
            content: `What are the nutrition facts for one serving of "${foodQuery}"? If this is a restaurant or branded item, use the actual published nutrition data. Return ONLY this JSON format, no other text:\n{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0,"servingDescription":"1 medium"}`,
          },
        ],
        temperature: 0.1,
      }),
    })

    if (!res.ok) {
      console.log('[PERPLEXITY] API error:', res.status)
      return null
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null

    const jsonMatch = content.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      console.log('[PERPLEXITY] Could not parse JSON from:', content)
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])
    const result = {
      calories: Math.round(Number(parsed.calories) || 0),
      protein: Math.round((Number(parsed.protein) || 0) * 10) / 10,
      carbs: Math.round((Number(parsed.carbs) || 0) * 10) / 10,
      fat: Math.round((Number(parsed.fat) || 0) * 10) / 10,
      fiber: Math.round((Number(parsed.fiber) || 0) * 10) / 10,
      sugar: Math.round((Number(parsed.sugar) || 0) * 10) / 10,
      servingDescription: parsed.servingDescription,
    }

    if (result.calories === 0 && result.protein === 0 && result.carbs === 0) {
      console.log('[PERPLEXITY] All zeros, discarding')
      return null
    }

    console.log('[PERPLEXITY] Result:', result)
    return result
  } catch (error) {
    console.error('[PERPLEXITY] Error:', error)
    return null
  }
}

function enhanceQuery(query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ')

  if (/\b(raw|cooked|fried|baked|grilled|roasted|steamed|boiled)\b/i.test(normalized)) {
    return normalized
  }

  const rawFoods =
    /\b(banana|apple|orange|grape|strawberry|blueberry|mango|peach|pear|plum|cherry|avocado|tomato|carrot|celery|cucumber|spinach|lettuce|broccoli|pepper|onion|chicken|beef|pork|salmon|tuna|egg)\b/i

  if (rawFoods.test(normalized)) {
    return `${normalized} raw`
  }

  return normalized
}

async function executeLookupAndLogFood({
  foodQuery,
  displayName,
  quantity = 1,
  meal,
  estimatedCalories,
  estimatedProtein,
  estimatedCarbs,
  estimatedFat,
  estimatedFiber,
  estimatedSugar,
  servingUnit,
}: LookupAndLogFoodInput) {
  console.log('[LOOKUP] Searching for:', foodQuery)

  try {
    const cached = await lookupFoodCache(foodQuery)
    if (cached) {
      console.log(
        '[LOOKUP] Cache hit |',
        displayName,
        cached.calories,
        'cal (source:',
        cached.source + ')',
      )
      return {
        success: true,
        entry: {
          name: displayName,
          quantity,
          serving: {
            amount: 1,
            unit: cached.servingDescription || 'serving',
            gramWeight: cached.servingGramWeight || 100,
          },
          nutrients: {
            calories: cached.calories,
            protein: cached.protein,
            carbs: cached.carbs,
            fat: cached.fat,
            fiber: cached.fiber,
            sugar: cached.sugar,
          },
          meal,
          fdcId: cached.fdcId,
        },
        estimated: cached.source !== 'usda',
        source: cached.source,
        message: `Logged ${quantity} ${displayName} (${cached.source === 'usda' ? '' : cached.source + ': '}${cached.calories} cal)`,
      }
    }
  } catch (cacheErr) {
    console.error('[LOOKUP] Cache lookup error:', cacheErr)
  }

  const hasLLMEstimate = estimatedCalories !== undefined || estimatedProtein !== undefined
  const llmFallback = hasLLMEstimate
    ? {
        calories: Math.round(estimatedCalories ?? 100),
        protein: Math.round((estimatedProtein ?? 5) * 10) / 10,
        carbs: Math.round((estimatedCarbs ?? 15) * 10) / 10,
        fat: Math.round((estimatedFat ?? 3) * 10) / 10,
        fiber: Math.round((estimatedFiber ?? 0) * 10) / 10,
        sugar: Math.round((estimatedSugar ?? 0) * 10) / 10,
      }
    : null

  const buildEntry = (
    nutrients: {
      calories: number
      protein: number
      carbs: number
      fat: number
      fiber: number
      sugar: number
    },
    source: 'usda' | 'perplexity' | 'estimate',
    servingDesc?: string,
    fdcId?: number,
  ) => {
    writeFoodCache(foodQuery, {
      ...nutrients,
      source,
      servingDescription: servingDesc,
      servingGramWeight: 100,
      fdcId,
    }).catch(() => {})

    return {
      success: true,
      entry: {
        name: displayName,
        quantity,
        serving: {
          amount: 1,
          unit: servingDesc || 'serving',
          gramWeight: 100,
        },
        nutrients,
        meal,
      },
      estimated: source !== 'usda',
      source,
      message: `Logged ${quantity} ${displayName} (${source === 'usda' ? '' : source + ': '}${nutrients.calories} cal)`,
    }
  }

  const tryFallbacks = async () => {
    const pplx = await searchPerplexityNutrition(foodQuery)
    if (pplx) {
      console.log('[LOOKUP] Source: Perplexity |', displayName, pplx.calories, 'cal')
      return buildEntry(pplx, 'perplexity', pplx.servingDescription)
    }
    if (llmFallback) {
      console.log('[LOOKUP] Source: LLM estimate |', displayName, llmFallback.calories, 'cal')
      return buildEntry(llmFallback, 'estimate')
    }
    return null
  }

  if (!USDA_API_KEY) {
    console.log('[LOOKUP] No USDA API key, trying fallbacks')
    const fallback = await tryFallbacks()
    if (fallback) return fallback
    return {
      success: false,
      error: 'No API keys configured. Please provide estimated macros.',
      message:
        'Could not look up food. Please provide your best estimate for calories, protein, carbs, and fat.',
    }
  }

  try {
    const enhancedQuery = enhanceQuery(foodQuery)
    console.log('[LOOKUP] Searching USDA:', enhancedQuery)

    const searchParams = new URLSearchParams({
      api_key: USDA_API_KEY,
      query: enhancedQuery,
      pageSize: '5',
      dataType: 'Survey (FNDDS),Foundation,SR Legacy',
    })
    const searchRes = await fetch(`${USDA_BASE_URL}/foods/search?${searchParams}`)

    if (!searchRes.ok) {
      console.log('[LOOKUP] USDA search failed:', searchRes.status, searchRes.statusText)
      const fallback = await tryFallbacks()
      if (fallback) return fallback
      throw new Error(`USDA API error: ${searchRes.status}`)
    }

    const searchData = (await searchRes.json()) as USDASearchResponse

    if (searchData.foods?.length) {
      console.log('[LOOKUP] Search results:')
      searchData.foods.slice(0, 5).forEach((f, i) => {
        console.log(`  ${i + 1}. [${f.dataType}] ${f.description} (score: ${f.score})`)
      })
    }

    if (!searchData.foods?.length) {
      console.log('[LOOKUP] No USDA results, trying fallbacks')
      const fallback = await tryFallbacks()
      if (fallback) return fallback
      return {
        success: false,
        error: 'Food not found. Please provide estimated macros.',
        foodQuery,
        message: `Could not find "${foodQuery}". Please provide your best estimate for calories, protein, carbs, and fat.`,
      }
    }

    const queryWords = enhancedQuery
      .toLowerCase()
      .split(' ')
      .filter((w) => w.length > 2)
    let bestMatch = searchData.foods[0]
    let bestScore = -1

    for (const food of searchData.foods) {
      const desc = food.description.toLowerCase()
      const matchCount = queryWords.filter((w) => desc.includes(w)).length
      const dataTypeBonus = food.dataType === 'Survey (FNDDS)' ? 0.5 : 0
      const wordCount = desc.split(/[,\s]+/).length
      const simplicityBonus = wordCount <= 4 ? 0.3 : 0
      const score = matchCount + dataTypeBonus + simplicityBonus

      if (score > bestScore) {
        bestMatch = food
        bestScore = score
      }
    }

    const bestMatchCount = queryWords.filter((w) =>
      bestMatch.description.toLowerCase().includes(w),
    ).length
    const matchRatio = queryWords.length > 0 ? bestMatchCount / queryWords.length : 0

    if (matchRatio < 1) {
      console.log(
        `[LOOKUP] Poor USDA match (${bestMatchCount}/${queryWords.length} words), trying fallbacks`,
      )
      const fallback = await tryFallbacks()
      if (fallback) return fallback
    }

    const fdcId = bestMatch.fdcId
    console.log('[LOOKUP] Selected:', bestMatch.description, '(fdcId:', fdcId, ')')

    const detailRes = await fetch(`${USDA_BASE_URL}/food/${fdcId}?api_key=${USDA_API_KEY}`)
    if (!detailRes.ok) {
      console.log('[LOOKUP] USDA detail fetch failed:', detailRes.status, detailRes.statusText)
      const fallback = await tryFallbacks()
      if (fallback) return fallback
      throw new Error(`USDA API error: ${detailRes.status}`)
    }

    const food = (await detailRes.json()) as USDAFoodFull
    console.log('[LOOKUP] Fetched food:', food.description)

    const getNutrient = (ids: number[]) => {
      for (const id of ids) {
        const nutrient = food.foodNutrients?.find(
          (n: any) =>
            n.nutrientId === id || n.nutrient?.id === id || n.nutrientNumber === String(id),
        )
        if (nutrient) {
          const value = nutrient.value ?? nutrient.amount ?? 0
          if (value > 0) return value
        }
      }
      return 0
    }

    const rawCalories = getNutrient([1008, 208, 2047, 2048])
    const rawProtein = getNutrient([1003, 203])
    const rawCarbs = getNutrient([1005, 205])
    const rawFat = getNutrient([1004, 204])

    const calculatedCalories = Math.round(rawProtein * 4 + rawCarbs * 4 + rawFat * 9)
    const calories = rawCalories > 0 ? Math.round(rawCalories) : calculatedCalories

    const macros = {
      calories,
      protein: Math.round(rawProtein * 10) / 10,
      carbs: Math.round(rawCarbs * 10) / 10,
      fat: Math.round(rawFat * 10) / 10,
      fiber: Math.round(getNutrient([1079, 291]) * 10) / 10,
      sugar: Math.round(getNutrient([2000, 1063, 269]) * 10) / 10,
    }

    if (macros.calories === 0 && macros.protein === 0 && macros.carbs === 0 && macros.fat === 0) {
      console.log('[LOOKUP] No valid nutrients in USDA, trying fallbacks')
      const fallback = await tryFallbacks()
      if (fallback) return fallback
      return {
        success: false,
        error: 'Nutrient data incomplete. Please provide estimated macros.',
        foodQuery,
        fdcId,
        message: `Found "${food.description}" but nutrient data is incomplete. Please provide your best estimate.`,
      }
    }

    console.log('[LOOKUP] Macros per 100g:', macros)

    let portion = food.foodPortions?.[0]

    if (food.foodPortions && food.foodPortions.length > 0) {
      const portions = food.foodPortions
      const portionText = (p: any) =>
        `${p.modifier || ''} ${p.portionDescription || ''}`.toLowerCase()

      let matched = false
      if (servingUnit) {
        const unitLower = servingUnit.toLowerCase()
        const unitMatch = portions.find((p: any) => portionText(p).includes(unitLower))
        if (unitMatch) {
          portion = unitMatch
          matched = true
        }
      }

      if (!matched) {
        const mediumPortion = portions.find((p: any) => portionText(p).includes('medium'))
        if (mediumPortion) {
          portion = mediumPortion
        }
      }

      const currentText = portionText(portion)
      if (currentText.includes('package') || currentText.includes('yield') || currentText.includes('nfs')) {
        const betterPortion = portions.find((p: any) => {
          const text = portionText(p)
          return (
            text.includes('cup') ||
            text.includes('tbsp') ||
            text.includes('oz') ||
            text.includes('piece') ||
            text.includes('slice')
          )
        })
        if (betterPortion) {
          portion = betterPortion
        }
      }
    }

    const cleanUnit = (raw: string) => raw.replace(/^\d+(\.\d+)?\s*/, '') || raw

    const serving = portion
      ? {
          amount: portion.amount || 1,
          unit: cleanUnit(portion.modifier || portion.portionDescription || 'serving'),
          gramWeight: portion.gramWeight || 100,
        }
      : { amount: 100, unit: 'g', gramWeight: 100 }

    const scale = serving.gramWeight / 100
    const nutrients = {
      calories: Math.round(macros.calories * scale),
      protein: Math.round(macros.protein * scale * 10) / 10,
      carbs: Math.round(macros.carbs * scale * 10) / 10,
      fat: Math.round(macros.fat * scale * 10) / 10,
      fiber: Math.round(macros.fiber * scale * 10) / 10,
      sugar: Math.round(macros.sugar * scale * 10) / 10,
    }

    console.log('[LOOKUP] Source: USDA |', displayName, nutrients.calories, 'cal per', serving.unit)

    writeFoodCache(foodQuery, {
      ...nutrients,
      source: 'usda',
      servingDescription: serving.unit,
      servingGramWeight: serving.gramWeight,
      fdcId,
    }).catch(() => {})

    return {
      success: true,
      entry: {
        name: displayName,
        quantity,
        serving,
        nutrients,
        meal,
        fdcId,
      },
      estimated: false,
      source: 'usda',
      message: `Logged ${quantity} ${serving.unit} ${displayName} - ${nutrients.calories * quantity} cal, ${nutrients.protein * quantity}g protein`,
    }
  } catch (error) {
    console.error('[LOOKUP] Error:', error)
    const fallback = await tryFallbacks()
    if (fallback) return fallback
    return {
      success: false,
      error: 'API error occurred. Please provide estimated macros.',
      foodQuery,
      message: `Error looking up "${foodQuery}". Please provide your best estimate for calories, protein, carbs, and fat.`,
    }
  }
}

async function executeRemoveFoodEntry({ foodName }: RemoveFoodEntryInput) {
  console.log('[REMOVE] Removing:', foodName)
  return {
    success: true,
    action: 'remove',
    foodName,
    message: `Removed ${foodName} from the draft.`,
  }
}

async function executeUpdateFoodServings({ foodName, newQuantity }: UpdateFoodServingsInput) {
  console.log('[UPDATE] Updating:', foodName, 'to', newQuantity, 'servings')
  return {
    success: true,
    action: 'update_servings',
    foodName,
    newQuantity,
    message: `Updated ${foodName} to ${newQuantity} serving${newQuantity !== 1 ? 's' : ''}.`,
  }
}

async function executeGetFoodHistory({ period }: GetFoodHistoryInput, context: AssistantRuntimeContext) {
  const today = context.todayDateKey || new Date().toISOString().slice(0, 10)
  const history = context.foodHistory || []
  console.log(
    `[GET_FOOD_HISTORY] period=${period}, today=${today}, history has ${history.length} days`,
  )
  console.log(
    '[GET_FOOD_HISTORY] Available dates:',
    history.map((d) => `${d.date} (${d.entries.length} entries, ${d.totals.calories} cal)`),
  )

  let daysToInclude = 1
  switch (period) {
    case 'today':
      daysToInclude = 1
      break
    case 'yesterday':
      daysToInclude = 2
      break
    case 'week':
      daysToInclude = 7
      break
    case 'two_weeks':
      daysToInclude = 14
      break
  }

  const filtered =
    period === 'yesterday'
      ? history.filter((d) => d.date !== today).slice(0, 1)
      : history.slice(0, daysToInclude)

  console.log(
    `[GET_FOOD_HISTORY] Filtered to ${filtered.length} days:`,
    filtered.map((d) => d.date),
  )

  if (filtered.length === 0) {
    console.log('[GET_FOOD_HISTORY] No data found for period:', period)
    return {
      period,
      daysWithData: 0,
      message: `No food logged for ${period}.`,
    }
  }

  const aggregate = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
  }

  for (const day of filtered) {
    console.log(
      `[GET_FOOD_HISTORY] Day ${day.date}: cal=${day.totals.calories} p=${day.totals.protein} c=${day.totals.carbs} f=${day.totals.fat}`,
    )
    aggregate.calories += day.totals.calories
    aggregate.protein += day.totals.protein
    aggregate.carbs += day.totals.carbs
    aggregate.fat += day.totals.fat
    aggregate.fiber += day.totals.fiber ?? 0
    aggregate.sugar += day.totals.sugar ?? 0
  }

  const daysWithData = filtered.length
  const averages = {
    calories: Math.round(aggregate.calories / daysWithData),
    protein: Math.round((aggregate.protein / daysWithData) * 10) / 10,
    carbs: Math.round((aggregate.carbs / daysWithData) * 10) / 10,
    fat: Math.round((aggregate.fat / daysWithData) * 10) / 10,
    fiber: Math.round((aggregate.fiber / daysWithData) * 10) / 10,
    sugar: Math.round((aggregate.sugar / daysWithData) * 10) / 10,
  }

  console.log('[GET_FOOD_HISTORY] Aggregate totals:', aggregate)
  if (daysWithData > 1) {
    console.log('[GET_FOOD_HISTORY] Daily averages:', averages)
  }

  return {
    period,
    daysWithData,
    days: filtered,
    totals: aggregate,
    dailyAverages: daysWithData > 1 ? averages : undefined,
  }
}

async function executeGetUserGoals(context: AssistantRuntimeContext) {
  const defaults = {
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65,
  }
  const goals = context.userGoals || defaults
  console.log('[GET_USER_GOALS] Returning goals:', goals, 'isCustom:', !!context.userGoals)
  return {
    goals,
    isCustom: !!context.userGoals,
  }
}

export function buildAssistantTools(context: AssistantRuntimeContext) {
  return {
    lookup_and_log_food: {
      description: assistantToolDescriptions.lookup_and_log_food,
      inputSchema: assistantToolSchemas.lookup_and_log_food,
      execute: executeLookupAndLogFood,
    },
    remove_food_entry: {
      description: assistantToolDescriptions.remove_food_entry,
      inputSchema: assistantToolSchemas.remove_food_entry,
      execute: executeRemoveFoodEntry,
    },
    update_food_servings: {
      description: assistantToolDescriptions.update_food_servings,
      inputSchema: assistantToolSchemas.update_food_servings,
      execute: executeUpdateFoodServings,
    },
    get_food_history: {
      description: assistantToolDescriptions.get_food_history,
      inputSchema: assistantToolSchemas.get_food_history,
      execute: (input: GetFoodHistoryInput) => executeGetFoodHistory(input, context),
    },
    get_user_goals: {
      description: assistantToolDescriptions.get_user_goals,
      inputSchema: assistantToolSchemas.get_user_goals,
      execute: () => executeGetUserGoals(context),
    },
    ask_user: {
      description: assistantToolDescriptions.ask_user,
      inputSchema: assistantToolSchemas.ask_user,
    },
  }
}

export async function executeAssistantTool(
  toolName: keyof typeof assistantToolSchemas,
  input: unknown,
  context: AssistantRuntimeContext,
) {
  switch (toolName) {
    case 'lookup_and_log_food':
      return executeLookupAndLogFood(assistantToolSchemas.lookup_and_log_food.parse(input))
    case 'remove_food_entry':
      return executeRemoveFoodEntry(assistantToolSchemas.remove_food_entry.parse(input))
    case 'update_food_servings':
      return executeUpdateFoodServings(assistantToolSchemas.update_food_servings.parse(input))
    case 'get_food_history':
      return executeGetFoodHistory(assistantToolSchemas.get_food_history.parse(input), context)
    case 'get_user_goals':
      return executeGetUserGoals(context)
    case 'ask_user':
      return assistantToolSchemas.ask_user.parse(input)
    default:
      throw new Error(`Unsupported tool: ${toolName satisfies never}`)
  }
}

export function getAssistantFunctionDeclarations() {
  return (Object.entries(assistantToolSchemas) as [keyof typeof assistantToolSchemas, z.ZodTypeAny][])
    .map(([name, schema]) => ({
      name,
      description: assistantToolDescriptions[name],
      parametersJsonSchema: z.toJSONSchema(schema),
    }))
}

export function buildAssistantSystemPrompt({ voiceMode }: { voiceMode?: boolean } = {}) {
  return `You are Mora, a friendly macro-tracking assistant.

When a user says they ate something (like "I had a banana" or "ate chicken for lunch"):
1. First, check if you need more details — use ask_user to clarify portion size, preparation, type, etc. (see CLARIFICATION section below)
2. Once you have enough detail, use lookup_and_log_food with the specific food
3. Provide a friendly displayName - a clean, human-readable name like "Banana", "Grilled Chicken Breast", "Greek Yogurt" (NOT technical names like "Bananas, raw" or "Chicken, broilers or fryers, breast")
4. After the tool returns successfully, ask the user to confirm: "Does this look right?" or "Sound good?" or similar short confirmation question

IMPORTANT - Adding more food to the draft:
- When a user says "with X", "and X", "also had X", or "add X" - ONLY call the tool for the NEW item X
- The previous items are already in the confirmation card from earlier tool calls - do NOT look them up again
- Example: You looked up "turkey sandwich", user says "and a big mac" → ONLY call tool for "big mac" (turkey sandwich is already in the card)

CLARIFICATION — Be curious! Ask questions to get accurate entries:
- ALWAYS use ask_user BEFORE lookup_and_log_food unless the food is completely unambiguous AND has a standard serving (e.g., "a banana", "an apple", "a hard-boiled egg")
- Ask about PORTION SIZE when not specified: "How much chicken did you have — like a palm-sized piece, a whole breast, or a few strips?"
- Ask about PREPARATION when it affects macros: "Was that fried, grilled, or baked?" / "With oil or dry?"
- Ask about BRAND/RESTAURANT for packaged or takeout food: "Was that homemade or from a restaurant?" / "Which brand?"
- Ask about ADDITIONS/TOPPINGS: "Any toppings or sauces on that?" / "Did you have it with butter or plain?"
- Ask about TYPE when ambiguous: "What kind of sushi roll?" / "What type of sandwich?" / "What was in the salad?"
- IMPORTANT: Only ask ONE thing per question. Never combine multiple questions into one ask_user call.
  - WRONG: "What kind of sushi, and how many rolls?"
  - RIGHT: First ask "What kind of sushi roll?" → then ask "How many rolls did you have?"
- Provide 3-5 helpful quick-select options when possible
- Keep questions short and conversational — don't interrogate, just be helpful
- You CAN and SHOULD ask follow-up questions! After the user answers, call ask_user again if you still need more info.
  - Example: User says "sushi roll" → ask "What kind of sushi roll?" → they say "california roll" → ask "How many rolls did you have?" → then lookup
  - Example: User says "chicken" → ask "How was it cooked?" → they say "grilled" → ask "How much — like a breast, a thigh, or a few pieces?" → then lookup
  - Example: User says "coffee" → ask "What size?" → they say "large" → ask "Any milk or sugar?" → then lookup
- Keep it to 2-3 questions max total. Ask the most important question first (usually what type/kind).
- After you have enough detail, use the clarified info to call lookup_and_log_food
- Only skip questions for truly simple, unambiguous items with obvious portions (banana, apple, single egg, glass of water)

CORRECTIONS:
- "remove the X", "delete X", "take off the X" → call remove_food_entry with the exact displayName from the original lookup
- "I had 2, not 3", "actually just 1", "change to 2 servings" → call update_food_servings with the displayName and new quantity
- "actually it was X, not Y" → call remove_food_entry for Y, then lookup_and_log_food for X
- Always use the exact displayName you provided in the original lookup_and_log_food call

Your estimates should be reasonable per-serving values. For example:
- Medium banana: ~105 cal, 1g protein, 27g carbs, 0.4g fat, 3g fiber, 14g sugar
- Chicken breast (4oz): ~185 cal, 35g protein, 0g carbs, 4g fat, 0g fiber, 0g sugar
- Cup of rice: ~205 cal, 4g protein, 45g carbs, 0.4g fat, 0.6g fiber, 0g sugar
- Apple: ~95 cal, 0.5g protein, 25g carbs, 0.3g fat, 4g fiber, 19g sugar

Keep responses short and friendly.${voiceMode ? '' : ` After the tool lookup, just ask for confirmation - don't repeat all the macros since they'll see them in the confirmation card.
Example: "Found it! Does this look right?"`}

INSIGHTS & PROGRESS:
- When the user asks about their intake, progress, totals, or trends, use get_food_history to retrieve their logs
- When comparing intake to goals, also call get_user_goals to get their targets
- Summarize insights conversationally — highlight what matters (e.g., "You're at 85% of your protein goal today!")
- For multi-day queries, mention daily averages and trends
- If no data is available, let them know and suggest logging some food first${voiceMode ? `

VOICE MODE INSIGHTS — summarize key numbers verbally rather than reading every entry. Example: "This week you averaged about 1,800 calories and 120 grams of protein per day — that's a bit under your 150-gram protein target."` : ''}${voiceMode ? `

VOICE MODE — The user is speaking to you hands-free and CANNOT see the screen.
- After a food lookup, ALWAYS tell them the key nutritional info verbally: name, calories, protein, carbs, and fat. Example: "Got it — one California Roll, that's about 255 calories, 9g protein, 38g carbs, and 7g fat. Sound right?"
- Keep it conversational and concise — read out the important macros naturally, don't list every single nutrient.
- The user can ask follow-up questions about the food ("how much fiber?", "what about sugar?") — answer from the tool result.
- For clarification questions, do NOT provide options — just ask a simple open-ended question. Example: instead of listing sushi roll types, just ask "What kind of sushi roll was it?" and let them answer naturally.
- Still ask about portions and preparation in voice mode — just keep it to one quick question at a time. Example: "How much rice did you have — like a cup or half a cup?"
- Keep your tone warm and conversational since this is a spoken dialogue.` : ''}`
}
