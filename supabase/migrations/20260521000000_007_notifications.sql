-- ────────────────────────────────────────────────────────────────────────────
-- 007: Notifications table
-- ────────────────────────────────────────────────────────────────────────────

-- Notification type enum
CREATE TYPE notification_type AS ENUM (
  'task_assigned',
  'task_due_soon',
  'task_overdue',
  'deal_stage_changed',
  'mention',
  'automation_triggered'
);

-- Notifications table
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             notification_type NOT NULL,
  title            text NOT NULL,
  body             text,
  related_entity_type text,          -- 'task', 'deal', 'project', 'contact', etc.
  related_entity_id   uuid,
  is_read          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_notifications_user_workspace
  ON notifications (user_id, workspace_id, created_at DESC);

CREATE INDEX idx_notifications_unread
  ON notifications (user_id, workspace_id)
  WHERE is_read = false;

-- RLS: users see only their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow inserts from backend / service role (SECURITY DEFINER functions, edge functions)
-- Individual users cannot insert notifications for others
CREATE POLICY "Service can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (
    -- Allow if inserting for self (e.g., test/demo), or from service role
    user_id = auth.uid()
    OR (SELECT current_setting('role', true)) = 'service_role'
  );

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());
