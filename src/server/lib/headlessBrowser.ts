import { chromium, type Browser } from "playwright-core";

/**
 * Chromium compartilhado para renderizar HTML em imagem (slides de carrossel, páginas de HQ).
 * Ordem de busca: CHROMIUM_PATH (Docker: apk add chromium) → Chromium do Playwright → Chrome → Edge instalados.
 */
let browserPromise: Promise<Browser> | null = null;

const ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

async function launch(): Promise<Browser> {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return chromium.launch({ headless: true, executablePath: explicit, args: ARGS });

  const attempts: Array<() => Promise<Browser>> = [
    () => chromium.launch({ headless: true, args: ARGS }),
    () => chromium.launch({ headless: true, channel: "chrome", args: ARGS }),
    () => chromium.launch({ headless: true, channel: "msedge", args: ARGS }),
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    "Nenhum navegador disponível para renderizar os slides. Instale o Chromium (npx playwright-core install chromium) " +
    `ou defina CHROMIUM_PATH. Detalhe: ${(lastErr as Error)?.message?.split("\n")[0] ?? lastErr}`,
  );
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
    browserPromise = null;
  }
  browserPromise = launch();
  try {
    const b = await browserPromise;
    b.on("disconnected", () => { browserPromise = null; });
    return b;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
}

export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => undefined);
}
