# Repository Atlas: CollabSuite

## Project Responsibility
A full-stack collaboration and project management platform with Kanban boards, task tracking, funnel pipelines, team management, rich-text editing, real-time updates, and public shareable views. Built with React 19 + Express.js + Prisma ORM + MySQL.

## System Entry Points
- `src/main.tsx` — React SPA entrypoint (BrowserRouter + TooltipProvider + PWA)
- `src/App.tsx` — Root component with route definitions and public/private routing
- `src/server/index.ts` — Express server entrypoint (HTTP + Socket.IO + Vite middleware)
- `package.json` — Dependency manifest and scripts (`dev`, `build`, `start`)
- `vite.config.ts` — Vite build configuration
- `tsconfig.json` — TypeScript compiler configuration
- `prisma/schema.prisma` — Database schema (MySQL via Prisma)

## Build & Deploy
- **Dev:** `npm run dev` → tsx runs server + Vite serves frontend with HMR
- **Build:** `npm run build` → Prisma generate + Vite build + esbuild server bundle
- **Start:** `npm run start` → node dist/server.cjs
- **Container:** Dockerfile + docker-compose.yml for containerized deployment

## Directory Map (Aggregated)

| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `src/` | Main application source — React frontend + Express backend | [View Map](src/codemap.md) |
| `prisma/` | Database schema (MySQL) — all models, enums, relations | [View Map](prisma/codemap.md) |
| `public/` | Static assets (widget JS, test HTML, brand images) | — |
| `design_system/` | Ebenezer Design System reference (HTML prototype + brand assets) — source of truth for the UI tokens in `src/index.css`; not part of the build | — |
| `scripts/` | Utility scripts (DB fix, PWA icon generation) | — |
| `uploads/` | User-uploaded file storage | — |
| `.slim/` | Codemap state and change tracking | — |

## Key Technology Stack
- **Frontend:** React 19, React Router 7, Zustand 5, Tailwind CSS 4, TipTap 3 (rich text), Radix UI (primitives), Recharts (charts), Lucide React (icons), Motion (animations)
- **Design system:** Ebenezer — dark by default (light variant kept), brand pink `#EC1889`, Sora (display) / Geist (UI) / Geist Mono (numbers). Tokens live in `src/index.css` (`--background`, `--surface`, `--card`, `--elevated`, `--subtle`…, mapped in `@theme inline`); dynamic data colors in `src/lib/design.ts`
- **Backend:** Express 4, Socket.IO 4, Prisma 6, JWT (jsonwebtoken), bcryptjs, Zod 4 (validation), Helmet, express-rate-limit
- **Database:** MySQL via Prisma ORM
- **Build:** Vite 6, esbuild, TypeScript 5.8, tsx
- **PWA:** vite-plugin-pwa with offline indicator and update prompt
- **External APIs:** Google Calendar, Google Gen AI, AWS S3
- **Infrastructure:** Docker, Docker Compose

## Data Flow
```
User → Browser ──HTTP──→ Express API ──→ Services ──→ Prisma ──→ MySQL
                    └──WebSocket──→ Socket.IO ──→ Real-time events → Client
```

## Authentication Flow
1. User submits credentials → `POST /api/auth/login` → JWT issued
2. Token stored in localStorage (`collab_token`)
3. Axios interceptor attaches `Bearer` token to all requests
4. `requireAuth` middleware verifies JWT + fetches user from DB
5. 401 responses trigger automatic logout + redirect

## Editor de vídeo (StudioX)
`studiox/` é o app Python/FastAPI + frontend estático (porte fiel do StudioX), não parte do build Vite. O servidor Node o inicia sob demanda (`src/server/services/studiox/process.ts`) em 127.0.0.1 e o expõe em `/studiox` por um proxy autenticado (`proxy.ts`, cookie HttpOnly emitido por `POST /api/studiox/session`). A página `/editor-de-video` (`src/pages/VideoEditorPage.tsx`) embute `/studiox/` num iframe. Dados em `studiox/storage/` (ou `STUDIOX_STORAGE_DIR`), compartilhados por todos os usuários.
