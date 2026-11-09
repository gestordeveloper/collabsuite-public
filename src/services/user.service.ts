import api from "./api";
import type { User } from "../types";

export async function fetchUsers() {
  const { data } = await api.get("/users");
  return data as Partial<User>[];
}