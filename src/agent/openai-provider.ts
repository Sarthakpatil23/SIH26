// OpenAI-compatible provider client for OmniRoute, DeepSeek, OpenRouter, and custom endpoints.
// Supports streaming SSE, tool calling, DeepSeek reasoning_content, and multi-turn browser automation.

import type { CustomProviderConfig, ToolCallRecord, WSMessage } from '../types.js';
import type { ToolHandler, BrowserToolContext } from './tools/browser.js';

export interface ChatTurnOptions {
  config: CustomProviderConfig;
  model: string;
  systemPrompt: string;
  prompt: string;
  tools: ToolHandler[];
  disabledTools?: Set<string>;
  browserContext: BrowserToolContext;
  emit: (msg: WSMessage) => void;
  signal?: AbortSignal;
  visionFrame?: {
    base64: string;
    mimeType: string;
    width: number;
    height: number;
    dpr: number;
  } | null;
}

/** Test connectivity to an OpenAI-compatible endpoint like OmniRoute or DeepSeek. */
export async function testProviderConnection(
  config: CustomProviderConfig,
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return { ok: false, error: 'Base URL is required' };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // 1. First try GET /models
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const models: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (item?.id && typeof item.id === 'string') models.push(item.id);
        }
      }
      return { ok: true, models: models.slice(0, 50) };
    }
  } catch {
    // /models might not be exposed or timed out; fall back to a minimal completion
  }

  // 2. Fallback: test minimal chat completion
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const testModel = config.defaultModel || config.models[0] || 'deepseek-chat';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return { ok: true, models: config.models };
    }
    const errText = await res.text().catch(() => res.statusText);
    return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Connection failed or timed out' };
  }
}

function normalizeOmniRouteModel(model: string, config: CustomProviderConfig): string {
  if (!model) return config.defaultModel || config.models[0] || 'auto';
  if (config.type === 'omniroute' || config.baseUrl.includes('20128') || config.name.toLowerCase().includes('omniroute')) {
    const m = model.toLowerCase().trim();
    if (m === 'gemini-3.7-flash' || m === 'gemini-3.7' || m === 'gemini-3.7-flash-high' || m === 'gemini') {
      return 'antigravity/gemini-3.7-flash-high';
    }
    if (m === 'gemini-3.7-flash-medium') {
      return 'antigravity/gemini-3.7-flash-medium';
    }
    if (m === 'gemini-3.7-flash-low') {
      return 'antigravity/gemini-3.7-flash-low';
    }
  }
  return model;
}

/** Execute a full browser agent chat turn through a custom OpenAI-compatible provider. */
export async function executeCustomProviderTurn(
  options: ChatTurnOptions,
): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const {
    config,
    model,
    systemPrompt,
    prompt,
    tools,
    disabledTools = new Set(),
    browserContext,
    emit,
    signal,
  } = options;

  const resolvedModel = normalizeOmniRouteModel(model, config);
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Filter tools and format for OpenAI function calling schema
  const activeToolHandlers = tools.filter((t) => !disabledTools.has(t.def.name));
  const openAiTools = activeToolHandlers.map((h) => ({
    type: 'function',
    function: {
      name: h.def.name,
      description: h.def.description,
      parameters: h.def.parameters,
    },
  }));

  let initialUserContent: any = prompt;
  if (options.visionFrame) {
    initialUserContent = [
      { type: 'text', text: prompt },
      {
        type: 'image_url',
        image_url: {
          url: `data:${options.visionFrame.mimeType};base64,${options.visionFrame.base64}`,
        },
      },
    ];
  }

  const messages: Array<Record<string, any>> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialUserContent },
  ];

  const visionState: { pendingFrame: { base64: string; mimeType: string; width: number; height: number; dpr: number } | null } = {
    pendingFrame: null,
  };
  const toolContext: BrowserToolContext = {
    ...browserContext,
    onVisionCaptured: (frame) => {
      visionState.pendingFrame = frame;
    },
  };

  const executedToolCalls: ToolCallRecord[] = [];
  let turnCount = 0;
  const MAX_TURNS = 25; // safety limit to prevent runaway loops
  let accumulatedFinalText = '';

  while (turnCount < MAX_TURNS) {
    turnCount++;
    if (signal?.aborted) {
      throw new Error('Chat generation cancelled by user.');
    }

    emit({ type: 'activity', event: 'llm_call_start', turn: turnCount });
    const tStart = Date.now();

    const requestBody: Record<string, any> = {
      model: resolvedModel,
      messages,
      stream: true,
    };
    if (openAiTools.length > 0) {
      requestBody.tools = openAiTools;
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => response.statusText);
      throw new Error(`${config.name || 'Provider'} error (${response.status}): ${errBody.slice(0, 300)}`);
    }

    if (!response.body) {
      throw new Error('No response stream received from provider.');
    }

    // Accumulators for this stream
    let turnAssistantText = '';
    const turnToolCallsMap = new Map<number, { id: string; name: string; args: string }>();

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(dataStr);
          const choice = parsed?.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // 1. Text stream
          if (delta.content) {
            turnAssistantText += delta.content;
            accumulatedFinalText += delta.content;
            emit({ type: 'delta', text: delta.content });
          }

          // 2. Reasoning stream (DeepSeek R1 / reasoner models)
          if (delta.reasoning_content) {
            emit({ type: 'reasoning', text: delta.reasoning_content });
          }

          // 3. Tool call chunks
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              let existing = turnToolCallsMap.get(idx);
              if (!existing) {
                existing = { id: tc.id || `call_${idx}_${Date.now()}`, name: '', args: '' };
                turnToolCallsMap.set(idx, existing);
              }
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
            }
          }
        } catch {
          // ignore partial JSON parse errors
        }
      }
    }

    const tDuration = Date.now() - tStart;
    emit({ type: 'activity', event: 'llm_call_end', durationMs: tDuration, turn: turnCount });

    // Check if tools were called
    const toolCallsToExecute = Array.from(turnToolCallsMap.values()).filter((tc) => tc.name);

    if (toolCallsToExecute.length === 0) {
      // Model responded with final text without tool calls
      break;
    }

    // Append the assistant's turn with tool_calls to the conversation history
    messages.push({
      role: 'assistant',
      content: turnAssistantText || null,
      tool_calls: toolCallsToExecute.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.args,
        },
      })),
    });

    // Execute each tool call
    for (const tc of toolCallsToExecute) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = tc.args ? JSON.parse(tc.args) : {};
      } catch {
        parsedArgs = { raw: tc.args };
      }

      emit({
        type: 'tool_step',
        id: tc.id,
        name: tc.name,
        args: parsedArgs,
        status: 'start',
      });

      const tToolStart = Date.now();
      let toolResult = '';
      let isError = false;

      const handler = activeToolHandlers.find((h) => h.def.name === tc.name);
      if (!handler) {
        toolResult = JSON.stringify({ error: `Tool ${tc.name} not found or disabled.` });
        isError = true;
      } else {
        try {
          toolResult = await handler.run(parsedArgs, toolContext);
        } catch (err: any) {
          toolResult = JSON.stringify({ error: err?.message || String(err) });
          isError = true;
        }
      }

      const toolDuration = Date.now() - tToolStart;
      executedToolCalls.push({
        name: tc.name,
        args: parsedArgs,
        result: toolResult,
        durationMs: toolDuration,
      });

      emit({
        type: 'tool_step',
        id: tc.id,
        name: tc.name,
        status: isError ? 'error' : 'end',
        result: toolResult,
        durationMs: toolDuration,
      });

      // Append tool result message for the model
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResult,
      });
    }

    // If a tool (like look_at_screen) captured a fresh vision frame during this turn,
    // inject an observation message with the image into the conversation history
    if (visionState.pendingFrame) {
      const frame = visionState.pendingFrame;
      visionState.pendingFrame = null;
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[Visual observation from look_at_screen] Fresh viewport screenshot (${frame.width}x${frame.height}) is attached below. You can now use click_coordinate or type_coordinate.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${frame.mimeType};base64,${frame.base64}`,
            },
          },
        ],
      });
    }

    // Now loop back to continue the conversation with tool outputs!
  }

  return {
    text: accumulatedFinalText || 'Done.',
    toolCalls: executedToolCalls,
  };
}
