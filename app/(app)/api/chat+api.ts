import {
  buildAssistantSystemPrompt,
  buildAssistantTools,
} from '@/lib/assistantRuntime';
import { createGateway } from '@ai-sdk/gateway';
import { convertToModelMessages, stepCountIs, streamText, UIMessage } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';

const gateway = createGateway({ fetch: expoFetch as unknown as typeof globalThis.fetch });

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
      tools: buildAssistantTools({
        voiceMode,
        foodHistory,
        userGoals,
        todayDateKey,
      }),
      system: buildAssistantSystemPrompt({ voiceMode }),
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
