import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDays, subDays, differenceInDays, startOfDay, format,
  startOfWeek, startOfMonth, isToday,
} from 'date-fns';
import { create } from 'zustand';
import {
  ZoomIn, ZoomOut, Calendar, SquareChartGantt as GanttChartSquare,
  Filter, X, ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { TaskDetailPanel } from '../projects/TaskDetailPanel';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { Task, TaskDependency, PriorityLevel, Project } from '../../lib/database.types';

// ── Constants ─────────────────────────────────────────────────────────────────

type Scale = 'day' | 'week' | 'month';

const COL_WIDTH: Record<Scale, number> = { day: 40, week: 160, month: 120 };
const ROW_HEIGHT = 40;
const ROW_GAP = 4;
const BAR_HEIGHT = 28;
const LEFT_PANEL = 280;
const GROUP_ROW_HEIGHT = 32;

const PRIORITY_BAR: Record<PriorityLevel, string> = {
  urgent: 'bg-red-400 border-red-500',
  high:   'bg-orange-400 border-orange-500',
  medium: 'bg-sky-400 border-sky-500',
  low:    'bg-blue-300 border-blue-400',
};
const PRIORITY_BAR_CONFLICT = 'bg-red-500 border-red-700 ring-2 ring-red-300';

const PROJECT_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e',
];

// ── Drag store ────────────────────────────────────────────────────────────────

interface DragState {
  dragging: boolean;
  taskId: string | null;
  mode: 'move' | 'resize-left' | 'resize-right' | null;
  startX: number;
  deltaX: number;
  setDrag: (s: Partial<DragState>) => void;
  reset: () => void;
}

const useTlDragStore = create<DragState>((set) => ({
  dragging: false, taskId: null, mode: null, startX: 0, deltaX: 0,
  setDrag: (s) => set((prev) => ({ ...prev, ...s })),
  reset: () => set({ dragging: false, taskId: null, mode: null, startX: 0, deltaX: 0 }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

interface TlTask extends Task {
  project: { id: string; name: string } | null;
}

interface DepRow extends TaskDependency {
  blocking_task: TlTask | null;
  blocked_task: TlTask | null;
}

interface ProjectGroup {
  project: { id: string; name: string; color: string };
  tasks: TlTask[];
}

// ── Row descriptor (used for y-coordinate mapping) ────────────────────────────

type RowEntry =
  | { type: 'group'; projectId: string; projectName: string }
  | { type: 'task';  task: TlTask };

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateFromStr(s: string): Date { return startOfDay(new Date(s)); }
function strFromDate(d: Date): string { return format(d, 'yyyy-MM-dd'); }

// ── TimelinePage ──────────────────────────────────────────────────────────────

export function TimelinePage() {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();
  const drag = useTlDragStore();
  const gridRef = useRef<HTMLDivElement>(null);
  const dragMoved = useRef(false);

  const [scale, setScale] = useState<Scale>('day');
  const [viewStart, setViewStart] = useState<Date>(() => subDays(startOfDay(new Date()), 7));
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const colW = COL_WIDTH[scale];
  const TOTAL_COLS = scale === 'day' ? 90 : scale === 'week' ? 26 : 18;

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects', wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('projects').select('*').eq('workspace_id', wsId!).order('name');
      if (error) throw error;
      return data as Project[];
    },
  });

  const { data: tasks = [], isLoading } = useQuery<TlTask[]>({
    queryKey: ['ws-timeline-tasks', wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tasks')
        .select('*, project:projects!tasks_project_id_fkey(id, name)')
        .eq('workspace_id', wsId!)
        .is('parent_task_id', null)
        .order('position');
      if (error) throw error;
      return data as TlTask[];
    },
  });

  const filteredTasks = useMemo(() => {
    if (!filterProjectId) return tasks;
    return tasks.filter((t) => t.project_id === filterProjectId);
  }, [tasks, filterProjectId]);

  const { data: deps = [] } = useQuery<DepRow[]>({
    queryKey: ['ws-timeline-deps', wsId],
    enabled: !!wsId && tasks.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('task_dependencies')
        .select(`
          *,
          blocking_task:tasks!task_dependencies_blocking_task_id_fkey(*, project:projects!tasks_project_id_fkey(id, name)),
          blocked_task:tasks!task_dependencies_blocked_task_id_fkey(*, project:projects!tasks_project_id_fkey(id, name))
        `)
        .eq('workspace_id', wsId!);
      if (error) throw error;
      return (data ?? []) as DepRow[];
    },
  });

  // ── Group tasks by project ──────────────────────────────────────────────────

  const projectColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const uniqueIds = [...new Set(tasks.map((t) => t.project_id))];
    uniqueIds.forEach((pid, i) => {
      map.set(pid, PROJECT_COLORS[i % PROJECT_COLORS.length]);
    });
    return map;
  }, [tasks]);

  const groups: ProjectGroup[] = useMemo(() => {
    const map = new Map<string, TlTask[]>();
    for (const t of filteredTasks) {
      const pid = t.project_id;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(t);
    }
    return Array.from(map.entries()).map(([pid, tasks]) => ({
      project: {
        id: pid,
        name: tasks[0]?.project?.name ?? 'Unknown',
        color: projectColorMap.get(pid) ?? '#6b7280',
      },
      tasks,
    }));
  }, [filteredTasks, projectColorMap]);

  // ── Build flat row list (for y-coord mapping) ──────────────────────────────

  const rows: RowEntry[] = useMemo(() => {
    const list: RowEntry[] = [];
    for (const g of groups) {
      list.push({ type: 'group', projectId: g.project.id, projectName: g.project.name });
      if (!collapsedProjects.has(g.project.id)) {
        for (const t of g.tasks) {
          list.push({ type: 'task', task: t });
        }
      }
    }
    return list;
  }, [groups, collapsedProjects]);

  // Build a taskId → row-index map for connector lines
  const taskRowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.type === 'task') map.set(r.task.id, i);
    });
    return map;
  }, [rows]);

  // ── Date patch mutation ─────────────────────────────────────────────────────

  const patchDates = useMutation({
    mutationFn: async ({ taskId, start_date, due_date }: { taskId: string; start_date: string | null; due_date: string | null }) => {
      const { error } = await (supabase as any)
        .from('tasks')
        .update({ start_date, due_date, updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (error) throw error;
    },
    onMutate: ({ taskId, start_date, due_date }) => {
      qc.setQueryData<TlTask[]>(['ws-timeline-tasks', wsId], (old = []) =>
        old.map((t) => t.id === taskId ? { ...t, start_date, due_date } : t)
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ws-timeline-tasks', wsId] });
    },
  });

  // ── Day columns for current view ────────────────────────────────────────────

  const dayColumns = useMemo(() => {
    if (scale === 'day') return Array.from({ length: TOTAL_COLS }, (_, i) => addDays(viewStart, i));
    if (scale === 'week') {
      const start = startOfWeek(viewStart, { weekStartsOn: 1 });
      return Array.from({ length: TOTAL_COLS }, (_, i) => addDays(start, i * 7));
    }
    const start = startOfMonth(viewStart);
    return Array.from({ length: TOTAL_COLS }, (_, i) => startOfMonth(addDays(start, i * 32)));
  }, [viewStart, scale, TOTAL_COLS]);

  // ── Coordinate helpers ──────────────────────────────────────────────────────

  const dateToX = useCallback((date: Date): number => {
    const diffDays = differenceInDays(startOfDay(date), startOfDay(viewStart));
    return scale === 'day' ? diffDays * colW :
           scale === 'week' ? (diffDays / 7) * colW :
           (diffDays / 30) * colW;
  }, [viewStart, scale, colW]);

  const pxToDays = useCallback((px: number): number => {
    return scale === 'day' ? px / colW :
           scale === 'week' ? (px / colW) * 7 :
           (px / colW) * 30;
  }, [scale, colW]);

  // ── Row y-coordinate helper ─────────────────────────────────────────────────

  const rowY = useCallback((rowIdx: number): number => {
    let y = 0;
    for (let i = 0; i < rowIdx; i++) {
      y += rows[i].type === 'group' ? GROUP_ROW_HEIGHT : (ROW_HEIGHT + ROW_GAP);
    }
    return y;
  }, [rows]);

  const rowHeight = useCallback((rowIdx: number): number => {
    return rows[rowIdx]?.type === 'group' ? GROUP_ROW_HEIGHT : ROW_HEIGHT;
  }, [rows]);

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const onMouseDown = useCallback((
    e: React.MouseEvent,
    taskId: string,
    mode: 'move' | 'resize-left' | 'resize-right',
  ) => {
    e.preventDefault();
    dragMoved.current = false;
    drag.setDrag({ dragging: true, taskId, mode, startX: e.clientX, deltaX: 0 });
  }, [drag]);

  useEffect(() => {
    if (!drag.dragging) return;

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) > 3) dragMoved.current = true;
      drag.setDrag({ deltaX: dx });
    };

    const onUp = () => {
      if (!drag.taskId || !drag.dragging) { drag.reset(); return; }

      // If user didn't actually drag, treat as a click → open task detail
      if (!dragMoved.current) {
        setSelectedTaskId(drag.taskId);
        drag.reset();
        return;
      }

      const deltaDays = Math.round(pxToDays(drag.deltaX));
      if (deltaDays === 0) { drag.reset(); return; }
      const task = tasks.find((t) => t.id === drag.taskId);
      if (!task) { drag.reset(); return; }

      let newStart = task.start_date ? strFromDate(addDays(dateFromStr(task.start_date), deltaDays)) : null;
      let newEnd = task.due_date ? strFromDate(addDays(dateFromStr(task.due_date), deltaDays)) : null;

      if (drag.mode === 'resize-left') {
        newStart = task.start_date ? strFromDate(addDays(dateFromStr(task.start_date), deltaDays)) : null;
        newEnd = task.due_date;
      } else if (drag.mode === 'resize-right') {
        newStart = task.start_date;
        newEnd = task.due_date ? strFromDate(addDays(dateFromStr(task.due_date), deltaDays)) : null;
      }

      if (newStart && newEnd && newStart > newEnd) { drag.reset(); return; }

      patchDates.mutate({ taskId: drag.taskId, start_date: newStart, due_date: newEnd });
      drag.reset();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag.dragging, drag.taskId, drag.mode, drag.startX, drag.deltaX, pxToDays, tasks, patchDates]);

  // ── Conflict detection ──────────────────────────────────────────────────────

  const conflictTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const dep of deps) {
      if (!dep.blocking_task?.due_date || !dep.blocked_task?.start_date) continue;
      if (dep.blocking_task.due_date > dep.blocked_task.start_date) {
        set.add(dep.blocked_task.id);
      }
    }
    return set;
  }, [deps]);

  // ── Today X ─────────────────────────────────────────────────────────────────

  const todayX = dateToX(new Date());

  // ── Month headers (day scale) ───────────────────────────────────────────────

  const monthHeaders = useMemo(() => {
    if (scale !== 'day') return [];
    const months: { label: string; x: number; width: number }[] = [];
    let cur: string | null = null;
    let startX = 0;
    for (let i = 0; i < TOTAL_COLS; i++) {
      const d = addDays(viewStart, i);
      const m = format(d, 'MMM yyyy');
      if (m !== cur) {
        if (cur !== null) months.push({ label: cur, x: startX, width: i * colW - startX });
        cur = m;
        startX = i * colW;
      }
    }
    if (cur) months.push({ label: cur, x: startX, width: TOTAL_COLS * colW - startX });
    return months;
  }, [viewStart, scale, TOTAL_COLS, colW]);

  // ── Connector lines (cross-project deps) ───────────────────────────────────

  const connectors = useMemo(() => {
    return deps
      .filter((d) => d.blocking_task?.due_date && d.blocked_task?.start_date)
      .map((d) => {
        const fromRowIdx = taskRowIndex.get(d.blocking_task_id);
        const toRowIdx = taskRowIndex.get(d.blocked_task_id);
        if (fromRowIdx === undefined || toRowIdx === undefined) return null;

        const fromTask = d.blocking_task!;
        const toTask = d.blocked_task!;

        // Apply live drag offset
        const getDraggedDate = (t: TlTask, isEnd: boolean) => {
          if (drag.dragging && drag.taskId === t.id && drag.deltaX !== 0) {
            const delta = Math.round(pxToDays(drag.deltaX));
            const base = isEnd ? t.due_date : t.start_date;
            if (!base) return null;
            if (drag.mode === 'move') return strFromDate(addDays(dateFromStr(base), delta));
            if (drag.mode === 'resize-right' && isEnd) return strFromDate(addDays(dateFromStr(base), delta));
            if (drag.mode === 'resize-left' && !isEnd) return strFromDate(addDays(dateFromStr(base), delta));
            return base;
          }
          return isEnd ? t.due_date : t.start_date;
        };

        const fromDate = getDraggedDate(fromTask, true);
        const toDate = getDraggedDate(toTask, false);
        if (!fromDate || !toDate) return null;

        const x1 = dateToX(dateFromStr(fromDate)) + colW;
        const y1 = rowY(fromRowIdx) + rowHeight(fromRowIdx) / 2;
        const x2 = dateToX(dateFromStr(toDate));
        const y2 = rowY(toRowIdx) + rowHeight(toRowIdx) / 2;

        return { id: d.id, x1, y1, x2, y2 };
      })
      .filter(Boolean) as { id: string; x1: number; y1: number; x2: number; y2: number }[];
  }, [deps, taskRowIndex, dateToX, colW, rowY, rowHeight, drag.dragging, drag.taskId, drag.deltaX, drag.mode, pxToDays]);

  // ── Bar position (with live drag) ───────────────────────────────────────────

  const getBarDates = useCallback((task: TlTask) => {
    let startDate = task.start_date;
    let endDate = task.due_date;
    if (drag.dragging && drag.taskId === task.id && drag.deltaX !== 0) {
      const delta = Math.round(pxToDays(drag.deltaX));
      if (drag.mode === 'move') {
        startDate = startDate ? strFromDate(addDays(dateFromStr(startDate), delta)) : null;
        endDate = endDate ? strFromDate(addDays(dateFromStr(endDate), delta)) : null;
      } else if (drag.mode === 'resize-left') {
        startDate = startDate ? strFromDate(addDays(dateFromStr(startDate), delta)) : null;
      } else if (drag.mode === 'resize-right') {
        endDate = endDate ? strFromDate(addDays(dateFromStr(endDate), delta)) : null;
      }
    }
    return { startDate, endDate };
  }, [drag, pxToDays]);

  // ── Tooltip ─────────────────────────────────────────────────────────────────

  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // ── Collapse toggle ─────────────────────────────────────────────────────────

  const toggleCollapse = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  // ── Dimensions ──────────────────────────────────────────────────────────────

  const totalGridWidth = TOTAL_COLS * colW;
  const totalGridHeight = useMemo(() => {
    let h = 0;
    for (const r of rows) {
      h += r.type === 'group' ? GROUP_ROW_HEIGHT : (ROW_HEIGHT + ROW_GAP);
    }
    return h + 8;
  }, [rows]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
          <GanttChartSquare className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-semibold text-gray-900">Timeline</h1>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <Calendar className="w-8 h-8 text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No tasks in this workspace yet</p>
          <p className="text-xs text-gray-300 mt-1">Create tasks with dates inside a project to see them here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        <GanttChartSquare className="w-5 h-5 text-indigo-600 mr-1" />
        <h1 className="text-lg font-semibold text-gray-900 mr-4">Timeline</h1>

        <span className="text-xs text-gray-500 font-medium mr-2">Scale</span>
        {(['day', 'week', 'month'] as Scale[]).map((s) => (
          <Button key={s} size="sm" variant={scale === s ? 'default' : 'outline'}
            className={cn('h-7 text-xs capitalize', scale === s && 'bg-sky-600 hover:bg-sky-700')}
            onClick={() => setScale(s)}>
            {s}
          </Button>
        ))}

        <div className="flex-1" />

        {/* Project filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select
            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={filterProjectId ?? ''}
            onChange={(e) => setFilterProjectId(e.target.value || null)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {filterProjectId && (
            <button className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              onClick={() => setFilterProjectId(null)}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <Button size="sm" variant="outline" className="h-7 w-7 p-0"
          onClick={() => setViewStart((v) => subDays(v, scale === 'day' ? 14 : scale === 'week' ? 30 : 60))}>
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
          onClick={() => setViewStart(subDays(startOfDay(new Date()), 7))}>
          Today
        </Button>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0"
          onClick={() => setViewStart((v) => addDays(v, scale === 'day' ? 14 : scale === 'week' ? 30 : 60))}>
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Main layout */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Gantt area (shrinks when detail panel opens) */}
        <div className={cn(
          'flex flex-1 overflow-hidden transition-all duration-300 ease-in-out',
          selectedTaskId ? 'mr-[480px]' : 'mr-0'
        )}>
        {/* Left panel: project groups + task names */}
        <div
          className="shrink-0 border-r border-gray-200 bg-white overflow-y-auto overflow-x-hidden"
          style={{ width: LEFT_PANEL }}
        >
          {/* Header spacer */}
          <div className="h-[48px] border-b border-gray-200 bg-gray-50 px-3 flex items-end pb-1">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Project / Task</span>
          </div>

          {/* Rows */}
          <div style={{ paddingTop: 4 }}>
            {rows.map((row) => {
              if (row.type === 'group') {
                const isCollapsed = collapsedProjects.has(row.projectId);
                const color = projectColorMap.get(row.projectId) ?? '#6b7280';
                return (
                  <div
                    key={`g-${row.projectId}`}
                    className="flex items-center gap-2 px-2 hover:bg-gray-50 select-none group/row"
                    style={{ height: GROUP_ROW_HEIGHT }}
                  >
                    <button
                      className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                      onClick={() => toggleCollapse(row.projectId)}
                    >
                      {isCollapsed
                        ? <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      }
                      <span
                        className="w-2.5 h-2.5 rounded shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-semibold text-gray-700 truncate">{row.projectName}</span>
                    </button>
                    <button
                      className="p-1 rounded opacity-0 group-hover/row:opacity-100 hover:bg-indigo-100 text-gray-400 hover:text-indigo-600 transition-all shrink-0"
                      title="Open project"
                      onClick={() => navigate(`/projects/${row.projectId}`)}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={row.task.id}
                  className="flex items-center gap-2 px-3 pl-8 cursor-pointer hover:bg-indigo-50/50 transition-colors"
                  style={{ height: ROW_HEIGHT, marginBottom: ROW_GAP }}
                  onClick={() => setSelectedTaskId(row.task.id)}
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', {
                    'bg-red-500': row.task.priority === 'urgent',
                    'bg-orange-500': row.task.priority === 'high',
                    'bg-sky-400': row.task.priority === 'medium',
                    'bg-blue-300': row.task.priority === 'low',
                  })} />
                  <span className="text-xs text-gray-700 truncate hover:text-indigo-700 transition-colors">{row.task.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: scrollable grid */}
        <div className="flex-1 overflow-auto" ref={gridRef}>
          <div style={{ width: totalGridWidth, minWidth: totalGridWidth }}>
            {/* Date header */}
            <div className="sticky top-0 z-20 bg-white border-b border-gray-200" style={{ height: 48 }}>
              {scale === 'day' && (
                <div className="absolute top-0 left-0 right-0 h-5 flex">
                  {monthHeaders.map((m) => (
                    <div
                      key={m.label}
                      className="absolute top-0 h-5 px-2 text-[10px] font-semibold text-gray-500 flex items-center border-r border-gray-100"
                      style={{ left: m.x, width: m.width }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 h-6 flex">
                {dayColumns.map((d, i) => {
                  const label = scale === 'day' ? format(d, 'd') :
                                scale === 'week' ? `W${format(d, 'w')}` :
                                format(d, 'MMM');
                  const isT = scale === 'day' && isToday(d);
                  return (
                    <div
                      key={i}
                      className={cn(
                        'shrink-0 flex items-center justify-center text-[10px] border-r border-gray-100',
                        isT ? 'text-red-500 font-bold' : 'text-gray-400',
                      )}
                      style={{ width: colW }}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Grid body */}
            <div
              className="relative"
              style={{ height: totalGridHeight, paddingTop: 4 }}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Column lines */}
              {dayColumns.map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-r border-gray-100"
                  style={{ left: i * colW, width: colW }}
                />
              ))}

              {/* Row backgrounds */}
              {rows.map((row, i) => {
                const y = rowY(i);
                const h = row.type === 'group' ? GROUP_ROW_HEIGHT : ROW_HEIGHT;
                return (
                  <div
                    key={i}
                    className={cn(
                      'absolute left-0 right-0',
                      row.type === 'group' ? 'bg-gray-100/60' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'),
                    )}
                    style={{ top: y, height: h }}
                  />
                );
              })}

              {/* Today line */}
              {todayX >= 0 && todayX <= totalGridWidth && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{ left: todayX }}
                >
                  <div className="w-px h-full border-l-2 border-dashed border-red-400 opacity-70" />
                </div>
              )}

              {/* Dependency connectors */}
              <svg
                className="absolute inset-0 pointer-events-none z-10"
                style={{ width: totalGridWidth, height: totalGridHeight }}
                overflow="visible"
              >
                {connectors.map((c) => {
                  const midX = (c.x1 + c.x2) / 2;
                  const path = c.x2 > c.x1
                    ? `M ${c.x1} ${c.y1} H ${midX} V ${c.y2} H ${c.x2}`
                    : `M ${c.x1} ${c.y1} H ${c.x1 + 16} V ${c.y2 + 20} H ${c.x2 - 16} V ${c.y2} H ${c.x2}`;
                  return (
                    <g key={c.id}>
                      <path d={path} fill="none" stroke="#9ca3af" strokeWidth={1.5} strokeLinecap="round" />
                      <polygon
                        points={`${c.x2},${c.y2} ${c.x2 - 6},${c.y2 - 4} ${c.x2 - 6},${c.y2 + 4}`}
                        fill="#9ca3af"
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Task bars */}
              {rows.map((row, rowIdx) => {
                if (row.type === 'group') return null;
                const task = row.task;
                const { startDate, endDate } = getBarDates(task);
                const y = rowY(rowIdx);
                const top = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                const hasConflict = conflictTaskIds.has(task.id);
                const projectColor = projectColorMap.get(task.project_id) ?? '#6b7280';

                if (!startDate && !endDate) {
                  return (
                    <div
                      key={task.id}
                      className="absolute z-10 pointer-events-none"
                      style={{ left: todayX - 8, top: top + BAR_HEIGHT / 2 - 8 }}
                    >
                      <div
                        className={cn('w-4 h-4 rotate-45 border-2', PRIORITY_BAR[task.priority])}
                        title={task.title}
                      />
                    </div>
                  );
                }

                if (!startDate || !endDate) {
                  const x = startDate ? dateToX(dateFromStr(startDate)) : endDate ? dateToX(dateFromStr(endDate)) : todayX;
                  return (
                    <div
                      key={task.id}
                      className={cn('absolute rounded h-2 z-10', PRIORITY_BAR[task.priority])}
                      style={{ left: x, top: top + BAR_HEIGHT / 2 - 4, width: colW }}
                      title={task.title}
                    />
                  );
                }

                const x = dateToX(dateFromStr(startDate));
                const width = Math.max(colW, dateToX(dateFromStr(endDate)) - x + colW);

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'absolute rounded z-10 border flex items-center overflow-hidden',
                      'transition-shadow hover:shadow-md cursor-grab active:cursor-grabbing',
                      hasConflict ? PRIORITY_BAR_CONFLICT : PRIORITY_BAR[task.priority],
                    )}
                    style={{
                      left: x, top, width, height: BAR_HEIGHT,
                      borderLeftColor: projectColor,
                      borderLeftWidth: 3,
                    }}
                    title={hasConflict ? 'Dependency conflict: starts before blocker ends' : task.title}
                    onMouseDown={(e) => {
                      if ((e.target as HTMLElement).dataset.handle) return;
                      onMouseDown(e, task.id, 'move');
                    }}
                    onMouseEnter={(e) => {
                      if (hasConflict) {
                        const conflictDep = deps.find(
                          (d) => d.blocked_task_id === task.id &&
                            d.blocking_task?.due_date && d.blocked_task?.start_date &&
                            d.blocking_task.due_date > d.blocked_task.start_date
                        );
                        if (conflictDep) {
                          setTooltip({
                            text: `Overlaps with: ${conflictDep.blocking_task?.title ?? '?'}`,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {/* Left resize handle */}
                    <div
                      data-handle="left"
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-l z-20"
                      onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, task.id, 'resize-left'); }}
                    />
                    <span className="px-2 text-[11px] font-medium text-white truncate pointer-events-none select-none drop-shadow-sm flex-1">
                      {task.title}
                    </span>
                    {/* Right resize handle */}
                    <div
                      data-handle="right"
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-r z-20"
                      onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, task.id, 'resize-right'); }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </div>

        {/* Detail Panel — slides in from right */}
        <div className={cn(
          'absolute right-0 top-0 bottom-0 w-[480px] bg-white border-l border-gray-200 shadow-xl z-20 overflow-hidden flex flex-col',
          'transition-transform duration-300 ease-in-out',
          selectedTaskId ? 'translate-x-0' : 'translate-x-full'
        )}>
          {selectedTaskId && (() => {
            const task = tasks.find((t) => t.id === selectedTaskId);
            if (!task) return null;
            return (
              <TaskDetailPanel
                taskId={selectedTaskId}
                projectId={task.project_id}
                onClose={() => setSelectedTaskId(null)}
              />
            );
          })()}
        </div>
      </div>

      {/* Conflict tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg max-w-56"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
