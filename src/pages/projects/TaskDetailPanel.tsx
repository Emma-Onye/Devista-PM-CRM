import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import { X, Loader as Loader2, Calendar, SquareCheck as CheckSquare, Plus, FileText, Phone, Mail, MessageSquare, Send } from 'lucide-react';
import type { Block } from '@blocknote/core';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { useBoardStore, type BoardTask } from '../../stores/board-store';
import { BlockEditor } from '../../components/editor/BlockEditor';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { cn } from '../../lib/utils';
import type { Task, Activity, ActivityType, TaskStatus, PriorityLevel } from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubtaskRow extends Task {
  assignee: { display_name: string; avatar_url: string | null } | null;
}

interface ActivityRow extends Activity {
  profiles: { display_name: string } | null;
}

interface MemberOption {
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog',     label: 'Backlog' },
  { value: 'todo',        label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review',   label: 'In Review' },
  { value: 'done',        label: 'Done' },
];

const PRIORITY_OPTIONS: { value: PriorityLevel; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'text-red-600' },
  { value: 'high',   label: 'High',   color: 'text-orange-500' },
  { value: 'medium', label: 'Medium', color: 'text-amber-500' },
  { value: 'low',    label: 'Low',    color: 'text-blue-500' },
];

const PRIORITY_DOT: Record<PriorityLevel, string> = {
  urgent: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-blue-400',
};

const ACTIVITY_ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  note: FileText, call: Phone, email: Mail, meeting: Calendar,
  task_update: MessageSquare, deal_update: MessageSquare, status_change: MessageSquare,
};
const ACTIVITY_COLORS: Record<ActivityType, string> = {
  note: 'bg-gray-100 text-gray-600', call: 'bg-green-100 text-green-600',
  email: 'bg-blue-100 text-blue-600', meeting: 'bg-amber-100 text-amber-600',
  task_update: 'bg-violet-100 text-violet-600', deal_update: 'bg-indigo-100 text-indigo-600',
  status_change: 'bg-slate-100 text-slate-600',
};

// ── TaskDetailPanel ───────────────────────────────────────────────────────────

interface Props {
  taskId: string;
  projectId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, projectId, onClose }: Props) {
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const updateBoardTask = useBoardStore((s) => s.updateTask);

  const [title, setTitle] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Task query ────────────────────────────────────────────────────────────

  const { data: task, isLoading } = useQuery<BoardTask>({
    queryKey: ['task', taskId],
    enabled: !!taskId && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tasks')
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url)')
        .eq('id', taskId).eq('workspace_id', activeWorkspace!.id).single();
      if (error) throw error;
      return data as BoardTask;
    },
  });

  // Sync title from loaded task
  useEffect(() => {
    if (task) {
      setTitle(task.title);
    }
  }, [task?.id]);

  // ── Reporter name ─────────────────────────────────────────────────────────

  const { data: reporter } = useQuery<{ display_name: string } | null>({
    queryKey: ['profile', task?.reporter],
    enabled: !!task?.reporter,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('profiles').select('display_name').eq('id', task!.reporter).maybeSingle();
      return data;
    },
  });

  // ── Subtasks ──────────────────────────────────────────────────────────────

  const { data: subtasks = [] } = useQuery<SubtaskRow[]>({
    queryKey: ['subtasks', taskId],
    enabled: !!taskId && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tasks')
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url)')
        .eq('parent_task_id', taskId)
        .eq('workspace_id', activeWorkspace!.id)
        .order('position');
      if (error) throw error;
      return data as SubtaskRow[];
    },
  });

  // ── Activities ────────────────────────────────────────────────────────────

  const { data: activities = [] } = useQuery<ActivityRow[]>({
    queryKey: ['task-activities', taskId],
    enabled: !!taskId && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .select('*, profiles(display_name)')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('related_task_id', taskId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ActivityRow[];
    },
  });

  // ── Members ───────────────────────────────────────────────────────────────

  const { data: members = [] } = useQuery<MemberOption[]>({
    queryKey: ['workspace-members-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('workspace_members')
        .select('user_id, profiles(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id).eq('status', 'active');
      return data as MemberOption[];
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchTask = useMutation({
    mutationFn: async (updates: Partial<Task>) => {
      const { error } = await (supabase as any)
        .from('tasks').update(updates).eq('id', taskId);
      if (error) throw error;
    },
    onMutate: (updates) => {
      // Optimistic update in board store
      updateBoardTask(taskId, updates);
      // Also update local query cache
      qc.setQueryData<BoardTask>(['task', taskId], (old) => old ? { ...old, ...updates } : old);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-tasks', projectId] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });

  const commitTitle = () => {
    setTitleEditing(false);
    if (title.trim() && title !== task?.title) {
      patchTask.mutate({ title: title.trim() });
    }
  };

  const handleDescriptionChange = useCallback((blocks: Block[]) => {
    if (descSaveTimer.current) clearTimeout(descSaveTimer.current);
    descSaveTimer.current = setTimeout(() => {
      patchTask.mutate({ description_json: blocks as unknown as Task['description_json'] });
    }, 2000);
  }, [patchTask]);

  const addCommentMutation = useMutation({
    mutationFn: async (text: string) => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .insert({
          workspace_id: activeWorkspace!.id,
          type: 'note', subject: text.trim(),
          related_task_id: taskId,
          created_by: user!.id,
        })
        .select('*, profiles(display_name)').single();
      if (error) throw error;
      return data as ActivityRow;
    },
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: ['task-activities', taskId] });
      const prev = qc.getQueryData<ActivityRow[]>(['task-activities', taskId]);
      const opt: ActivityRow = {
        id: `opt-${Date.now()}`, workspace_id: activeWorkspace!.id,
        type: 'note', subject: text, body_text: null,
        related_contact_id: null, related_deal_id: null,
        related_task_id: taskId, related_project_id: null,
        created_by: user!.id, created_at: new Date().toISOString(),
        profiles: null,
      };
      qc.setQueryData<ActivityRow[]>(['task-activities', taskId], (old = []) => [opt, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['task-activities', taskId], ctx?.prev); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task-activities', taskId] }); setComment(''); },
  });

  const addSubtaskMutation = useMutation({
    mutationFn: async (title: string) => {
      const pos = (subtasks.length + 1) * 1000;
      const { data, error } = await (supabase as any)
        .from('tasks')
        .insert({
          workspace_id: activeWorkspace!.id,
          project_id: task!.project_id,
          parent_task_id: taskId,
          title: title.trim(),
          status: 'todo',
          priority: 'medium',
          reporter: user!.id,
          position: pos,
        })
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url)')
        .single();
      if (error) throw error;
      return data as SubtaskRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subtasks', taskId] });
      qc.invalidateQueries({ queryKey: ['project-tasks', projectId] });
      setNewSubtask('');
    },
  });

  const toggleSubtaskMutation = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await (supabase as any)
        .from('tasks').update({
          status: done ? 'done' : 'todo',
          completed_at: done ? new Date().toISOString() : null,
        }).eq('id', id);
      if (error) throw error;
    },
    onMutate: ({ id, done }) => {
      qc.setQueryData<SubtaskRow[]>(['subtasks', taskId], (old = []) =>
        old.map((s) => s.id === id ? { ...s, status: done ? 'done' : 'todo' } : s)
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subtasks', taskId] }),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Task</span>
        </div>
        <Button variant="ghost" size="icon" className="w-7 h-7 text-gray-400" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {isLoading || !task ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-5">

            {/* Title */}
            <div>
              {titleEditing ? (
                <input
                  ref={titleRef}
                  className="w-full text-lg font-bold text-gray-900 bg-transparent border-b-2 border-indigo-400 outline-none pb-0.5"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitle(task.title); setTitleEditing(false); } }}
                  autoFocus
                />
              ) : (
                <button
                  className="w-full text-left text-lg font-bold text-gray-900 hover:text-indigo-700 transition-colors leading-snug"
                  onClick={() => setTitleEditing(true)}
                >
                  {task.title}
                </button>
              )}
            </div>

            {/* Meta fields */}
            <div className="grid grid-cols-2 gap-3">
              {/* Status */}
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Status</p>
                <Select value={task.status}
                  onValueChange={(v) => patchTask.mutate({ status: v as TaskStatus })}>
                  <SelectTrigger className="h-7 text-xs border-gray-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Priority</p>
                <Select value={task.priority}
                  onValueChange={(v) => patchTask.mutate({ priority: v as PriorityLevel })}>
                  <SelectTrigger className="h-7 text-xs border-gray-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <span className="flex items-center gap-1.5">
                          <span className={cn('w-2 h-2 rounded-full', PRIORITY_DOT[p.value])} />
                          {p.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Assigned to */}
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Assigned to</p>
                <Select value={task.assigned_to ?? '__none__'}
                  onValueChange={(v) => patchTask.mutate({ assigned_to: v === '__none__' ? null : v })}>
                  <SelectTrigger className="h-7 text-xs border-gray-200">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profiles?.display_name ?? m.user_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reporter (read-only) */}
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Reporter</p>
                <div className="h-7 flex items-center text-xs text-gray-600 px-2 bg-gray-50 border border-gray-200 rounded-md">
                  {reporter?.display_name ?? '—'}
                </div>
              </div>

              {/* Start date */}
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Start date</p>
                <input
                  type="date"
                  className="h-7 w-full px-2 text-xs border border-gray-200 rounded-md bg-white text-gray-700 focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
                  value={task.start_date ?? ''}
                  onChange={(e) => patchTask.mutate({ start_date: e.target.value || null })}
                />
              </div>

              {/* Due date */}
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Due date</p>
                <input
                  type="date"
                  className={cn(
                    'h-7 w-full px-2 text-xs border rounded-md bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 outline-none',
                    task.due_date && isPast(new Date(task.due_date)) && task.status !== 'done'
                      ? 'border-red-300 text-red-600'
                      : 'border-gray-200 text-gray-700'
                  )}
                  value={task.due_date ?? ''}
                  onChange={(e) => patchTask.mutate({ due_date: e.target.value || null })}
                />
              </div>
            </div>

            <Separator />

            {/* Description */}
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400 font-medium">Description</p>
              <div className="rounded-md border border-gray-100 bg-gray-50 min-h-[80px] [&_.bn-editor]:!px-3 [&_.bn-editor]:!py-2 [&_.bn-container]:!bg-transparent">
                <BlockEditor
                  key={task.id}
                  initialContent={task.description_json as Block[] | null}
                  onChange={handleDescriptionChange}
                />
              </div>
            </div>

            <Separator />

            {/* Subtasks */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                  Subtasks {subtasks.length > 0 && (
                    <span className="text-gray-300 normal-case">
                      ({subtasks.filter((s) => s.status === 'done').length}/{subtasks.length})
                    </span>
                  )}
                </p>
                <Button size="sm" variant="ghost" className="h-6 text-xs text-indigo-600 hover:text-indigo-700 gap-0.5 px-1"
                  onClick={() => setAddingSubtask(true)}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>

              {subtasks.length > 0 && (
                <div className="space-y-1">
                  {subtasks.map((sub) => (
                    <div key={sub.id} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-gray-50 group">
                      <input
                        type="checkbox"
                        checked={sub.status === 'done'}
                        onChange={(e) => toggleSubtaskMutation.mutate({ id: sub.id, done: e.target.checked })}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400 shrink-0"
                      />
                      <span className={cn('text-sm flex-1 leading-tight',
                        sub.status === 'done' ? 'line-through text-gray-300' : 'text-gray-700')}>
                        {sub.title}
                      </span>
                      {sub.assignee && (
                        <div className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden shrink-0"
                          title={sub.assignee.display_name}>
                          {sub.assignee.avatar_url ? (
                            <img src={sub.assignee.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-indigo-700 text-[8px] font-bold">
                              {sub.assignee.display_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {addingSubtask && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    className="flex-1 text-sm border border-indigo-300 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
                    placeholder="Subtask title…"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSubtask.trim()) addSubtaskMutation.mutate(newSubtask);
                      if (e.key === 'Escape') { setAddingSubtask(false); setNewSubtask(''); }
                    }}
                    autoFocus
                  />
                  <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700"
                    disabled={!newSubtask.trim() || addSubtaskMutation.isPending}
                    onClick={() => newSubtask.trim() && addSubtaskMutation.mutate(newSubtask)}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400"
                    onClick={() => { setAddingSubtask(false); setNewSubtask(''); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            {/* Activity feed */}
            <div className="space-y-3">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Activity</p>

              {activities.length > 0 && (
                <div className="space-y-0">
                  {activities.map((act, i) => {
                    const Icon = ACTIVITY_ICON[act.type] ?? FileText;
                    return (
                      <div key={act.id} className="flex gap-2.5">
                        <div className="flex flex-col items-center">
                          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0', ACTIVITY_COLORS[act.type])}>
                            <Icon className="w-3 h-3" />
                          </div>
                          {i < activities.length - 1 && <div className="w-px flex-1 bg-gray-100 my-0.5" />}
                        </div>
                        <div className="pb-3 flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-gray-900 leading-snug">{act.subject}</p>
                            <time className="text-[10px] text-gray-400 whitespace-nowrap shrink-0"
                              title={format(new Date(act.created_at), 'PPpp')}>
                              {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}
                            </time>
                          </div>
                          {act.profiles && (
                            <p className="text-[10px] text-gray-400 mt-0.5">by {act.profiles.display_name}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add comment */}
              <div className="flex items-start gap-2 pt-1">
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-indigo-700 text-[9px] font-bold">
                    {user?.email?.charAt(0).toUpperCase() ?? '?'}
                  </span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    className="flex-1 text-sm border border-gray-200 rounded-full px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 bg-gray-50"
                    placeholder="Add a comment…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) addCommentMutation.mutate(comment); }}
                  />
                  <Button size="icon" className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-700 shrink-0"
                    disabled={!comment.trim() || addCommentMutation.isPending}
                    onClick={() => comment.trim() && addCommentMutation.mutate(comment)}>
                    {addCommentMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Send className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Created */}
            <p className="text-[10px] text-gray-300">
              Created {format(new Date(task.created_at), 'MMM d, yyyy')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
