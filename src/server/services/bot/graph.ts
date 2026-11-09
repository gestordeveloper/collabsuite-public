// Forma de BotFlow.draft_graph / published_graph depois do JSON.parse. Espelha o que o editor em canvas
// (React Flow) já usa: node.id/type/position/data e edge.source/target/sourceHandle — assim o grafo vai
// e volta do editor sem camada de tradução.

export type BotFlowNodeType =
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

export interface BotFlowMenuOption {
  id: string;
  label: string;
  /** Palavras separadas por vírgula/;: um texto que *contenha* alguma delas (ou o rótulo) escolhe a opção, além do número. */
  keywords?: string;
}

export interface BotFlowNode {
  id: string;
  type: BotFlowNodeType;
  position?: { x: number; y: number };
  // O formato de `data` depende do tipo:
  //  message        { text }
  //  question       { prompt, variable }
  //  menu           { prompt, options: BotFlowMenuOption[], fallbackMessage? }
  //  condition      { variable, operator: "equals"|"contains"|"gt"|"lt", value }   (saídas "true"/"false")
  //  set_variable   { variable, value }
  //  transfer_queue { queueId }
  //  transfer_agent { userId? }
  //  notify_agent   { message, userId? }
  //  wait           { minutes }
  //  add_tag        { tagIds: number[] }
  //  http_request   { method, url, headers: {key,value}[], body, variable }       (saídas "success"/"error")
  //  image|video|audio { url, caption? }
  //  end            { text? }
  data: Record<string, any>;
}

export interface BotFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Nós com mais de um caminho: id da opção do menu, ou "true"/"false" (condição), "success"/"error" (http). */
  sourceHandle?: string | null;
}

export interface BotFlowGraph {
  nodes: BotFlowNode[];
  edges: BotFlowEdge[];
  startNodeId: string;
}

export const EMPTY_GRAPH: BotFlowGraph = { nodes: [], edges: [], startNodeId: "" };

export const parseGraph = (raw: string | null | undefined): BotFlowGraph => {
  if (!raw) return EMPTY_GRAPH;
  try {
    const parsed = JSON.parse(raw);
    return {
      nodes: parsed.nodes || [],
      edges: parsed.edges || [],
      startNodeId: parsed.startNodeId || "",
    };
  } catch {
    return EMPTY_GRAPH;
  }
};

const normalize = (text: string): string =>
  (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const parseKeywords = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]/) : [];
  return list.map((item) => normalize(String(item))).filter(Boolean);
};

/**
 * Decide qual opção do menu o texto do cliente escolhe. Precedência:
 *  1. o número da opção ("1", "2." ou "3)") — só com `allowNumber`, porque na primeira mensagem um "1"
 *     solto não responde a um menu que o cliente ainda não viu;
 *  2. o rótulo digitado exatamente (sem caixa/acentos);
 *  3. o texto *contendo* o rótulo ou alguma palavra-chave da opção.
 * Um texto que acerta mais de uma opção é ambíguo e não escolhe nada (o menu é reenviado).
 */
export const matchMenuOption = (options: BotFlowMenuOption[], text: string, allowNumber = true): BotFlowMenuOption | null => {
  const normalized = normalize(text);
  if (!normalized) return null;

  if (allowNumber) {
    const numeric = normalized.match(/^(\d+)[.)]?$/);
    if (numeric) return options[parseInt(numeric[1], 10) - 1] ?? null;
  }

  const exact = options.find((option) => normalize(option.label) === normalized);
  if (exact) return exact;

  const hits = options.filter((option) =>
    [normalize(option.label), ...parseKeywords(option.keywords)].some((keyword) => keyword && normalized.includes(keyword))
  );
  return hits.length === 1 ? hits[0] : null;
};
