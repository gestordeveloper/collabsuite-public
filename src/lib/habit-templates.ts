import type { HabitPayload } from "@/src/services/habit.service";
import { ACCENT_COLORS } from "@/src/lib/design";

/** Rotinas prontas para quem gerencia produto e equipe. Cada uma já vem com dias, horário e passos. */
export interface HabitTemplate {
  id: string;
  title: string;
  /** Quando/por que fazer — aparece no catálogo. */
  blurb: string;
  payload: HabitPayload & { name: string; kind: "routine"; checklist: string[] };
}

const [PINK_C, VIOLET, BLUE, TEAL, AMBER, GREEN] = ACCENT_COLORS;

export const WEEKDAYS_ONLY = [1, 2, 3, 4, 5];

export const PO_TEMPLATES: HabitTemplate[] = [
  {
    id: "planning",
    title: "Planejamento da semana",
    blurb: "Segunda cedo: define o que importa antes de a semana te levar.",
    payload: {
      name: "Planejamento da semana",
      description: "Prioridades, capacidade do time e riscos",
      kind: "routine",
      color: VIOLET,
      target_per_week: 1,
      reminder_time: "08:30",
      reminder_days: [1],
      checklist: [
        "Rever o resumo da semana passada",
        "Escolher as 3 prioridades da semana",
        "Conferir a capacidade e as ausências do time",
        "Listar riscos e dependências",
        "Alinhar o foco com a equipe",
      ],
    },
  },
  {
    id: "daily",
    title: "Daily com a equipe",
    blurb: "Alinhamento rápido de segunda a sexta: bloqueios e foco do dia.",
    payload: {
      name: "Daily com a equipe",
      description: "Bloqueios, foco do dia e decisões",
      kind: "routine",
      color: BLUE,
      target_per_week: 5,
      reminder_time: "09:00",
      reminder_days: WEEKDAYS_ONLY,
      checklist: [
        "Olhar o quadro e os itens parados",
        "Ouvir bloqueios de cada pessoa",
        "Definir quem precisa de apoio hoje",
        "Registrar decisões e combinados",
      ],
    },
  },
  {
    id: "backlog-review",
    title: "Revisão do backlog",
    blurb: "Mantém o backlog saudável: priorizado, claro e sem lixo.",
    payload: {
      name: "Revisão do backlog",
      description: "Priorizar, detalhar e limpar o backlog",
      kind: "routine",
      color: TEAL,
      target_per_week: 1,
      reminder_time: "10:00",
      reminder_days: [2],
      checklist: [
        "Priorizar o topo do backlog",
        "Detalhar critérios de aceite dos próximos itens",
        "Quebrar histórias grandes",
        "Descartar ou arquivar o que ficou obsoleto",
        "Confirmar dúvidas com quem vai executar",
      ],
    },
  },
  {
    id: "one-on-one",
    title: "1:1 com a equipe",
    blurb: "Conversa individual: bloqueios, carga, feedback e próximos passos.",
    payload: {
      name: "1:1 com a equipe",
      description: "Uma conversa por pessoa, com pauta",
      kind: "routine",
      color: GREEN,
      target_per_week: 2,
      reminder_time: "14:00",
      reminder_days: [3, 4],
      checklist: [
        "Rever as anotações do último 1:1",
        "Perguntar sobre bloqueios e carga de trabalho",
        "Dar um feedback específico (positivo ou de ajuste)",
        "Combinar próximos passos e registrar",
      ],
    },
  },
  {
    id: "stakeholders",
    title: "Atualização para stakeholders",
    blurb: "Ninguém deve descobrir atraso por acaso: status curto e honesto.",
    payload: {
      name: "Atualização para stakeholders",
      description: "Status, riscos e pedidos de decisão",
      kind: "routine",
      color: AMBER,
      target_per_week: 1,
      reminder_time: "15:00",
      reminder_days: [4],
      checklist: [
        "O que foi entregue desde a última atualização",
        "O que está em risco e o plano",
        "Decisões que dependem deles",
        "Próximas entregas e datas",
      ],
    },
  },
  {
    id: "weekly-review",
    title: "Review da semana",
    blurb: "Sexta: fecha o ciclo, aprende e escolhe o foco da próxima semana.",
    payload: {
      name: "Review da semana",
      description: "Entregas, atrasos e aprendizados",
      kind: "routine",
      color: PINK_C,
      target_per_week: 1,
      reminder_time: "16:00",
      reminder_days: [5],
      checklist: [
        "Abrir o Resumo semanal aqui nos Hábitos",
        "Conferir o que foi entregue e o que atrasou (e por quê)",
        "Atualizar prioridades e roadmap",
        "Cobrar pendências da equipe",
        "Escolher o foco da próxima semana",
      ],
    },
  },
  {
    id: "metrics",
    title: "Revisão de métricas",
    blurb: "Olhar os números com calma para decidir com dados.",
    payload: {
      name: "Revisão de métricas",
      description: "Indicadores de entrega e de produto",
      kind: "routine",
      color: BLUE,
      target_per_week: 1,
      reminder_time: "11:00",
      reminder_days: [3],
      checklist: [
        "Abrir Relatórios e ver a produtividade da semana",
        "Comparar com a semana anterior",
        "Anotar uma hipótese e uma ação para o que mudou",
      ],
    },
  },
  {
    id: "day-close",
    title: "Fechamento do dia",
    blurb: "Cinco minutos para encerrar com clareza e acordar sem pendência na cabeça.",
    payload: {
      name: "Fechamento do dia",
      description: "Revisar o foco e preparar amanhã",
      kind: "routine",
      color: VIOLET,
      target_per_week: 5,
      reminder_time: "17:45",
      reminder_days: WEEKDAYS_ONLY,
      checklist: [
        "Fazer a revisão do Foco do dia",
        "Atualizar o status das tarefas",
        "Anotar o que fica para amanhã",
      ],
    },
  },
];

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "Seg a Sex", "Ter", "Todos os dias"… */
export function formatReminderDays(days: number[] | null): string {
  if (!days || days.length === 0 || days.length >= 7) return "todos os dias";
  const sorted = [...days].sort();
  if (sorted.join(",") === "1,2,3,4,5") return "Seg a Sex";
  return sorted.map((d) => WEEKDAY_LABELS[d]).join(", ");
}
