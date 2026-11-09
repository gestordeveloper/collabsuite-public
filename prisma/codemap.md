# prisma/ — Database Schema

## Responsibility
Defines the MySQL database schema via Prisma ORM. Contains the single `schema.prisma` file with all models, enums, relations, and indexes for the CollabSuite platform.

## Data Source
- **Provider:** MySQL (`mysql2`)
- **Connection:** `DATABASE_URL` environment variable
- **Client:** Prisma Client JS (`@prisma/client`)

## Enums

| Enum | Values | Usage |
|------|--------|-------|
| `UserRole` | `user`, `admin`, `super_admin` | Access control levels |
| `TaskPriority` | `low`, `medium`, `high` | Task prioritization |
| `TaskStatus` | `notdone`, `inprogress`, `done` | Task lifecycle state |
| `TaskType` | `task`, `meeting`, `note` | Task classification |
| `UserStatus` | `registered`, `confirmed`, `active`, `inactive` | User account lifecycle |
| `RecurrenceFrequency` | `daily`, `weekly`, `monthly` | Recurring task intervals |

## Models

### User (`user`)
Core user account entity. Stores authentication credentials, profile information, and UTM tracking fields for registration source attribution.

**Key fields:** `id` (PK), `email` (unique), `password` (hashed), `role` (UserRole), `status` (UserStatus), UTM fields for marketing attribution.

**Relations:**
- Has many: `funnels`, `tasks` (as assignee), `activities`, `funnelUsers`, `taskUsers`, `folders`

**Indexes:** `company_id`, `email`, `username`

### Funnel (`funnel`)
Pipeline/project container that organizes tasks into stages. Represents a workflow or project board.

**Key fields:** `name`, `color`, `prefix` (for task numbering), `funnel_default` (boolean flag).

**Relations:**
- Belongs to: `User` (optional owner)
- Has many: `stages` (FunnelStage, cascade delete), `tasks`, `funnelUsers`

**Indexes:** `company_id`, `user_id`

### FunnelStage (`funnelstage`)
Individual column/status within a funnel pipeline. Ordered by `stage_order`.

**Key fields:** `name`, `status`, `stage_order`, `stage_done`.

**Relations:**
- Belongs to: `Funnel` (cascade delete)
- Has many: `tasks`

**Indexes:** `funnel_id`, composite `(funnel_id, stage_order)`

### FunnelUser (`funneluser`)
Many-to-many join table linking users to funnels (team membership).

**Unique constraint:** `(funnel_id, user_id)` — prevents duplicate membership.

**Indexes:** `funnel_id`, `user_id`

### Task (`task`)
Core work item entity. Highly flexible model with extensive optional fields for different task types.

**Key fields:** `title`, `description`, `content` (rich text), `type` (TaskType), `status` (TaskStatus), `priority`, `due_at`, `estimated_time`, `story_points`, `template` (default/spreadsheet/form), `form_schema`, `folder_id`.

**Template modes:**
- `default` — Standard task with description/checklists
- `spreadsheet` — Tabular data view
- `form` — Custom form with schema stored in `form_schema`

**Relations:**
- Belongs to: `Funnel`, `FunnelStage`, `User` (assignee), `Folder`
- Has many: `activities`, `checklists`, `attachments`, `recurrences`, `stageHistory`, `taskUsers`, `formResponses`

**Indexes:** `funnel_id`, `stage_id`, `user_id`, `status`, `due_at`, composite `(funnel_id, stage_id, sort_order)`, `deleted_at`, `folder_id`

### TaskActivity (`taskactivity`)
Activity log entries for a task (comments, status changes, etc.).

**Relations:** Belongs to `Task` (cascade delete) and `User`.

**Indexes:** Composite `(task_id, created_at)`, `user_id`

### TaskChecklist (`taskchecklist`)
Checklist items within a task. Simple key-value: `title` + `is_done`.

**Relations:** Belongs to `Task` (cascade delete).

### TaskRecurrence (`taskrecurrence`)
Recurrence configuration for repeating tasks. Supports daily/weekly/monthly frequencies with flexible interval settings.

**Key fields:** `frequency`, `interval_value`, `week_days`, `month_day`, `start_date`, `end_date`, `next_run`, `is_active`.

**Relations:** Belongs to `Task` (cascade delete).

**Indexes:** `task_id`, `next_run`

### TaskStageHistory (`taskstagehistory`)
Audit log of stage transitions for a task. Tracks which stage a task was in at each point in time.

**Relations:** Belongs to `Task` (cascade delete).

**Indexes:** Composite `(task_id, created_at)`, composite `(funnel_id, stage_id)`

### TaskUser (`taskuser`)
Many-to-many join table for task assignees (additional assignees beyond the primary `user_id` on Task).

**Unique constraint:** `(task_id, user_id)`.

**Indexes:** `task_id`, `user_id`

### TaskAttachment (`taskattachment`)
File attachments linked to a task. Stores metadata: file name, URL, size, type.

**Relations:** Belongs to `Task` (cascade delete).

### FormResponse (`form_response`)
Stores submitted form responses for tasks with `template: 'form'`. Answers stored as JSON string in `answers` (LongText).

**Relations:** Belongs to `Task` (cascade delete).

### Folder (`folder`)
User-defined folders for organizing tasks (logical grouping).

**Key fields:** `name`.

**Relations:**
- Belongs to: `User` (cascade delete)
- Has many: `tasks`

**Indexes:** `user_id`

### `Habit` / `HabitLog` — Hábitos diários (added 2026-09-23)
`Habit`: `name`, `description`, `color` (hex), `target_per_week` (7 = diário, 1–6 = "N vezes por semana"), `sort_order`, `archived_at`. Belongs to `User` (cascade delete); has many `logs`. Indexes: `(user_id, archived_at)`, `company_id`.
`HabitLog`: one row per habit per day (`log_date` is a `DATE` — the user's calendar day, sent by the client as `YYYY-MM-DD`; the server never converts time zones). Unique `(habit_id, log_date)`; cascade delete with the habit. Streaks/rates are computed in `habit.service.ts`, not stored.

### `Habit` extensions, `TeamHabit`, `DailyFocus` (added 2026-10-23)
`Habit` gained `kind` (`habit`|`routine`), `project_id` (SetNull), `reminder_time` (HH:MM, Brasília), `reminder_days` ("0,1,…", null = todos), `last_reminded_on` (DATE, dedupe do worker), `checklist` (JSON string[]), `team_habit_id` (SetNull; quando preenchido a definição é somente leitura para o dono da linha).
`TeamHabit`: definição criada por um gestor (`creator_id`, cascade); cada pessoa atribuída tem a sua própria linha em `habit`, então check-ins/sequências seguem por usuário. Apagar o TeamHabit deixa as linhas como hábitos pessoais.
`DailyFocus`: `(user_id, focus_date)` único; `items` JSON `[{id,text,done,task_id?}]` (máx. 3) e `review`.

### `Recording` / `RecordingAction` — Gravações com transcrição e análise por IA (added 2026-10-23)
`Recording`: belongs to `User` (cascade) and optionally a `Project` (`SetNull` — deleting a project keeps its recordings). `status` (`RecordingStatus`: uploaded → transcribing → analyzing → done | error), `storage` (`s3`|`local`) + `storage_key` (private object key, never a public URL), `transcript` (LongText, `[mm:ss]` lines), `summary`, and JSON-in-Text columns (`tags`, `participants`, `topics`, `decisions`, `risks`, `next_steps`), `analysis_md` (rendered report). Indexes: `(user_id, recorded_at)`, `(project_id, recorded_at)`, `company_id`.
`RecordingAction`: an action the AI extracted (`text`, `priority` P1|P2|P3, `owner_name`, `due_text`, `status` pending|converted|dismissed). `task_id` → `Task` (`SetNull`) once sent to the project's backlog.

## Relationships Overview

```
User ──┬── Funnel ──┬── FunnelStage ── Task
       │             └── FunnelUser       │
       │                                  ├── TaskActivity
       │                                  ├── TaskChecklist
       │                                  ├── TaskAttachment
       │                                  ├── TaskRecurrence
       │                                  ├── TaskStageHistory
       │                                  ├── TaskUser ──── User
       │                                  ├── FormResponse
       │                                  └── Folder
       │                                     
       └── Folder ──── Task
```

## Integration
- Consumed by: `src/server/lib/prisma.ts` (Prisma client singleton)
- Used by: All server services (`src/server/services/`) for database operations
- Schema is applied via `prisma generate` and `prisma migrate` during build
