import express from "express";
import helmet from "helmet";
import cors from "cors";
import { apiLimiter } from "./middleware/rateLimit.middleware";

import path from "path";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import projectRoutes from "./routes/project.routes";
import funnelRoutes from "./routes/funnel.routes";
import driveRoutes from "./routes/drive.routes";
import credentialRoutes from "./routes/credential.routes";
import taskRoutes from "./routes/task.routes";
import checklistRoutes from "./routes/checklist.routes";
import activityRoutes from "./routes/activity.routes";
import publicRoutes from "./routes/public.routes";
import uploadRoutes from "./routes/upload.routes";
import attachmentRoutes from "./routes/attachment.routes";
import taskDriveRoutes from "./routes/taskDrive.routes";
import widgetRoutes from "./routes/widget.routes";
import analyticsRoutes from "./routes/analytics.routes";
import folderRoutes from "./routes/folder.routes";
import proposalRoutes from "./routes/proposal.routes";
import designRoutes from "./routes/design.routes";
import customFontRoutes from "./routes/custom-font.routes";
import transcriptRoutes from "./routes/transcript.routes";
import recordingRoutes from "./routes/recording.routes";
import transcriptItemRoutes from "./routes/transcriptItem.routes";
import whatsappRoutes from "./routes/whatsapp.routes";
import taskWhatsappRoutes from "./routes/taskWhatsapp.routes";
import notificationRoutes from "./routes/notification.routes";
import aiCredentialRoutes from "./routes/ai-credential.routes";
import localCliRoutes from "./routes/local-cli.routes";
import cliAgentRoutes from "./routes/cli-agent.routes";
import agentRoutes from "./routes/agent.routes";
import agentConversationRoutes from "./routes/agent-conversation.routes";
import agentChannelRoutes from "./routes/agent-channel.routes";
import conversationRoutes from "./routes/conversation.routes";
import agentPipelineRoutes from "./routes/agent-pipeline.routes";
import agentRunRoutes from "./routes/agent-run.routes";
import generatedImageRoutes from "./routes/generated-image.routes";
import icpRoutes from "./routes/icp.routes";
import habitRoutes from "./routes/habit.routes";
import healthRoutes from "./routes/health.routes";
import ticketsRoutes from "./routes/tickets.routes";
import carrosselRoutes from "./routes/carrossel.routes";
import photosuiteRoutes from "./routes/photosuite.routes";
import instagramRoutes from "./routes/instagram.routes";
import socialRoutes from "./routes/social.routes";
import githubRoutes from "./routes/github.routes";
import sshRoutes from "./routes/ssh.routes";
import studioxRoutes from "./routes/studiox.routes";
import { studioxProxy } from "./services/studiox/proxy";

export function createApp() {
  const app = express();
  
  // Trust proxy for rate limiter to work correctly behind reverse proxies (like Nginx/Cloudflare)
  app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
  app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  }));
  // Editor de vídeo (StudioX): proxy para o processo Python. Antes do express.json, que consumiria o corpo das requisições.
  app.use("/studiox", studioxProxy);

  // rawBody: o webhook do Instagram assina o corpo bruto (X-Hub-Signature-256).
  app.use(express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      if ((req as any).originalUrl?.startsWith("/api/instagram/webhook")) (req as any).rawBody = buf;
    },
  }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/projects/:projectId/drive", driveRoutes);
  app.use("/api/projects/:projectId/credentials", credentialRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/funnels", funnelRoutes);
app.use("/api/tasks", checklistRoutes);
app.use("/api/tasks", activityRoutes);
app.use("/api/tasks", attachmentRoutes);
app.use("/api/tasks", taskDriveRoutes);
app.use("/api/tasks", transcriptRoutes);
app.use("/api/transcripts", transcriptItemRoutes);
app.use("/api/tasks", taskWhatsappRoutes);
app.use("/api/tasks", taskRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/public/widget", widgetRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/folders", folderRoutes);
  app.use("/api/proposal-templates", proposalRoutes);
  app.use("/api/designs", designRoutes);
  app.use("/api/custom-fonts", customFontRoutes);
  app.use("/api/whatsapp", whatsappRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/ai-credentials", aiCredentialRoutes);
  app.use("/api/local-clis", localCliRoutes);
  app.use("/api/cli-agent", cliAgentRoutes);
  app.use("/api/agents", agentRoutes);
  app.use("/api/agents/:agentId/conversations", agentConversationRoutes);
  app.use("/api/agents/:agentId/channel", agentChannelRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/agent-pipelines", agentPipelineRoutes);
  app.use("/api/agent-runs", agentRunRoutes);
  app.use("/api/generated-images", generatedImageRoutes);
  app.use("/api/icps", icpRoutes);
  app.use("/api/habits", habitRoutes);
  app.use("/api/health", healthRoutes);
  app.use("/api/recordings", recordingRoutes);
  app.use("/api/atendimento", ticketsRoutes);
  app.use("/api/carrosseis", carrosselRoutes);
  app.use("/api/photosuite", photosuiteRoutes);
  app.use("/api/instagram", instagramRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/github", githubRoutes);
  app.use("/api/ssh", sshRoutes);
  app.use("/api/studiox", studioxRoutes);

  return app;
}