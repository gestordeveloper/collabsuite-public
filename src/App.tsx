import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAppData } from "./hooks/useAppData";
import { useAuthStore } from "./store/auth.store";
import { LoginPage } from "./pages/LoginPage";
import { PublicCalendarPage } from "./pages/PublicCalendarPage";
import { PublicTaskPage } from "./pages/PublicTaskPage";
import { PublicRecordingPage } from "./pages/PublicRecordingPage";
import { PublicNovelaPage } from "./pages/PublicNovelaPage";
import { PublicPhotosuitePage } from "./pages/PublicPhotosuitePage";
import { PublicProposalPage } from "./pages/PublicProposalPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DashboardOverviewPage } from "./pages/DashboardOverviewPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDashboardPage } from "./pages/ProjectDashboardPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { KanbanPage } from "./pages/KanbanPage";
import { AgendaPage } from "./pages/AgendaPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WhatsAppPage } from "./pages/WhatsAppPage";
import { TicketsPage } from "./pages/TicketsPage";
import { TicketSettingsPage } from "./pages/TicketSettingsPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { DesignsPage } from "./pages/DesignsPage";
import { DesignEditorPage } from "./pages/DesignEditorPage";
import { EntradaPage } from "./pages/EntradaPage";
import { PublicFormPage } from "./pages/PublicFormPage";
import { PrivacyPage, TermsPage } from "./pages/LegalPage";
import { LandingPage } from "./pages/LandingPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AgentManagePage } from "./pages/AgentManagePage";
import { AgentPipelinesPage } from "./pages/AgentPipelinesPage";
import { AgentPipelineEditorPage } from "./pages/AgentPipelineEditorPage";
import { ImageGalleryPage } from "./pages/ImageGalleryPage";
import { IcpsPage } from "./pages/IcpsPage";
import { HabitsPage } from "./pages/HabitsPage";
import { HealthPage } from "./pages/HealthPage";
import { TasksPage } from "./pages/TasksPage";
import { RecordingsPage } from "./pages/RecordingsPage";
import { InstagramPage } from "./pages/InstagramPage";
import { VideoEditorPage } from "./pages/VideoEditorPage";
import { CarouselsPage } from "./pages/CarouselsPage";
import { PhotosuitePage } from "./pages/PhotosuitePage";
import { PhotosuiteEditorPage } from "./pages/PhotosuiteEditorPage";
import { CarouselEditorPage } from "./pages/CarouselEditorPage";
import { ComicSeriesPage } from "./pages/ComicSeriesPage";
import { OfflineIndicator } from "@/src/components/pwa/OfflineIndicator";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const { user } = useAppData();
  const location = useLocation();

  if (!isAuthenticated) {
    // Visitante na raiz vê a página inicial; o login fica em /entrar (e em qualquer outra rota protegida).
    return location.pathname === "/" ? <LandingPage /> : <LoginPage />;
  }

  if (isAuthenticated && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div
          className="w-16 h-16 dynamic-color-img"
          style={{
            WebkitMaskImage: "url('/assets/images/loader.gif')",
            maskImage: "url('/assets/images/loader.gif')",
          }}
        />
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  const [publicUsername, setPublicUsername] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pubCal = params.get("publicCalendar");
    setPublicUsername(pubCal);
  }, [location.search]);

  if (publicUsername) {
    return <PublicCalendarPage username={publicUsername} themeColor="#ec1889" />;
  }

  // Páginas legais públicas (exigidas pelas lojas de apps do Google, Meta e TikTok)
  if (/^\/(privacidade|privacy|termos|terms)\/?$/i.test(location.pathname)) {
    return (
      <Routes>
        <Route path="/privacidade" element={<PrivacyPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/termos" element={<TermsPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    );
  }

  // Public task share route (no auth required)
  if (location.pathname.startsWith("/public/task/")) {
    return (
      <Routes>
        <Route path="/public/task/:id" element={<PublicTaskPage />} />
      </Routes>
    );
  }

  // Public mini-novela approval route (no auth required)
  if (location.pathname.startsWith("/public/novela/")) {
    return (
      <Routes>
        <Route path="/public/novela/:token" element={<PublicNovelaPage />} />
      </Routes>
    );
  }

  // Public proposal route (no auth required)
  if (location.pathname.startsWith("/public/proposal/")) {
    return (
      <Routes>
        <Route path="/public/proposal/:id" element={<PublicProposalPage />} />
      </Routes>
    );
  }

  // Public recording share route (no auth required)
  if (location.pathname.startsWith("/public/recording/")) {
    return (
      <Routes>
        <Route path="/public/recording/:token" element={<PublicRecordingPage />} />
      </Routes>
    );
  }

  // Public Photosuite share route (no auth required)
  if (location.pathname.startsWith("/public/photosuite/")) {
    return (
      <Routes>
        <Route path="/public/photosuite/:token" element={<PublicPhotosuitePage />} />
      </Routes>
    );
  }

  // Public form submit route (no auth required)
  if (location.pathname.startsWith("/public/form/")) {
    return (
      <Routes>
        <Route path="/public/form/:id" element={<PublicFormPage />} />
      </Routes>
    );
  }

  return (
    <RequireAuth>
      <Routes>
        <Route path="/" element={<DashboardPage />}>
          <Route index element={<DashboardOverviewPage />} />
          <Route path="entrada" element={<EntradaPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="projects/dashboard" element={<ProjectDashboardPage />} />
          <Route path="tarefas" element={<TasksPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="habitos" element={<HabitsPage />} />
          <Route path="saude" element={<HealthPage />} />
          <Route path="atendimento" element={<TicketsPage />} />
          <Route path="atendimento/configuracoes" element={<TicketSettingsPage />} />
          <Route path="atendimento/:ticketId" element={<TicketsPage />} />
          <Route path="whatsapp" element={<WhatsAppPage />} />
          <Route path="gravacoes" element={<RecordingsPage />} />
          <Route path="carrosseis" element={<CarouselsPage />} />
          <Route path="instagram" element={<InstagramPage />} />
          <Route path="editor-de-video" element={<VideoEditorPage />} />
          <Route path="carrosseis/:id" element={<CarouselEditorPage />} />
          <Route path="novelas/:id" element={<ComicSeriesPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="task/:id" element={<TaskDetailPage />} />
          <Route path="designs" element={<DesignsPage />} />
          <Route path="photosuite" element={<PhotosuitePage />} />
          <Route path="agentes" element={<AgentsPage />} />
          <Route path="agentes/pipelines" element={<AgentPipelinesPage />} />
          <Route path="agentes/galeria" element={<ImageGalleryPage />} />
          <Route path="agentes/icps" element={<IcpsPage />} />
          <Route path="agentes/:id/gerenciar" element={<AgentManagePage />} />
        </Route>
        {/* Full-screen editor, outside the DashboardPage chrome (sidebar/header/tabbar) — same idea as the public routes above, just authenticated. */}
        <Route path="designs/:id" element={<DesignEditorPage />} />
        <Route path="photosuite/:id" element={<PhotosuiteEditorPage />} />
        <Route path="agentes/pipelines/:id" element={<AgentPipelineEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <OfflineIndicator />
    </RequireAuth>
  );
}