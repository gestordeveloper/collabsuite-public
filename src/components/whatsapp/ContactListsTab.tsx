import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ListPlus, Plus, Trash2, Upload, Users, Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Badge } from "@/src/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  fetchLists,
  createList,
  deleteList,
  fetchContacts,
  createContact,
  updateContact,
  deleteContact,
  bulkImportContacts,
  parseContactsCsv,
  type WhatsAppContactList,
  type WhatsAppContact,
} from "@/src/services/whatsappContact.service";

export function ContactListsTab() {
  const [lists, setLists] = useState<WhatsAppContactList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [selectedList, setSelectedList] = useState<WhatsAppContactList | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadLists = useCallback(async () => {
    try {
      const data = await fetchLists();
      setLists(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  async function handleCreateList() {
    if (!newListName.trim()) return;
    setCreating(true);
    try {
      const created = await createList({ name: newListName.trim() });
      setLists((prev) => [{ ...created, _count: { contacts: 0, campaigns: 0 } }, ...prev]);
      setNewListName("");
      setCreateOpen(false);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar lista.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteList(list: WhatsAppContactList) {
    if (!confirm(`Excluir a lista "${list.name}" e todos os seus contatos?`)) return;
    try {
      await deleteList(list.id);
      setLists((prev) => prev.filter((l) => l.id !== list.id));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao excluir lista.");
    }
  }

  if (selectedList) {
    return (
      <ContactListDetail
        list={selectedList}
        onBack={() => {
          setSelectedList(null);
          loadLists();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <ListPlus className="h-4 w-4" />
          Nova lista
        </Button>
      </div>

      {loadingLists ? (
        <p className="text-sm text-muted-foreground">Carregando listas…</p>
      ) : lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma lista de contatos cadastrada.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => (
            <Card key={list.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedList(list)}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-violet-500/10 text-violet-500 shrink-0">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{list.name}</p>
                      <p className="text-xs text-muted-foreground">{list._count?.contacts ?? 0} contatos</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteList(list);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova lista de contatos</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-list-name">Nome</Label>
            <Input
              id="new-list-name"
              placeholder="ex: Leads Setembro"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateList()}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCreateList} disabled={creating || !newListName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactListDetail({ list, onBack }: { list: WhatsAppContactList; onBack: () => void }) {
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchContacts(list.id);
      setContacts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [list.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddContact() {
    if (!phone.trim()) return;
    setSaving(true);
    try {
      const created = await createContact(list.id, {
        name: name.trim() || null,
        phone: phone.trim(),
        tags: tags.trim() || null,
      });
      setContacts((prev) => [created, ...prev]);
      setName("");
      setPhone("");
      setTags("");
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao adicionar contato.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleOptOut(contact: WhatsAppContact) {
    try {
      const updated = await updateContact(list.id, contact.id, { opted_out: !contact.opted_out });
      setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao atualizar contato.");
    }
  }

  async function handleDeleteContact(contact: WhatsAppContact) {
    if (!confirm(`Remover ${contact.name || contact.phone} da lista?`)) return;
    try {
      await deleteContact(list.id, contact.id);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao remover contato.");
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseContactsCsv(text);
      if (rows.length === 0) {
        alert("Nenhum contato válido encontrado no arquivo. Use colunas 'name' e 'phone'.");
        return;
      }
      const result = await bulkImportContacts(list.id, rows);
      setImportResult(result);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao importar CSV.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <h3 className="font-semibold text-lg">{list.name}</h3>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adicionar contato</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input placeholder="Nome (opcional)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Telefone (com DDI/DDD)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input placeholder="Tags (opcional)" value={tags} onChange={(e) => setTags(e.target.value)} />
            <Button onClick={handleAddContact} disabled={saving || !phone.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </Button>
          </div>

          <div className="flex items-center gap-3 mt-4 pt-4 border-t">
            <Button variant="outline" size="sm" disabled={importing} onClick={() => fileInputRef.current?.click()}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Importar CSV
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            <p className="text-xs text-muted-foreground">
              Colunas esperadas: <code>name, phone</code> (ou <code>nome, telefone</code>). O arquivo é lido no navegador.
            </p>
          </div>
          {importResult && (
            <p className="text-xs mt-2 text-emerald-600 dark:text-emerald-400">
              {importResult.imported} contato(s) importado(s){importResult.skipped > 0 ? `, ${importResult.skipped} ignorado(s) por telefone inválido` : ""}.
            </p>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando contatos…</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contato nesta lista.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-muted-foreground">
                <th className="p-3 font-medium">Nome</th>
                <th className="p-3 font-medium">Telefone</th>
                <th className="p-3 font-medium">Tags</th>
                <th className="p-3 font-medium">Opt-out</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-t">
                  <td className="p-3">{contact.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3">{contact.phone}</td>
                  <td className="p-3">
                    {contact.tags ? <Badge variant="outline">{contact.tags}</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3">
                    <Checkbox checked={contact.opted_out} onCheckedChange={() => handleToggleOptOut(contact)} />
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteContact(contact)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
