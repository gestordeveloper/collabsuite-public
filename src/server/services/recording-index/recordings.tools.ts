import { prisma } from "../../lib/prisma";
import type { ToolDefinition } from "../../lib/ai-providers/types";
import type { ExtraToolset } from "../agent-run.service";
import { accessWhere } from "../recording.service";
import { dateStrOf, dayStartUtc, addDays, isDate } from "../agent-calendar/calendar.service";
import { isIndexConfigured, searchRecordingChunks } from "./index.service";

/**
 * Ferramentas de análise de gravações para o agente. Sempre restritas ao que o usuário pode ver
 * (dono ou membro do projeto). Só são oferecidas no chat web e no Telegram, nunca ao cliente final do WhatsApp.
 */

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const parseJson = <T>(v: string | null, fb: T): T => {
  try {
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const clip = (s: string | null | undefined, n: number) => ((s ?? "").length > n ? (s ?? "").slice(0, n) + "…" : (s ?? ""));
const clock = (sec: number | null) => (sec ? `${Math.floor(sec / 60)} min` : null);

const filterProps = {
  data_inicio: { type: "string", description: "AAAA-MM-DD (opcional)" },
  data_fim: { type: "string", description: "AAAA-MM-DD, inclusive (opcional)" },
  projeto_id: { type: "number", description: "Restringe a um projeto (opcional)" },
  tipo: { type: "string", description: "Tipo da gravação, ex.: Reunião (opcional)" },
};

export function openRecordingsToolset(ctx: { userId: number; companyId: number | null }): ExtraToolset & { promptNote: string } {
  const promptNote = `Você tem acesso às gravações (reuniões, ligações) do usuário e às análises delas.
- Para responder perguntas sobre o que foi dito: use buscar_nas_gravacoes (busca semântica por trecho) e, se precisar de contexto, ler_gravacao.
- Para relatórios (por período, projeto ou tema): chame dados_para_relatorio, aprofunde com buscar_nas_gravacoes quando faltar evidência e só então escreva.
- Sempre cite a origem de cada afirmação: título da gravação, data e minuto (ex.: "Alinhamento do projeto X, 12/10, 14:32"). Nunca invente: se não achar, diga que não encontrou nas gravações.
- Seja objetivo: relatórios com decisões, responsáveis, prazos, riscos e pendências, sem encher de texto.`;

  const definitions: ToolDefinition[] = [
    {
      name: "buscar_nas_gravacoes",
      description: "Busca semântica nas transcrições e resumos das gravações. Retorna trechos com gravação, data e minuto.",
      parameters: {
        type: "object",
        properties: { consulta: { type: "string", description: "O que procurar, em linguagem natural" }, ...filterProps, limite: { type: "number", description: "Trechos a retornar (1 a 12; padrão 8)" } },
        required: ["consulta"],
      },
    },
    {
      name: "listar_gravacoes",
      description: "Lista gravações (id, título, data, tipo, participantes e resumo curto) com filtros.",
      parameters: { type: "object", properties: { ...filterProps, texto: { type: "string", description: "Palavra no título/resumo (opcional)" }, limite: { type: "number", description: "1 a 30; padrão 15" } } },
    },
    {
      name: "ler_gravacao",
      description: "Lê uma gravação: a análise (resumo, decisões, riscos, próximos passos, ações) ou um trecho da transcrição.",
      parameters: {
        type: "object",
        properties: {
          gravacao_id: { type: "number" },
          parte: { type: "string", enum: ["analise", "transcricao"], description: "padrão: analise" },
          deslocamento: { type: "number", description: "Para a transcrição: caractere inicial (padrão 0)" },
        },
        required: ["gravacao_id"],
      },
    },
    {
      name: "dados_para_relatorio",
      description: "Reúne, de várias gravações de um período/projeto, resumo, decisões, riscos, próximos passos e ações, para você montar um relatório consolidado.",
      parameters: { type: "object", properties: { ...filterProps, limite: { type: "number", description: "Gravações (1 a 30; padrão 20)" } } },
    },
  ];

  /** Gravações visíveis ao usuário já com os filtros de período/projeto/tipo aplicados. */
  async function scope(args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    if (args.data_inicio !== undefined && !isDate(args.data_inicio)) throw new Error("data_inicio inválida (use AAAA-MM-DD).");
    if (args.data_fim !== undefined && !isDate(args.data_fim)) throw new Error("data_fim inválida (use AAAA-MM-DD).");
    const range: Record<string, Date> = {};
    if (args.data_inicio) range.gte = dayStartUtc(args.data_inicio as string);
    if (args.data_fim) range.lt = dayStartUtc(addDays(args.data_fim as string, 1));
    return {
      status: "done" as const,
      transcript: { not: null },
      AND: [accessWhere(ctx.userId)],
      ...(Object.keys(range).length ? { recorded_at: range } : {}),
      ...(args.projeto_id ? { project_id: num(args.projeto_id) } : {}),
      ...(args.tipo ? { tipo: String(args.tipo) } : {}),
      ...extra,
    };
  }

  const head = (r: { id: number; title: string; recorded_at: Date; tipo: string; duration_seconds: number | null; project?: { name: string } | null }) => ({
    gravacao_id: r.id,
    titulo: r.title,
    data: dateStrOf(r.recorded_at),
    tipo: r.tipo,
    duracao: clock(r.duration_seconds),
    projeto: r.project?.name ?? null,
  });

  async function execute(name: string, args: Record<string, unknown>): Promise<string | null> {
    try {
      switch (name) {
        case "buscar_nas_gravacoes": {
          const consulta = String(args.consulta ?? "").trim();
          if (!consulta) throw new Error("Informe o que buscar.");
          const k = Math.min(12, Math.max(1, Math.floor(num(args.limite) || 8)));
          const rows = await prisma.recording.findMany({
            where: await scope(args),
            select: { id: true, title: true, recorded_at: true, tipo: true, duration_seconds: true, indexed_at: true, transcript: true, project: { select: { name: true } } },
            orderBy: { recorded_at: "desc" },
            take: 3000,
          });
          if (!rows.length) return JSON.stringify({ resultados: [], observacao: "Nenhuma gravação encontrada com esses filtros." });
          const byId = new Map(rows.map((r) => [r.id, r]));

          type Row = (typeof rows)[number];
          const keyword = (pool: Row[], limit: number) => {
            const terms = consulta.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
            return pool
              .map((r) => {
                const text = r.transcript ?? "";
                const lower = text.toLowerCase();
                const pos = terms.map((t) => lower.indexOf(t)).filter((p) => p >= 0);
                return { r, score: pos.length, at: pos.length ? Math.min(...pos) : -1, text };
              })
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, limit)
              .map((x) => ({ ...head(x.r), origem: "palavra-chave", trecho: clip(x.text.slice(Math.max(0, x.at - 200)), 900) }));
          };

          const indexed = rows.filter((r) => r.indexed_at);
          const notIndexed = rows.filter((r) => !r.indexed_at);
          if (isIndexConfigured() && indexed.length) {
            try {
              const hits = await searchRecordingChunks(ctx.userId, ctx.companyId, consulta, indexed.map((r) => r.id), k);
              const semantic = hits.filter((h) => byId.has(h.recording_id)).map((h) => ({ ...head(byId.get(h.recording_id)!), minuto: h.start, origem: h.chunk_type, relevancia: Number(h.score.toFixed(3)), trecho: clip(h.text, 1000) }));
              // Gravações ainda fora do índice não ficam invisíveis: entram por palavra-chave.
              const extra = notIndexed.length ? keyword(notIndexed, Math.max(2, Math.floor(k / 3))) : [];
              return JSON.stringify({ resultados: [...semantic, ...extra], observacao: notIndexed.length ? `${notIndexed.length} gravação(ões) ainda não indexada(s): para elas a busca é só por palavra-chave.` : undefined });
            } catch (err: any) {
              console.warn("[recordings-tools] busca semântica falhou, usando palavra-chave:", err?.message || err);
              return JSON.stringify({ resultados: keyword(rows, k), observacao: "Busca por palavra-chave: a busca semântica falhou (verifique a credencial OpenAI e o Qdrant)." });
            }
          }
          return JSON.stringify({ resultados: keyword(rows, k), observacao: "Busca por palavra-chave: o índice semântico não está disponível/indexado." });
        }

        case "listar_gravacoes": {
          const limit = Math.min(30, Math.max(1, Math.floor(num(args.limite) || 15)));
          const texto = String(args.texto ?? "").trim();
          const rows = await prisma.recording.findMany({
            where: await scope(args, texto ? { OR: [{ title: { contains: texto } }, { summary: { contains: texto } }] } : {}),
            select: { id: true, title: true, recorded_at: true, tipo: true, duration_seconds: true, summary: true, participants: true, project: { select: { name: true } } },
            orderBy: { recorded_at: "desc" },
            take: limit,
          });
          return JSON.stringify({ total: rows.length, gravacoes: rows.map((r) => ({ ...head(r), participantes: parseJson<string[]>(r.participants, []), resumo: clip(r.summary, 300) })) });
        }

        case "ler_gravacao": {
          const r = await prisma.recording.findFirst({ where: { id: num(args.gravacao_id), AND: [accessWhere(ctx.userId)] }, include: { project: { select: { name: true } }, actions: { orderBy: { sort_order: "asc" } } } });
          if (!r) throw new Error("Gravação não encontrada ou sem permissão de acesso.");
          if (args.parte === "transcricao") {
            const from = Math.max(0, Math.floor(num(args.deslocamento) || 0));
            const text = r.transcript ?? "";
            const part = text.slice(from, from + 8000);
            return JSON.stringify({ ...head(r), deslocamento: from, proximo_deslocamento: from + part.length < text.length ? from + part.length : null, transcricao: part });
          }
          return JSON.stringify({
            ...head(r),
            resumo: r.summary,
            participantes: parseJson<string[]>(r.participants, []),
            temas: parseJson<string[]>(r.topics, []),
            decisoes: parseJson<{ checked: boolean; text: string }[]>(r.decisions, []).map((d) => d.text),
            riscos: parseJson<string[]>(r.risks, []),
            proximos_passos: parseJson<string[]>(r.next_steps, []),
            acoes: r.actions.map((a) => ({ acao: a.text, prioridade: a.priority, responsavel: a.owner_name, prazo: a.due_text, status: a.status })),
          });
        }

        case "dados_para_relatorio": {
          const limit = Math.min(30, Math.max(1, Math.floor(num(args.limite) || 20)));
          const rows = await prisma.recording.findMany({
            where: await scope(args),
            include: { project: { select: { name: true } }, actions: { orderBy: { sort_order: "asc" } } },
            orderBy: { recorded_at: "asc" },
            take: limit,
          });
          const total = await prisma.recording.count({ where: await scope(args) });
          return JSON.stringify({
            total_no_periodo: total,
            incluidas: rows.length,
            aviso: total > rows.length ? "Há mais gravações do que o limite; refine o período ou o projeto para cobrir todas." : undefined,
            gravacoes: rows.map((r) => ({
              ...head(r),
              participantes: parseJson<string[]>(r.participants, []),
              resumo: clip(r.summary, 700),
              decisoes: parseJson<{ text: string }[]>(r.decisions, []).slice(0, 8).map((d) => clip(d.text, 200)),
              riscos: parseJson<string[]>(r.risks, []).slice(0, 6).map((x) => clip(x, 200)),
              proximos_passos: parseJson<string[]>(r.next_steps, []).slice(0, 8).map((x) => clip(x, 200)),
              acoes: r.actions.slice(0, 10).map((a) => `${a.text}${a.owner_name ? ` — ${a.owner_name}` : ""}${a.due_text ? ` (${a.due_text})` : ""} [${a.priority}, ${a.status}]`),
            })),
          });
        }
        default:
          return null;
      }
    } catch (err: any) {
      return JSON.stringify({ sucesso: false, erro: err?.message || "Falha ao consultar as gravações." });
    }
  }

  return { definitions, execute, promptNote };
}
