import api from "./api";

export interface Icp {
  id: number;
  user_id: number;
  company_id?: number | null;
  name: string;
  niche?: string | null;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface IcpPayload {
  name: string;
  niche?: string | null;
  description: string;
}

export async function fetchIcps() {
  const { data } = await api.get("/icps");
  return data as Icp[];
}

export async function createIcp(payload: IcpPayload) {
  const { data } = await api.post("/icps", payload);
  return data as Icp;
}

export async function updateIcp(icpId: number, payload: Partial<IcpPayload>) {
  const { data } = await api.put(`/icps/${icpId}`, payload);
  return data as Icp;
}

export async function deleteIcp(icpId: number) {
  await api.delete(`/icps/${icpId}`);
}
