import api from "./api";

export interface StudioxStatus {
  installed: boolean;
  running: boolean;
  error: string | null;
}

export const studioxService = {
  async status(): Promise<StudioxStatus> {
    const { data } = await api.get("/studiox/status");
    return data;
  },
  /** Sobe o editor (se preciso) e grava o cookie que autoriza o iframe em /studiox. */
  async openSession(): Promise<void> {
    await api.post("/studiox/session");
  },
};
