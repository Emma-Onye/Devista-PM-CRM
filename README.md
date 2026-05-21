# Vantage PM

A full-featured **CRM & Project Management** SaaS built with React, TypeScript, and Supabase. Manage projects with Kanban boards and Gantt timelines, track deals through customizable pipelines, organize contacts and companies, and automate workflows — all within a multi-tenant workspace.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui (Radix primitives) |
| State | Zustand (persisted), TanStack Query v5 |
| Backend | Supabase (PostgreSQL, Auth, RLS, Edge Functions, Storage) |
| Charts | Recharts |
| DnD | @hello-pangea/dnd |
| Editor | BlockNote (rich-text documents) |
| Hosting | Vercel (static SPA) |

## Features

- **Multi-tenant workspaces** — create and switch between workspaces
- **Projects** — create, track status, link deals
- **Kanban Board** — drag-and-drop task management (project-scoped + workspace-wide)
- **Gantt Timeline** — drag-resize bars, zoom (day/week/month), dependency arrows, conflict detection
- **My Tasks** — personal task list across all projects
- **CRM Contacts & Companies** — lifecycle stages, owners, tagging
- **Deal Pipeline** — customizable stages, drag-to-advance, revenue tracking
- **Documents** — rich-text editor powered by BlockNote
- **Automations** — rule-based triggers and actions with execution logs
- **Dashboard** — stats, charts, upcoming tasks, recent activity, deals closing soon
- **Global Search** — Cmd+K to search across all entities
- **Notifications** — in-app notification bell with unread counts
- **Responsive** — mobile hamburger menu, collapsible sidebar, mobile-friendly layouts
- **Row-Level Security** — all data scoped by workspace membership via Supabase RLS

## Local Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- A [Supabase](https://supabase.com) project

### 1. Clone and install

```bash
git clone https://github.com/Emma-Onye/Devista-PM-CRM.git
cd Devista-PM-CRM
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Supabase project URL and anon key (found in Supabase Dashboard > Settings > API):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Set up the database

Run the SQL migrations in order against your Supabase project. You can use the Supabase Dashboard SQL editor or the CLI:

```bash
# If using Supabase CLI:
supabase db push
```

Or paste each file in `supabase/migrations/` into the SQL editor in order:
1. `001_vantage_pm_initial_schema.sql`
2. `002_fix_function_security.sql`
3. `003_workspace_logos_storage.sql`
4. `004_document_images_storage.sql`
5. `005_automation_runs.sql`
6. `006_fix_workspace_creator_select.sql`
7. `007_notifications.sql`

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### 5. Create your account

1. Navigate to `/signup` and create an account
2. Check your email for the confirmation link (or disable email confirmation in Supabase Auth settings for dev)
3. Log in and create your first workspace

## Deploy to Vercel

### 1. Push to GitHub

```bash
git add -A
git commit -m "Ready for deployment"
git push origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Framework Preset: **Vite**
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy

The `vercel.json` file handles client-side routing rewrites automatically.

### 3. Update Supabase Auth

In your Supabase Dashboard > Authentication > URL Configuration:
- Set **Site URL** to your Vercel domain (e.g., `https://your-app.vercel.app`)
- Add your Vercel domain to **Redirect URLs**

## Project Structure

```
src/
  components/
    shell/        # AppShell, Sidebar, TopBar, AuthProvider, ErrorBoundary, GlobalSearch
    ui/           # shadcn/ui components (button, dialog, table, etc.)
    editor/       # BlockNote rich-text editor wrapper
  lib/
    supabase.ts   # Supabase client
    database.types.ts  # TypeScript interfaces for all tables
    utils.ts      # cn() helper
    query-client.ts    # TanStack Query client
  pages/
    auth/         # Login, Register
    onboarding/   # First workspace creation
    workspace/    # Workspace selector
    dashboard/    # Dashboard with stats and charts
    projects/     # Projects list, detail, Kanban, Gantt, TaskDetailPanel
    tasks/        # My Tasks
    board/        # Workspace-wide Kanban
    timeline/     # Workspace-wide Gantt
    contacts/     # Contacts list and detail
    companies/    # Companies list and detail
    deals/        # Deals pipeline and detail
    documents/    # Documents list and editor
    automations/  # Automation rules and logs
    settings/     # General, Members, Profile, Pipeline settings
  stores/
    auth-store.ts      # Zustand auth state
    workspace-store.ts # Zustand workspace + sidebar state
    board-store.ts     # Zustand kanban board state
  router.tsx     # All routes
  main.tsx       # Entry point
supabase/
  migrations/    # SQL migration files (run in order)
```

## License

Private project.
