import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Zap, Plus, Search, ToggleLeft, Clock,
  Loader as Loader2, Trash2, ArrowRight,
  History, ChevronLeft, ChevronRight,
  CircleCheck as CheckCircle2, CircleX as XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { cn } from '../../lib/utils';
import type { AutomationRule, TriggerType, ActionType, AutomationRun } from '../../lib/database.types';
import { CreateAutomationWizard } from './CreateAutomationWizard';

// ── Human-readable descriptions ───────────────────────────────────────────────

function describeTrigger(rule: AutomationRule): string {
  const cfg = rule.trigger_config as Record<string, unknown>;
  switch (rule.trigger_type as TriggerType) {
    case 'task_status_change': {
      const s = cfg.target_status as string | undefined;
      return s ? `When task status changes to "${s.replace(/_/g, ' ')}"` : 'When task status changes';
    }
    case 'deal_stage_change': {
      const n = cfg.stage_name as string | undefined;
      return n ? `When deal moves to "${n}"` : 'When deal stage changes';
    }
    case 'due_date_passed': {
      const d = cfg.days_after as number | undefined;
      if (d === undefined) return 'When due date passes';
      return d === 0 ? 'On the due date' : `${d} day${d !== 1 ? 's' : ''} after due date`;
    }
    case 'task_assigned': {
      const name = cfg.assignee_name as string | undefined;
      return name ? `When task is assigned to ${name}` : 'When any task is assigned';
    }
    default: return 'Custom trigger';
  }
}

function describeAction(rule: AutomationRule): string {
  const cfg = rule.action_config as Record<string, unknown>;
  switch (rule.action_type as ActionType) {
    case 'update_field': {
      const entity = cfg.entity as string | undefined;
      const field = cfg.field as string | undefined;
      const value = cfg.value as string | undefined;
      if (field && value) return `Update ${entity ?? 'record'} ${field.replace(/_/g, ' ')} to "${value.replace(/_/g, ' ')}"`;
      return 'Update a field';
    }
    case 'send_notification': {
      const to = cfg.recipient as string | undefined;
      return to ? `Notify ${to.replace(/_/g, ' ')}` : 'Send notification';
    }
    case 'create_activity': {
      const type = cfg.activity_type as string | undefined;
      return type ? `Log activity: ${type}` : 'Create activity log';
    }
    case 'move_task': {
      const status = cfg.target_status as string | undefined;
      return status ? `Move task to "${status.replace(/_/g, ' ')}"` : 'Move task';
    }
    default: return 'Custom action';
  }
}

const TRIGGER_COLOR: Record<TriggerType, string> = {
  task_status_change: 'bg-sky-50 text-sky-600',
  deal_stage_change:  'bg-emerald-50 text-emerald-600',
  due_date_passed:    'bg-amber-50 text-amber-600',
  task_assigned:      'bg-violet-50 text-violet-600',
};

type FilterMode = 'all' | 'active' | 'inactive';
type TabMode = 'rules' | 'logs';

// ── Types for joined runs ────────────────────────────────────────────────────

interface RunRow extends AutomationRun {
  automation_rules: { name: string; trigger_type: string } | null;
}

const LOG_PAGE_SIZE = 15;

// ── AutomationsPage ───────────────────────────────────────────────────────────

export function AutomationsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabMode>('rules');

  // ── Log state ───────────────────────────────────────────────────────────
  const [logPage, setLogPage] = useState(1);
  const [logFilter, setLogFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);

  // ── Rules query ─────────────────────────────────────────────────────────
  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ['automation-rules', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('automation_rules')
        .select('*')
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as AutomationRule[];
    },
  });

  const { data: profiles = {} } = useQuery<Record<string, string>>({
    queryKey: ['rule-creators', rules.map((r) => r.created_by).join(',')],
    enabled: rules.length > 0,
    queryFn: async () => {
      const ids = [...new Set(rules.map((r) => r.created_by))];
      const { data } = await (supabase as any)
        .from('profiles').select('id, display_name').in('id', ids);
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = p.display_name;
      return map;
    },
  });

  // ── Runs query ──────────────────────────────────────────────────────────
  const { data: runs = [], isLoading: runsLoading } = useQuery<RunRow[]>({
    queryKey: ['automation-runs', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id && tab === 'logs',
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('automation_runs')
        .select('*, automation_rules(name, trigger_type)')
        .eq('workspace_id', activeWorkspace!.id)
        .order('executed_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as RunRow[];
    },
  });

  // ── Mutations ───────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('automation_rules').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onMutate: ({ id, is_active }) => {
      qc.setQueryData<AutomationRule[]>(['automation-rules', activeWorkspace?.id], (old = []) =>
        old.map((r) => r.id === id ? { ...r, is_active } : r)
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['automation-rules', activeWorkspace?.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('automation_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-rules', activeWorkspace?.id] });
      setDeleteId(null);
    },
  });

  // ── Filtered data ───────────────────────────────────────────────────────
  const filteredRules = rules.filter((r) => {
    if (filter === 'active' && !r.is_active) return false;
    if (filter === 'inactive' && r.is_active) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredRuns = runs.filter((r) => {
    if (logFilter === 'success' && r.status !== 'success') return false;
    if (logFilter === 'failed' && r.status !== 'failed') return false;
    return true;
  });

  const logTotalPages = Math.max(1, Math.ceil(filteredRuns.length / LOG_PAGE_SIZE));
  const logPageData = filteredRuns.slice((logPage - 1) * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE);

  if (wizardOpen) {
    return (
      <CreateAutomationWizard
        onClose={() => setWizardOpen(false)}
        onSuccess={() => {
          setWizardOpen(false);
          qc.invalidateQueries({ queryKey: ['automation-rules', activeWorkspace?.id] });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Automations</h1>
              <p className="text-xs text-gray-400">
                {rules.length} rule{rules.length !== 1 ? 's' : ''} · {rules.filter((r) => r.is_active).length} active
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white h-8"
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Create Automation
          </Button>
        </div>
      </div>

      {/* Tabs + Toolbar */}
      <div className="px-6 py-3 border-b border-gray-100 bg-white shrink-0 flex flex-wrap items-center gap-3">
        {/* Tab switcher */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 mr-2">
          <button
            onClick={() => setTab('rules')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5',
              tab === 'rules' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Zap className="w-3 h-3" /> Rules
          </button>
          <button
            onClick={() => { setTab('logs'); setLogPage(1); }}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5',
              tab === 'logs' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <History className="w-3 h-3" /> Execution Logs
          </button>
        </div>

        {/* Rules toolbar */}
        {tab === 'rules' && (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="pl-8 h-8 text-sm border border-gray-200 rounded-md w-52 outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 bg-white"
                placeholder="Search rules…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {(['all', 'active', 'inactive'] as FilterMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setFilter(m)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md capitalize transition-all',
                    filter === m ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Logs toolbar */}
        {tab === 'logs' && (
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {(['all', 'success', 'failed'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setLogFilter(m); setLogPage(1); }}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md capitalize transition-all',
                  logFilter === m ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'rules' && (
          <>
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : filteredRules.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mb-3">
                  <Zap className="w-6 h-6 text-amber-300" />
                </div>
                <p className="text-sm font-medium text-gray-500">
                  {search || filter !== 'all' ? 'No matching rules' : 'No automations yet'}
                </p>
                {!search && filter === 'all' && (
                  <>
                    <p className="text-xs text-gray-400 mt-1 max-w-xs">
                      Create your first automation to trigger actions when events occur in your workspace.
                    </p>
                    <Button
                      size="sm" variant="outline"
                      className="mt-4 gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
                      onClick={() => setWizardOpen(true)}
                    >
                      <Plus className="w-3.5 h-3.5" /> Create Automation
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="px-6 py-4 space-y-3">
                {filteredRules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    creatorName={profiles[rule.created_by] ?? '—'}
                    onToggle={(v) => toggleMutation.mutate({ id: rule.id, is_active: v })}
                    onDelete={() => setDeleteId(rule.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'logs' && (
          <>
            {runsLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : filteredRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
                  <History className="w-6 h-6 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-500">
                  {logFilter !== 'all' ? 'No matching logs' : 'No execution logs yet'}
                </p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  Logs appear here when automation rules are triggered by task or deal changes.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="whitespace-nowrap">Rule Name</TableHead>
                    <TableHead className="whitespace-nowrap">Trigger</TableHead>
                    <TableHead className="whitespace-nowrap">Entity</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap">Executed</TableHead>
                    <TableHead className="whitespace-nowrap w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logPageData.map((run) => (
                    <TableRow
                      key={run.id}
                      className="cursor-pointer hover:bg-indigo-50/40 transition-colors"
                      onClick={() => setSelectedRun(run)}
                    >
                      <TableCell className="font-medium text-gray-900 text-sm whitespace-nowrap max-w-[200px] truncate">
                        {run.automation_rules?.name ?? 'Deleted rule'}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                        {(run.automation_rules?.trigger_type ?? '').replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                        <Badge variant="outline" className="text-[10px] bg-gray-50 border-gray-200">
                          {run.triggered_by_entity_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {run.status === 'success' ? (
                          <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 gap-1" variant="outline">
                            <CheckCircle2 className="w-3 h-3" /> Success
                          </Badge>
                        ) : (
                          <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200 gap-1" variant="outline">
                            <XCircle className="w-3 h-3" /> Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-gray-400 whitespace-nowrap">
                        {format(new Date(run.executed_at), 'MMM d, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-gray-400">
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>

      {/* Log pagination */}
      {tab === 'logs' && logTotalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white shrink-0">
          <p className="text-xs text-gray-400">
            {(logPage - 1) * LOG_PAGE_SIZE + 1}–{Math.min(logPage * LOG_PAGE_SIZE, filteredRuns.length)} of {filteredRuns.length} logs
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="w-7 h-7" disabled={logPage === 1} onClick={() => setLogPage((p) => p - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            {Array.from({ length: Math.min(logTotalPages, 7) }, (_, i) => i + 1).map((p) => (
              <Button
                key={p} size="sm"
                variant={logPage === p ? 'default' : 'outline'}
                className={`w-7 h-7 text-xs ${logPage === p ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
                onClick={() => setLogPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button variant="outline" size="icon" className="w-7 h-7" disabled={logPage === logTotalPages} onClick={() => setLogPage((p) => p + 1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Run detail dialog */}
      <Dialog open={!!selectedRun} onOpenChange={(o) => !o && setSelectedRun(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedRun?.status === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              Execution Details
            </DialogTitle>
            <DialogDescription>
              {selectedRun?.automation_rules?.name ?? 'Deleted rule'} — {selectedRun?.executed_at ? format(new Date(selectedRun.executed_at), 'MMM d, yyyy HH:mm:ss') : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedRun && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</p>
                  {selectedRun.status === 'success' ? (
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1" variant="outline">
                      <CheckCircle2 className="w-3 h-3" /> Success
                    </Badge>
                  ) : (
                    <Badge className="bg-red-50 text-red-700 border-red-200 gap-1" variant="outline">
                      <XCircle className="w-3 h-3" /> Failed
                    </Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Trigger</p>
                  <p className="text-sm text-gray-700">{(selectedRun.automation_rules?.trigger_type ?? '').replace(/_/g, ' ')}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Entity Type</p>
                  <p className="text-sm text-gray-700 capitalize">{selectedRun.triggered_by_entity_type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Entity ID</p>
                  <p className="text-xs text-gray-500 font-mono break-all">{selectedRun.triggered_by_entity_id}</p>
                </div>
              </div>

              {selectedRun.result_message && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Result</p>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    <p className="text-sm text-emerald-800">{selectedRun.result_message}</p>
                  </div>
                </div>
              )}

              {selectedRun.error_message && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Error</p>
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="text-sm text-red-800 font-mono whitespace-pre-wrap break-all">{selectedRun.error_message}</p>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Executed At</p>
                <p className="text-sm text-gray-700">
                  {format(new Date(selectedRun.executed_at), 'MMMM d, yyyy \'at\' HH:mm:ss')}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation?</AlertDialogTitle>
            <AlertDialogDescription>
              This rule will be permanently deleted and will stop running.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── RuleCard ──────────────────────────────────────────────────────────────────

function RuleCard({
  rule, creatorName, onToggle, onDelete,
}: {
  rule: AutomationRule;
  creatorName: string;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
}) {
  const iconCls = TRIGGER_COLOR[rule.trigger_type as TriggerType] ?? 'bg-gray-100 text-gray-500';
  return (
    <div className={cn(
      'border rounded-xl p-4 bg-white transition-all hover:shadow-sm',
      rule.is_active ? 'border-gray-200' : 'border-gray-100 opacity-70',
    )}>
      <div className="flex items-start gap-3">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5', iconCls)}>
          <Zap className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900">{rule.name}</p>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={cn('text-[10px]',
                rule.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200',
              )}>
                {rule.is_active ? 'Active' : 'Inactive'}
              </Badge>
              <Switch
                checked={rule.is_active}
                onCheckedChange={onToggle}
                className="data-[state=checked]:bg-emerald-500 h-5 w-9"
              />
              <button className="text-gray-300 hover:text-red-500 transition-colors" onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-0.5">
              {describeTrigger(rule)}
            </span>
            <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5">
              Then: {describeAction(rule)}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-2.5 text-[10px] text-gray-400 flex-wrap">
            <span className="flex items-center gap-1">
              <ToggleLeft className="w-3 h-3" />
              {rule.trigger_type.replace(/_/g, ' ')}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(new Date(rule.created_at), 'MMM d, yyyy')}
            </span>
            {creatorName !== '—' && <><span>·</span><span>by {creatorName}</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}
