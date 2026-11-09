import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyRound, Plus, Globe, Server, Database, Mail, Code2, Loader2, Eye, EyeOff,
  Copy, Check, Pencil, Trash2, ExternalLink, RefreshCw, Sparkles,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/src/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/src/components/ui/popover";
import { Checkbox } from "@/src/components/ui/checkbox";
import * as credentialService from "@/src/services/credential.service";
import type { Credential, CredentialPayload } from "@/src/services/credential.service";
import {
  generateSecurePassword, estimatePasswordStrength, DEFAULT_PASSWORD_OPTIONS,
  type PasswordGeneratorOptions,
} from "@/src/lib/passwordGenerator";

const CATEGORY_OPTIONS = [
  { value: "website", label: "Site / Aplicação", icon: Globe },
  { value: "server", label: "Servidor", icon: Server },
  { value: "database", label: "Banco de Dados", icon: Database },
  { value: "email", label: "E-mail", icon: Mail },
  { value: "api", label: "API / Chave", icon: Code2 },
  { value: "other", label: "Outro", icon: KeyRound },
] as const;

function categoryMeta(category?: string | null) {
  return CATEGORY_OPTIONS.find((c) => c.value === category) || CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
}

const STRENGTH_META: Record<string, { label: string; className: string; width: string }> = {
  weak: { label: "Fraca", className: "bg-destructive", width: "25%" },
  medium: { label: "Média", className: "bg-amber-500", width: "50%" },
  strong: { label: "Forte", className: "bg-emerald-500", width: "75%" },
  "very-strong": { label: "Muito forte", className: "bg-emerald-600", width: "100%" },
};

function emptyForm(): CredentialPayload {
  return { title: "", category: "website", username: "", password: "", url: "", notes: "" };
}

export function ProjectCredentialsTab({ projectId }: { projectId: number }) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [form, setForm] = useState<CredentialPayload>(emptyForm());
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [genOptions, setGenOptions] = useState<PasswordGeneratorOptions>(DEFAULT_PASSWORD_OPTIONS);

  const [revealedIds, setRevealedIds] = useState<Record<number, string>>({});
  const [revealingId, setRevealingId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await credentialService.fetchCredentials(projectId);
      setCredentials(list);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar as credenciais.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => (categoryFilter === "all" ? credentials : credentials.filter((c) => (c.category || "other") === categoryFilter)),
    [credentials, categoryFilter]
  );

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setShowPassword(false);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(credential: Credential) {
    setEditing(credential);
    setForm({
      title: credential.title,
      category: credential.category || "other",
      username: credential.username || "",
      password: "",
      url: credential.url || "",
      notes: credential.notes || "",
    });
    setShowPassword(false);
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      setFormError("Informe um título para a credencial.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        const payload: Partial<CredentialPayload> = {
          title: form.title,
          category: form.category,
          username: form.username || null,
          url: form.url || null,
          notes: form.notes || null,
        };
        if (form.password) payload.password = form.password;
        const updated = await credentialService.updateCredential(projectId, editing.id, payload);
        setCredentials((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setRevealedIds((prev) => {
          const next = { ...prev };
          delete next[editing.id];
          return next;
        });
      } else {
        const created = await credentialService.createCredential(projectId, form);
        setCredentials((prev) => [created, ...prev]);
      }
      setDialogOpen(false);
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Não foi possível salvar a credencial.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(credential: Credential) {
    if (!window.confirm(`Excluir a credencial "${credential.title}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await credentialService.deleteCredential(projectId, credential.id);
      setCredentials((prev) => prev.filter((c) => c.id !== credential.id));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível excluir a credencial.");
    }
  }

  async function handleReveal(credential: Credential) {
    if (revealedIds[credential.id] !== undefined) {
      setRevealedIds((prev) => {
        const next = { ...prev };
        delete next[credential.id];
        return next;
      });
      return;
    }
    setRevealingId(credential.id);
    try {
      const { password } = await credentialService.revealCredentialPassword(projectId, credential.id);
      setRevealedIds((prev) => ({ ...prev, [credential.id]: password || "" }));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível revelar a senha.");
    } finally {
      setRevealingId(null);
    }
  }

  async function handleCopy(key: string, value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
  }

  function handleGenerate() {
    const generated = generateSecurePassword(genOptions);
    setForm((prev) => ({ ...prev, password: generated }));
    setShowPassword(true);
  }

  const strength = form.password ? estimatePasswordStrength(form.password) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Todas as categorias" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Nova Credencial
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <KeyRound className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {credentials.length === 0
                ? "Nenhuma credencial cadastrada para este projeto ainda."
                : "Nenhuma credencial nesta categoria."}
            </p>
            {credentials.length === 0 && (
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> Cadastrar credencial
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((credential) => {
            const meta = categoryMeta(credential.category);
            const Icon = meta.icon;
            const revealed = revealedIds[credential.id];
            const isRevealed = revealed !== undefined;
            return (
              <Card key={credential.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1.5 rounded-md bg-muted text-muted-foreground shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{credential.title}</p>
                        <Badge variant="outline" className="text-[9px] mt-0.5">{meta.label}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {credential.url && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir link" onClick={() => window.open(credential.url!, "_blank")}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEdit(credential)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Excluir" onClick={() => handleDelete(credential)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {credential.username && (
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-muted-foreground">Usuário</p>
                        <p className="text-xs truncate">{credential.username}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleCopy(`user-${credential.id}`, credential.username!)}>
                        {copiedKey === `user-${credential.id}` ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  )}

                  {credential.has_password && (
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-muted-foreground">Senha</p>
                        <p className="text-xs font-mono truncate">
                          {isRevealed ? (revealed || "(vazio)") : "••••••••••••"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleReveal(credential)} disabled={revealingId === credential.id}>
                          {revealingId === credential.id ? <Loader2 className="h-3 w-3 animate-spin" /> : isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        {isRevealed && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopy(`pass-${credential.id}`, revealed || "")}>
                            {copiedKey === `pass-${credential.id}` ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {credential.notes && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{credential.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Credencial" : "Nova Credencial"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cred-title">Título</Label>
              <Input id="cred-title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ex: Hostinger - FTP" />
            </div>

            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={form.category || "other"} onValueChange={(v) => setForm((p) => ({ ...p, category: v }))}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cred-username">Usuário / login</Label>
                <Input id="cred-username" value={form.username || ""} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} placeholder="usuario@exemplo.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cred-url">Link (opcional)</Label>
                <Input id="cred-url" value={form.url || ""} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} placeholder="https://..." />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="cred-password">{editing ? "Nova senha (deixe em branco para manter)" : "Senha"}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2">
                      <Sparkles className="h-3 w-3" /> Opções
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span>Comprimento</span>
                        <span className="font-semibold">{genOptions.length}</span>
                      </div>
                      <input
                        type="range" min={8} max={48} value={genOptions.length}
                        onChange={(e) => setGenOptions((p) => ({ ...p, length: Number(e.target.value) }))}
                        className="w-full"
                      />
                    </div>
                    {([
                      ["uppercase", "Letras maiúsculas (A-Z)"],
                      ["lowercase", "Letras minúsculas (a-z)"],
                      ["numbers", "Números (0-9)"],
                      ["symbols", "Símbolos (!@#$...)"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={genOptions[key]}
                          onCheckedChange={(checked) => setGenOptions((p) => ({ ...p, [key]: checked === true }))}
                        />
                        {label}
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  id="cred-password"
                  type={showPassword ? "text" : "password"}
                  value={form.password || ""}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder={editing ? "••••••••" : "Digite ou gere uma senha"}
                  className="font-mono"
                  autoComplete="new-password"
                />
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setShowPassword((v) => !v)} title={showPassword ? "Ocultar" : "Mostrar"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={handleGenerate} title="Gerar senha segura">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {strength && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${STRENGTH_META[strength].className}`} style={{ width: STRENGTH_META[strength].width }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Força da senha: {STRENGTH_META[strength].label}</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cred-notes">Observações (opcional)</Label>
              <Textarea id="cred-notes" rows={3} value={form.notes || ""} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Instruções, contexto de uso, etc." />
            </div>

            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
