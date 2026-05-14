import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  isBefore, isWithinInterval, startOfDay, endOfDay,
  endOfWeek, startOfMonth, endOfMonth, format, differenceInDays,
} from 'date-fns';
import { SquareCheck as CheckSquare, Square, ChevronDown, ChevronRight, Plus, Search, Loader as Loader2, TriangleAlert as AlertTriangle, Calendar, FolderKanban, SlidersHorizontal, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { TaskDetailPanel } from '../projects/TaskDetailPanel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import type { Task, TaskStatus, PriorityLevel } from '../../lib/database.types';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const ALL_PRIORITIES: PriorityLevel[] = ['urgent', 'high', 'medium', 'low'];

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  in_review: 'In Review', done: 'Done',
};
const STATUS_CLASS: Record<TaskStatus, string> = {
  backlog:     'bg-gray-100 text-gray-600 border-gray-200',
  todo:        'bg-blue-50 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  in_review:   'bg-sky-50 text-sky-700 border-sky-200',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const PRIORITY_DOT: Record<PriorityLevel, string> = {
  urgent: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-blue-400',
};
const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};
const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface MyTask extends Task {
  project: { id: string; name: string } | null;
}

interface ProjectOption { id: string; name: string }

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onToggleDone,
  onOpenDetail,
}: {
  task: MyTask;
  onToggleDone: (task: MyTask) => void;
  onOpenDetail: (task: MyTask) => void;
}) {
  const today = startOfDay(new Date());
  const isDone = task.status === 'done';
  const due = task.due_date ? startOfDay(new Date(task.due_date)) : null;
  const isOverdue = due && !isDone && isBefore(due, today);
  const isDueSoon = due && !isDone && !isOverdue &&
    differenceInDays(due, today) <= 3;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group',
      isDone && 'opacity-60',
    )}>
      {/* Checkbox */}
      <button
        className="shrink-0 text-gray-400 hover:text-emerald-600 transition-colors"
        onClick={() => onToggleDone(task)}
      >
        {isDone
          ? <CheckSquare className="w-4 h-4 text-emerald-600" />
          : <Square className="w-4 h-4" />}
      </button>

      {/* Title */}
      <button
        className={cn(
          'flex-1 text-left text-sm font-medium text-gray-800 truncate',
          'hover:text-blue-700 transition-colors group-hover:underline',
          isDone && 'line-through text-gray-400',
        )}
        onClick={() => onOpenDetail(task)}
      >
        {task.title}
      </button>

      {/* Priority badge */}
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        <span className={cn('w-2 h-2 rounded-full', PRIORITY_DOT[task.priority])} />
        <span className="text-xs text-gray-500">{PRIORITY_LABEL[task.priority]}</span>
      </div>

      {/* Due date */}
      {due ? (
        <div className={cn(
          'hidden sm:flex items-center gap-1 text-xs shrink-0',
          isOverdue ? 'text-red-600 font-semibold' : isDueSoon ? 'text-amber-600 font-medium' : 'text-gray-400',
        )}>
          <Calendar className="w-3 h-3" />
          {format(due, 'MMM d')}
          {isOverdue && <AlertTriangle className="w-3 h-3 ml-0.5" />}
        </div>
      ) : (
        <div className="hidden sm:block w-16 shrink-0" />
      )}

      {/* Status badge */}
      <Badge
        variant="outline"
        className={cn('text-xs shrink-0 hidden md:inline-flex', STATUS_CLASS[task.status])}
      >
        {STATUS_LABEL[task.status]}
      </Badge>

      {/* Project badge */}
      {task.project && (
        <div className="hidden lg:flex items-center gap-1 shrink-0 max-w-[140px]">
          <FolderKanban className="w-3 h-3 text-gray-400 shrink-0" />
          <span className="text-xs text-gray-400 truncate">{task.project.name}</span>
        </div>
      )}
    </div>
  );
}

// ── TasksPage ─────────────────────────────────────────────────────────────────

export function TasksPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  // Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<PriorityLevel | 'all'>('all');
  const [dueDateFilter, setDueDateFilter] = useState<'all' | 'overdue' | 'this_week' | 'today'>('all');

  // Collapse state per project group
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Task detail panel
  const [detailTask, setDetailTask] = useState<MyTask | null>(null);

  // Add task dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    project_id: '',
    title: '',
    priority: 'medium' as PriorityLevel,
    status: 'todo' as TaskStatus,
    due_date: '',
  });

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: tasks = [], isLoading } = useQuery<MyTask[]>({
    queryKey: ['my-tasks', activeWorkspace?.id, user?.id],
    enabled: !!activeWorkspace?.id && !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tasks')
        .select('*, project:projects(id, name)')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('assigned_to', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as MyTask[];
    },
  });

  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ['projects-options', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('projects')
        .select('id, name')
        .eq('workspace_id', activeWorkspace!.id)
        .neq('status', 'archived')
        .order('name');
      return (data ?? []) as ProjectOption[];
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const toggleDoneMutation = useMutation({
    mutationFn: async ({ taskId, newStatus }: { taskId: string; newStatus: TaskStatus }) => {
      const { error } = await (supabase as any)
        .from('tasks')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (error) throw error;
    },
    onMutate: async ({ taskId, newStatus }) => {
      await qc.cancelQueries({ queryKey: ['my-tasks', activeWorkspace?.id, user?.id] });
      const prev = qc.getQueryData<MyTask[]>(['my-tasks', activeWorkspace?.id, user?.id]);
      qc.setQueryData<MyTask[]>(['my-tasks', activeWorkspace?.id, user?.id], (old = []) =>
        old.map((t) => t.id === taskId ? { ...t, status: newStatus } : t)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['my-tasks', activeWorkspace?.id, user?.id], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-tasks', activeWorkspace?.id, user?.id] });
    },
  });

  const addTaskMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from('tasks')
        .insert({
          workspace_id: activeWorkspace!.id,
          project_id: addForm.project_id,
          title: addForm.title.trim(),
          priority: addForm.priority,
          status: addForm.status,
          due_date: addForm.due_date || null,
          assigned_to: user!.id,
          reporter: user!.id,
          position: 0,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-tasks', activeWorkspace?.id, user?.id] });
      setAddOpen(false);
      setAddForm({ project_id: '', title: '', priority: 'medium', status: 'todo', due_date: '' });
    },
  });

  // ── Derived stats ────────────────────────────────────────────────────────────

  const today = startOfDay(new Date());
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const stats = useMemo(() => {
    const total = tasks.length;
    const overdue = tasks.filter((t) =>
      t.due_date && t.status !== 'done' && isBefore(startOfDay(new Date(t.due_date)), today)
    ).length;
    const thisWeek = tasks.filter((t) =>
      t.due_date && t.status !== 'done' &&
      isWithinInterval(startOfDay(new Date(t.due_date)), { start: today, end: weekEnd })
    ).length;
    const completedMonth = tasks.filter((t) =>
      t.status === 'done' && t.updated_at &&
      isWithinInterval(new Date(t.updated_at), { start: monthStart, end: monthEnd })
    ).length;
    return { total, overdue, thisWeek, completedMonth };
  }, [tasks]);

  // ── Filtered & grouped tasks ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(t.status)) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (dueDateFilter !== 'all') {
        const due = t.due_date ? startOfDay(new Date(t.due_date)) : null;
        if (dueDateFilter === 'overdue') {
          if (!due || !isBefore(due, today) || t.status === 'done') return false;
        } else if (dueDateFilter === 'today') {
          if (!due || !isWithinInterval(due, { start: startOfDay(today), end: endOfDay(today) })) return false;
        } else if (dueDateFilter === 'this_week') {
          if (!due || !isWithinInterval(due, { start: today, end: weekEnd })) return false;
        }
      }
      return true;
    });
  }, [tasks, search, statusFilter, priorityFilter, dueDateFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, { projectName: string; tasks: MyTask[] }>();
    for (const t of filtered) {
      const key = t.project_id;
      const name = t.project?.name ?? 'No Project';
      if (!map.has(key)) map.set(key, { projectName: name, tasks: [] });
      map.get(key)!.tasks.push(t);
    }
    // Sort tasks within each group: priority asc, then due_date asc (nulls last)
    for (const group of map.values()) {
      group.tasks.sort((a, b) => {
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pd !== 0) return pd;
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });
    }
    // Sort groups by name
    return Array.from(map.entries()).sort((a, b) =>
      a[1].projectName.localeCompare(b[1].projectName)
    );
  }, [filtered]);

  const toggleCollapse = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const handleToggleDone = (task: MyTask) => {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    toggleDoneMutation.mutate({ taskId: task.id, newStatus });
  };

  const hasFilters = statusFilter.length > 0 || priorityFilter !== 'all' || dueDateFilter !== 'all' || search;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <CheckSquare className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">My Tasks</h1>
              <p className="text-xs text-gray-400">All tasks assigned to you</p>
            </div>
          </div>
          <Button
            size="sm"
            className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white h-8"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Add Task
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Assigned" value={stats.total} />
          <StatCard label="Overdue" value={stats.overdue} valueClass="text-red-600" />
          <StatCard label="Due This Week" value={stats.thisWeek} valueClass="text-amber-600" />
          <StatCard label="Completed This Month" value={stats.completedMonth} valueClass="text-emerald-600" />
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-gray-100 bg-white shrink-0 flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <Input
            className="pl-8 h-8 text-sm w-52"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status multi-select */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Status
              {statusFilter.length > 0 && (
                <span className="bg-blue-600 text-white rounded-full text-[10px] w-4 h-4 flex items-center justify-center">
                  {statusFilter.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {ALL_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statusFilter.includes(s)}
                onCheckedChange={(checked) =>
                  setStatusFilter((prev) =>
                    checked ? [...prev, s] : prev.filter((x) => x !== s)
                  )
                }
              >
                {STATUS_LABEL[s]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority */}
        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}>
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {ALL_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Due date range */}
        <Select value={dueDateFilter} onValueChange={(v) => setDueDateFilter(v as typeof dueDateFilter)}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Due date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any due date</SelectItem>
            <SelectItem value="today">Due today</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="this_week">This week</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-gray-500 gap-1"
            onClick={() => {
              setSearch('');
              setStatusFilter([]);
              setPriorityFilter('all');
              setDueDateFilter('all');
            }}
          >
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mb-3">
              <CheckSquare className="w-6 h-6 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">
              {hasFilters ? 'No tasks match your filters' : 'No tasks assigned to you'}
            </p>
            {!hasFilters && (
              <p className="text-xs text-gray-400 mt-1">Use Add Task to create one</p>
            )}
          </div>
        ) : (
          <div className="pb-8">
            {grouped.map(([projectId, { projectName, tasks: groupTasks }]) => {
              const isCollapsed = collapsed[projectId] ?? false;
              const overdueCount = groupTasks.filter(
                (t) => t.due_date && t.status !== 'done' && isBefore(startOfDay(new Date(t.due_date)), today)
              ).length;

              return (
                <div key={projectId} className="border-b border-gray-100 last:border-0">
                  {/* Group header */}
                  <button
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left sticky top-0 z-10"
                    onClick={() => toggleCollapse(projectId)}
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                    <FolderKanban className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      {projectName}
                    </span>
                    <span className="text-xs text-gray-400 ml-1">
                      {groupTasks.length} task{groupTasks.length !== 1 ? 's' : ''}
                    </span>
                    {overdueCount > 0 && (
                      <span className="ml-1 text-xs text-red-600 font-semibold flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3" /> {overdueCount} overdue
                      </span>
                    )}
                  </button>

                  {/* Tasks */}
                  {!isCollapsed && (
                    <div className="divide-y divide-gray-50">
                      {groupTasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onToggleDone={handleToggleDone}
                          onOpenDetail={setDetailTask}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task detail panel */}
      {detailTask && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="flex-1 bg-black/20"
            onClick={() => setDetailTask(null)}
          />
          <div className="w-full max-w-xl bg-white shadow-2xl overflow-auto">
            <TaskDetailPanel
              taskId={detailTask.id}
              projectId={detailTask.project_id}
              onClose={() => {
                setDetailTask(null);
                qc.invalidateQueries({ queryKey: ['my-tasks', activeWorkspace?.id, user?.id] });
              }}
            />
          </div>
        </div>
      )}

      {/* Add Task Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Project <span className="text-red-500">*</span></Label>
              <Select
                value={addForm.project_id}
                onValueChange={(v) => setAddForm((f) => ({ ...f, project_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Task title…"
                value={addForm.title}
                onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={addForm.priority}
                  onValueChange={(v) => setAddForm((f) => ({ ...f, priority: v as PriorityLevel }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={addForm.status}
                  onValueChange={(v) => setAddForm((f) => ({ ...f, status: v as TaskStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Due date <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input
                type="date"
                value={addForm.due_date}
                onChange={(e) => setAddForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!addForm.project_id || !addForm.title.trim() || addTaskMutation.isPending}
              onClick={() => addTaskMutation.mutate()}
            >
              {addTaskMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: number;
  valueClass?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={cn('text-2xl font-bold text-gray-900', valueClass)}>{value}</p>
    </div>
  );
}
