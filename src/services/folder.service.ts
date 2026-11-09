import api from "./api";
import type { Folder } from "../types";

export async function fetchFolders() {
  const { data } = await api.get("/folders");
  return data as Folder[];
}

export async function createFolder(name: string) {
  const { data } = await api.post("/folders", { name });
  return data as Folder;
}

export async function deleteFolder(folderId: number) {
  await api.delete(`/folders/${folderId}`);
}
