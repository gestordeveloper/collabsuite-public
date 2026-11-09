import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import type { Icp, IcpPayload } from "@/src/services/icp.service";

interface IcpFormModalProps {
  open: boolean;
  icp: Icp | null;
  onClose: () => void;
  onSubmit: (payload: IcpPayload) => Promise<void>;
}

const EMPTY_FORM: IcpPayload = { name: "", niche: "", description: "" };

export function IcpFormModal({ open, icp, onClose, onSubmit }: IcpFormModalProps) {
  const [form, setForm] = useState<IcpPayload>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(icp ? { name: icp.name, niche: icp.niche || "", description: icp.description } : EMPTY_FORM);
      setError(null);
    }
  }, [open, icp]);

  async function handleSubmit() {
    if (!form.name.trim() || !form.description.trim()) {
      setError("Nome e descrição são obrigatórios.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível salvar o ICP.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{icp ? "Editar ICP" : "Novo ICP"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex.: Empreendedoras Digitais"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Nicho (opcional)</Label>
            <Input
              value={form.niche || ""}
              onChange={(e) => setForm((f) => ({ ...f, niche: e.target.value }))}
              placeholder="Ex.: Infoprodutos, e-commerce, serviços..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição do perfil</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Quem é essa pessoa, objetivo principal, dor/reclamação principal, soluções que busca, alternativas caras que considera..."
              rows={10}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
