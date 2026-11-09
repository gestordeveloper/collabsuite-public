import { proto, initAuthCreds, BufferJSON } from "baileys";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "baileys";
import { prisma } from "../prisma";
import { encrypt, decrypt } from "../encryption";

/**
 * Baileys' own `useMultiFileAuthState` persists the auth state (creds + signal key store) as
 * one JSON file per key to a local folder — not viable here since the app runs in a Docker
 * container without a guaranteed persistent volume, and multiple app instances/redeploys must
 * not lose an already-paired WhatsApp session.
 *
 * This mirrors that same logic (see baileys' `lib/Utils/use-multi-file-auth-state.js`) but keeps
 * everything as a single JSON blob (creds + every signal key, keyed by category then id) and
 * persists it, AES-256-GCM encrypted, to `WhatsAppConnection.auth_state` via Prisma instead of
 * the filesystem.
 */

interface AuthBlob {
  creds: AuthenticationCreds;
  keys: { [category: string]: { [id: string]: any } };
}

function emptyBlob(): AuthBlob {
  return { creds: initAuthCreds(), keys: {} };
}

export async function loadAuthBlob(connectionId: number): Promise<AuthBlob> {
  const row = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
    select: { auth_state: true },
  });

  if (!row?.auth_state) {
    return emptyBlob();
  }

  try {
    const json = decrypt(row.auth_state);
    const parsed = JSON.parse(json, BufferJSON.reviver) as Partial<AuthBlob>;
    return {
      creds: parsed.creds || initAuthCreds(),
      keys: parsed.keys || {},
    };
  } catch (err) {
    console.error(`[whatsapp] Falha ao decodificar auth_state da conexão ${connectionId}, iniciando nova sessão.`, err);
    return emptyBlob();
  }
}

export interface PrismaAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export async function createPrismaAuthState(connectionId: number): Promise<PrismaAuthState> {
  const blob = await loadAuthBlob(connectionId);

  // Serializes concurrent writes (creds.update fires often during the initial handshake, and
  // keys.set can be called many times in quick succession) so we never interleave two partial
  // JSON.stringify/encrypt/prisma.update cycles against the same row.
  let saveChain: Promise<void> = Promise.resolve();
  function persist(): Promise<void> {
    saveChain = saveChain.then(async () => {
      const serialized = JSON.stringify(blob, BufferJSON.replacer);
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: { auth_state: encrypt(serialized) },
      });
    });
    // Swallow here so one failed persist doesn't wedge the chain for subsequent calls, but still
    // surface the error to the caller that triggered this particular save.
    return saveChain.catch((err) => {
      console.error(`[whatsapp] Falha ao persistir auth_state da conexão ${connectionId}:`, err);
      saveChain = Promise.resolve();
      throw err;
    });
  }

  const state: AuthenticationState = {
    creds: blob.creds,
    keys: {
      get: async (type, ids) => {
        const data: { [id: string]: any } = {};
        for (const id of ids) {
          let value = blob.keys[type]?.[id];
          if (value !== undefined && value !== null) {
            if (type === "app-state-sync-key") {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
        }
        return data as { [id: string]: SignalDataTypeMap[typeof type] };
      },
      set: async (data) => {
        for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const catData = data[category];
          if (!catData) continue;
          blob.keys[category] = blob.keys[category] || {};
          for (const id of Object.keys(catData)) {
            const value = (catData as any)[id];
            if (value) {
              blob.keys[category][id] = value;
            } else {
              delete blob.keys[category][id];
            }
          }
        }
        await persist().catch(() => {});
      },
    },
  };

  return {
    state,
    saveCreds: () => persist().catch(() => {}),
  };
}

/** Wipes the persisted session — required after a WhatsApp-side logout, since the creds are dead. */
export async function clearAuthState(connectionId: number): Promise<void> {
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { auth_state: null, qr: null },
  });
}
