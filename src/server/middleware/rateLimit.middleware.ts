import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  message: { error: "Muitas requisições. Tente novamente em alguns segundos." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const publicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Limite de agendamentos públicos atingido. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const publicCommentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: "Limite de comentários atingido. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const widgetUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Limite de envio de arquivos atingido. Tente novamente em alguns minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});