import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMask(value: string, maskType?: "none" | "cpf_cnpj" | "phone" | "cep"): string {
  if (!maskType || maskType === "none") return value;

  // Remove non-digit characters
  const digits = value.replace(/\D/g, "");

  if (maskType === "cpf_cnpj") {
    const cleanDigits = digits.slice(0, 14);
    if (cleanDigits.length <= 11) {
      // CPF: 000.000.000-00
      let formatted = "";
      for (let i = 0; i < cleanDigits.length; i++) {
        if (i === 3 || i === 6) formatted += ".";
        if (i === 9) formatted += "-";
        formatted += cleanDigits[i];
      }
      return formatted;
    } else {
      // CNPJ: 00.000.000/0000-00
      let formatted = "";
      for (let i = 0; i < cleanDigits.length; i++) {
        if (i === 2 || i === 5) formatted += ".";
        if (i === 8) formatted += "/";
        if (i === 12) formatted += "-";
        formatted += cleanDigits[i];
      }
      return formatted;
    }
  }

  if (maskType === "phone") {
    const cleanDigits = digits.slice(0, 11);
    const d = cleanDigits;
    if (d.length <= 2) {
      return d.length > 0 ? `(${d}` : "";
    }
    if (d.length <= 6) {
      return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    }
    if (d.length <= 10) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    }
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  if (maskType === "cep") {
    const cleanDigits = digits.slice(0, 8);
    const d = cleanDigits;
    if (d.length <= 5) {
      return d;
    }
    return `${d.slice(0, 5)}-${d.slice(5)}`;
  }

  return value;
}