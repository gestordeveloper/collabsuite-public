import { create } from "zustand";
import type { User } from "../types";
import * as authService from "../services/auth.service";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (login: string, password: string) => Promise<void>;
  register: (payload: any) => Promise<void>;
  fetchMe: () => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const getStoredUser = (): User | null => {
  try {
    const stored = localStorage.getItem("collab_user");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  user: getStoredUser(),
  token: localStorage.getItem("collab_token"),
  isAuthenticated: !!localStorage.getItem("collab_token"),

  login: async (loginVal, password) => {
    const result = await authService.login(loginVal, password);
    localStorage.setItem("collab_token", result.token);
    localStorage.setItem("collab_user", JSON.stringify(result.user));
    set({ user: result.user, token: result.token, isAuthenticated: true });
  },

  register: async (payload) => {
    const result = await authService.register(payload);
    localStorage.setItem("collab_token", result.token);
    localStorage.setItem("collab_user", JSON.stringify(result.user));
    set({ user: result.user, token: result.token, isAuthenticated: true });
  },

  fetchMe: async () => {
    try {
      const user = await authService.getMe();
      localStorage.setItem("collab_user", JSON.stringify(user));
      set({ user, isAuthenticated: true });
    } catch (err: any) {
      // Only clear storage and logout if we get an explicit 401 Unauthorized response from the server.
      // If it's a network error (no response or another status code), keep the local session.
      if (err.response?.status === 401) {
        localStorage.removeItem("collab_token");
        localStorage.removeItem("collab_user");
        set({ user: null, token: null, isAuthenticated: false });
      }
    }
  },

  logout: () => {
    localStorage.removeItem("collab_token");
    localStorage.removeItem("collab_user");
    set({ user: null, token: null, isAuthenticated: false });
  },

  updateUser: (user: User) => {
    localStorage.setItem("collab_user", JSON.stringify(user));
    set({ user });
  },
}));