import type { AiProviderAdapter, ChatCompletionRequest, ChatCompletionResult, ChatMessageParam, ToolCallRequest } from "./types";

interface OpenAiCompatibleConfig {
  id: "groq" | "openai" | "openrouter";
  baseUrl: string;
  extraHeaders?: Record<string, string>;
}

/** Builds OpenAI's multipart content array for a message with an image attachment; plain-text
 *  messages keep going through as a bare string (works identically, less payload noise). */
function toOpenAiContent(content: ChatMessageParam["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.base64}` } }
  );
}

function toOpenAiMessages(systemPrompt: string | undefined, messages: ChatMessageParam[]) {
  const out: Record<string, unknown>[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: (typeof m.content === "string" ? m.content : null) || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.tool_call_id, content: typeof m.content === "string" ? m.content : "" });
    } else {
      out.push({ role: m.role, content: toOpenAiContent(m.content) });
    }
  }
  return out;
}

/** Factory reused for Groq, OpenAI and OpenRouter — all three speak the OpenAI chat/completions shape. */
export function createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig): AiProviderAdapter {
  return {
    id: config.id,
    async chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toOpenAiMessages(req.systemPrompt, req.messages),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
      };
      if (req.jsonMode && (config.id === "groq" || config.id === "openai")) body.response_format = { type: "json_object" };
      if (req.reasoningEffort && config.id === "groq" && req.model.toLowerCase().includes("gpt-oss")) {
        body.reasoning_effort = req.reasoningEffort;
      }
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          "Content-Type": "application/json",
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${config.id} chat failed (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const message = choice?.message;
      const rawToolCalls = message?.tool_calls as Array<{ id: string; function?: { name: string; arguments?: string } }> | undefined;

      const toolCalls: ToolCallRequest[] = (rawToolCalls || []).map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        return { id: tc.id, name: tc.function?.name || "", arguments: args };
      });

      return {
        text: message?.content ?? null,
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool_calls" : choice?.finish_reason === "length" ? "max_tokens" : "end_turn",
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : undefined,
      };
    },
  };
}
