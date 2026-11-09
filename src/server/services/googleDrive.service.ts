import { google } from 'googleapis';
import { Readable } from 'stream';

const ROOT_FOLDER_NAME = 'CollabSuite';

export interface DriveFileDto {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  webContentLink?: string | null;
  iconLink?: string | null;
}

const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink';

function buildDriveClient(refreshToken: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

function tagScopeError(err: any) {
  const reason = err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason;
  if (err?.code === 403 || err?.response?.status === 403) {
    err.driveScopeError = reason !== 'storageQuotaExceeded';
  }
  return err;
}

export const googleDriveService = {
  async ensureRootFolder(refreshToken: string): Promise<{ id: string; webViewLink: string }> {
    const drive = buildDriveClient(refreshToken);
    try {
      const existing = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${ROOT_FOLDER_NAME}' and trashed=false and 'root' in parents`,
        fields: 'files(id,webViewLink)',
        spaces: 'drive',
      });
      const found = existing.data.files?.[0];
      if (found?.id) {
        return { id: found.id, webViewLink: found.webViewLink || '' };
      }

      const created = await drive.files.create({
        requestBody: {
          name: ROOT_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root'],
        },
        fields: 'id,webViewLink',
      });
      return { id: created.data.id!, webViewLink: created.data.webViewLink || '' };
    } catch (err) {
      throw tagScopeError(err);
    }
  },

  async createProjectFolder(refreshToken: string, params: { funnelId: number; funnelName: string }): Promise<{ id: string; webViewLink: string }> {
    const root = await this.ensureRootFolder(refreshToken);
    return this.createFolder(refreshToken, root.id, `${params.funnelName} (#${params.funnelId})`);
  },

  async createFolder(refreshToken: string, parentFolderId: string, name: string): Promise<{ id: string; webViewLink: string }> {
    const drive = buildDriveClient(refreshToken);
    try {
      const created = await drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentFolderId],
        },
        fields: 'id,webViewLink',
      });
      return { id: created.data.id!, webViewLink: created.data.webViewLink || '' };
    } catch (err) {
      throw tagScopeError(err);
    }
  },

  /**
   * Confirma que `fileOrFolderId` está dentro da árvore de `rootFolderId`, subindo pela
   * cadeia de `parents`. Necessário porque o servidor sempre age com o token do dono da
   * pasta do projeto — sem isso, qualquer folderId/fileId informado pelo cliente poderia
   * ler/apagar arquivos de qualquer lugar do Drive do dono.
   */
  async isWithinRoot(refreshToken: string, fileOrFolderId: string, rootFolderId: string): Promise<boolean> {
    if (fileOrFolderId === rootFolderId) return true;
    const drive = buildDriveClient(refreshToken);
    let currentId = fileOrFolderId;
    for (let i = 0; i < 25; i++) {
      let parents: string[] | null | undefined;
      try {
        const res = await drive.files.get({ fileId: currentId, fields: 'id,parents' });
        parents = res.data.parents;
      } catch {
        return false;
      }
      if (!parents || parents.length === 0) return false;
      if (parents.includes(rootFolderId)) return true;
      currentId = parents[0];
    }
    return false;
  },

  async shareFolder(refreshToken: string, folderId: string, emails: string[]): Promise<void> {
    const drive = buildDriveClient(refreshToken);
    const results = await Promise.allSettled(
      emails.map((emailAddress) =>
        drive.permissions.create({
          fileId: folderId,
          sendNotificationEmail: false,
          requestBody: { type: 'user', role: 'writer', emailAddress },
        })
      )
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[GoogleDrive] Falha ao compartilhar pasta ${folderId} com ${emails[i]}:`, r.reason?.message || r.reason);
      }
    });
  },

  async revokeAccess(refreshToken: string, folderId: string, email: string): Promise<void> {
    const drive = buildDriveClient(refreshToken);
    try {
      const list = await drive.permissions.list({ fileId: folderId, fields: 'permissions(id,emailAddress)' });
      const permission = list.data.permissions?.find((p) => p.emailAddress?.toLowerCase() === email.toLowerCase());
      if (!permission?.id) return;
      await drive.permissions.delete({ fileId: folderId, permissionId: permission.id });
    } catch (err) {
      console.error(`[GoogleDrive] Falha ao revogar acesso de ${email} na pasta ${folderId}:`, (err as any)?.message || err);
    }
  },

  async listFiles(refreshToken: string, folderId: string): Promise<DriveFileDto[]> {
    const drive = buildDriveClient(refreshToken);
    try {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: `files(${FILE_FIELDS})`,
        orderBy: 'modifiedTime desc',
      });
      return (res.data.files || []) as DriveFileDto[];
    } catch (err) {
      throw tagScopeError(err);
    }
  },

  async uploadFile(refreshToken: string, folderId: string, params: { filename: string; mimeType: string; buffer: Buffer }): Promise<DriveFileDto> {
    const drive = buildDriveClient(refreshToken);
    try {
      const created = await drive.files.create({
        requestBody: { name: params.filename, parents: [folderId] },
        media: { mimeType: params.mimeType, body: Readable.from(params.buffer) },
        fields: FILE_FIELDS,
      });
      return created.data as DriveFileDto;
    } catch (err) {
      throw tagScopeError(err);
    }
  },

  /**
   * Abre o conteúdo de um arquivo para exibição. Arquivos nativos do Google (Docs, Sheets, Slides)
   * não têm conteúdo binário, então são exportados como PDF.
   */
  async openFileStream(refreshToken: string, fileId: string, range?: string): Promise<{
    stream: Readable; name: string; mimeType: string;
    /** Preenchido quando o Drive respondeu um trecho (206): permite vídeo tocar e pular sem baixar tudo. */
    partial?: { status: number; contentRange?: string; contentLength?: string };
    acceptRanges?: boolean;
  }> {
    const drive = buildDriveClient(refreshToken);
    try {
      const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });
      const name = meta.data.name || 'arquivo';
      const mimeType = meta.data.mimeType || 'application/octet-stream';
      if (mimeType === 'application/vnd.google-apps.folder') throw new Error('Pastas não podem ser visualizadas.');

      if (mimeType.startsWith('application/vnd.google-apps.')) {
        const res = await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'stream' });
        return { stream: res.data as unknown as Readable, name: name.endsWith('.pdf') ? name : `${name}.pdf`, mimeType: 'application/pdf' };
      }
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream', headers: range ? { Range: range } : undefined },
      );
      const h = res.headers as Record<string, string | undefined>;
      return {
        stream: res.data as unknown as Readable,
        name,
        mimeType,
        acceptRanges: true,
        partial: res.status === 206 ? { status: 206, contentRange: h['content-range'], contentLength: h['content-length'] } : undefined,
      };
    } catch (err) {
      throw tagScopeError(err);
    }
  },

  async deleteFile(refreshToken: string, fileId: string): Promise<void> {
    const drive = buildDriveClient(refreshToken);
    try {
      await drive.files.update({ fileId, requestBody: { trashed: true } });
    } catch (err) {
      throw tagScopeError(err);
    }
  },
};
