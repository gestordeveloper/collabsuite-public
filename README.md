# CollabSuite

Plataforma completa de colaboração e gestão de projetos da **Ebenezer**: quadros Kanban, tarefas, funis, agenda, anotações, hábitos, atendimento por WhatsApp, agentes de IA, estúdios criativos (carrosséis, designs, Photosuite, editor de vídeo) e publicação em redes sociais — tudo em um só lugar, com atualizações em tempo real e links públicos compartilháveis.

## Principais recursos

**Workspace**
- **Dashboard** com tarefas do dia, gráfico de conclusões, agenda, hábitos e progresso dos projetos
- **Projetos, funis e Kanban** com etapas, filtros, visão de lista, calendário e linha do tempo (Gantt)
- **Tarefas** com editor rico (TipTap), checklists, anexos, formulários, histórico de atividades e visões públicas
- **Agenda** integrada ao Google Calendar e Google Drive
- **Anotações** em pastas, com editor e autosave
- **Hábitos e rotinas** com sequências, foco do dia, hábitos de equipe e resumo semanal
- **Saúde** com passos, água, sono, medidas e treinos, sincronizáveis por token (`/api/health/ingest`)
- **Notificações** no app, push web (VAPID) e e-mail (SMTP opcional)
- **PWA** instalável, com indicador offline e aviso de atualização

**Ferramentas**
- **Gravações**: gravação/upload de áudio, transcrição (Whisper), análise por IA e conversão das ações em tarefas
- **Atendimento (tickets)** e **WhatsApp** (Baileys): filas, campanhas, fluxos de bot
- **Agentes de IA**: pipelines, ICPs, galeria de imagens, base de conhecimento (RAG com Qdrant), MCP, resposta automática no WhatsApp e acesso à agenda
- **Carrosséis e mini-novelas (HQ)**: slides 1080×1350 a partir de brandbooks, exportação em PNG/ZIP/MP4
- **Designs** e **Photosuite**: editor de imagens com camadas, máscaras, 33 modos de mesclagem, ajustes, filtros e importação/exportação PSD/SVG
- **Editor de vídeo (StudioX)**: app Python/FastAPI embutido em `/editor-de-video`
- **Redes sociais**: publicação e agendamento no Instagram, YouTube e TikTok, com automação de comentários
- **GitHub** por projeto (commits, PRs, issues, Actions e relatórios em PDF) e **terminal SSH** seguro (somente dono/admin)
- **Gerenciador de credenciais** com criptografia em repouso e **propostas comerciais** públicas

## Stack

| Camada | Tecnologias |
|--------|-------------|
| Frontend | React 19, React Router 7, Zustand 5, Tailwind CSS 4, TipTap 3, Radix UI, Recharts, Lucide, Motion |
| Backend | Express 4, Socket.IO 4, Prisma 6, JWT, bcryptjs, Zod 4, Helmet, express-rate-limit |
| Banco de dados | MySQL 8 |
| Build | Vite 6, esbuild, TypeScript 5.8, tsx |
| Integrações | Google Calendar/Drive, Google Gen AI, Anthropic, OpenAI, Groq, AWS S3, Qdrant, Meta Graph API, YouTube, TikTok, GitHub |
| Infra | Docker, Docker Compose |

Design system **Ebenezer**: tema escuro por padrão, rosa `#EC1889`, fontes Sora, Geist e Geist Mono. A referência está em `design_system/` e os tokens em `src/index.css`.

## Estrutura do repositório

```
src/
  server/        API Express + Socket.IO (routes → controllers → services → Prisma)
  components/    Componentes React por domínio (ui, kanban, editor, photosuite, ...)
  pages/         Componentes de rota
  store/         Estado global (Zustand)
  services/      Clientes HTTP da API
  lib/           Utilitários e motores (photosuite, design-studio, ...)
prisma/          schema.prisma e migrations (MySQL)
studiox/         Editor de vídeo (Python/FastAPI + frontend estático), fora do build Vite
agent/           Agentes locais: cli-agent (CLIs de IA) e flow-agent (Google Flow)
chrome-extension/ Extensão "Tarefas do dia"
extension/       flow-bridge: extensão para o Google Flow
design_system/   Referência do Design System Ebenezer
models_proposals/ Modelos de proposta comercial
public/          Assets estáticos e widget
scripts/         Utilitários (ícones PWA, manutenção de banco)
```

Para um mapa detalhado da arquitetura, veja [codemap.md](codemap.md), [src/codemap.md](src/codemap.md) e [prisma/codemap.md](prisma/codemap.md). A API pública está em [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

## Pré-requisitos

- **Node.js 20+**
- **MySQL 8** (local, Laragon ou Docker)
- Opcionais, conforme os recursos usados:
  - **FFmpeg** no PATH (ou `FFMPEG_PATH`) para gravações, mini-novelas e StudioX
  - **Chromium/Chrome** (`CHROMIUM_PATH`) para renderizar slides e HQs
  - **Python 3.10+** para o editor de vídeo
  - **Qdrant** para a base de conhecimento dos agentes

## Rodando localmente

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie o arquivo de ambiente e preencha ao menos `DATABASE_URL`, `JWT_SECRET` e `ENCRYPTION_KEY`:
   ```bash
   cp .env.example .env
   ```
3. Crie o banco `collabsuite` no MySQL e aplique as migrations:
   ```bash
   npx prisma migrate deploy
   ```
4. Inicie em modo desenvolvimento (API + Vite com HMR, em `http://localhost:3000`):
   ```bash
   npm run dev
   ```

No primeiro start, com o banco vazio, o sistema cria usuários e dados de demonstração (senha padrão `password123`). **Troque as senhas antes de qualquer uso real.**

### Editor de vídeo (opcional)

```bash
python -m venv studiox/.venv
studiox/.venv/Scripts/pip install -r studiox/requirements.txt   # Linux/macOS: studiox/.venv/bin/pip
cd studiox/motion && npm ci
```

O servidor Node inicia o StudioX sob demanda e o expõe, com autenticação, em `/studiox`.

## Variáveis de ambiente

Todas estão documentadas em [.env.example](.env.example). As principais:

| Variável | Uso |
|----------|-----|
| `DATABASE_URL` | Conexão MySQL (`mysql://user:senha@host:3306/collabsuite`) |
| `JWT_SECRET` | Assinatura dos tokens — altere em produção |
| `ENCRYPTION_KEY` | Criptografia de credenciais e tokens (`openssl rand -hex 32`) |
| `APP_URL` | URL pública (callbacks OAuth, mídias do Instagram) |
| `CORS_ORIGIN` | Origens permitidas |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | IA e transcrição |
| `VAPID_*`, `SMTP_*` | Push web e e-mail (opcionais) |
| `QDRANT_*` | RAG dos agentes |
| `FACEBOOK_*`, `YOUTUBE_*`, `TIKTOK_*`, `GITHUB_*` | Fallback das integrações, que também podem ser configuradas por um administrador na interface |
| `AWS_S3_*` | Armazenamento de arquivos (sem ele, usa `uploads/`) |

Chaves de IA por usuário são cadastradas em **Configurações → Integrações de IA**.

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor + frontend em modo desenvolvimento |
| `npm run build` | `prisma generate`, build do Vite e bundle do servidor (`dist/server.cjs`) |
| `npm run start` | Executa o build de produção |
| `npm run lint` | Checagem de tipos (`tsc --noEmit`) |
| `npm run db:fix` | Script de correção de banco |
| `npm run pwa:icons` | Gera os ícones do PWA |

## Deploy com Docker

```bash
docker compose up -d --build
```

Sobe o app em `http://localhost:3000` e um MySQL 8, com volumes persistentes (`db_data`, `studiox_data`). A imagem já inclui FFmpeg, Chromium e o ambiente Python do StudioX, e o `docker-entrypoint.sh` aplica as migrations a cada inicialização. Defina `JWT_SECRET` e demais variáveis em um `.env` ao lado do `docker-compose.yml`, e troque as credenciais padrão do MySQL em produção.

## Extensões e agentes locais

- **[chrome-extension/](chrome-extension/README.md)**: ver e criar as tarefas do dia sem abrir o sistema
- **extension/flow-bridge** e **agent/flow-agent**: geram imagens das mini-novelas no Google Flow com a sua conta
- **agent/cli-agent**: usa os CLIs de IA instalados no seu computador (Claude Code, Codex, Gemini etc.) para gerar textos, com o seu login

Cada agente local tem um `iniciar.bat` para execução no Windows.

## Segurança

- Autenticação por JWT, com `Helmet` e limite de requisições
- Credenciais, tokens OAuth e chaves SSH criptografados com AES (`ENCRYPTION_KEY`)
- Nunca versione o `.env`; use um `JWT_SECRET` e um `ENCRYPTION_KEY` fortes e exclusivos em produção
- Trocar o `ENCRYPTION_KEY` torna ilegíveis os segredos já armazenados

---

Desenvolvido pela **Ebenezer**.
