import api from "./api";

export type CredentialCategory = "website" | "server" | "database" | "email" | "api" | "other";

export interface Credential {
  id: number;
  project_id?: number | null;
  user_id?: number | null;
  title: string;
  category?: CredentialCategory | string | null;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  has_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface CredentialPayload {
  title: string;
  category?: CredentialCategory | string;
  username?: string | null;
  password?: string | null;
  url?: string | null;
  notes?: string | null;
}

export async function fetchCredentials(projectId: number) {
  const { data } = await api.get(`/projects/${projectId}/credentials`);
  return data as Credential[];
}

export async function createCredential(projectId: number, payload: CredentialPayload) {
  const { data } = await api.post(`/projects/${projectId}/credentials`, payload);
  return data as Credential;
}

export async function updateCredential(projectId: number, credentialId: number, payload: Partial<CredentialPayload>) {
  const { data } = await api.put(`/projects/${projectId}/credentials/${credentialId}`, payload);
  return data as Credential;
}

export async function deleteCredential(projectId: number, credentialId: number) {
  await api.delete(`/projects/${projectId}/credentials/${credentialId}`);
}

export async function revealCredentialPassword(projectId: number, credentialId: number) {
  const { data } = await api.get(`/projects/${projectId}/credentials/${credentialId}/reveal`);
  return data as { password: string | null };
}
