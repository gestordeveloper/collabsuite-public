import Anthropic from "@anthropic-ai/sdk";
import type { AiProviderAdapter, ChatCompletionRequest, ChatCompletionResult, ChatMessageParam, ToolCallRequest } from "./types";

/** Builds Anthropic's content blocks for a message with an image attachment; plain-text messages
 *  keep going through as a bare string (works identically, less payload noise). */
function toAnthropicContent(content: ChatMessageParam["content"]): string | Anthropic.ContentBlockParam[] {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : { type: "image" as const, source: { type: "base64" as const, media_type: part.mimeType, data: part.base64 } }
  );
}

function toAnthropicMessages(messages: ChatMessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  function flushToolResults() {
    if (pendingToolResults.length) {
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  }

  for (const m of messages) {
    if (m.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: m.tool_call_id!,
        content: typeof m.content === "string" ? m.content : "",
      });
      continue;
    }
    flushToolResults();

    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (typeof m.content === "string" && m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content });
    } else {
      out.push({ role: m.role === "assistant" ? "assistant" : "user", content: toAnthropicContent(m.content) });
    }
  }
  flushToolResults();
  return out;
}

/** Anthropic's Messages API shape differs meaningfully from the OpenAI-compatible providers:
 *  system prompt is a top-level field (not a message), tools use `input_schema` (not
 *  `function.parameters`), and tool_use.input already arrives parsed (not a JSON string). */
export function createAnthropicAdapter(): AiProviderAdapter {
  return {
    id: "anthropic",
    async chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const client = new Anthropic({ apiKey: req.apiKey });

      const response = await client.messages.create({
        model: req.model,
        system: req.systemPrompt,
        messages: toAnthropicMessages(req.messages),
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.7,
        tools: req.tools?.length
          ? req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema }))
          : undefined,
      });

      let text: string | null = null;
      const toolCalls: ToolCallRequest[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          text = (text || "") + block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, arguments: block.input as Record<string, unknown> });
        }
      }

      return {
        text,
        toolCalls,
        stopReason: response.stop_reason === "tool_use" ? "tool_calls" : response.stop_reason === "max_tokens" ? "max_tokens" : "end_turn",
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
