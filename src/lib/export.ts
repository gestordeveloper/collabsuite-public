import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import type { Task, FunnelStage } from "@/src/types";
import type { Filters } from "@/src/components/kanban/FilterBar";

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

function describeFilters(filters?: Filters, stages?: FunnelStage[]): string | null {
  if (!filters) return null;
  const parts: string[] = [];

  if (filters.priority.length > 0) {
    const labels = filters.priority.map((p) => (p === "high" ? "Alta" : p === "medium" ? "Média" : "Baixa"));
    parts.push(`Prioridade: ${labels.join(", ")}`);
  }
  if (filters.stageId !== null) {
    const stageName = stages?.find((s) => s.id === filters.stageId)?.name ?? filters.stageId;
    parts.push(`Etapa: ${stageName}`);
  }
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? formatDate(filters.dateFrom) : "…";
    const to = filters.dateTo ? formatDate(filters.dateTo) : "…";
    parts.push(`Período: ${from} - ${to}`);
  }
  if (filters.hasChecklist === true) parts.push("Com checklist");
  if (filters.hasChecklist === false) parts.push("Sem checklist");
  if (filters.isOverdue === true) parts.push("Somente atrasadas");
  if (filters.isOverdue === false) parts.push("Não atrasadas");

  return parts.length > 0 ? parts.join("  |  ") : null;
}

interface ExportRow {
  prioridade: string;
  tarefa: string;
  responsaveis: string;
  checklist: string;
  prazo: string;
  etapa: string;
  status: string;
}

function buildRows(tasks: Task[], stages: FunnelStage[]): ExportRow[] {
  const stageMap = new Map(stages.map((s) => [s.id, s.name]));
  return tasks.map((t) => {
    const done = t.checklists?.filter((c) => c.is_done === true || c.is_done === 1).length ?? 0;
    const total = t.checklists?.length ?? 0;
    const assignees = [
      t.user?.first_name,
      ...(t.taskUsers?.map((tu) => tu.user?.first_name).filter(Boolean) ?? []),
    ]
      .filter(Boolean)
      .join(", ");

    return {
      prioridade:
        t.priority === "high" ? "Alta" : t.priority === "medium" ? "Média" : t.priority === "low" ? "Baixa" : "—",
      tarefa: t.title,
      responsaveis: assignees || "—",
      checklist: total > 0 ? `${done}/${total}` : "—",
      prazo: t.due_at
        ? new Date(t.due_at).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "—",
      etapa: stageMap.get(t.stage_id ?? 0) ?? "—",
      status: t.status === "done" ? "Concluído" : t.status === "pending" ? "Pendente" : t.status || "—",
    };
  });
}

const columns = [
  { header: "Prioridade", dataKey: "prioridade" },
  { header: "Tarefa", dataKey: "tarefa" },
  { header: "Responsáveis", dataKey: "responsaveis" },
  { header: "Checklist", dataKey: "checklist" },
  { header: "Prazo", dataKey: "prazo" },
  { header: "Etapa", dataKey: "etapa" },
  { header: "Status", dataKey: "status" },
];

export function exportToPDF(tasks: Task[], stages: FunnelStage[], projectName: string, filters?: Filters) {
  const doc = new jsPDF("landscape", "mm", "a4");
  const rows = buildRows(tasks, stages).map((r) => columns.map((c) => r[c.dataKey as keyof ExportRow]));
  const filterSummary = describeFilters(filters, stages);

  doc.setFontSize(14);
  doc.text(`Tarefas - ${projectName}`, 14, 18);
  doc.setFontSize(9);
  doc.text(`Exportado em: ${new Date().toLocaleDateString("pt-BR")}`, 14, 25);

  let startY = 30;
  if (filterSummary) {
    doc.text(`Filtros aplicados: ${filterSummary}`, 14, 31);
    startY = 36;
  }

  autoTable(doc, {
    head: [columns.map((c) => c.header)],
    body: rows,
    startY,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [79, 70, 229] as [number, number, number], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 250] as [number, number, number] },
  });

  doc.save(`tarefas-${projectName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
}

export function exportToExcel(tasks: Task[], stages: FunnelStage[], projectName: string, filters?: Filters) {
  const rows = buildRows(tasks, stages);
  const filterSummary = describeFilters(filters, stages);
  const wb = XLSX.utils.book_new();

  const headerLines: string[][] = [[`Tarefas - ${projectName}`]];
  if (filterSummary) headerLines.push([`Filtros aplicados: ${filterSummary}`]);

  const ws = XLSX.utils.aoa_to_sheet(headerLines);
  XLSX.utils.sheet_add_json(ws, rows, { origin: -1 });
  XLSX.utils.book_append_sheet(wb, ws, "Tarefas");

  const colWidths = [
    { wch: 10 },  // prioridade
    { wch: 50 },  // tarefa
    { wch: 25 },  // responsaveis
    { wch: 12 },  // checklist
    { wch: 14 },  // prazo
    { wch: 20 },  // etapa
    { wch: 14 },  // status
  ];
  ws["!cols"] = colWidths;

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `tarefas-${projectName.replace(/\s+/g, "-").toLowerCase()}.xlsx`);
}