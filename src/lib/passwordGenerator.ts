export interface PasswordGeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordGeneratorOptions = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
};

// Conjuntos sem caracteres ambíguos (0/O, 1/l/I) para facilitar a leitura/digitação manual.
const CHARSETS: Record<Exclude<keyof PasswordGeneratorOptions, "length">, string> = {
  uppercase: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lowercase: "abcdefghjkmnpqrstuvwxyz",
  numbers: "23456789",
  symbols: "!@#$%^&*()-_=+[]{}",
};

export function generateSecurePassword(options: PasswordGeneratorOptions = DEFAULT_PASSWORD_OPTIONS): string {
  const pools = (Object.keys(CHARSETS) as (keyof typeof CHARSETS)[]).filter((key) => options[key]);
  if (pools.length === 0) {
    throw new Error("Selecione ao menos um tipo de caractere.");
  }

  const length = Math.max(4, Math.min(128, Math.round(options.length)));
  const fullCharset = pools.map((key) => CHARSETS[key]).join("");

  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);

  const chars: string[] = [];
  // Garante ao menos um caractere de cada tipo selecionado.
  pools.forEach((key, i) => {
    const pool = CHARSETS[key];
    chars.push(pool[randomValues[i] % pool.length]);
  });
  for (let i = pools.length; i < length; i++) {
    chars.push(fullCharset[randomValues[i] % fullCharset.length]);
  }

  const shuffleValues = new Uint32Array(chars.length);
  crypto.getRandomValues(shuffleValues);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleValues[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

export type PasswordStrength = "weak" | "medium" | "strong" | "very-strong";

export function estimatePasswordStrength(password: string): PasswordStrength {
  if (!password) return "weak";
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;

  const entropy = password.length * Math.log2(poolSize || 1);
  if (entropy < 40) return "weak";
  if (entropy < 60) return "medium";
  if (entropy < 90) return "strong";
  return "very-strong";
}
