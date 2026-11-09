import type { AiProvider } from "@/src/services/ai-credential.service";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
};

export interface ModelOption {
  id: string;
  label: string;
}

// Mirrors src/server/lib/ai-providers/models.ts — kept in sync manually since it's a small,
// infrequently-changed static list (no need for a round-trip just to populate a picker).
export const PROVIDER_MODELS: Record<AiProvider, ModelOption[]> = {
  groq: [
    // Llama 3.1/3.3 require a Groq Enterprise contract ("Contact Sales") — a standard API
    // key gets a 404 model_not_found on these. Kept in the list (labeled) since some
    // accounts do have access; GPT-OSS below are the ones available self-serve.
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Enterprise)" },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Enterprise)" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  ],
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (via OpenRouter)" },
    { id: "openai/gpt-4.1", label: "GPT-4.1 (via OpenRouter)" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OpenRouter)" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)" },
  ],
};

export interface AgentToolOption {
  name: string;
  label: string;
  description: string;
}

// Mirrors the named handlers in src/server/lib/ai-providers/tools/registry.ts.
export const AVAILABLE_TOOLS: AgentToolOption[] = [
  { name: "create_task", label: "Criar tarefa", description: "Cria uma tarefa em um projeto do CollabSuite." },
  {
    name: "send_whatsapp_message",
    label: "Enviar WhatsApp",
    description: "Envia uma mensagem via uma conexão de WhatsApp do usuário.",
  },
  {
    name: "get_project_summary",
    label: "Resumo de projeto",
    description: "Consulta (somente leitura) o status das tarefas de um projeto.",
  },
  {
    name: "generate_image",
    label: "Gerar imagem",
    description: "Gera uma imagem a partir de uma descrição (Nano Banana via OpenRouter) e salva na galeria.",
  },
  {
    name: "get_icp",
    label: "Usar ICPs",
    description: "Consulta os perfis de cliente ideal (ICPs) cadastrados para usar como contexto na conversa.",
  },
  {
    name: "create_carousel_design",
    label: "Criar carrossel de design",
    description:
      "A partir de um roteiro, gera um carrossel completo (2 a 10 slides, com imagens por IA) e salva pronto no Design Studio.",
  },
  {
    name: "generate_file",
    label: "Gerar arquivo",
    description: "Gera um arquivo para download (PDF, Word, Excel ou texto/markdown) a partir de um conteúdo.",
  },
];

export const AGENT_AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

export const AGENT_AVATAR_EMOJIS = ["🤖", "🧠", "✨", "🚀", "📊", "✍️", "🎨", "🔎", "📣", "🛠️"];
