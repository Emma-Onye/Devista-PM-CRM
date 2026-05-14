import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Zap, CircleCheck as CheckCircle, ChevronRight, ChevronLeft, X, Activity, BellRing, ClipboardList, ArrowRight, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { cn } from '../../lib/utils';
import type { TriggerType, ActionType, TaskStatus, PriorityLevel } from '../../lib/database.types';

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'backlog',     label: 'Backlog' },
  { value: 'todo',        label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review',   label: 'In Review' },
  { value: 'done',        label: 'Done' },
];

const PRIORITIES: { value: PriorityLevel; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
];

// ── Trigger definitions ───────────────────────────────────────────────────────

interface TriggerDef {
  type: TriggerType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const TRIGGERS: TriggerDef[] = [
  {
    type: 'task_status_change',
    label: 'Task Status Changes',
    description: 'Fires when a task moves to a specific status',
    icon: CheckCircle,
    color: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  {
    type: 'deal_stage_change',
    label: 'Deal Stage Changes',
    description: 'Fires when a deal moves to a specific pipeline stage',
    icon: ArrowRight,
    color: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    type: 'due_date_passed',
    label: 'Due Date Passes',
    description: 'Fires when a task due date is reached or overdue',
    icon: Activity,
    color: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  {
    type: 'task_assigned',
    label: 'Task Assigned',
    description: 'Fires when a task is assigned to someone',
    icon: ClipboardList,
    color: 'border-violet-200 bg-violet-50 text-violet-700',
  },
];

// ── Action definitions ────────────────────────────────────────────────────────

interface ActionDef {
  type: ActionType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const ACTIONS: ActionDef[] = [
  {
    type: 'update_field',
    label: 'Update Field',
    description: 'Change a field value on a task or deal',
    icon: ClipboardList,
    color: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  {
    type: 'send_notification',
    label: 'Send Notification',
    description: 'Notify the assignee, reporter, or admins',
    icon: BellRing,
    color: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    type: 'create_activity',
    label: 'Create Activity Log',
    description: 'Log an activity entry automatically',
    icon: Activity,
    color: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  {
    type: 'move_task',
    label: 'Move Task',
    description: 'Change a task to a different status',
    icon: ArrowRight,
    color: 'border-violet-200 bg-violet-50 text-violet-700',
  },
];

// ── State types ───────────────────────────────────────────────────────────────

type TriggerConfig = Record<string, unknown>;
type ActionConfig = Record<string, unknown>;

// ── Wizard ────────────────────────────────────────────────────────────────────

export function CreateAutomationWizard({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();

  const [step, setStep] = useState(1);
  const [triggerType, setTriggerType] = useState<TriggerType | null>(null);
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfig>({});
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionConfig, setActionConfig] = useState<ActionConfig>({});
  const [name, setName] = useState('');

  // Deal stages for deal_stage_change trigger
  const { data: dealStages = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['deal-stages', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('deal_stages').select('id, name').eq('workspace_id', activeWorkspace!.id).order('position');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Workspace members for task_assigned filter
  const { data: members = [] } = useQuery<{ user_id: string; display_name: string }[]>({
    queryKey: ['members-options', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id && triggerType === 'task_assigned',
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('workspace_members')
        .select('user_id, profiles(display_name)')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('status', 'active');
      return (data ?? []).map((m: { user_id: string; profiles: { display_name: string } | null }) => ({
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? '—',
      }));
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from('automation_rules')
        .insert({
          workspace_id: activeWorkspace!.id,
          name: name.trim(),
          is_active: true,
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          action_type: actionType,
          action_config: actionConfig,
          created_by: user!.id,
        });
      if (error) throw error;
    },
    onSuccess,
  });

  // Auto-generate name
  const autoName = (() => {
    if (!triggerType || !actionType) return '';
    const tDef = TRIGGERS.find((t) => t.type === triggerType);
    const aDef = ACTIONS.find((a) => a.type === actionType);
    return `${tDef?.label} → ${aDef?.label}`;
  })();

  const canProceedStep1 = !!triggerType && isStep1Valid(triggerType, triggerConfig);
  const canProceedStep2 = !!actionType && isStep2Valid(actionType, actionConfig);
  const canSave = name.trim().length > 0;

  const selectedTrigger = TRIGGERS.find((t) => t.type === triggerType);
  const selectedAction = ACTIONS.find((a) => a.type === actionType);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top bar */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-600" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Create Automation</h2>
        </div>
        <button className="text-gray-400 hover:text-gray-600 transition-colors" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Step indicator */}
      <div className="px-6 py-3 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2 max-w-xl">
          {[
            { n: 1, label: 'Choose Trigger' },
            { n: 2, label: 'Choose Action' },
            { n: 3, label: 'Name & Confirm' },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center gap-2 flex-1">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all shrink-0',
                step > s.n ? 'bg-emerald-500 text-white' :
                step === s.n ? 'bg-amber-500 text-white' :
                'bg-gray-200 text-gray-400',
              )}>
                {step > s.n ? <CheckCircle className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={cn('text-xs font-medium whitespace-nowrap', step === s.n ? 'text-gray-800' : 'text-gray-400')}>
                {s.label}
              </span>
              {i < 2 && <div className="flex-1 h-px bg-gray-200 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {step === 1 && (
            <Step1Trigger
              triggerType={triggerType}
              triggerConfig={triggerConfig}
              dealStages={dealStages}
              members={members}
              onSelectType={(t) => { setTriggerType(t); setTriggerConfig({}); }}
              onConfigChange={setTriggerConfig}
            />
          )}
          {step === 2 && (
            <Step2Action
              actionType={actionType}
              actionConfig={actionConfig}
              onSelectType={(a) => { setActionType(a); setActionConfig({}); }}
              onConfigChange={setActionConfig}
            />
          )}
          {step === 3 && (
            <Step3Confirm
              name={name}
              autoName={autoName}
              triggerDef={selectedTrigger ?? null}
              actionDef={selectedAction ?? null}
              triggerConfig={triggerConfig}
              actionConfig={actionConfig}
              onNameChange={setName}
            />
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div className="px-6 py-4 border-t border-gray-200 bg-white shrink-0 flex justify-between">
        <Button variant="outline" onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
          className="gap-1.5">
          {step === 1 ? <><X className="w-3.5 h-3.5" /> Cancel</> : <><ChevronLeft className="w-3.5 h-3.5" /> Back</>}
        </Button>
        {step < 3 ? (
          <Button
            disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
            className="gap-1.5 bg-amber-500 hover:bg-amber-600"
            onClick={() => {
              if (step === 2 && !name) setName(autoName);
              setStep((s) => s + 1);
            }}
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button
            disabled={!canSave || saveMutation.isPending}
            className="gap-1.5 bg-amber-500 hover:bg-amber-600"
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Save Automation
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isStep1Valid(type: TriggerType, cfg: TriggerConfig): boolean {
  switch (type) {
    case 'task_status_change': return !!cfg.target_status;
    case 'deal_stage_change': return !!cfg.stage_id;
    case 'due_date_passed': return cfg.days_after !== undefined && cfg.days_after !== '';
    case 'task_assigned': return true;
    default: return false;
  }
}

function isStep2Valid(type: ActionType, cfg: ActionConfig): boolean {
  switch (type) {
    case 'update_field': return !!cfg.entity && !!cfg.field && !!cfg.value;
    case 'send_notification': return !!cfg.recipient && !!(cfg.message as string)?.trim();
    case 'create_activity': return !!cfg.activity_type && !!(cfg.message as string)?.trim();
    case 'move_task': return !!cfg.target_status;
    default: return false;
  }
}

// ── Step 1 ────────────────────────────────────────────────────────────────────

function Step1Trigger({
  triggerType, triggerConfig, dealStages, members,
  onSelectType, onConfigChange,
}: {
  triggerType: TriggerType | null;
  triggerConfig: TriggerConfig;
  dealStages: { id: string; name: string }[];
  members: { user_id: string; display_name: string }[];
  onSelectType: (t: TriggerType) => void;
  onConfigChange: (cfg: TriggerConfig) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-900">Choose a trigger</h3>
        <p className="text-sm text-gray-400 mt-0.5">Select the event that will start this automation.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TRIGGERS.map((t) => {
          const Icon = t.icon;
          const selected = triggerType === t.type;
          return (
            <button
              key={t.type}
              onClick={() => onSelectType(t.type)}
              className={cn(
                'text-left p-4 rounded-xl border-2 transition-all hover:shadow-sm',
                selected ? 'border-amber-400 bg-amber-50/50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300',
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', t.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{t.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Config panel */}
      {triggerType && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 mt-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Configure trigger</p>

          {triggerType === 'task_status_change' && (
            <div className="space-y-1.5">
              <Label>When task status changes to</Label>
              <Select
                value={triggerConfig.target_status as string ?? ''}
                onValueChange={(v) => onConfigChange({ ...triggerConfig, target_status: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select status…" /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {triggerType === 'deal_stage_change' && (
            <div className="space-y-1.5">
              <Label>When deal moves to stage</Label>
              {dealStages.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No deal stages found in this workspace.</p>
              ) : (
                <Select
                  value={triggerConfig.stage_id as string ?? ''}
                  onValueChange={(v) => {
                    const stage = dealStages.find((s) => s.id === v);
                    onConfigChange({ ...triggerConfig, stage_id: v, stage_name: stage?.name });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select stage…" /></SelectTrigger>
                  <SelectContent>
                    {dealStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {triggerType === 'due_date_passed' && (
            <div className="space-y-1.5">
              <Label>Days after due date (0 = on the day)</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={triggerConfig.days_after as string ?? '0'}
                onChange={(e) => onConfigChange({ ...triggerConfig, days_after: parseInt(e.target.value) || 0 })}
                className="w-32"
              />
              <p className="text-xs text-gray-400">
                {(triggerConfig.days_after as number) === 0
                  ? 'Triggers on the exact due date'
                  : `Triggers ${triggerConfig.days_after} day${(triggerConfig.days_after as number) !== 1 ? 's' : ''} after due date`}
              </p>
            </div>
          )}

          {triggerType === 'task_assigned' && (
            <div className="space-y-1.5">
              <Label>Filter to specific assignee <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Select
                value={triggerConfig.assignee_id as string ?? 'any'}
                onValueChange={(v) => {
                  if (v === 'any') {
                    onConfigChange({ ...triggerConfig, assignee_id: undefined, assignee_name: undefined });
                  } else {
                    const m = members.find((mm) => mm.user_id === v);
                    onConfigChange({ ...triggerConfig, assignee_id: v, assignee_name: m?.display_name });
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Any assignee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any assignee</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────────────

function Step2Action({
  actionType, actionConfig, onSelectType, onConfigChange,
}: {
  actionType: ActionType | null;
  actionConfig: ActionConfig;
  onSelectType: (a: ActionType) => void;
  onConfigChange: (cfg: ActionConfig) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-900">Choose an action</h3>
        <p className="text-sm text-gray-400 mt-0.5">Select what happens when the trigger fires.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const selected = actionType === a.type;
          return (
            <button
              key={a.type}
              onClick={() => onSelectType(a.type)}
              className={cn(
                'text-left p-4 rounded-xl border-2 transition-all hover:shadow-sm',
                selected ? 'border-amber-400 bg-amber-50/50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300',
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', a.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{a.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Config panel */}
      {actionType && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 mt-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Configure action</p>

          {actionType === 'update_field' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Entity to update</Label>
                <Select
                  value={actionConfig.entity as string ?? ''}
                  onValueChange={(v) => onConfigChange({ ...actionConfig, entity: v, field: undefined, value: undefined })}
                >
                  <SelectTrigger><SelectValue placeholder="Select entity…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="deal">Deal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {actionConfig.entity === 'task' && (
                <div className="space-y-1.5">
                  <Label>Field to update</Label>
                  <Select
                    value={actionConfig.field as string ?? ''}
                    onValueChange={(v) => onConfigChange({ ...actionConfig, field: v, value: undefined })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select field…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status">Status</SelectItem>
                      <SelectItem value="priority">Priority</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {actionConfig.entity === 'task' && actionConfig.field === 'status' && (
                <div className="space-y-1.5">
                  <Label>New value</Label>
                  <Select
                    value={actionConfig.value as string ?? ''}
                    onValueChange={(v) => onConfigChange({ ...actionConfig, value: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select status…" /></SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {actionConfig.entity === 'task' && actionConfig.field === 'priority' && (
                <div className="space-y-1.5">
                  <Label>New value</Label>
                  <Select
                    value={actionConfig.value as string ?? ''}
                    onValueChange={(v) => onConfigChange({ ...actionConfig, value: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select priority…" /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {actionType === 'send_notification' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Notify</Label>
                <Select
                  value={actionConfig.recipient as string ?? ''}
                  onValueChange={(v) => onConfigChange({ ...actionConfig, recipient: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select recipient…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="assignee">Task Assignee</SelectItem>
                    <SelectItem value="reporter">Task Reporter</SelectItem>
                    <SelectItem value="workspace_admins">Workspace Admins</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Message template</Label>
                <textarea
                  className="w-full h-20 text-sm border border-gray-200 rounded-md px-3 py-2 outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 resize-none"
                  placeholder="e.g., Task {{task.title}} has been updated…"
                  value={actionConfig.message as string ?? ''}
                  onChange={(e) => onConfigChange({ ...actionConfig, message: e.target.value })}
                />
                <p className="text-xs text-gray-400">Use {`{{task.title}}`} for dynamic values.</p>
              </div>
            </div>
          )}

          {actionType === 'create_activity' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Activity type</Label>
                <Select
                  value={actionConfig.activity_type as string ?? ''}
                  onValueChange={(v) => onConfigChange({ ...actionConfig, activity_type: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="task_update">Task Update</SelectItem>
                    <SelectItem value="status_change">Status Change</SelectItem>
                    <SelectItem value="deal_update">Deal Update</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Log message template</Label>
                <textarea
                  className="w-full h-20 text-sm border border-gray-200 rounded-md px-3 py-2 outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 resize-none"
                  placeholder="e.g., Task {{task.title}} status changed to {{task.status}}"
                  value={actionConfig.message as string ?? ''}
                  onChange={(e) => onConfigChange({ ...actionConfig, message: e.target.value })}
                />
              </div>
            </div>
          )}

          {actionType === 'move_task' && (
            <div className="space-y-1.5">
              <Label>Move task to status</Label>
              <Select
                value={actionConfig.target_status as string ?? ''}
                onValueChange={(v) => onConfigChange({ ...actionConfig, target_status: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select status…" /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────────────

function Step3Confirm({
  name, autoName, triggerDef, actionDef, triggerConfig, actionConfig, onNameChange,
}: {
  name: string;
  autoName: string;
  triggerDef: { label: string; color: string; icon: React.ComponentType<{ className?: string }> } | null;
  actionDef: { label: string; color: string; icon: React.ComponentType<{ className?: string }> } | null;
  triggerConfig: TriggerConfig;
  actionConfig: ActionConfig;
  onNameChange: (v: string) => void;
}) {
  const TIcon = triggerDef?.icon;
  const AIcon = actionDef?.icon;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-gray-900">Name & confirm</h3>
        <p className="text-sm text-gray-400 mt-0.5">Review your automation and give it a name.</p>
      </div>

      {/* Summary */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Summary</p>
          <div className="flex items-start gap-3">
            {TIcon && triggerDef && (
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', triggerDef.color)}>
                    <TIcon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">Trigger</span>
                </div>
                <p className="text-sm text-gray-600 ml-9">{triggerDef.label}</p>
                <div className="ml-9 mt-1 space-y-0.5">
                  {Object.entries(triggerConfig)
                    .filter(([k]) => !k.endsWith('_id'))
                    .map(([k, v]) => (
                      <p key={k} className="text-xs text-gray-400">
                        <span className="font-medium capitalize">{k.replace(/_/g, ' ')}:</span> {String(v)}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 bg-amber-50 flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-amber-700 font-medium">Then run this action</span>
        </div>

        <div className="p-4">
          {AIcon && actionDef && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', actionDef.color)}>
                  <AIcon className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-gray-700">Action</span>
              </div>
              <p className="text-sm text-gray-600 ml-9">{actionDef.label}</p>
              <div className="ml-9 mt-1 space-y-0.5">
                {Object.entries(actionConfig)
                  .filter(([k]) => !k.endsWith('_id'))
                  .map(([k, v]) => (
                    <p key={k} className="text-xs text-gray-400">
                      <span className="font-medium capitalize">{k.replace(/_/g, ' ')}:</span> {String(v)}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Name field */}
      <div className="space-y-1.5">
        <Label>Rule name <span className="text-red-500">*</span></Label>
        <Input
          autoFocus
          placeholder={autoName || 'e.g., Auto-unblock tasks on completion'}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
        <p className="text-xs text-gray-400">This rule will be activated immediately after saving.</p>
      </div>
    </div>
  );
}

