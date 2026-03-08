import {
  type USDAFoodFull,
  type USDASearchResponse,
} from '@/types/nutrition';
import { createGateway } from '@ai-sdk/gateway';
import { convertToModelMessages, stepCountIs, streamText, UIMessage } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';

const gateway = createGateway({ fetch: expoFetch as unknown as typeof globalThis.fetch });

const USDA_API_KEY = process.env.USDA_API_KEY;
const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

/**
 * Search Perplexity Sonar for nutrition info — used as a smarter fallback
 * when USDA doesn't have a good match (branded foods, restaurant items, etc.)
 */
async function searchPerplexityNutrition(foodQuery: string): Promise<{
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  servingDescription?: string;
} | null> {
  if (!PERPLEXITY_API_KEY) return null;

  try {
    console.log("[PERPLEXITY] Searching for:", foodQuery);
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a nutrition data lookup tool. Return ONLY valid JSON with no other text. Search for accurate nutrition information for the requested food.",
          },
          {
            role: "user",
            content: `What are the nutrition facts for one serving of "${foodQuery}"? If this is a restaurant or branded item, use the actual published nutrition data. Return ONLY this JSON format, no other text:\n{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0,"servingDescription":"1 medium"}`,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.log("[PERPLEXITY] API error:", res.status);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      console.log("[PERPLEXITY] Could not parse JSON from:", content);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = {
      calories: Math.round(Number(parsed.calories) || 0),
      protein: Math.round((Number(parsed.protein) || 0) * 10) / 10,
      carbs: Math.round((Number(parsed.carbs) || 0) * 10) / 10,
      fat: Math.round((Number(parsed.fat) || 0) * 10) / 10,
      fiber: Math.round((Number(parsed.fiber) || 0) * 10) / 10,
      sugar: Math.round((Number(parsed.sugar) || 0) * 10) / 10,
      servingDescription: parsed.servingDescription,
    };

    // Sanity check — if everything is 0, it's not useful
    if (result.calories === 0 && result.protein === 0 && result.carbs === 0) {
      console.log("[PERPLEXITY] All zeros, discarding");
      return null;
    }

    console.log("[PERPLEXITY] Result:", result);
    return result;
  } catch (error) {
    console.error("[PERPLEXITY] Error:", error);
    return null;
  }
}

/**
 * Enhance query for better USDA search results
 * Adds "raw" suffix for whole foods that benefit from it
 */
function enhanceQuery(query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, " ");

  // Skip if already has preparation method
  if (
    /\b(raw|cooked|fried|baked|grilled|roasted|steamed|boiled)\b/i.test(
      normalized,
    )
  ) {
    return normalized;
  }

  // Whole foods that benefit from "raw" suffix
  const rawFoods =
    /\b(banana|apple|orange|grape|strawberry|blueberry|mango|peach|pear|plum|cherry|avocado|tomato|carrot|celery|cucumber|spinach|lettuce|broccoli|pepper|onion|chicken|beef|pork|salmon|tuna|egg)\b/i;

  if (rawFoods.test(normalized)) {
    return `${normalized} raw`;
  }

  return normalized;
}

export async function POST(req: Request) {
  const {
    messages,
    voiceMode,
    foodHistory,
    userGoals,
    todayDateKey,
  }: {
    messages: UIMessage[];
    voiceMode?: boolean;
    foodHistory?: {
      date: string;
      entries: {
        name: string;
        quantity: number;
        meal?: string;
        nutrients: {
          calories: number;
          protein: number;
          carbs: number;
          fat: number;
          fiber?: number;
          sugar?: number;
        };
      }[];
      totals: {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        fiber?: number;
        sugar?: number;
      };
    }[];
    userGoals?: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    } | null;
    todayDateKey?: string;
  } = await req.json();
  console.log(
    "[CHAT API] Received",
    messages.length,
    "messages",
    voiceMode ? "(voice mode)" : "",
  );
  console.log(
    "[CHAT API] foodHistory:",
    foodHistory?.length ?? 0,
    "days, dates:",
    foodHistory?.map((d) => d.date),
  );
  console.log("[CHAT API] userGoals:", userGoals);
  console.log("[CHAT API] todayDateKey:", todayDateKey);

  try {
    const result = streamText({
      model: gateway("google/gemini-3-flash"),
      messages: await convertToModelMessages(messages),
      stopWhen: stepCountIs(5),
      tools: {
        // Single tool that searches, gets details, and returns ready-to-log data
        lookup_and_log_food: {
          description:
            "Look up a food in the USDA database and log it. Use this when the user says they ate something. If the food is not found in USDA, provide your best estimate for the macros.",
          inputSchema: z.object({
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
            quantity: z
              .number()
              .default(1)
              .describe("Number of servings (default 1)"),
            meal: z
              .enum(["breakfast", "lunch", "dinner", "snack"])
              .optional()
              .describe("Meal type if mentioned"),
            // LLM-provided estimates used as fallback when USDA lookup fails
            estimatedCalories: z
              .number()
              .optional()
              .describe(
                "Your estimated calories per serving if USDA lookup fails",
              ),
            estimatedProtein: z
              .number()
              .optional()
              .describe(
                "Your estimated protein (g) per serving if USDA lookup fails",
              ),
            estimatedCarbs: z
              .number()
              .optional()
              .describe(
                "Your estimated carbs (g) per serving if USDA lookup fails",
              ),
            estimatedFat: z
              .number()
              .optional()
              .describe(
                "Your estimated fat (g) per serving if USDA lookup fails",
              ),
            estimatedFiber: z
              .number()
              .optional()
              .describe(
                "Your estimated fiber (g) per serving if USDA lookup fails",
              ),
            estimatedSugar: z
              .number()
              .optional()
              .describe(
                "Your estimated sugar (g) per serving if USDA lookup fails",
              ),
          }),
          execute: async ({
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
          }) => {
            console.log("[LOOKUP] Searching for:", foodQuery);

            // LLM-provided fallback macros (per serving) — last resort after Perplexity
            const hasLLMEstimate =
              estimatedCalories !== undefined || estimatedProtein !== undefined;
            const llmFallback = hasLLMEstimate
              ? {
                  calories: Math.round(estimatedCalories ?? 100),
                  protein: Math.round((estimatedProtein ?? 5) * 10) / 10,
                  carbs: Math.round((estimatedCarbs ?? 15) * 10) / 10,
                  fat: Math.round((estimatedFat ?? 3) * 10) / 10,
                  fiber: Math.round((estimatedFiber ?? 0) * 10) / 10,
                  sugar: Math.round((estimatedSugar ?? 0) * 10) / 10,
                }
              : null;

            // Helper: build a successful entry from any nutrient source
            const buildEntry = (
              nutrients: {
                calories: number;
                protein: number;
                carbs: number;
                fat: number;
                fiber: number;
                sugar: number;
              },
              source: "usda" | "perplexity" | "estimate",
              servingDesc?: string,
            ) => ({
              success: true,
              entry: {
                name: displayName,
                quantity,
                serving: {
                  amount: 1,
                  unit: servingDesc || "serving",
                  gramWeight: 100,
                },
                nutrients,
                meal,
              },
              estimated: source !== "usda",
              source,
              message: `Logged ${quantity} ${displayName} (${source === "usda" ? "" : source + ": "}${nutrients.calories} cal)`,
            });

            // Helper: try Perplexity, then LLM estimate, then return null
            const tryFallbacks = async () => {
              const pplx = await searchPerplexityNutrition(foodQuery);
              if (pplx) {
                console.log(
                  "[LOOKUP] Source: Perplexity |",
                  displayName,
                  pplx.calories,
                  "cal",
                );
                return buildEntry(pplx, "perplexity", pplx.servingDescription);
              }
              if (llmFallback) {
                console.log(
                  "[LOOKUP] Source: LLM estimate |",
                  displayName,
                  llmFallback.calories,
                  "cal",
                );
                return buildEntry(llmFallback, "estimate");
              }
              return null;
            };

            if (!USDA_API_KEY) {
              console.log("[LOOKUP] No USDA API key, trying fallbacks");
              const fallback = await tryFallbacks();
              if (fallback) return fallback;
              return {
                success: false,
                error:
                  "No API keys configured. Please provide estimated macros.",
                message:
                  "Could not look up food. Please provide your best estimate for calories, protein, carbs, and fat.",
              };
            }

            try {
              // Enhance query for better results
              const enhancedQuery = enhanceQuery(foodQuery);

              // Search USDA - include Survey (FNDDS) for prepared/mixed foods
              console.log("[LOOKUP] Searching USDA:", enhancedQuery);
              const searchParams = new URLSearchParams({
                api_key: USDA_API_KEY,
                query: enhancedQuery,
                pageSize: "5",
                dataType: "Survey (FNDDS),Foundation,SR Legacy",
              });
              const searchRes = await fetch(
                `${USDA_BASE_URL}/foods/search?${searchParams}`,
              );

              // Handle non-OK responses
              if (!searchRes.ok) {
                console.log(
                  "[LOOKUP] USDA search failed:",
                  searchRes.status,
                  searchRes.statusText,
                );
                const fallback = await tryFallbacks();
                if (fallback) return fallback;
                throw new Error(`USDA API error: ${searchRes.status}`);
              }

              const searchData = (await searchRes.json()) as USDASearchResponse;

              // Log all results for debugging
              if (searchData.foods?.length) {
                console.log("[LOOKUP] Search results:");
                searchData.foods.slice(0, 5).forEach((f, i) => {
                  console.log(
                    `  ${i + 1}. [${f.dataType}] ${f.description} (score: ${f.score})`,
                  );
                });
              }

              if (!searchData.foods?.length) {
                console.log("[LOOKUP] No USDA results, trying fallbacks");
                const fallback = await tryFallbacks();
                if (fallback) return fallback;
                return {
                  success: false,
                  error: "Food not found. Please provide estimated macros.",
                  foodQuery,
                  message: `Could not find "${foodQuery}". Please provide your best estimate for calories, protein, carbs, and fat.`,
                };
              }

              // Find the best matching result - prefer results that contain query words
              const queryWords = enhancedQuery
                .toLowerCase()
                .split(" ")
                .filter((w) => w.length > 2);
              let bestMatch = searchData.foods[0];
              let bestMatchCount = 0;

              for (const food of searchData.foods) {
                const desc = food.description.toLowerCase();
                const matchCount = queryWords.filter((w) =>
                  desc.includes(w),
                ).length;

                if (matchCount > bestMatchCount) {
                  bestMatch = food;
                  bestMatchCount = matchCount;
                }
              }

              // If fewer than half of query words match, USDA result is likely wrong — try fallbacks
              const matchRatio =
                queryWords.length > 0 ? bestMatchCount / queryWords.length : 0;
              if (matchRatio < 1) {
                console.log(
                  `[LOOKUP] Poor USDA match (${bestMatchCount}/${queryWords.length} words), trying fallbacks`,
                );
                const fallback = await tryFallbacks();
                if (fallback) return fallback;
                // If fallbacks also fail, continue with best USDA match as last resort
              }

              const fdcId = bestMatch.fdcId;
              console.log(
                "[LOOKUP] Selected:",
                bestMatch.description,
                "(fdcId:",
                fdcId,
                ")",
              );

              // Get full details from API
              const detailRes = await fetch(
                `${USDA_BASE_URL}/food/${fdcId}?api_key=${USDA_API_KEY}`,
              );

              if (!detailRes.ok) {
                console.log(
                  "[LOOKUP] USDA detail fetch failed:",
                  detailRes.status,
                  detailRes.statusText,
                );
                const fallback = await tryFallbacks();
                if (fallback) return fallback;
                throw new Error(`USDA API error: ${detailRes.status}`);
              }

              const food = (await detailRes.json()) as USDAFoodFull;
              console.log("[LOOKUP] Fetched food:", food.description);

              // Extract macros - handle multiple nutrient ID formats
              const getNutrient = (ids: number[]) => {
                for (const id of ids) {
                  const n = food.foodNutrients?.find(
                    (n: any) =>
                      n.nutrientId === id ||
                      n.nutrient?.id === id ||
                      n.nutrientNumber === String(id),
                  );
                  if (n) {
                    const val = n.value ?? (n as any).amount ?? 0;
                    if (val > 0) return val;
                  }
                }
                return 0;
              };

              // Energy IDs: 1008 (standard), 208 (alternate), 2047 (Atwater General), 2048 (Atwater Specific)
              const rawCalories = getNutrient([1008, 208, 2047, 2048]);
              const rawProtein = getNutrient([1003, 203]);
              const rawCarbs = getNutrient([1005, 205]);
              const rawFat = getNutrient([1004, 204]);

              // Calculate calories from macros if not found (protein*4 + carbs*4 + fat*9)
              const calculatedCalories = Math.round(
                rawProtein * 4 + rawCarbs * 4 + rawFat * 9,
              );
              const calories =
                rawCalories > 0 ? Math.round(rawCalories) : calculatedCalories;

              const macros = {
                calories,
                protein: Math.round(rawProtein * 10) / 10,
                carbs: Math.round(rawCarbs * 10) / 10,
                fat: Math.round(rawFat * 10) / 10,
                fiber: Math.round(getNutrient([1079, 291]) * 10) / 10,
                sugar: Math.round(getNutrient([2000, 1063, 269]) * 10) / 10,
              };

              // Validate: if all macros are 0, try fallbacks
              if (
                macros.calories === 0 &&
                macros.protein === 0 &&
                macros.carbs === 0 &&
                macros.fat === 0
              ) {
                console.log(
                  "[LOOKUP] No valid nutrients in USDA, trying fallbacks",
                );
                const fallback = await tryFallbacks();
                if (fallback) return fallback;
                return {
                  success: false,
                  error:
                    "Nutrient data incomplete. Please provide estimated macros.",
                  foodQuery,
                  fdcId,
                  message: `Found "${food.description}" but nutrient data is incomplete. Please provide your best estimate.`,
                };
              }

              console.log("[LOOKUP] Macros per 100g:", macros);

              // Get a reasonable serving size - prefer medium-sized portions
              let portion = food.foodPortions?.[0];

              if (food.foodPortions && food.foodPortions.length > 1) {
                const mediumPortion = food.foodPortions.find(
                  (p: any) =>
                    p.modifier?.toLowerCase().includes("medium") ||
                    p.portionDescription?.toLowerCase().includes("medium"),
                );
                if (mediumPortion) {
                  portion = mediumPortion;
                }
              }

              // Strip leading numeric prefix from USDA unit strings
              // e.g. "1 roll (6oz, 220g)" → "roll (6oz, 220g)"
              const cleanUnit = (raw: string) =>
                raw.replace(/^\d+(\.\d+)?\s*/, "") || raw;

              const serving = portion
                ? {
                    amount: portion.amount || 1,
                    unit: cleanUnit(
                      portion.modifier ||
                        portion.portionDescription ||
                        "serving",
                    ),
                    gramWeight: portion.gramWeight || 100,
                  }
                : { amount: 100, unit: "g", gramWeight: 100 };

              // Scale macros to serving size
              const scale = serving.gramWeight / 100;
              const nutrients = {
                calories: Math.round(macros.calories * scale),
                protein: Math.round(macros.protein * scale * 10) / 10,
                carbs: Math.round(macros.carbs * scale * 10) / 10,
                fat: Math.round(macros.fat * scale * 10) / 10,
                fiber: Math.round(macros.fiber * scale * 10) / 10,
                sugar: Math.round(macros.sugar * scale * 10) / 10,
              };

              console.log(
                "[LOOKUP] Source: USDA |",
                displayName,
                nutrients.calories,
                "cal per",
                serving.unit,
              );

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
                source: "usda",
                message: `Logged ${quantity} ${serving.unit} ${displayName} - ${nutrients.calories * quantity} cal, ${nutrients.protein * quantity}g protein`,
              };
            } catch (error) {
              console.error("[LOOKUP] Error:", error);
              const fallback = await tryFallbacks();
              if (fallback) return fallback;
              return {
                success: false,
                error: "API error occurred. Please provide estimated macros.",
                foodQuery,
                message: `Error looking up "${foodQuery}". Please provide your best estimate for calories, protein, carbs, and fat.`,
              };
            }
          },
        },
        remove_food_entry: {
          description:
            'Remove a food item from the pending draft. Use when the user says "remove the X", "delete X", "take off the X", or "nevermind on the X".',
          inputSchema: z.object({
            foodName: z
              .string()
              .describe(
                'The exact display name of the food to remove (e.g., "Banana", "Grilled Chicken Breast")',
              ),
          }),
          execute: async ({ foodName }) => {
            console.log("[REMOVE] Removing:", foodName);
            return {
              success: true,
              action: "remove",
              foodName,
              message: `Removed ${foodName} from the draft.`,
            };
          },
        },
        update_food_servings: {
          description:
            'Update the quantity/servings of a food item in the pending draft. Use when the user says "I had 2, not 3", "change to 1 serving", "actually just 1", or any quantity correction.',
          inputSchema: z.object({
            foodName: z
              .string()
              .describe(
                'The exact display name of the food to update (e.g., "Banana", "Grilled Chicken Breast")',
              ),
            newQuantity: z
              .number()
              .min(1)
              .describe("The new number of servings"),
          }),
          execute: async ({ foodName, newQuantity }) => {
            console.log(
              "[UPDATE] Updating:",
              foodName,
              "to",
              newQuantity,
              "servings",
            );
            return {
              success: true,
              action: "update_servings",
              foodName,
              newQuantity,
              message: `Updated ${foodName} to ${newQuantity} serving${newQuantity !== 1 ? "s" : ""}.`,
            };
          },
        },
        get_food_history: {
          description:
            "Get the user's food log history. Use when the user asks about what they ate, their intake, progress, or trends.",
          inputSchema: z.object({
            period: z
              .enum(["today", "yesterday", "week", "two_weeks"])
              .describe("Time period to retrieve"),
          }),
          execute: async ({ period }) => {
            const today = todayDateKey || new Date().toISOString().slice(0, 10);
            const history = foodHistory || [];
            console.log(
              `[GET_FOOD_HISTORY] period=${period}, today=${today}, history has ${history.length} days`,
            );
            console.log(
              "[GET_FOOD_HISTORY] Available dates:",
              history.map(
                (d) =>
                  `${d.date} (${d.entries.length} entries, ${d.totals.calories} cal)`,
              ),
            );

            // Filter by period
            let daysToInclude: number;
            switch (period) {
              case "today":
                daysToInclude = 1;
                break;
              case "yesterday":
                daysToInclude = 2;
                break;
              case "week":
                daysToInclude = 7;
                break;
              case "two_weeks":
                daysToInclude = 14;
                break;
            }

            // History is sorted most recent first (today at index 0)
            const filtered =
              period === "yesterday"
                ? history.filter((d) => d.date !== today).slice(0, 1)
                : history.slice(0, daysToInclude);

            console.log(
              `[GET_FOOD_HISTORY] Filtered to ${filtered.length} days:`,
              filtered.map((d) => d.date),
            );

            if (filtered.length === 0) {
              console.log(
                "[GET_FOOD_HISTORY] No data found for period:",
                period,
              );
              return {
                period,
                daysWithData: 0,
                message: `No food logged for ${period}.`,
              };
            }

            // Compute aggregates
            const aggregate = {
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              fiber: 0,
              sugar: 0,
            };
            for (const day of filtered) {
              console.log(
                `[GET_FOOD_HISTORY] Day ${day.date}: cal=${day.totals.calories} p=${day.totals.protein} c=${day.totals.carbs} f=${day.totals.fat}`,
              );
              aggregate.calories += day.totals.calories;
              aggregate.protein += day.totals.protein;
              aggregate.carbs += day.totals.carbs;
              aggregate.fat += day.totals.fat;
              aggregate.fiber += day.totals.fiber ?? 0;
              aggregate.sugar += day.totals.sugar ?? 0;
            }

            const daysWithData = filtered.length;
            const averages = {
              calories: Math.round(aggregate.calories / daysWithData),
              protein: Math.round((aggregate.protein / daysWithData) * 10) / 10,
              carbs: Math.round((aggregate.carbs / daysWithData) * 10) / 10,
              fat: Math.round((aggregate.fat / daysWithData) * 10) / 10,
              fiber: Math.round((aggregate.fiber / daysWithData) * 10) / 10,
              sugar: Math.round((aggregate.sugar / daysWithData) * 10) / 10,
            };

            console.log("[GET_FOOD_HISTORY] Aggregate totals:", aggregate);
            if (daysWithData > 1)
              console.log("[GET_FOOD_HISTORY] Daily averages:", averages);

            return {
              period,
              daysWithData,
              days: filtered,
              totals: aggregate,
              dailyAverages: daysWithData > 1 ? averages : undefined,
            };
          },
        },
        get_user_goals: {
          description:
            "Get the user's daily nutrition goals/targets. Use when comparing intake to goals or answering questions about targets.",
          inputSchema: z.object({}),
          execute: async () => {
            const defaults = {
              calories: 2000,
              protein: 150,
              carbs: 200,
              fat: 65,
            };
            const goals = userGoals || defaults;
            console.log(
              "[GET_USER_GOALS] Returning goals:",
              goals,
              "isCustom:",
              !!userGoals,
            );
            return {
              goals,
              isCustom: !!userGoals,
            };
          },
        },
        ask_user: {
          description:
            'Ask the user a clarifying question when more information is needed to accurately look up food. Use when food is ambiguous (e.g., "sushi roll", "sandwich", "coffee").',
          inputSchema: z.object({
            question: z.string().describe("The question to ask"),
            options: z
              .array(
                z.object({
                  label: z.string().describe("Display text"),
                  value: z.string().describe("Value when selected"),
                }),
              )
              .optional()
              .describe("Quick-select options"),
            allowFreeform: z
              .boolean()
              .default(true)
              .describe("Show text input for custom answers"),
            context: z
              .string()
              .optional()
              .describe("Additional context for display"),
          }),
          // No execute — answer comes from client via addToolOutput
        },
      },
      system: `You are Miro, a friendly macro-tracking assistant.

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

Keep responses short and friendly.${
        voiceMode
          ? ""
          : ` After the tool lookup, just ask for confirmation - don't repeat all the macros since they'll see them in the confirmation card.
Example: "Found it! Does this look right?"`
      }

INSIGHTS & PROGRESS:
- When the user asks about their intake, progress, totals, or trends, use get_food_history to retrieve their logs
- When comparing intake to goals, also call get_user_goals to get their targets
- Summarize insights conversationally — highlight what matters (e.g., "You're at 85% of your protein goal today!")
- For multi-day queries, mention daily averages and trends
- If no data is available, let them know and suggest logging some food first${
        voiceMode
          ? `

VOICE MODE INSIGHTS — summarize key numbers verbally rather than reading every entry. Example: "This week you averaged about 1,800 calories and 120 grams of protein per day — that's a bit under your 150-gram protein target."`
          : ""
      }${
        voiceMode
          ? `

VOICE MODE — The user is speaking to you hands-free and CANNOT see the screen.
- After a food lookup, ALWAYS tell them the key nutritional info verbally: name, calories, protein, carbs, and fat. Example: "Got it — one California Roll, that's about 255 calories, 9g protein, 38g carbs, and 7g fat. Sound right?"
- Keep it conversational and concise — read out the important macros naturally, don't list every single nutrient.
- The user can ask follow-up questions about the food ("how much fiber?", "what about sugar?") — answer from the tool result.
- For clarification questions, do NOT provide options — just ask a simple open-ended question. Example: instead of listing sushi roll types, just ask "What kind of sushi roll was it?" and let them answer naturally.
- Still ask about portions and preparation in voice mode — just keep it to one quick question at a time. Example: "How much rice did you have — like a cup or half a cup?"
- Keep your tone warm and conversational since this is a spoken dialogue.`
          : ""
      }`,
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "none",
      },
    });
  } catch (error) {
    console.error("[CHAT API] Stream error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to generate response. Please try again.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
