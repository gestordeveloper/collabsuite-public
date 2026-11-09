# src/ — Application Source

## Responsibility
Full-stack source for CollabSuite, a collaboration and project management platform. Contains the React SPA frontend (components, pages, stores, hooks) and the Express.js backend (server routes, middleware, services, controllers).

## Directory Map

### `src/server/` — Backend API Server
**Responsibility:** Express.js HTTP server + Socket.IO real-time layer. Implements RESTful API routes, authentication/authorization middleware, Zod-based request validation, business logic services, and real-time event broadcasting.

**Subdirectories:**
- `lib/` — Low-level server utilities (Prisma client singleton, JWT helpers, bcrypt wrapper, Socket.IO initialization)
- `middleware/` — Express middleware pipeline: `auth.middleware.ts` (JWT + DB user lookup), `error.middleware.ts` (404/500 handlers), `rateLimit.middleware.ts` (express-rate-limit), `validate.middleware.ts` (Zod schema validation)
- `routes/` — Route definitions mapping HTTP paths to controller functions (12 route files: auth, user, funnel, task, checklist, activity, attachment, public, upload, widget, analytics, folder)
- `controllers/` — Request handlers that parse input, delegate to services, and format responses (10 controller files)
- `services/` — Business logic layer: CRUD operations, analytics queries, Google Calendar integration, seed data initialization
- `validations/` — Zod schemas for request body validation (`schemas.ts`)
- Habits API (`/api/habits`): `routes/habit.routes.ts` → `controllers/habit.controller.ts` → `services/habit.service.ts` (streak = consecutive days for daily habits, consecutive Sun–Sat weeks for "N×/week"; 30-day rate; per-user ownership checks; idempotent `PUT /:id/logs {date, done}`)
- Habits extensions (2026-10-23): `habit.service.ts` also carries `kind` (habit|routine), `project_id`, `reminder_time`/`reminder_days` (BRT), `checklist`; hábitos atribuídos (`team_habit_id`) são somente leitura para quem recebeu. `habit-team.service.ts` (TeamHabit → one `Habit` row per assignee; assignable = people sharing a project; board of 14-day adherence; `nudge` with 30-min cooldown), `habit-focus.service.ts` ("Foco do dia", max 3 items + review, one row per user/day), `habit-summary.service.ts` (weekly Sun–Sat summary: habits %, tasks done/overdue, focus, team adherence). Fixed routes (`/summary`, `/focus`, `/team…`) are declared before `/:id` in `habit.routes.ts`. `habitReminderWorker.ts` (60s poller, started in `index.ts`): reminders at `reminder_time` (1h grace, once/day via `last_reminded_on`) and the Monday 08–11h weekly-summary notification; new notification types `habit_reminder` and `weekly_summary`.
- Health API (`/api/health`, 2026-10-31): `routes/health.routes.ts` → `controllers/health.controller.ts` → `services/health.service.ts`. One `HealthDaily` row per user/day (steps, water, sleep, weight/body fat/waist, mood/energy/stress; `sources` JSON = "manual"|"api" per field) + `HealthWorkout` + `HealthProfile` (goals JSON, sha256 of the ingest token). `POST /api/health/ingest` (Bearer `hk_…`, no login) is the sync entry point for bridge apps/watches: never overwrites manual fields, workouts dedupe by `external_id`. Writes per user/day are serialized with `runExclusive`. `Habit.health_metric` (steps|water|sleep|workout) auto-checks the habit when the day's goal is met (never unchecks). No Fitbit/Google Fit connector: legacy Fitbit Web API shuts down 2026-11-02 and Google Health API is not onboarding projects.
- GitHub API (`/api/github`, 2026-11-01): `routes/github.routes.ts` -> `controllers/github.controller.ts` -> `services/github/` (`api.ts` fetch wrapper with GITHUB_API_URL/GITHUB_WEB_URL overrides, `config.service.ts` OAuth App credentials in `github_app_config` (secret AES-encrypted, admin-only) > .env, `account.service.ts` per-user OAuth connect (`github_account`, token encrypted, state = JWT, return_to sanitized), `repo.service.ts` link/create repo (`project_repo`) + commits/branches/contents (read, edit, create, delete = commits)/PRs (review, merge, comment)/issues/Actions (runs, jobs, logs, rerun, cancel, dispatch)). Reads use the caller token, else the token of whoever linked the repo; writes require the caller own GitHub account. UI: `components/github/` (`GithubTab` is the project tab, plus Code/Commits/Branches/Pulls/Issues/Actions panels, `GithubConfigCard`), repo creation checkbox in `NewProjectModal`. Token upkeep (`account.service.ts`, `tokenRefresher.ts`): GitHub App / expiring OAuth tokens last ~8 h and come with a SINGLE-USE refresh_token, so refresh is serialized per user (`runExclusive`); it runs before use when <10 min remain, on a GitHub 401 (refresh + retry once, `GithubAuthError`), and in a 30-min worker for tokens expiring within 2 h. GitHub-auth failures return HTTP 424, never 401 (the axios interceptor logs the user out on any 401). Update report (`POST /github/projects/:id/report`, `services/github/report.service.ts` + `components/github/ReportPanel.tsx`, 'Relatório' sub-tab / 'Gerar relatório' header button): commits of a date range (America/Sao_Paulo, merges/build/release commits skipped, up to 600) -> plain-language Markdown from the user's configured AI key (`carrossel/aiClient` `requireCfg`/`chat`, map-reduce when the list exceeds the provider context limit) -> pdfkit PDF (manual word wrap for bold runs); returns JSON with `pdf_base64` + `markdown`.
- SSH terminal (`/api/ssh` + Socket.IO namespace `/ssh`, 2026-11-02): `routes/ssh.routes.ts` -> `controllers/ssh.controller.ts` -> `services/ssh/` (`access.ts` owner-or-admin only, 404 for non-members and 403 for plain members; `client.ts` ssh2 config/probe/host+key validation, ssh2 imported via default for ESM interop; `connection.service.ts` per-project accesses with AES-encrypted key/password/passphrase that never leave the server, fingerprint pinning via test + trust; `command.service.ts` saved commands; `session.service.ts` audit rows + asciicast v2 output-only recordings in `SSH_RECORDINGS_DIR` (default `.ssh-recordings/`, gitignored, 10 MB cap) read only through the API; `terminal.ts` the `/ssh` namespace: JWT verified on connect, permission + pinned fingerprint + per-user session limit checked on each `open`, idle (no input AND no output)/max-duration timers, boot sweep closes orphan sessions). UI: `components/ssh/` (`SshTab` = project tab "Terminal", `TerminalView` xterm.js, `ConnectionsPanel`, `CommandsPanel`, `SessionsPanel` with replay). `vite.config.ts` pre-optimizes xterm to avoid a dev page reload.
- Recordings API (`/api/recordings`): `routes/recording.routes.ts` → `controllers/recording.controller.ts` (multer to disk, 1 GB) → `services/recording.service.ts`. Audio goes to a **private** S3 object (`lib/recordingStorage.ts`, presigned GET via `GET /:id/audio-url`; local `uploads/recordings` fallback when `AWS_S3_*` is unset). Processing runs in an in-process one-at-a-time queue: `lib/ffmpeg.ts` (mp3 mono 16k, 10-min chunks; needs `ffmpeg` on PATH or `FFMPEG_PATH`) → Whisper (Groq, fallback OpenAI) → LLM JSON analysis (Groq → Anthropic → OpenAI → OpenRouter, keys via `resolveApiKey`) in `lib/recordingPipeline.ts`. `RecordingAction` rows are the AI-extracted actions; `POST /:id/actions/to-tasks` turns them into Tasks in the project's default funnel, stage named "Backlog" (P1/P2/P3 → high/medium/low; `dd/mm` due dates and owner→project-member name matching parsed). `sweepStuckRecordings()` at boot marks interrupted jobs as error (reprocess re-downloads from S3).
- Photosuite (`/photosuite`, `/photosuite/:id`; image editor modeled on PhotoCraft, 2026-10-31): API `/api/photosuite` (`routes/photosuite.routes.ts` → `controllers/photosuite.controller.ts` → `services/photosuite.service.ts`), table `photo_document` (`doc` = layer-tree JSON only; pixels are per-layer/mask PNGs uploaded via `/api/upload/file`, URLs referenced by `src`). Client engine in `lib/photosuite/`: `types.ts` (doc model, 33 blend modes), `blend.ts` (exact port of PhotoCraft `crates/color/src/blend.rs`; native canvas ops only where the formula matches, CPU reference for the rest), `engine.ts` (canvas registry, compositor, hydrate, dirty-PNG upload; server URLs live in `sources`, NOT in layers, so history can't resurrect stale URLs), `brush.ts` (stamp brush with stroke-opacity/flow), `tree.ts`, `session.ts` (open/save/export). State + undo/redo in `store/photosuite.store.ts`; UI in `components/photosuite/*`, pages `PhotosuitePage.tsx` (list) and `PhotosuiteEditorPage.tsx` (full-screen route outside the dashboard layout, autosave 2.5s). Phases 1-2 done: layers/groups/masks/33 blend modes/history/export, plus selections (`selection.ts`: immutable doc-size alpha canvas, marching ants drawn at screen resolution; rect/ellipse/lasso/wand, add/sub/intersect, feather/grow/invert, move outline), `fill.ts` (flood fill for wand+bucket, gradients), `transform.ts` (free transform math; live preview via `engine.setLiveTransform`), crop, image/canvas size + canvas rotate/flip (`applyDocOp` in the store records size+selection+pixel swaps in one history entry), clone stamp, copy/cut/paste, layer-via-copy. Phase 3 done: adjustment layers are `RasterLayer`s with an `adjustment` field and no pixel canvas (only a doc-size mask; `engine.applyAdjustmentLayer` runs them over everything composed below, mixed by opacity×mask, optional blend mode); math in `adjustments.ts` (port of `compose/src/adjust.rs`, 14 of 15 PhotoCraft adjustments — Color Lookup/3D LUT missing; per-channel ones compile to 256-entry LUTs), editors in `components/photosuite/AdjustmentEditor.tsx` (shown under the layer list; Levels/Curves get a histogram of the layers below via `histogram.ts`). Destructive filters in `filters.ts` (gaussian/box/motion blur, unsharp, smart sharpen, high-pass, noise, median, mosaic, emboss, find edges, solarize) and "Aplicar ajuste à camada…" both run through the store's `beginPixelEdit/previewPixelEdit/commitPixelEdit` session (live preview on the real canvas, clipped by the selection, one history step) with floating dialogs in `FilterDialogs.tsx`. Phase 4 done: `RasterLayer.text` (`text.ts`: own layout — point/box text, word wrap, justify, tracking, leading, caps, underline; pixels re-generated from `TextData`, fonts via `design-studio/fonts.ts`, `ensureTextFont` polls for late Google stylesheets; in-place editing by `TextEditorOverlay` = transparent textarea over the canvas), `RasterLayer.shape` (`vector.ts`: Bezier paths whose points live in the layer canvas' own coordinates and are rebased after every rasterization, so moving a layer never touches points; pen / direct-select / shape tools in `Viewport.tsx`; edits during a drag use the store's `live*` session = one history step) and `RasterLayer.styles` (`effects.ts`: port of PhotoCraft's coverage-map pipeline — drop/inner shadow, outer/inner glow, stroke, color/gradient overlay, satin, bevel; exterior effects are blended against the real backdrop, interior ones onto the content; results cached per layer in `engine.styleCache`, invalidated by `touch(key)` pixel versions). Text/shape layers are NOT uploaded as PNGs (only their masks) — they are rebuilt from data on load; painting/filtering needs "Rasterizar". Phase 5 (files, `lib/photosuite/formats/`): `psd.ts` (ag-psd: layers, groups, masks, blend modes, opacity, text → editable text, layer effects ↔ `LayerStyles`, 9 adjustment kinds; clipping/vector masks/smart objects become warnings), `svg.ts` (import path/rect/circle/ellipse/line/polyline/polygon/g/text with transforms, arcs and linear/radial gradients as editable shape layers; export shapes→`<path>`, text→`<text>`, pixels→`<image>`), `native.ts` (`.photosuite` = gzip JSON with embedded PNGs, lossless), `index.ts` (`readFile` → `ImportResult`, `persistImport` uploads PNGs + creates the doc, `exportDocumentAs`). Import warnings travel through `sessionStorage[photosuite-warnings-<id>]` and show as a banner in the editor. Phase 6 (integration): `photo_document` gained `visibility` (private|project: project members open AND edit; only the owner deletes/changes access), `share_token`/`share_image_url` (public read-only link = a published PNG at `/public/photosuite/:token`, API `/api/photosuite/public/:token`); `ShareDialog.tsx` (Equipe / Link público / Anexar a tarefa — exports the image and creates a task attachment) and a button in `editor/nodes/Attachment.tsx` that opens an image attachment as a new Photosuite document (`fromUrl.ts`). Not built: rich-text runs, text on a path / warp, pattern overlays, custom contours, multiple instances of one effect, bevel contour/texture, fill-opacity separate from opacity, boolean path operations.
- Carousel Studio (`/api/carrosseis`, port of CarrosselX, 2026-10-23): `routes/carrossel.routes.ts` → `controllers/carrossel.controller.ts` + `comic.controller.ts` → `services/carrossel/*`. Brandbooks (DB `carousel_brandbook`, assets as data URIs, 3 seeds in `seed/*.json`) hold the REAL 1080×1350 slide templates; `templateEngine.ts` (cheerio) extracts (`extractTemplates`), fills (`fillTemplate`), themes (`applyTheme`) them; `brandbookImport.service.ts` imports the .zip. `ai.service.ts`/`slideAi.service.ts` generate/regenerate/review via the existing LLM adapters + `resolveApiKey` (`aiClient.ts` adds JSON mode/retries); prompts editable per user (`prompt.service.ts`). `imageText.service.ts` = built-in "Imagem e Texto" template (IT01, injected at read time, never saved) + `people.service.ts` + `mediaGen.service.ts` (OpenRouter/OpenAI/Gemini images). Rendering: `lib/headlessBrowser.ts` (playwright-core, `CHROMIUM_PATH`) → `render.service.ts` (PNG/ZIP), `slideExport.service.ts` (Stories/MP4 with `animationRuntime.ts` + ffmpeg). HQ mini-novelas: `comic.service.ts` (series/episodes as JSON docs in `comic_series`/`comic_episode`; script → art prompts → Nano Banana images → text overlay PNG), `comicVideo.service.ts` + `eleven.service.ts` + `ptNumbers.ts` (narrated MP4). Long work runs in `jobs.ts` (in-memory, polled at `/jobs/:id`). Binary outputs go through `storeBuffer` (S3 or `uploads/`). Frontend: `pages/CarouselsPage.tsx` (tabs), `CarouselEditorPage.tsx`, `ComicSeriesPage.tsx`, `components/carrossel/*`, `services/carrossel.service.ts`, `comic.service.ts`.
- Agent channel / RAG / MCP (2026-10-27, port of agent-davisantos): a per-agent WhatsApp auto-reply. `services/agent-channel/*` — `channel.service.ts` (Baileys `messages.upsert` handler attached in `connectionManager.doStart`; one active agent per connection via `Agent.channel_connection_id` + `channel_enabled`; per-contact debounce `buffer.ts`; audio → Whisper `media.ts`; images/stickers → vision part; reply split/typing delays `humanize.ts`; history in `AgentChannelSession` with TTL `session.service.ts`; `transferir_para_humano` tool creates a pending Ticket + internal note and sets `handed_off`). The ticket inbound handler skips chats an agent owns (`agentOwnsChat`), so tickets only appear after a handoff (needs `receive_tickets` on the connection). `services/agent-rag/*` — Qdrant over REST (`qdrant.ts`, one shared collection filtered by `metadata.agent_id`, vector `text-dense` 3072), OpenAI `text-embedding-3-large` (`llm.ts`), LLM chunking per 12k-char window + self-query filters (`rag.service.ts`); `runAgentTurn` injects retrieved context into the system prompt when `agent.rag_enabled` (also affects the web chat/pipelines). `services/agent-mcp/mcp.service.ts` — per-agent MCP servers (url/stdio; secrets encrypted; stdio admin-only), one session per turn, tools merged into `runAgentTurn`. Routes: `/api/agents/:agentId/channel/{settings,sessions,knowledge,mcp}` (`controllers/agent-channel.controller.ts`). Frontend: `pages/AgentManagePage.tsx` (`/agentes/:id/gerenciar`, 6 tabs) + `components/agents/manage/*`, `services/agent-channel.service.ts`. Env: `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`.
- Agent dashboard + calendar access (2026-10-28): `services/agent-metrics/metrics.service.ts` (`logTurn` writes one `AgentTurnLog` per WhatsApp turn from `channel.service.ts` — agent_ms, wait_ms from first buffered message to first sent chunk, tokens from `runAgentTurn().usage`, tools, rag, media, handoff/ticket; `getDashboard(agentId, days)` aggregates vs. the previous equal period, daily series, weekday×hour heatmap, handoff-ticket outcomes, appointments). `services/agent-calendar/calendar.service.ts` — `AgentCalendarAccess` (agent↔user, `can_write`, `enforce_availability`; non-admins can only grant their own agenda) and tools injected by `runAgentTurn` when the agent has any access: `listar_agenda`, `horarios_disponiveis`, `agendar_compromisso`, `remarcar_compromisso`, `cancelar_compromisso`. The agenda is `Task` rows (`due_at` + `hour_at` + `estimated_time`, BRT UTC-3); slots come from `User.schedule_settings`; conflicts only count meetings/tasks with an estimated duration; every change is logged in `AgentAppointment`. Routes `GET /channel/dashboard?days=`, `/channel/calendar`. Frontend tabs `DashboardTab.tsx`, `CalendarTab.tsx`.
- Instagram (`/api/instagram`, port of campinsta, 2026-10-29): publishing + comment automation, tied to the calendar. `services/instagram/` — `graph.ts` (Graph API v21: publish IMAGE/REELS/CAROUSEL with container polling, comment reply, private-reply DM with optional link button, OAuth/webhook subscription; media URLs must be public — `APP_URL`/S3, localhost is rejected), `account.service.ts` (**one `InstagramAccount` per Project = per client**, `ig_user_id` unique so one IG account can't serve two projects; any project member (owner or `ProjectUser`) uses it, `user_id` = who connected; Facebook Login OAuth with state = signed JWT carrying `projectId`; Page-selection held in memory 10 min; tokens AES-encrypted; disconnect only blanks tokens + `connected=false` so posts/automations survive and reconnect revives them; `memberProjectIds`/`assertMember` gate every read/write; `refreshAccount` renews the 60-day user token), `post.service.ts` (**each `InstagramPost` owns a `Task` with `template: "instagram_post"`** so it shows in `/agenda`; `task.service.updateTask`/`softDeleteTask` call `onTaskChanged`/`onTaskDeleted` so moving/deleting the item in the calendar reschedules/cancels the post; `publishPost` claims atomically, 3 attempts, then `failed` + notification), `automation.service.ts` + `webhook.service.ts` ("Engajar": keyword on a given `ig_media_id` → AI public reply via `resolveCfg`/`chat` (falls back to fixed text) + DM; dedupe by unique (automation, comment, type) since Meta resends), `worker.ts` (60 s poller started in `index.ts`: due posts of connected accounts + token refresh; boot sweep marks interrupted "publishing" posts failed instead of re-posting). Webhook (`GET/POST /webhook`, `/oauth/callback`) is public; signature is checked against `FACEBOOK_APP_SECRET` using `req.rawBody` (captured in `app.ts` `express.json({verify})` for that path only). No RabbitMQ — events are processed in-process after the 200. Frontend: `pages/InstagramPage.tsx` (`/instagram`, client chips filter by project, tabs Postagens/Engajar/Contas — Contas lists every project with Connect/Reconnect/Disconnect; dialogs pick the client via `ProjectPicker`; `?task=ID` opens the post — `AgendaPage` routes `instagram_post` tasks there), `components/instagram/{PostDialog,AutomationDialog,AutomationFields}.tsx`, `services/instagram.service.ts`. Meta app credentials (ONE app for the whole platform; clients connect via OAuth) live in `config.service.ts` → table `instagram_app_config` (single row, secret AES-encrypted, admin-only `PUT /api/instagram/config`, edited in the `MetaConfigCard` on the Contas tab); `.env` `FACEBOOK_APP_ID/SECRET/VERIFY_TOKEN` + `APP_URL` are only the fallback when the DB row is absent. `publicUrlSync()` is the cached public URL used to absolutize `/uploads` media.
- Social video (`/api/social`, YouTube Shorts / YouTube / TikTok, 2026-11-07): same idea as Instagram but separate code, `services/social/`. `config.service.ts` (per-platform app credentials, table `social_app_config`, secret AES-encrypted, admin-only `PUT /config/:platform`; `.env` `YOUTUBE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET` are the fallback; public URL falls back to the Meta card's / `APP_URL`), `account.service.ts` (**`SocialAccount` unique per (project, platform)** and per (platform, external_id); OAuth state = signed JWT `purpose: social_oauth`; `validAccessToken` refreshes under a per-account mutex because TikTok rotates the refresh token; `refreshStaleAccounts` from the worker keeps tokens alive), `youtube.ts` (OAuth offline + resumable upload in 8 MB chunks with resume-after-failure; quota/permission errors mapped to friendly non-retryable `PlatformError`), `tiktok.ts` (Login Kit v2 + Content Posting API `FILE_UPLOAD` chunked — no verified domain needed; `direct` or `draft` (inbox) mode; `creatorInfo` gives the real privacy options; status polling), `media.ts` (streams the video to a temp file/reads `/uploads` in place — never the whole file in memory; YouTube/TikTok take bytes, so localhost works), `post.service.ts` (**one `SocialPost` per network**, cross-posting shares `group_id`; each owns a `Task` `template: "social_post"` — `task.service` hooks mirror the Instagram ones; kinds `youtube_short|youtube_video|tiktok`; non-retryable errors fail immediately, otherwise 3 attempts), `worker.ts` (60 s poller). Notifications reuse type `instagram_post`. Frontend: everything lives on `/instagram` (nav label "Redes sociais"): `PostDialog` has a "Publicar em" destination picker (Instagram is created first, then `POST /social/posts`), the Postagens tab merges both kinds into one feed, Contas has `SocialConfigCard` per platform + per-project YouTube/TikTok connect rows, `components/social/{SocialConfigCard,SocialOptionsFields,SocialPostDialog}.tsx`, `services/social.service.ts`; `?task=ID` tries the Instagram post then the social post.
- `app.ts` — Express app factory (middleware registration, route mounting)
- `index.ts` — Server entrypoint (HTTP server creation, Vite middleware in dev, static file serving in production)

**Design Patterns:**
- Layered architecture: routes → controllers → services → Prisma ORM
- Middleware chain: helmet → cors → json → rate-limit → auth → validate → controller
- Singleton pattern: Prisma client (`lib/prisma.ts`), Socket.IO server (`lib/socket.ts`)
- Service-layer separation of concerns

**Flow:**
1. `index.ts` bootstraps Express app, initializes Socket.IO, seeds DB
2. Request enters → middleware pipeline → route handler → controller → service → Prisma → response
3. Real-time mutations emit Socket.IO events to user/funnel rooms
4. Dev mode: Vite middleware serves HMR-enabled React frontend

**Integration:**
- Consumes: Prisma ORM (database), JWT lib, bcrypt lib, Google Calendar API
- Produces: REST API consumed by frontend services (`src/services/`), WebSocket events consumed by `src/hooks/useSocket.ts`

---

### `src/components/` — React UI Components
**Responsibility:** All reusable and page-specific React components organized by domain.

**Subdirectories:**
- `ui/` — Primitive UI components built on Radix UI primitives (avatar, badge, button, card, checkbox, dialog, dropdown-menu, input, label, popover, progress, scroll-area, select, separator, skeleton, switch, tabs, textarea, tooltip). Wrapped with consistent styling via shadcn/ui pattern.
- `layout/` — App shell components: `Header.tsx` (breadcrumb + toolbar slot + notifications + "Nova tarefa"), `Sidebar.tsx` (244px desktop nav: sections, project list, user footer), `Tabbar.tsx` (mobile bottom nav), `CommandPalette.tsx` (global Ctrl/⌘+K search), `nav-items.ts` (single source for sidebar/palette/breadcrumb routes)
- `kanban/` — Kanban board views: `KanbanBoard.tsx`, `KanbanColumn.tsx`, `TaskCard.tsx`, `CalendarView.tsx`, `ListView.tsx`, `FilterBar.tsx`
- `modals/` — Dialog components: `NewTaskModal.tsx`, `NewStageModal.tsx`, `NewProjectModal.tsx`, `EditProjectModal.tsx`, `DuplicateTaskModal.tsx`, `ManageMembersModal.tsx`
- `editor/` — TipTap rich-text editor: `NotionEditor.tsx`, `SlashMenu.tsx`, custom nodes (`nodes/`)
- `common/` — Shared components: `Modal.tsx`, `UserAvatar.tsx`, `EmojiPicker.tsx`
- `dashboard/` — `RightCalendarSidebar.tsx` ("Próximos eventos")
- `tasks/` — Cross-project task views: `TasksTable.tsx` (status-grouped table), `TasksTimeline.tsx` (per-project Gantt with today line, progress fill)
- `notes/` — Notes (Anotações): `NoteEditorPane.tsx` (title + TipTap body with queued autosave), `NoteToolbar.tsx`
- `recordings/` — Gravações: `RecordingsPanel.tsx` (list/search; `projectId` prop scopes it to a project — used by the project "Gravações" tab and the global `/gravacoes` page), `NewRecordingDialog.tsx` (MediaRecorder mic + optional tab audio, or file upload), `RecordingDetailDialog.tsx` (player, actions → backlog, summary, transcript, report)
- `habits/` — also `FocusCard.tsx` (Foco do dia, autosave), `TeamHabitsBoard.tsx` (aba Equipe: aderência + "Cobrar quem falta"), `WeeklySummaryPanel.tsx`, `RoutineTemplatesDialog.tsx` (catálogo em `lib/habit-templates.ts`), `HabitDetailPanel.tsx`. Daily habits: `HabitFormModal.tsx`, `HabitCheck.tsx` (check-in marker), `HabitsTodayCard.tsx` (dashboard card)
- `projects/` — `ProjectDetailSheet.tsx`
- `settings/` — `ProfileSettings.tsx`
- `agenda/` — `AgendaView.tsx`
- `task-templates/` — `TemplateSelector.tsx`
- `pwa/` — PWA support: `OfflineIndicator.tsx`, `PWAUpdatePrompt.tsx`

**Design Patterns:**
- Compound component pattern (Radix UI primitives)
- Composition over inheritance (feature components compose UI primitives)
- shadcn/ui conventions (cn() utility, variants API via class-variance-authority)

**Integration:**
- Consumes: Zustand stores, React Router, TipTap editor, Radix UI, Lucide icons
- Consumed by: Page components in `src/pages/`

---

### `src/pages/` — Page-Level Components
**Responsibility:** Top-level route components that compose feature components into full pages. Each file corresponds to a route in `App.tsx`.

**Key pages:**
- `LoginPage.tsx` — Authentication entry
- `DashboardPage.tsx` — Main layout shell with sidebar/header
- `DashboardOverviewPage.tsx` — Home dashboard (greeting, stats, "Para hoje" with quick-complete, completed-tasks chart by week/month/quarter, agenda, habits card, project progress)
- `TasksPage.tsx` — `/tarefas`: Tabela + Linha do tempo (tabs Quadro/Calendário link to `/kanban` and `/agenda`), filters, done checkbox
- `EntradaPage.tsx` — `/entrada` shown as "Anotações": folder chips + note list + embedded editor (no project/funnel items only)
- `RecordingsPage.tsx` — `/gravacoes`: every recording the user can see, filterable by project
- `HealthPage.tsx` — Saúde (`/saude`): day navigator, water/sleep/steps/weight/mood/workout cards, goals, trends (`components/health/`), sync-token dialog
- `HabitsPage.tsx` — Daily habits: week grid with check-ins (navigable by week), streak/30-day rate, 26-week heatmap, create/edit/archive/delete
- `EntradaPage.tsx` — Inbox/input view
- `ProjectsPage.tsx`, `ProjectDetailPage.tsx`, `ProjectDashboardPage.tsx` — Project management
- `KanbanPage.tsx` — Kanban board view
- `AgendaPage.tsx` — Calendar/agenda view
- `AnalyticsPage.tsx` — Charts and metrics
- `TaskDetailPage.tsx` — Full task view with editor, checklists, attachments, activity feed
- `SettingsPage.tsx` — User settings/profile
- `PublicCalendarPage.tsx`, `PublicTaskPage.tsx`, `PublicFormPage.tsx` — Unauthenticated public views

**Design Patterns:**
- Container pattern (pages are route-level containers that compose child components)
- Protected routes via `RequireAuth` wrapper in App.tsx

**Integration:**
- Consumes: All component groups, stores, hooks, services
- Consumed by: React Router in `App.tsx`

---

### `src/store/` — Zustand State Management
**Responsibility:** Client-side application state using Zustand. Four stores managing distinct domains:

- `auth.store.ts` — Authentication state (user, token, login/register/logout, session persistence via localStorage)
- `task.store.ts` — Core data store (tasks, funnels, selected funnel, loading/error states, race-condition guard via request ID counter)
- `notification.store.ts` — Toast/notification queue
- `theme.store.ts` — Theme preferences (dark by default; explicit light/dark and custom brand color persisted in localStorage; one-time migration from the old indigo default)
- `habit.store.ts` — Habits + optimistic day toggling (`toggleDay`), streak/goal formatters

**Design Patterns:**
- Zustand store pattern (lightweight, hook-based state management)
- Race condition protection via monotonically increasing request ID counter (`_loadTasksRequestId` in task.store.ts)
- localStorage persistence with JSON serialization for auth tokens and user preferences

**Flow:**
1. `useAppData.ts` hook initializes auth → funnels → tasks on mount
2. Socket events directly mutate store state (addTask, updateTaskInState, removeTask)
3. Components subscribe via hook-selectors for reactive updates

**Integration:**
- Consumed by: All components and pages via hooks
- Consumes: Service layer (`src/services/`) for async data fetching

---

### `src/services/` — Frontend API Services
**Responsibility:** HTTP client abstraction layer. Each service encapsulates API calls for a specific domain.

- `api.ts` — Axios instance with base URL `/api`, JWT token injection interceptor, and 401 redirect interceptor
- `habit.service.ts` (also `toDayString`/`fromDayString`: client-local calendar days), `auth.service.ts`, `user.service.ts`, `task.service.ts`, `funnel.service.ts`, `folder.service.ts`, `attachment.service.ts`, `upload.service.ts`, `analytics.service.ts`, `public.service.ts`

**Design Patterns:**
- Axios interceptor pattern (request: attach JWT; response: handle 401)
- Service module pattern (each domain's API calls grouped in a dedicated file)

**Integration:**
- Consumes: Express REST API at `/api/*`
- Consumed by: Zustand stores, hooks, and directly by components

---

### `src/hooks/` — Custom React Hooks
**Responsibility:** Shared hook-based logic for cross-cutting concerns.

- `useAppData.ts` — App initialization orchestrator: calls fetchMe → loadFunnels → loadTasks on auth state changes
- `useSocket.ts` — Socket.IO client lifecycle: connects on auth, subscribes to task/funnel real-time events, updates stores via refs to avoid stale closures
- `useUsers.ts` — User data fetching hook

**Design Patterns:**
- Hook composition (useAppData composes useSocket + auth store + task store)
- Refs to latest store state (useSocket uses storeRef pattern to avoid stale closure bugs)

**Integration:**
- Consumed by: `App.tsx`, pages, and other components
- Consumes: Stores, services

---

### `src/context/` — React Context
**Responsibility:** Single React context for dashboard state.

- `dashboard.context.ts` — Dashboard-level shared state (likely date range, filters)

**Integration:**
- Consumed by: Dashboard components
- Provides: Context to dashboard subtree

---

### `src/lib/` — Utility Functions
**Responsibility:** Pure utility functions shared across the frontend.

- `utils.ts` — `cn()` (Tailwind class merging via clsx + tailwind-merge), `formatMask()` (CPF/CNPJ/phone/CEP input masking)
- `export.ts` — Data export utilities (PDF via jsPDF, spreadsheet via xlsx)
- `design.ts` — Design-system constants for data-driven colors (brand pink, accent palette, semantic colors, `hexA`, priority/stage colors)
- `task-view.ts` — `buildTaskRows()` (project/stage/status/progress per task), tags, due-date tone/format
- `project-progress.ts` — `projectProgress()` shared by sidebar and dashboard
- `task-actions.ts` — `setTaskDone()` / `isTaskDone()` (moves a task to its funnel's done stage)

**Design Patterns:**
- Pure functions with no side effects
- Utility module pattern

**Integration:**
- Consumed by: All frontend components

---

### Root Files

- `App.tsx` — Root React component: route definitions with public/private routing, RequireAuth guard, public calendar/task/form routes
- `main.tsx` — Application entrypoint: React.StrictMode + BrowserRouter + TooltipProvider + PWA update prompt
- `types.ts` — Shared TypeScript interfaces: User, Project, ProjectUser, Funnel, FunnelStage, Task, TaskChecklist, TaskAttachment, TaskActivity, TaskUser, Folder
- `index.css` — Ebenezer design-system tokens (light `:root`, dark `.dark`, `.light`/`.a4-page` forced-light scopes), Tailwind `@theme`, editor and recharts theming
- `vite-env.d.ts` — Vite client type declarations
