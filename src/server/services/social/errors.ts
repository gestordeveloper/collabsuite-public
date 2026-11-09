/** Erro de uma rede social. `retryable = false` para o que tentar de novo não resolve (cota, permissão, vídeo inválido). */
export class PlatformError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}
