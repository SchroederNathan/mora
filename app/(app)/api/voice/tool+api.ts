import {
  assistantToolSchemas,
  executeAssistantTool,
  type AssistantGoals,
  type AssistantHistoryDay,
} from '@/lib/assistantRuntime'

type ToolName = keyof typeof assistantToolSchemas

export async function POST(req: Request) {
  try {
    const {
      toolName,
      input,
      voiceMode,
      foodHistory,
      userGoals,
      todayDateKey,
    }: {
      toolName: ToolName
      input: unknown
      voiceMode?: boolean
      foodHistory?: AssistantHistoryDay[]
      userGoals?: AssistantGoals | null
      todayDateKey?: string
    } = await req.json()

    if (!toolName || !(toolName in assistantToolSchemas)) {
      return new Response(JSON.stringify({ error: 'Unsupported tool' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const output = await executeAssistantTool(toolName, input, {
      voiceMode,
      foodHistory,
      userGoals,
      todayDateKey,
    })

    return Response.json({ output })
  } catch (error) {
    console.error('[VOICE TOOL] Failed to execute tool:', error)
    return new Response(
      JSON.stringify({ error: 'Tool execution failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
