import axios from "axios";

const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("collab_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 = sessão da CollabSuite inválida. Chamadas de integrações (GitHub) nunca devem deslogar a pessoa por falha externa.
    const url = String(error.config?.url ?? "");
    if (error.response?.status === 401 && !url.startsWith("/github/")) {
      localStorage.removeItem("collab_token");
      localStorage.removeItem("collab_user");
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default api;