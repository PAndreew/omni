// ─── OpenRouter LLM Service ───────────────────────────────────────────────────

import OpenAI from 'openai';
import type { AgentTool, TaskComplexity, ConversationMessage } from './types.js';

const SIMPLE_KEYWORDS  = [
  'weather', 'chore', 'task', 'music', 'play', 'pause', 'calendar', 'schedule', 'time', 'date',
  'remind', 'reminder', 'add', 'tomorrow', 'appointment', 'meeting', 'call', 'phone', 'event',
  'today', 'week', 'next', 'upcoming', 'temperature', 'forecast',
];
const COMPLEX_KEYWORDS = ['code', 'script', 'file', 'write', 'debug', 'install', 'run', 'bash', 'fix', 'create', 'edit'];

const SYSTEM_PROMPT = `You are Omni, a helpful home assistant running on a Raspberry Pi wall display.
You help with chores, weather, calendar events, music control, and general questions.
Complex tasks (coding, files, scripts, system commands) are handled by a separate agent — just answer the user's conversational or lookup questions here.

IMPORTANT RULES:
- Be concise — your responses will be spoken aloud via TTS. Keep answers under 2-3 sentences.
- When someone says "remind me to X", "we need to call X", "I need to do X", "add X" → use add_chore with a clear title and due_date if mentioned.
- When someone asks what's coming up, check get_calendar first.
- Before using a tool, always say one short sentence out loud (e.g. "Let me check that." or "Adding that to the list."). This becomes the spoken response while the tool runs.
- After tools complete, summarise the result naturally as if speaking to someone — no bullet points, no markdown.`;

export class OpenRouterService {
  private client: OpenAI;
  private simpleModel: string;
  private mediumModel: string;
  private complexModel: string;

  constructor(
    apiKey: string,
    simpleModel  = 'google/gemini-flash-1.5-8b',
    mediumModel  = 'anthropic/claude-3-haiku',
    complexModel = 'anthropic/claude-3.5-sonnet',
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'OmniWall',
      },
    });
    this.simpleModel  = simpleModel;
    this.mediumModel  = mediumModel;
    this.complexModel = complexModel;
  }

  classifyComplexity(text: string): TaskComplexity {
    const lower = text.toLowerCase();
    if (COMPLEX_KEYWORDS.some(k => lower.includes(k))) return 'complex';
    if (SIMPLE_KEYWORDS.some(k => lower.includes(k)))  return 'simple';
    return 'medium';
  }

  private getModel(complexity: TaskComplexity): string {
    switch (complexity) {
      case 'simple':  return this.simpleModel;
      case 'complex': return this.complexModel;
      default:        return this.mediumModel;
    }
  }

  async streamResponse(
    text: string,
    history: ConversationMessage[],
    tools: AgentTool[],
    onStatus: (status: string) => void,
    onDelta: (delta: string) => void,
    onDone: (fullText: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const complexity = this.classifyComplexity(text);
    const model      = this.getModel(complexity);
    console.log(`[OpenRouter] Using model: ${model} (${complexity})`);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map(m => ({
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name        ? { name: m.name }                  : {}),
      })),
    ];

    // ── Tool-calling loop ────────────────────────────────────────────────────
    const openAiTools = tools.length > 0
      ? tools.map(t => ({ type: 'function' as const, function: t.function }))
      : undefined;

    let loopMessages = [...messages];
    let accumulated = '';

    for (let iteration = 0; iteration < 5; iteration++) {
      if (signal.aborted) return;

      const stream = await this.client.chat.completions.create({
        model,
        messages: loopMessages,
        tools: openAiTools,
        tool_choice: openAiTools ? 'auto' : undefined,
        stream: true,
      }, { signal });

      let fullContent = '';
      const toolCalls: Record<number, { id: string; name: string; args: string }> = {};
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        if (signal.aborted) return;
        const delta = chunk.choices[0]?.delta;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

        if (delta?.content) {
          fullContent += delta.content;
          accumulated += delta.content;
          onDelta(delta.content);
        }

        // Collect tool call fragments
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' };
            }
            if (tc.id)              toolCalls[idx].id   = tc.id;
            if (tc.function?.name)  toolCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
          }
        }
      }

      // No tool calls → done
      if (finishReason !== 'tool_calls' || Object.keys(toolCalls).length === 0) {
        break;
      }

      // Execute tool calls and loop
      const assistantMsg: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: Object.values(toolCalls).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      };
      loopMessages = [...loopMessages, assistantMsg];

      for (const tc of Object.values(toolCalls)) {
        const tool = tools.find(t => t.function.name === tc.name);
        if (!tool) continue;

        // Status update before executing
        const statusLabel = tc.name.replace(/_/g, ' ');
        onStatus(`${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}…`);

        let result: string;
        try {
          const args = JSON.parse(tc.args || '{}');
          // Tool execution is handled by tools.ts via the registry passed by agent.ts
          result = await (tool as any).__execute(args);
        } catch (err: any) {
          result = `Error: ${err.message}`;
        }

        loopMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    onDone(accumulated);
  }
}
