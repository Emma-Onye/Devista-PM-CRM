/*
  # Vantage PM — Initial Schema

  ## Overview
  Full multi-tenant SaaS schema for a combined CRM + Project Management application.
  Every table has workspace_id for tenant isolation, with RLS enforced on all tables.

  ## Tables Created
  1. profiles — Auth user extensions (display_name, avatar_url, timezone)
  2. workspaces — Root tenant entity (name, slug, plan)
  3. workspace_members — User membership with role and status per workspace
  4. projects — Scoped to workspace; status and priority enums
  5. tasks — Full task model with subtasks (adjacency list), BlockNote JSON description
  6. task_dependencies — Finish-to-start and other dependency types between tasks
  7. companies — CRM company records
  8. contacts — CRM contact records linked to companies
  9. deal_stages — Configurable pipeline stages per workspace with defaults seeded
  10. deals — CRM deals linked to contacts, companies, stages, and optionally projects
  11. activities — Universal activity log across all entities
  12. documents — BlockNote rich-text documents scoped to workspace/project
  13. automation_rules — Trigger/action automation definitions

  ## Security
  - RLS enabled on ALL tables
  - SELECT: active workspace member
  - INSERT: active member with role in (owner, admin, manager, member)
  - UPDATE: active member with role in (owner, admin, manager, member)
  - DELETE: active member with role in (owner, admin, manager)

  ## Notes
  - workspace_members is the central trust table — all policies join through it
  - Helper function is_workspace_member() used across all policies for DRY enforcement
  - profiles RLS: users can only read/update their own profile row
*/

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE workspace_plan AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'manager', 'member', 'viewer');
CREATE TYPE member_status AS ENUM ('active', 'pending', 'deactivated');
CREATE TYPE project_status AS ENUM ('active', 'on_hold', 'completed', 'archived');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE task_status AS ENUM ('backlog', 'todo', 'in_progress', 'in_review', 'done');
CREATE TYPE dependency_type AS ENUM ('finish_to_start', 'start_to_start', 'finish_to_finish');
CREATE TYPE contact_source AS ENUM ('manual', 'import', 'web_form', 'referral');
CREATE TYPE lifecycle_stage AS ENUM ('lead', 'qualified', 'opportunity', 'customer', 'churned');
CREATE TYPE activity_type AS ENUM ('note', 'call', 'email', 'meeting', 'task_update', 'deal_update', 'status_change');
CREATE TYPE trigger_type AS ENUM ('task_status_change', 'deal_stage_change', 'due_date_passed', 'task_assigned');
CREATE TYPE action_type AS ENUM ('update_field', 'send_notification', 'create_activity', 'move_task');

-- ============================================================
-- PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- WORKSPACES
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  plan workspace_plan NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WORKSPACE_MEMBERS
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  role member_role NOT NULL DEFAULT 'member',
  invited_email text,
  status member_status NOT NULL DEFAULT 'pending',
  joined_at timestamptz
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTION — used by all downstream RLS policies
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_workspace_role(ws_id uuid)
RETURNS member_role
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM workspace_members
  WHERE workspace_id = ws_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_active_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION can_write_in_workspace(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role IN ('owner', 'admin', 'manager', 'member')
  );
$$;

CREATE OR REPLACE FUNCTION can_delete_in_workspace(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  );
$$;

-- ============================================================
-- WORKSPACE RLS (depends on workspace_members + helper fns)
-- ============================================================

CREATE POLICY "Members can view their workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (is_active_workspace_member(id));

CREATE POLICY "Authenticated users can create workspaces"
  ON workspaces FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Owners and admins can update workspace"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (get_my_workspace_role(id) IN ('owner', 'admin'))
  WITH CHECK (get_my_workspace_role(id) IN ('owner', 'admin'));

CREATE POLICY "Only owners can delete workspace"
  ON workspaces FOR DELETE
  TO authenticated
  USING (get_my_workspace_role(id) = 'owner');

-- WORKSPACE_MEMBERS RLS
CREATE POLICY "Active members can view workspace membership"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Owners and admins can add members"
  ON workspace_members FOR INSERT
  TO authenticated
  WITH CHECK (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "Owners and admins can update members"
  ON workspace_members FOR UPDATE
  TO authenticated
  USING (get_my_workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "Owners and admins can remove members"
  ON workspace_members FOR DELETE
  TO authenticated
  USING (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));

-- ============================================================
-- PROJECTS
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status project_status NOT NULL DEFAULT 'active',
  priority priority_level NOT NULL DEFAULT 'medium',
  start_date date,
  target_end_date date,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects(workspace_id);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view projects"
  ON projects FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create projects"
  ON projects FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update projects"
  ON projects FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete projects"
  ON projects FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  description_json jsonb,
  status task_status NOT NULL DEFAULT 'todo',
  priority priority_level NOT NULL DEFAULT 'medium',
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reporter uuid NOT NULL REFERENCES profiles(id),
  start_date date,
  due_date date,
  completed_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view tasks"
  ON tasks FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create tasks"
  ON tasks FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update tasks"
  ON tasks FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete tasks"
  ON tasks FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- TASK_DEPENDENCIES
-- ============================================================

CREATE TABLE IF NOT EXISTS task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  blocking_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type dependency_type NOT NULL DEFAULT 'finish_to_start',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocking_task_id, blocked_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_workspace_id ON task_dependencies(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_blocking ON task_dependencies(blocking_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_blocked ON task_dependencies(blocked_task_id);
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view task dependencies"
  ON task_dependencies FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create task dependencies"
  ON task_dependencies FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update task dependencies"
  ON task_dependencies FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete task dependencies"
  ON task_dependencies FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- COMPANIES
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  industry text,
  employee_count integer,
  annual_revenue numeric,
  address_line text,
  city text,
  state text,
  country text,
  phone text,
  website text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_workspace_id ON companies(workspace_id);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view companies"
  ON companies FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create companies"
  ON companies FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update companies"
  ON companies FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete companies"
  ON companies FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- CONTACTS
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  title text,
  source contact_source NOT NULL DEFAULT 'manual',
  lifecycle_stage lifecycle_stage NOT NULL DEFAULT 'lead',
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_id ON contacts(owner_id);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view contacts"
  ON contacts FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create contacts"
  ON contacts FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update contacts"
  ON contacts FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete contacts"
  ON contacts FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- DEAL_STAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  probability integer NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  color text NOT NULL DEFAULT '#6366f1'
);

CREATE INDEX IF NOT EXISTS idx_deal_stages_workspace_id ON deal_stages(workspace_id);
ALTER TABLE deal_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view deal stages"
  ON deal_stages FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Admins and above can create deal stages"
  ON deal_stages FOR INSERT TO authenticated
  WITH CHECK (get_my_workspace_role(workspace_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY "Admins and above can update deal stages"
  ON deal_stages FOR UPDATE TO authenticated
  USING (get_my_workspace_role(workspace_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (get_my_workspace_role(workspace_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY "Admins and above can delete deal stages"
  ON deal_stages FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- DEALS
-- ============================================================

CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  deal_stage_id uuid NOT NULL REFERENCES deal_stages(id),
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_workspace_id ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage_id ON deals(deal_stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact_id ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_company_id ON deals(company_id);
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view deals"
  ON deals FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create deals"
  ON deals FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update deals"
  ON deals FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete deals"
  ON deals FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- ACTIVITIES
-- ============================================================

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type activity_type NOT NULL DEFAULT 'note',
  subject text NOT NULL DEFAULT '',
  body_text text,
  related_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  related_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  related_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  related_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_workspace_id ON activities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact_id ON activities(related_contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_deal_id ON activities(related_deal_id);
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view activities"
  ON activities FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create activities"
  ON activities FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update own activities"
  ON activities FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id) AND created_by = auth.uid())
  WITH CHECK (can_write_in_workspace(workspace_id) AND created_by = auth.uid());

CREATE POLICY "Managers and above can delete activities"
  ON activities FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled Document',
  content_json jsonb,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view documents"
  ON documents FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create documents"
  ON documents FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Members can update documents"
  ON documents FOR UPDATE TO authenticated
  USING (can_write_in_workspace(workspace_id))
  WITH CHECK (can_write_in_workspace(workspace_id));

CREATE POLICY "Managers and above can delete documents"
  ON documents FOR DELETE TO authenticated
  USING (can_delete_in_workspace(workspace_id));

-- ============================================================
-- AUTOMATION_RULES
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  trigger_type trigger_type NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  action_type action_type NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_workspace_id ON automation_rules(workspace_id);
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active members can view automation rules"
  ON automation_rules FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Admins and above can create automation rules"
  ON automation_rules FOR INSERT TO authenticated
  WITH CHECK (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "Admins and above can update automation rules"
  ON automation_rules FOR UPDATE TO authenticated
  USING (get_my_workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "Admins and above can delete automation rules"
  ON automation_rules FOR DELETE TO authenticated
  USING (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));

-- ============================================================
-- TRIGGERS — auto-updated timestamps
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER — auto-create profile on signup
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, timezone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
