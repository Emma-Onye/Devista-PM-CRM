/*
  # Fix workspace creation RLS — chicken-and-egg problem (comprehensive)

  ## Problem
  Three sequential RLS barriers prevent workspace onboarding:
  1. INSERT workspace → .select() fails (SELECT policy needs membership)
  2. INSERT workspace_member → fails (INSERT policy needs owner/admin role)
  3. INSERT deal_stages → fails (INSERT policy needs owner/admin/manager role)

  If step 1 errors, the client code returns early and the workspace_members row
  is never created. The user becomes permanently locked out.

  ## Solution
  1. A SECURITY DEFINER function `create_workspace_with_owner()` that atomically:
     - Creates the workspace
     - Adds the caller as owner in workspace_members
     - Seeds default deal stages
     All in one transaction. If any step fails, everything rolls back.

  2. A SELECT policy so creators can always see their own workspace.

  3. A profiles SELECT policy so workspace co-members can see each other
     (needed for assignee names, member lists, etc.)

  ## Security Analysis
  - The function only creates workspaces owned by auth.uid()
  - Users cannot impersonate others or escalate privileges
  - All existing RLS policies remain unchanged and fully enforced
  - Only the onboarding bootstrap bypasses RLS (via SECURITY DEFINER)
*/

-- ============================================================
-- 1. Atomic workspace creation function
-- ============================================================

CREATE OR REPLACE FUNCTION create_workspace_with_owner(
  ws_name text,
  ws_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ws_id   uuid;
  v_result  jsonb;
BEGIN
  -- Guard: must be authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Step 1: Create workspace
  INSERT INTO workspaces (name, slug, created_by)
  VALUES (ws_name, ws_slug, v_user_id)
  RETURNING id INTO v_ws_id;

  -- Step 2: Add caller as owner (the critical step that was failing)
  INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
  VALUES (v_ws_id, v_user_id, 'owner', 'active', now());

  -- Step 3: Seed default deal stages
  INSERT INTO deal_stages (workspace_id, name, position, probability, color, is_won, is_lost) VALUES
    (v_ws_id, 'Qualification', 0, 10,  '#6366f1', false, false),
    (v_ws_id, 'Proposal',      1, 30,  '#3b82f6', false, false),
    (v_ws_id, 'Negotiation',   2, 50,  '#f59e0b', false, false),
    (v_ws_id, 'Verbal Commit', 3, 70,  '#8b5cf6', false, false),
    (v_ws_id, 'Closed Won',    4, 100, '#10b981', true,  false),
    (v_ws_id, 'Closed Lost',   5, 0,   '#ef4444', false, true);

  -- Return the full workspace row as JSON
  SELECT to_jsonb(w) INTO v_result
  FROM workspaces w
  WHERE w.id = v_ws_id;

  RETURN v_result;
END;
$$;

-- Lock down access: only authenticated users, not anon or public
REVOKE EXECUTE ON FUNCTION create_workspace_with_owner(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_workspace_with_owner(text, text) TO authenticated;

-- ============================================================
-- 2. Workspace creator SELECT policy (safety net)
-- ============================================================

CREATE POLICY "Creators can view own workspace"
  ON workspaces FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

-- ============================================================
-- 3. Profiles visibility for workspace co-members
--    Without this, users can't see teammate names in task lists,
--    member pages, assignee dropdowns, etc.
-- ============================================================

CREATE POLICY "Workspace co-members can view profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm1
      JOIN workspace_members wm2
        ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = auth.uid()
        AND wm2.user_id = profiles.id
        AND wm1.status = 'active'
        AND wm2.status = 'active'
    )
  );
