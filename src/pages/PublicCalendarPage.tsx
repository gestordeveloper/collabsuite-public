import { useState, useEffect } from "react";
import { Calendar as CalendarIcon, Clock, Check, ChevronLeft, ChevronRight, AlertCircle, ArrowLeft, Heart } from "lucide-react";
import { fetchPublicCalendar, bookPublicMeeting } from "@/src/services/public.service";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";

interface PublicCalendarPageProps {
  username: string;
  themeColor: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function PublicCalendarPage({ username, themeColor }: PublicCalendarPageProps) {
  const [publicData, setPublicData] = useState<any>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", first_name: "", last_name: "", email: "", phone: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError("");
    fetchPublicCalendar(username)
      .then((data) => setPublicData(data))
      .catch((err) => setError(err.message));
  }, [username]);

  const settings = (() => {
    const defaults = { availableDays: [1, 2, 3, 4, 5], startHour: "09:00", endHour: "18:00", meetingDuration: 30, blockedPeriods: [] };
    try {
      return publicData?.user?.schedule_settings
        ? { ...defaults, ...JSON.parse(publicData.user.schedule_settings) }
        : defaults;
    } catch {
      return defaults;
    }
  })();

  function getCalendarDays() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const first = new Date(year, month, 1);
    const offset = first.getDay();
    const daysIn = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function isAvailable(d: Date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return false;
    return settings.availableDays.includes(d.getDay());
  }

  function getAvailableSlots(day: Date) {
    const slots: string[] = [];
    let [sh, sm] = settings.startHour.split(":").map(Number);
    const [eh, em] = settings.endHour.split(":").map(Number);
    const cur = new Date(day);
    cur.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);
    while (cur < end) {
      const time = `${cur.getHours().toString().padStart(2, "0")}:${cur.getMinutes().toString().padStart(2, "0")}`;
      const occupied = (publicData?.meetings ?? []).some((m: any) => m.hour_at === time && new Date(m.due_at).toDateString() === day.toDateString());
      const blocked = (settings.blockedPeriods ?? []).some((bp: any) => bp.day === day.getDay() && time >= bp.start && time < bp.end);
      const now = new Date();
      const isPast = cur.toDateString() === now.toDateString() && cur < now;
      if (!occupied && !blocked && !isPast) slots.push(time);
      cur.setMinutes(cur.getMinutes() + settings.meetingDuration);
    }
    return slots;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    if (!form.title.trim() || !form.first_name.trim() || !form.email.trim() || !selectedDate || !selectedTime) {
      setError("Preencha os campos obrigatórios e selecione data/hora.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      await bookPublicMeeting(username, {
        title: form.title.trim(),
        description: form.description,
        first_name: form.first_name.trim(),
        last_name: form.last_name,
        email: form.email.trim(),
        phone: form.phone,
        due_at: selectedDate.toISOString().split("T")[0],
        hour_at: selectedTime,
      });
      setSuccess(true);
      const refreshed = await fetchPublicCalendar(username);
      setPublicData(refreshed);
    } catch (err: any) {
      setError(err.message || "Falha ao realizar agendamento.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset() {
    setSuccess(false);
    setSelectedDate(null);
    setSelectedTime(null);
    setForm({ title: "", description: "", first_name: "", last_name: "", email: "", phone: "" });
  }

  return (
    <div className="min-h-screen flex-col justify-between bg-background" style={{ ["--primary" as any]: themeColor }}>
      <div className="mx-auto max-w-4xl flex-grow space-y-8 p-6 py-12 md:p-8">
        {error && <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>}

        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row md:gap-6">
            <UserAvatar user={publicData?.user} className="h-24 w-24" />
            <div className="text-center sm:text-left">
              <span className="inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">Agenda Pública de Agendamento</span>
              <h1 className="font-display text-2xl font-bold">{publicData?.user?.first_name} {publicData?.user?.last_name}</h1>
              <p className="text-sm text-muted-foreground">{publicData?.user?.biography || "Bem-vindo(a) à minha agenda pública. Selecione um horário disponível para agendar uma reunião."}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-12">
          <Card className="md:col-span-7">
            <CardContent className="flex h-full flex-col p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold"><CalendarIcon className="h-5 w-5 text-primary" /> Selecione a Data</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { const d = new Date(currentDate); d.setMonth(d.getMonth() - 1); setCurrentDate(d); }}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="text-sm font-medium">{currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { const d = new Date(currentDate); d.setMonth(d.getMonth() + 1); setCurrentDate(d); }}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
                {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {getCalendarDays().map((d, i) => d ? (
                  <button
                    key={i}
                    disabled={!isAvailable(d)}
                    onClick={() => { setSelectedDate(d); setSelectedTime(null); }}
                    className={`h-9 rounded-md text-sm transition-colors ${selectedDate?.toDateString() === d.toDateString() ? "bg-primary text-primary-foreground" : isAvailable(d) ? "hover:bg-accent" : "cursor-not-allowed text-muted-foreground/30"}`}
                  >
                    {d.getDate()}
                  </button>
                ) : <span key={i} />)}
              </div>
              <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground"><AlertCircle className="h-3 w-3" />Apenas datas disponíveis podem ser selecionadas.</p>
            </CardContent>
          </Card>

          <Card className="md:col-span-5">
            <CardContent className="flex h-full flex-col p-6">
              {success ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15"><Check className="h-7 w-7 text-emerald-500" /></div>
                  <h3 className="font-display text-lg font-semibold">Agendado com sucesso!</h3>
                  <p className="text-sm text-muted-foreground">Sua reunião foi registrada. Verifique seu e-mail para confirmação.</p>
                  <Button onClick={reset} variant="secondary">Novo Agendamento</Button>
                </div>
              ) : !selectedDate ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <CalendarIcon className="h-10 w-10 opacity-40" />
                  <p className="text-sm">Selecione uma data disponível no calendário.</p>
                </div>
              ) : !selectedTime ? (
                <div className="flex h-full flex-col">
                  <Button variant="ghost" size="sm" className="mb-2 w-fit gap-1" onClick={() => setSelectedDate(null)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                  <p className="mb-3 text-sm font-semibold">Horários em {selectedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
                  {getAvailableSlots(selectedDate).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem horários disponíveis neste dia.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {getAvailableSlots(selectedDate).map((t) => (
                        <Button key={t} variant="outline" onClick={() => setSelectedTime(t)}>{t}</Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex h-full flex-col">
                  <Button variant="ghost" size="sm" className="mb-2 w-fit gap-1" onClick={() => setSelectedTime(null)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4 text-primary" /> {selectedDate.toLocaleDateString("pt-BR")} às {selectedTime}</div>
                  <div className="space-y-3">
                    <div className="space-y-1.5"><Label htmlFor="p_title">Título *</Label><Input id="p_title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label htmlFor="p_first">Nome *</Label><Input id="p_first" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required /></div>
                      <div className="space-y-1.5"><Label htmlFor="p_last">Sobrenome</Label><Input id="p_last" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label htmlFor="p_email">E-mail *</Label><Input id="p_email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
                      <div className="space-y-1.5"><Label htmlFor="p_phone">Telefone</Label><Input id="p_phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                    </div>
                    <div className="space-y-1.5"><Label htmlFor="p_desc">Descrição</Label><Textarea id="p_desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                  </div>
                  <Button type="submit" disabled={isSubmitting} className="mt-auto gap-2">
                    {isSubmitting ? "Agendando..." : "Confirmar Agendamento"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Desenvolvido via CollabSuite <Heart className="mx-1 inline h-3 w-3" /> © 2026.
      </footer>
    </div>
  );
}