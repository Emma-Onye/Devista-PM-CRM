/*
  # 008: Security hardening

  ## Changes
  1. Add SET search_path = public to all SECURITY DEFINER helper functions
     (prevents search_path hijacking attacks)
  2. Tighten notification INSERT policy to service_role only
     (regular users should not insert notifications directly)
  3. Add text length constraints to prevent oversized field abuse
*/

-- ============================================================
-- 1. Fix search_path on SECURITY DEFINER helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_workspace_role(ws_id uuid)
RETURNS member_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
-- 2. Tighten notification INSERT policy
--    Only service_role (edge functions, backend) can create notifications.
--    Regular users should never insert notifications directly.
-- ============================================================

DROP POLICY IF EXISTS "Service can insert notifications" ON notifications;

CREATE POLICY "Only service role can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (
    (SELECT current_setting('role', true)) = 'service_role'
  );

-- ============================================================
-- 3. Add text length constraints to prevent oversized field abuse
-- ============================================================

-- Workspaces
ALTER TABLE workspaces
  ADD CONSTRAINT chk_workspace_name_length CHECK (length(name) <= 255),
  ADD CONSTRAINT chk_workspace_slug_length CHECK (length(slug) <= 100);

-- Projects
ALTER TABLE projects
  ADD CONSTRAINT chk_project_name_length CHECK (length(name) <= 255),
  ADD CONSTRAINT chk_project_description_length CHECK (length(description) <= 5000);

-- Tasks
ALTER TABLE tasks
  ADD CONSTRAINT chk_task_title_length CHECK (length(title) <= 500);

-- Companies
ALTER TABLE companies
  ADD CONSTRAINT chk_company_name_length CHECK (length(name) <= 255);

-- Contacts
ALTER TABLE contacts
  ADD CONSTRAINT chk_contact_first_name_length CHECK (length(first_name) <= 255),
  ADD CONSTRAINT chk_contact_last_name_length CHECK (length(last_name) <= 255),
  ADD CONSTRAINT chk_contact_email_length CHECK (length(email) <= 320);

-- Deals
ALTER TABLE deals
  ADD CONSTRAINT chk_deal_name_length CHECK (length(name) <= 255);

-- Documents
ALTER TABLE documents
  ADD CONSTRAINT chk_document_title_length CHECK (length(title) <= 500);

-- Notifications
ALTER TABLE notifications
  ADD CONSTRAINT chk_notification_title_length CHECK (length(title) <= 500),
  ADD CONSTRAINT chk_notification_body_length CHECK (length(body) <= 2000);

-- Automation rules
ALTER TABLE automation_rules
  ADD CONSTRAINT chk_automation_name_length CHECK (length(name) <= 255);

-- Activities
ALTER TABLE activities
  ADD CONSTRAINT chk_activity_subject_length CHECK (length(subject) <= 500);

-- Deal stages
ALTER TABLE deal_stages
  ADD CONSTRAINT chk_deal_stage_name_length CHECK (length(name) <= 100);

-- Profiles
ALTER TABLE profiles
  ADD CONSTRAINT chk_profile_display_name_length CHECK (length(display_name) <= 255);
