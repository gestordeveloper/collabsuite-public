/**
 * Mapa da pessoa: perfil de quem aparece nas imagens do carrossel (aparência, estilo, cenários) + fotos de referência.
 * As fotos vão como referência ao gerador de imagens para manter o rosto e os traços da pessoa.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../access.service";
import { fetchStoredFileBytes } from "../../lib/fileStorage";
import { storeBuffer } from "../../controllers/upload.controller";
import type { ImageRef } from "./mediaGen.service";

export const MAX_PHOTOS = 8;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export interface Person {
  id: string;
  name: string;
  description: string; // aparência: idade aproximada, cabelo, barba, óculos, traços marcantes
  style: string; // estilo e roupas
  mood: string; // expressão e presença
  scenarios: string; // cenários e ambientes que combinam
  avoid: string; // o que evitar nas imagens
  notes: string; // tom de voz e observações gerais usadas pela IA ao escrever
  photos: string[]; // URLs das fotos de referência
}

const FIELDS = ["description", "style", "mood", "scenarios", "avoid", "notes"] as const;

function toPerson(row: { id: string; name: string; data: string }): Person {
  const d = JSON.parse(row.data || "{}");
  return {
    id: row.id, name: row.name, description: d.description || "", style: d.style || "", mood: d.mood || "",
    scenarios: d.scenarios || "", avoid: d.avoid || "", notes: d.notes || "", photos: Array.isArray(d.photos) ? d.photos : [],
  };
}

const pack = (p: Person) => JSON.stringify(Object.fromEntries([...FIELDS.map((k) => [k, p[k]]), ["photos", p.photos]]));

export async function listPeople(userId: number): Promise<Person[]> {
  return (await prisma.carouselPerson.findMany({ where: { user_id: userId }, orderBy: { name: "asc" } })).map(toPerson);
}

export async function getPerson(id: string | null | undefined, userId: number): Promise<Person | null> {
  if (!id) return null;
  const row = await prisma.carouselPerson.findFirst({ where: { id, user_id: userId } });
  return row ? toPerson(row) : null;
}

async function requirePerson(id: string, userId: number): Promise<Person> {
  const p = await getPerson(id, userId);
  if (!p) throw new NotFoundError("Pessoa não encontrada.");
  return p;
}

export async function savePerson(userId: number, input: Partial<Person>): Promise<Person> {
  if (!input.name?.trim()) throw new Error("Dê um nome à pessoa.");
  const existing = input.id ? await getPerson(input.id, userId) : null;
  const person: Person = {
    id: existing?.id || `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 25) || "pessoa"}-${randomUUID().slice(0, 4)}`,
    name: input.name.trim().slice(0, 150),
    description: input.description || "", style: input.style || "", mood: input.mood || "", scenarios: input.scenarios || "",
    avoid: input.avoid || "", notes: input.notes || "",
    photos: existing?.photos || [], // as fotos só mudam pelos endpoints de foto
  };
  if (existing) await prisma.carouselPerson.update({ where: { id: person.id }, data: { name: person.name, data: pack(person) } });
  else await prisma.carouselPerson.create({ data: { id: person.id, user_id: userId, name: person.name, data: pack(person) } });
  return person;
}

export async function deletePerson(id: string, userId: number): Promise<boolean> {
  return (await prisma.carouselPerson.deleteMany({ where: { id, user_id: userId } })).count > 0;
}

export async function addPhoto(id: string, userId: number, file: { buffer: Buffer; mimetype: string }): Promise<Person> {
  const person = await requirePerson(id, userId);
  const ext = Object.entries(MIME).find(([, m]) => m === file.mimetype)?.[0];
  if (!ext) throw new Error("Use fotos PNG, JPG ou WEBP.");
  if (person.photos.length >= MAX_PHOTOS) throw new Error(`Máximo de ${MAX_PHOTOS} fotos de referência por pessoa.`);
  person.photos.push(await storeBuffer(file.buffer, ext === "jpeg" ? "jpg" : ext, file.mimetype));
  await prisma.carouselPerson.update({ where: { id }, data: { data: pack(person) } });
  return person;
}

export async function removePhoto(id: string, userId: number, url: string): Promise<Person> {
  const person = await requirePerson(id, userId);
  person.photos = person.photos.filter((p) => p !== url);
  await prisma.carouselPerson.update({ where: { id }, data: { data: pack(person) } });
  return person;
}

/** Fotos de referência no formato aceito pelo gerador de imagens. */
export async function referenceFiles(person: Person): Promise<ImageRef[]> {
  const out: ImageRef[] = [];
  for (const url of person.photos) {
    try {
      const ext = (url.split("?")[0].split(".").pop() || "png").toLowerCase();
      out.push({ label: person.name, data: await fetchStoredFileBytes(url), mime: MIME[ext] || "image/png" });
    } catch { /* foto indisponível: segue sem ela */ }
  }
  return out;
}

/** Aparência, estilo e expressão (vai no prompt de imagem). */
export function describeLook(p: Person): string {
  const parts: string[] = [];
  if (p.description) parts.push(p.description.trim());
  if (p.style) parts.push(`Estilo e roupas: ${p.style.trim()}.`);
  if (p.mood) parts.push(`Expressão: ${p.mood.trim()}.`);
  return parts.join(" ") || p.name;
}

/** Mapa completo (vai no prompt de texto, para dar tom e escolher a cena). */
export function describeFull(p: Person | null): string {
  if (!p) return "Nenhuma pessoa definida. Sugira cenas com uma pessoa real em ambiente natural.";
  const lines = [`Nome: ${p.name}`];
  for (const [label, v] of [["Aparência", p.description], ["Estilo", p.style], ["Expressão", p.mood], ["Cenários que combinam", p.scenarios], ["Evitar", p.avoid], ["Observações", p.notes]]) {
    if (v?.trim()) lines.push(`${label}: ${v.trim()}`);
  }
  return lines.join("\n");
}
