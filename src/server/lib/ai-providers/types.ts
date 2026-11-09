export type AiProvider = "groq" | "openai" | "anthropic" | "openrouter";

/** Image mime types every adapter is asked to support — kept to the 4 Anthropic accepts natively
 *  so a single whitelist works across all providers without per-provider capability branching. */
export const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: SupportedImageMimeType; base64: string };

/** A message's content is a plain string in every case except the CURRENT user turn when it
 *  carries an image attachment — history, assistant and tool messages are always strings. */
export type ChatContent = string | ChatContentPart[];

export interface ChatMessageParam {
  role: "user" | "assistant" | "tool";
  content: ChatContent;
  toolCalls?: ToolCallRequest[]; // present on an "assistant" message that requested tool calls
  tool_call_id?: string; // present when role === "tool" (which call this result answers)
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object, provider-agnostic
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatCompletionRequest {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  messages: ChatMessageParam[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Pede a resposta como objeto JSON (Groq/OpenAI: response_format json_object). */
  jsonMode?: boolean;
  /** Esforço de raciocínio dos modelos gpt-oss na Groq. */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ChatCompletionResult {
  text: string | null;
  toolCalls: ToolCallRequest[];
  stopReason: "end_turn" | "tool_calls" | "max_tokens" | "error";
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AiProviderAdapter {
  id: AiProvider;
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}
