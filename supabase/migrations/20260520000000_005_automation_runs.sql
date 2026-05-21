/*
  # Automation Runs — Execution Log

  ## Overview
  Tracks every time an automation rule fires, recording success/failure status
  and error details. Uses the same RLS pattern as all other workspace-scoped tables.

  ## Tables Created
  1. automation_runs — Execution history for automation_rules

  ## Enums Created
  1. automation_run_status — success | failed

  ## Indexes
  - workspace_id for tenant isolation queries
  - automation_rule_id for per-rule history lookups
  - executed_at DESC for chronological listing
*/

-- ============================================================
-- ENUM
-- ============================================================

CREATE TYPE automation_run_status AS ENUM ('success', 'failed');

-- ============================================================
-- AUTOMATION_RUNS
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_rule_id uuid NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  triggered_by_entity_type text NOT NULL,       -- 'task' | 'deal'
  triggered_by_entity_id uuid NOT NULL,
  status automation_run_status NOT NULL DEFAULT 'success',
  result_message text,                          -- human-readable result summary
  error_message text,                           -- error details when status = 'failed'
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workspace_id ON automation_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule_id ON automation_runs(automation_rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_executed_at ON automation_runs(executed_at DESC);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ─────────────────────────────────────────────
-- Follows the same pattern as all other workspace-scoped tables.

CREATE POLICY "Active members can view automation runs"
  ON automation_runs FOR SELECT TO authenticated
  USING (is_active_workspace_member(workspace_id));

CREATE POLICY "Members can create automation runs"
  ON automation_runs FOR INSERT TO authenticated
  WITH CHECK (can_write_in_workspace(workspace_id));

-- Runs are append-only audit records — no UPDATE policy needed.

CREATE POLICY "Admins and above can delete automation runs"
  ON automation_runs FOR DELETE TO authenticated
  USING (get_my_workspace_role(workspace_id) IN ('owner', 'admin'));
