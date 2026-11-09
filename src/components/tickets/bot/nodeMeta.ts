import {
  Clock,
  Globe,
  GitBranch,
  HelpCircle,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Music,
  PenLine,
  Flag,
  Tag,
  Bell,
  UserRound,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

export type NodeType =
  | "message"
  | "question"
  | "menu"
  | "condition"
  | "set_variable"
  | "wait"
  | "add_tag"
  | "transfer_queue"
  | "transfer_agent"
  | "notify_agent"
  | "http_request"
  | "image"
  | "video"
  | "audio"
  | "end";

export interface NodeMeta {
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
  /** Nós que encerram o fluxo: não têm saída. */
  terminal?: boolean;
  defaults: () => Record<string, unknown>;
}

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newId = uid;

export const NODE_META: Record<NodeType, NodeMeta> = {
  message: { label: "Mensagem", hint: "Envia um texto ao cliente", icon: MessageSquare, color: "#4C9BFF", defaults: () => ({ text: "Olá, {{name}}! 👋" }) },
  question: { label: "Pergunta", hint: "Pergunta e guarda a resposta", icon: HelpCircle, color: "#9B7BFF", defaults: () => ({ prompt: "Qual é o seu nome completo?", variable: "nome" }) },
  menu: {
    label: "Menu",
    hint: "Opções numeradas, cada uma com um caminho",
    icon: ListChecks,
    color: "#EC1889",
    defaults: () => ({ prompt: "Como podemos ajudar?", options: [{ id: uid("o"), label: "Suporte", keywords: "ajuda, problema, erro" }, { id: uid("o"), label: "Comercial", keywords: "comprar, preço, orçamento" }], fallbackMessage: "" }),
  },
  condition: { label: "Condição", hint: "Segue por Sim ou Não", icon: GitBranch, color: "#F7B32B", defaults: () => ({ variable: "__isBusinessHours", operator: "equals", value: "true" }) },
  set_variable: { label: "Definir variável", hint: "Guarda um valor para usar depois", icon: PenLine, color: "#2DD4BF", defaults: () => ({ variable: "", value: "" }) },
  wait: { label: "Esperar", hint: "Pausa o fluxo por um tempo", icon: Clock, color: "#8A8A94", defaults: () => ({ minutes: 30 }) },
  add_tag: { label: "Etiquetar", hint: "Aplica etiquetas ao atendimento", icon: Tag, color: "#2BD47D", defaults: () => ({ tagIds: [] }) },
  transfer_queue: { label: "Enviar para fila", hint: "Encaminha para uma fila e passa para a equipe", icon: Users, color: "#FF5CAE", terminal: true, defaults: () => ({ queueId: null }) },
  transfer_agent: { label: "Enviar para atendente", hint: "Atribui a uma pessoa e passa para a equipe", icon: UserRound, color: "#FF5CAE", terminal: true, defaults: () => ({ userId: null }) },
  notify_agent: { label: "Avisar equipe", hint: "Nota interna + notificação ao responsável", icon: Bell, color: "#F7B32B", defaults: () => ({ message: "", userId: null }) },
  http_request: { label: "Chamar API", hint: "Requisição HTTP (sucesso / erro)", icon: Globe, color: "#2DD4BF", defaults: () => ({ method: "GET", url: "https://", headers: [], body: "", variable: "resposta" }) },
  image: { label: "Imagem", hint: "Envia uma imagem por URL", icon: ImageIcon, color: "#4C9BFF", defaults: () => ({ url: "https://", caption: "" }) },
  video: { label: "Vídeo", hint: "Envia um vídeo por URL", icon: Video, color: "#4C9BFF", defaults: () => ({ url: "https://", caption: "" }) },
  audio: { label: "Áudio", hint: "Envia um áudio por URL (como mensagem de voz)", icon: Music, color: "#4C9BFF", defaults: () => ({ url: "https://" }) },
  end: { label: "Fim", hint: "Encerra o fluxo (com mensagem opcional)", icon: Flag, color: "#8A8A94", terminal: true, defaults: () => ({ text: "" }) },
};

export const NODE_GROUPS: { label: string; types: NodeType[] }[] = [
  { label: "Conversa", types: ["message", "question", "menu", "image", "video", "audio"] },
  { label: "Lógica", types: ["condition", "set_variable", "wait", "http_request"] },
  { label: "Atendimento", types: ["add_tag", "notify_agent", "transfer_queue", "transfer_agent", "end"] },
];

export function summarize(type: NodeType, data: Record<string, any>): string {
  switch (type) {
    case "message":
      return data.text || "—";
    case "question":
      return data.prompt || "—";
    case "menu":
      return `${data.prompt || "—"} · ${(data.options || []).length} opções`;
    case "condition":
      return `${data.variable || "?"} ${data.operator || "="} ${data.value ?? ""}`;
    case "set_variable":
      return `${data.variable || "?"} = ${data.value ?? ""}`;
    case "wait":
      return `${data.minutes ?? 0} min`;
    case "add_tag":
      return `${(data.tagIds || []).length} etiqueta(s)`;
    case "transfer_queue":
      return data.queueId ? `Fila: ${data.__queueName ?? `#${data.queueId}`}` : "Escolha a fila";
    case "transfer_agent":
      return data.userId ? `Atendente: ${data.__userName ?? `#${data.userId}`}` : "Escolha o atendente";
    case "notify_agent":
      return data.message || "—";
    case "http_request":
      return `${data.method || "GET"} ${data.url || ""}`;
    case "image":
    case "video":
    case "audio":
      return data.url || "—";
    case "end":
      return data.text || "Encerra o fluxo";
  }
}
