import api from "./api";
import type { ProposalTemplate } from "@/src/types";

export async function listTemplates(): Promise<ProposalTemplate[]> {
  const res = await api.get("/proposal-templates");
  return res.data;
}

export async function getTemplate(id: number): Promise<ProposalTemplate> {
  const res = await api.get(`/proposal-templates/${id}`);
  return res.data;
}

export async function createTemplate(data: {
  name: string;
  cover?: string | null;
  about_company?: string | null;
  about_work?: string | null;
  values?: string | null;
  thank_you?: string | null;
  styles?: string | null;
  design?: string;
  theme?: string | null;
  slides?: string | null;
}): Promise<ProposalTemplate> {
  const res = await api.post("/proposal-templates", data);
  return res.data;
}

export async function updateTemplate(id: number, data: Partial<{
  name: string;
  cover: string | null;
  about_company: string | null;
  about_work: string | null;
  values: string | null;
  thank_you: string | null;
  styles: string | null;
  is_default: boolean;
  design: string;
  theme: string | null;
  slides: string | null;
}>): Promise<ProposalTemplate> {
  const res = await api.put(`/proposal-templates/${id}`, data);
  return res.data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/proposal-templates/${id}`);
}
