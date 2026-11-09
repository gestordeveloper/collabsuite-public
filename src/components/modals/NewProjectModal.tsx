import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import * as projectService from "@/src/services/project.service";
import * as github from "@/src/services/github.service";
import { slugify } from "@/src/components/github/GithubTab";
import { useTaskStore } from "@/src/store/task.store";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_COLORS = ["#EC1889", "#9B7BFF", "#4C9BFF", "#2DD4BF", "#F7B32B", "#2BD47D", "#FF5A5F", "#8A8A94"];

export function NewProjectModal({ isOpen, onClose }: NewProjectModalProps) {
  const setSelectedFunnelId = useTaskStore((s) => s.setSelectedFunnelId);
  const [form, setForm] = useState({ name: "", content: "", color: "#EC1889" });
  const [ghStatus, setGhStatus] = useState<github.GithubStatus | null>(null);
  const [orgs, setOrgs] = useState<{ login: string }[]>([]);
  const [createRepo, setCreateRepo] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [repoNameEdited, setRepoNameEdited] = useState(false);
  const [repoPrivate, setRepoPrivate] = useState(true);
  const [repoOrg, setRepoOrg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ name: "", content: "", color: "#EC1889" });
    setCreateRepo(false);
    setRepoName("");
    setRepoNameEdited(false);
    setRepoPrivate(true);
    setRepoOrg("");
    setGhStatus(null);
    github.getStatus().then((s) => {
      setGhStatus(s);
      if (s.connected) github.listOrgs().then(setOrgs).catch(() => setOrgs([]));
    }).catch(() => setGhStatus(null));
  }, [isOpen]);

  // O nome do repositório acompanha o do projeto até a pessoa editá-lo.
  useEffect(() => {
    if (!repoNameEdited) setRepoName(slugify(form.name));
  }, [form.name, repoNameEdited]);

  const ghReady = !!ghStatus?.configured && !!ghStatus.connected;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || submitting) return;
    if (createRepo && !repoName.trim()) return alert("Informe o nome do repositório do GitHub.");
    setSubmitting(true);
    try {
      const created = await projectService.createProject({ name: form.name.trim(), content: form.content, color: form.color });
      useTaskStore.getState().addProject(created);
      const defaultFunnel = created.funnels?.[0];
      if (defaultFunnel) {
        useTaskStore.getState().addFunnel(defaultFunnel);
        setSelectedFunnelId(defaultFunnel.id);
      }
      // O projeto já existe; se o repositório falhar, ele pode ser criado depois na aba GitHub.
      if (createRepo && ghReady) {
        try {
          await github.createRepo(created.id, { name: repoName.trim(), description: form.content.trim().slice(0, 350) || undefined, private: repoPrivate, org: repoOrg || undefined });
        } catch (err) {
          alert(`O projeto foi criado, mas o repositório do GitHub não: ${github.errMsg(err)}
Você pode tentar de novo na aba GitHub do projeto.`);
        }
      }
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao criar projeto.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Projeto</DialogTitle>
          <DialogDescription>Crie um novo projeto. Um funil principal será criado automaticamente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome do Projeto *</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Descrição</Label>
            <Textarea id="content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-background ${form.color === c ? "ring-foreground" : "ring-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-8 w-8 cursor-pointer rounded-md border" />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border bg-surface p-3">
            <label className={`flex items-center gap-2 text-sm font-medium ${ghReady ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
              <input type="checkbox" checked={createRepo && ghReady} disabled={!ghReady} onChange={(e) => setCreateRepo(e.target.checked)} />
              Criar repositório no GitHub
            </label>
            {!ghStatus ? null : !ghStatus.configured ? (
              <p className="text-xs text-muted-foreground">A integração com o GitHub ainda não foi configurada por um administrador.</p>
            ) : !ghStatus.connected ? (
              <p className="text-xs text-muted-foreground">Conecte sua conta na aba <b>GitHub</b> de qualquer projeto para criar repositórios daqui.</p>
            ) : createRepo ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gh-owner">Dono</Label>
                  <select id="gh-owner" value={repoOrg} onChange={(e) => setRepoOrg(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
                    <option value="">@{ghStatus.login} (minha conta)</option>
                    {orgs.map((o) => <option key={o.login} value={o.login}>{o.login}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gh-repo-name">Nome do repositório</Label>
                  <Input id="gh-repo-name" value={repoName} onChange={(e) => { setRepoName(e.target.value); setRepoNameEdited(true); }} placeholder="meu-projeto" />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[13px] sm:col-span-2">
                  <input type="checkbox" checked={repoPrivate} onChange={(e) => setRepoPrivate(e.target.checked)} /> Repositório privado
                </label>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Conectado como @{ghStatus.login}. Marque para criar o repositório junto com o projeto.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Criando…" : "Criar Projeto"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
