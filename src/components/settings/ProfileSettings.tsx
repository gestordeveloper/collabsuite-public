import { useState, useCallback, useRef } from "react";
import { User, Plus, Check, Save, Camera, X, CalendarClock } from "lucide-react";
import { useAuthStore } from "@/src/store/auth.store";
import * as authService from "@/src/services/auth.service";
import Cropper from "react-easy-crop";
import api from "@/src/services/api";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";

const getCroppedImg = async (imageSrc: string, pixelCrop: any): Promise<string> => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => (image.onload = resolve));
  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
  return canvas.toDataURL("image/jpeg");
};

const DAYS = [
  { label: "Dom", value: 0 }, { label: "Seg", value: 1 }, { label: "Ter", value: 2 },
  { label: "Qua", value: 3 }, { label: "Qui", value: 4 }, { label: "Sex", value: 5 }, { label: "Sáb", value: 6 },
];

interface ProfileSettingsProps {
  activeSection: "profile" | "schedule";
}

export function ProfileSettings({ activeSection }: ProfileSettingsProps) {
  const { user, updateUser } = useAuthStore();

  const [formData, setFormData] = useState({
    first_name: user?.first_name || "", last_name: user?.last_name || "",
    username: user?.username || "", email: user?.email || "",
    photo: user?.photo || "", biography: user?.biography || "", password: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const [scheduleSettings, setScheduleSettings] = useState<any>(() => {
    const defaults = { availableDays: [1, 2, 3, 4, 5], startHour: "09:00", endHour: "18:00", meetingDuration: 30, blockedPeriods: [] };
    try {
      return user?.schedule_settings ? { ...defaults, ...JSON.parse(user.schedule_settings) } : defaults;
    } catch {
      return defaults;
    }
  });

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  async function handleSaveProfile() {
    if (!user) return;
    setIsLoading(true);
    try {
      const payload: any = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        username: formData.username,
        email: formData.email,
        photo: formData.photo,
        biography: formData.biography,
      };
      if (formData.password) {
        payload.password = formData.password;
      }
      const updatedUser = await authService.updateUserProfile(user.id, payload);
      updateUser({ ...user, ...updatedUser });
      setFormData((prev) => ({ ...prev, password: "" }));
      alert("Perfil atualizado com sucesso!");
    } catch (err) {
      console.error(err);
      alert("Erro ao atualizar o perfil.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveSchedule() {
    if (!user) return;
    setIsLoading(true);
    try {
      const payload = {
        schedule_settings: JSON.stringify(scheduleSettings),
      };
      const updatedUser = await authService.updateUserProfile(user.id, payload);
      updateUser({ ...user, ...updatedUser });
      alert("Agenda atualizada com sucesso!");
    } catch (err) {
      console.error(err);
      alert("Erro ao atualizar a agenda.");
    } finally {
      setIsLoading(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => setImageSrc(reader.result?.toString() || null));
      reader.readAsDataURL(file);
    }
  }

  const onCropComplete = useCallback((_: any, area: any) => setCroppedAreaPixels(area), []);

  async function handleUploadCroppedImage() {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      const cropped = await getCroppedImg(imageSrc, croppedAreaPixels);
      const res = await api.post("/upload", { image: cropped });
      setFormData((prev) => ({ ...prev, photo: res.data.url }));
      setImageSrc(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error(err);
      alert("Erro ao fazer upload da imagem.");
    }
  }

  return (
    <>
      {activeSection === "profile" && (
        <Card className="border-none shadow-none bg-transparent sm:bg-card sm:border sm:shadow-sm">
          <CardHeader className="px-0 sm:p-6">
            <CardTitle className="flex items-center gap-2 text-xl font-bold font-display">
              <User className="h-5 w-5 text-primary animate-pulse" /> Dados do Perfil
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:p-6 space-y-6">
            <div className="flex flex-col gap-6 md:flex-row">
              <div className="flex shrink-0 flex-col items-center space-y-2">
                <div 
                  className="group relative cursor-pointer overflow-hidden rounded-full ring-4 ring-primary/30 transition-all hover:ring-primary/50" 
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UserAvatar
                    user={{ first_name: formData.first_name, last_name: formData.last_name, photo: formData.photo }}
                    className="h-28 w-28 text-4xl"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <Camera className="h-8 w-8 text-white scale-90 transition-transform duration-200 group-hover:scale-100" />
                  </div>
                </div>
                <input type="file" ref={fileInputRef} onChange={onFileChange} accept="image/*" className="hidden" />
                <span className="text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
                  Toque na foto para alterar
                </span>
              </div>

              <div className="grid flex-grow grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="first_name" className="text-xs font-semibold">Nome</Label>
                  <Input id="first_name" name="first_name" value={formData.first_name} onChange={handleChange} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last_name" className="text-xs font-semibold">Sobrenome</Label>
                  <Input id="last_name" name="last_name" value={formData.last_name} onChange={handleChange} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-xs font-semibold">Nome de Usuário</Label>
                  <Input id="username" name="username" value={formData.username} onChange={handleChange} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold">E-mail</Label>
                  <Input id="email" name="email" type="email" value={formData.email} onChange={handleChange} className="h-11" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="password" className="text-xs font-semibold">Nova Senha (deixe em branco para manter)</Label>
                  <Input id="password" name="password" type="password" value={formData.password} onChange={handleChange} placeholder="******" className="h-11" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="biography" className="text-xs font-semibold">Biografia</Label>
                  <Textarea id="biography" name="biography" value={formData.biography} onChange={handleChange} rows={3} placeholder="Fale um pouco sobre você" className="resize-none" />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleSaveProfile} disabled={isLoading} className="w-full sm:w-auto h-11 px-6 gap-2">
                <Save className="h-4 w-4" />{isLoading ? "Salvando..." : "Salvar Perfil"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === "schedule" && (
        <Card className="border-none shadow-none bg-transparent sm:bg-card sm:border sm:shadow-sm">
          <CardHeader className="px-0 sm:p-6">
            <CardTitle className="flex items-center gap-2 text-xl font-bold font-display">
              <CalendarClock className="h-5 w-5 text-primary" /> Configurações da Agenda
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:p-6 space-y-6">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block text-xs font-semibold">Dias Disponíveis</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => {
                    const isSelected = scheduleSettings.availableDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => {
                          const days = isSelected
                            ? scheduleSettings.availableDays.filter((d: number) => d !== day.value)
                            : [...scheduleSettings.availableDays, day.value];
                          setScheduleSettings({ ...scheduleSettings, availableDays: days });
                        }}
                        className={`rounded-full border px-4 py-2 text-xs font-bold transition-all duration-200 ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground shadow-sm scale-105"
                            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Início do Expediente</Label>
                  <Input type="time" value={scheduleSettings.startHour} onChange={(e) => setScheduleSettings({ ...scheduleSettings, startHour: e.target.value })} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Fim do Expediente</Label>
                  <Input type="time" value={scheduleSettings.endHour} onChange={(e) => setScheduleSettings({ ...scheduleSettings, endHour: e.target.value })} className="h-11" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Duração Padrão de Reunião</Label>
                <select 
                  value={scheduleSettings.meetingDuration} 
                  onChange={(e) => setScheduleSettings({ ...scheduleSettings, meetingDuration: Number(e.target.value) })} 
                  className="flex h-11 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value={15}>15 minutos</option>
                  <option value={30}>30 minutos</option>
                  <option value={45}>45 minutos</option>
                  <option value={60}>1 hora</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <Label className="mb-2 block text-xs font-semibold">Bloqueios e Pausas na Agenda</Label>
                <p className="text-xs text-muted-foreground mb-4">Adicione intervalos fixos onde você não receberá reuniões (ex: almoço).</p>
              </div>
              <div className="space-y-2">
                {(scheduleSettings.blockedPeriods || []).map((bp: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3 text-sm transition-all hover:bg-muted/70">
                    <span className="w-16 font-bold">{DAYS.find(d => d.value === bp.day)?.label || "Dia"}</span>
                    <span className="text-muted-foreground">Das {bp.start} às {bp.end}</span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2.5 rounded-lg" 
                      onClick={() => {
                        const next = [...(scheduleSettings.blockedPeriods || [])];
                        next.splice(idx, 1);
                        setScheduleSettings({ ...scheduleSettings, blockedPeriods: next });
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-xl border border-dashed p-4 sm:flex sm:flex-wrap sm:items-end">
                <div className="space-y-1.5 flex-grow sm:w-auto">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase">Dia</Label>
                  <select id="new-block-day" className="h-10 rounded-md border border-input bg-surface px-2.5 text-sm w-full sm:w-32">
                    {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 flex-grow sm:w-auto">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase">Início</Label>
                  <Input id="new-block-start" type="time" defaultValue="12:00" className="h-10 w-full sm:w-28" />
                </div>
                <div className="space-y-1.5 flex-grow sm:w-auto">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase">Fim</Label>
                  <Input id="new-block-end" type="time" defaultValue="13:00" className="h-10 w-full sm:w-28" />
                </div>
                <Button 
                  type="button"
                  variant="outline" 
                  size="sm" 
                  className="w-full sm:w-auto h-10 px-4 bg-background" 
                  onClick={() => {
                    const day = Number((document.getElementById("new-block-day") as HTMLSelectElement).value);
                    const start = (document.getElementById("new-block-start") as HTMLInputElement).value;
                    const end = (document.getElementById("new-block-end") as HTMLInputElement).value;
                    if (start && end) {
                      setScheduleSettings({ ...scheduleSettings, blockedPeriods: [...(scheduleSettings.blockedPeriods || []), { day, start, end }] });
                    }
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Sincronização com Google Calendar
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Conecte sua conta do Google para gerar links de reuniões automaticamente.</p>
              </div>
              <div className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1">
                  <p className="text-xs font-semibold leading-relaxed">
                    {scheduleSettings.google_refresh_token 
                      ? "✓ Sua conta do Google está conectada e sincronizada." 
                      : "Sua conta do Google não está integrada."}
                  </p>
                </div>
                {scheduleSettings.google_refresh_token ? (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full sm:w-auto h-9 text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive" 
                    onClick={() => {
                      const next = { ...scheduleSettings };
                      delete next.google_refresh_token;
                      setScheduleSettings(next);
                    }}
                  >
                    Desconectar Conta
                  </Button>
                ) : (
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    className="w-full sm:w-auto h-9 gap-2 font-bold" 
                    onClick={async () => {
                      try {
                        const res = await api.get("/auth/google/url");
                        if (res.data.url) {
                          const popup = window.open(res.data.url, "google_login", "width=500,height=600");
                          if (popup) {
                            const timer = setInterval(async () => {
                              if (popup.closed) {
                                clearInterval(timer);
                                try {
                                  const u = await authService.getMe();
                                  updateUser(u);
                                  if (u.schedule_settings) {
                                    const parsed = JSON.parse(u.schedule_settings);
                                    setScheduleSettings((prev: any) => ({ ...prev, google_refresh_token: parsed.google_refresh_token }));
                                  }
                                } catch (e) { console.error(e); }
                              }
                            }, 1000);
                          }
                        }
                      } catch (e) { console.error(e); }
                    }}
                  >
                    <Plus className="h-4 w-4" /> Conectar Google
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t pt-6">
              <Button onClick={handleSaveSchedule} disabled={isLoading} className="w-full sm:w-auto h-11 px-6 gap-2">
                <Save className="h-4 w-4" />{isLoading ? "Salvando..." : "Salvar Agenda"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {imageSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="flex h-[520px] w-full max-w-md flex-col rounded-2xl bg-card p-4 shadow-2xl border">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-lg font-display">Cortar Foto</h3>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => { setImageSrc(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                className="rounded-full h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative mb-4 flex-grow overflow-hidden rounded-xl bg-muted border">
              <Cropper 
                image={imageSrc} 
                crop={crop} 
                zoom={zoom} 
                aspect={1} 
                cropShape="round" 
                onCropChange={setCrop} 
                onCropComplete={onCropComplete} 
                onZoomChange={setZoom} 
              />
            </div>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-xs font-semibold text-muted-foreground">Zoom:</span>
              <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-primary h-1 rounded-lg cursor-pointer" />
            </div>
            <Button onClick={handleUploadCroppedImage} className="gap-2 h-11 rounded-xl">
              <Check className="h-4 w-4" /> Confirmar Foto
            </Button>
          </div>
        </div>
      )}
    </>
  );
}