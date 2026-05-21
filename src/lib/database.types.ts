export type WorkspacePlan = 'free' | 'pro' | 'enterprise';
export type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
export type MemberStatus = 'active' | 'pending' | 'deactivated';
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';
export type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish';
export type ContactSource = 'manual' | 'import' | 'web_form' | 'referral';
export type LifecycleStage = 'lead' | 'qualified' | 'opportunity' | 'customer' | 'churned';
export type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'task_update' | 'deal_update' | 'status_change';
export type TriggerType = 'task_status_change' | 'deal_stage_change' | 'due_date_passed' | 'task_assigned';
export type ActionType = 'update_field' | 'send_notification' | 'create_activity' | 'move_task';
export type AutomationRunStatus = 'success' | 'failed';
export type NotificationType = 'task_assigned' | 'task_due_soon' | 'task_overdue' | 'deal_stage_changed' | 'mention' | 'automation_triggered';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_by: string;
  plan: WorkspacePlan;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string | null;
  role: MemberRole;
  invited_email: string | null;
  status: MemberStatus;
  joined_at: string | null;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: PriorityLevel;
  start_date: string | null;
  target_end_date: string | null;
  created_by: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  workspace_id: string;
  parent_task_id: string | null;
  title: string;
  description_json: Record<string, unknown> | null;
  status: TaskStatus;
  priority: PriorityLevel;
  assigned_to: string | null;
  reporter: string;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  id: string;
  workspace_id: string;
  blocking_task_id: string;
  blocked_task_id: string;
  dependency_type: DependencyType;
  created_at: string;
}

export interface Company {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  website: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  title: string | null;
  source: ContactSource;
  lifecycle_stage: LifecycleStage;
  owner_id: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DealStage {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
  color: string;
}

export interface Deal {
  id: string;
  workspace_id: string;
  name: string;
  value: number;
  currency: string;
  contact_id: string | null;
  company_id: string | null;
  deal_stage_id: string;
  assigned_to: string | null;
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  workspace_id: string;
  type: ActivityType;
  subject: string;
  body_text: string | null;
  related_contact_id: string | null;
  related_deal_id: string | null;
  related_task_id: string | null;
  related_project_id: string | null;
  created_by: string;
  created_at: string;
}

export interface Document {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  content_json: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationRule {
  id: string;
  workspace_id: string;
  name: string;
  is_active: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  action_type: ActionType;
  action_config: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface AutomationRun {
  id: string;
  workspace_id: string;
  automation_rule_id: string;
  triggered_by_entity_type: string;
  triggered_by_entity_id: string;
  status: AutomationRunStatus;
  result_message: string | null;
  error_message: string | null;
  executed_at: string;
}

export interface Notification {
  id: string;
  workspace_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

// Supabase DB generic type used by the client
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string }; Update: Partial<Profile> };
      workspaces: { Row: Workspace; Insert: Omit<Workspace, 'id' | 'created_at'>; Update: Partial<Workspace> };
      workspace_members: { Row: WorkspaceMember; Insert: Omit<WorkspaceMember, 'id'>; Update: Partial<WorkspaceMember> };
      projects: { Row: Project; Insert: Omit<Project, 'id' | 'created_at'>; Update: Partial<Project> };
      tasks: { Row: Task; Insert: Omit<Task, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Task> };
      task_dependencies: { Row: TaskDependency; Insert: Omit<TaskDependency, 'id' | 'created_at'>; Update: Partial<TaskDependency> };
      companies: { Row: Company; Insert: Omit<Company, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Company> };
      contacts: { Row: Contact; Insert: Omit<Contact, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Contact> };
      deal_stages: { Row: DealStage; Insert: Omit<DealStage, 'id'>; Update: Partial<DealStage> };
      deals: { Row: Deal; Insert: Omit<Deal, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Deal> };
      activities: { Row: Activity; Insert: Omit<Activity, 'id' | 'created_at'>; Update: Partial<Activity> };
      documents: { Row: Document; Insert: Omit<Document, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Document> };
      automation_rules: { Row: AutomationRule; Insert: Omit<AutomationRule, 'id' | 'created_at'>; Update: Partial<AutomationRule> };
      automation_runs: { Row: AutomationRun; Insert: Omit<AutomationRun, 'id' | 'executed_at'>; Update: Partial<AutomationRun> };
      notifications: { Row: Notification; Insert: Omit<Notification, 'id' | 'created_at'>; Update: Partial<Notification> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      workspace_plan: WorkspacePlan;
      member_role: MemberRole;
      member_status: MemberStatus;
      project_status: ProjectStatus;
      priority_level: PriorityLevel;
      task_status: TaskStatus;
      dependency_type: DependencyType;
      contact_source: ContactSource;
      lifecycle_stage: LifecycleStage;
      activity_type: ActivityType;
      trigger_type: TriggerType;
      action_type: ActionType;
      automation_run_status: AutomationRunStatus;
      notification_type: NotificationType;
    };
  };
};
