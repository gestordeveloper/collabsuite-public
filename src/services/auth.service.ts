import api from "./api";
import type { User } from "../types";

export async function login(login: string, password: string) {
  const { data } = await api.post("/auth/login", { login, password });
  return data as { token: string; user: User };
}

export async function register(payload: {
  first_name: string;
  last_name?: string;
  email: string;
  username: string;
  password: string;
}) {
  const { data } = await api.post("/auth/register", payload);
  return data as { token: string; user: User };
}

export async function getMe() {
  const { data } = await api.get("/auth/me");
  return data.user as User;
}

export async function updateBiography(userId: number, biography: string) {
  const { data } = await api.put(`/users/${userId}`, { biography });
  return data as User;
}

export async function updateUserProfile(userId: number, payload: Partial<User>) {
  const { data } = await api.put(`/users/${userId}`, payload);
  return data as User;
}