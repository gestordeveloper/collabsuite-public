import { prisma } from "../../lib/prisma";
import { runExclusive } from "../../lib/keyedMutex";
import { resumeSession } from "./engine";

const TICK_MS = 30_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

/** Acorda sessões paradas num nó `wait` cujo prazo venceu e segue o fluxo. */
async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await prisma.botFlowSession.findMany({
      where: { status: "waiting_timer", resume_at: { lte: new Date() } },
      include: { flow: true, ticket: { include: { contact: true } } },
      take: 50,
    });

    for (const session of due) {
      const { flow, ticket } = session;
      // Fecha a corrida com a mensagem do cliente (que também pode retomar a sessão): só um dos dois segue.
      await runExclusive(`bot-session:${session.id}`, async () => {
        const fresh = await prisma.botFlowSession.findUnique({ where: { id: session.id } });
        if (!fresh || fresh.status !== "waiting_timer") return;
        if (!flow.published_graph || !flow.is_active) {
          await prisma.botFlowSession.update({ where: { id: fresh.id }, data: { status: "completed", resume_at: null } });
          return;
        }
        if (flow.status_filter) {
          const allowed: string[] = JSON.parse(flow.status_filter);
          if (!allowed.includes(ticket.status)) {
            await prisma.botFlowSession.update({ where: { id: fresh.id }, data: { status: "completed", resume_at: null } });
            return;
          }
        }
        await resumeSession(fresh, flow, { connectionId: ticket.connection_id, ticketId: ticket.id, contact: ticket.contact });
      }).catch((err) => console.error(`[bot-worker] Falha ao retomar a sessão ${session.id}:`, err));
    }
  } catch (err) {
    console.error("[bot-worker] Erro no ciclo:", err);
  } finally {
    running = false;
  }
}

export function startBotWorker() {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}
