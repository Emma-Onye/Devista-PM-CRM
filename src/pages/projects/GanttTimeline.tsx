import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDays, subDays, differenceInDays, startOfDay, format,
  startOfWeek, startOfMonth, isToday,
} from 'date-fns';
import { create } from 'zustand';
import { ZoomIn, ZoomOut, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { Task, TaskDependency, PriorityLevel } from '../../lib/database.types';

// ── Constants ─────────────────────────────────────────────────────────────────

type Scale = 'day' | 'week' | 'month';

const COL_WIDTH: Record<Scale, number> = { day: 40, week: 160, month: 120 };
const ROW_HEIGHT = 40;
const ROW_GAP = 4;
const BAR_HEIGHT = 32;
const LEFT_PANEL = 240;

const PRIORITY_BAR: Record<PriorityLevel, string> = {
  urgent: 'bg-red-400 border-red-500',
  high:   'bg-orange-400 border-orange-500',
  medium: 'bg-sky-400 border-sky-500',
  low:    'bg-blue-300 border-blue-400',
};
const PRIORITY_BAR_CONFLICT = 'bg-red-500 border-red-700 ring-2 ring-red-300';

// ── Drag store (Zustand) ──────────────────────────────────────────────────────

interface DragState {
  dragging: boolean;
  taskId: string | null;
  mode: 'move' | 'resize-left' | 'resize-right' | null;
  startX: number;
  startDate: string | null;
  endDate: string | null;
  deltaX: number;
  setDrag: (s: Partial<DragState>) => void;
  reset: () => void;
}

const useDragStore = create<DragState>((set) => ({
  dragging: false,
  taskId: null,
  mode: null,
  startX: 0,
  startDate: null,
  endDate: null,
  deltaX: 0,
  setDrag: (s) => set((prev) => ({ ...prev, ...s })),
  reset: () => set({
    dragging: false, taskId: null, mode: null,
    startX: 0, startDate: null, endDate: null, deltaX: 0,
  }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

interface GanttTask extends Task {
  project?: { name: string } | null;
}

interface DepRow extends TaskDependency {
  blocking_task: GanttTask | null;
  blocked_task: GanttTask | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateFromStr(s: string): Date { return startOfDay(new Date(s)); }
function strFromDate(d: Date): string { return format(d, 'yyyy-MM-dd'); }

function getDayColumns(viewStart: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(viewStart, i));
}

// ── GanttTimeline ─────────────────────────────────────────────────────────────

export function GanttTimeline({ projectId }: { projectId: string }) {
  const { activeWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();
  const drag = useDragStore();
  const gridRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState<Scale>('day');
  const [viewStart, setViewStart] = useState<Date>(() => subDays(startOfDay(new Date()), 7));

  const colW = COL_WIDTH[scale];
  const TOTAL_COLS = scale === 'day' ? 90 : scale === 'week' ? 26 : 18;

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: tasks = [], isLoading } = useQuery<GanttTask[]>({
    queryKey: ['project-tasks', projectId],
    enabled: !!projectId && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('workspace_id', activeWorkspace!.id)
        .is('parent_task_id', null)
        .order('position');
      if (error) throw error;
      return data as GanttTask[];
    },
  });

  const { data: deps = [] } = useQuery<DepRow[]>({
    queryKey: ['project-dependencies', projectId],
    enabled: !!projectId && !!activeWorkspace?.id && tasks.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('task_dependencies')
        .select(`
          *,
          blocking_task:tasks!task_dependencies_blocking_task_id_fkey(*),
          blocked_task:tasks!task_dependencies_blocked_task_id_fkey(*)
        `)
        .eq('workspace_id', activeWorkspace!.id)
        .in('blocking_task_id', tasks.map((t) => t.id).concat(['__none__']));
      if (error) throw error;
      return (data ?? []) as DepRow[];
    },
  });

  // ── Date patch mutation ──────────────────────────────────────────────────────

  const patchDates = useMutation({
    mutationFn: async ({ taskId, start_date, due_date }: { taskId: string; start_date: string | null; due_date: string | null }) => {
      const { error } = await (supabase as any)
        .from('tasks')
        .update({ start_date, due_date, updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (error) throw error;
    },
    onMutate: ({ taskId, start_date, due_date }) => {
      qc.setQueryData<GanttTask[]>(['project-tasks', projectId], (old = []) =>
        old.map((t) => t.id === taskId ? { ...t, start_date, due_date } : t)
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['project-tasks', projectId] });
    },
  });

  // ── Day columns for current view ─────────────────────────────────────────────

  const dayColumns = useMemo(() => {
    if (scale === 'day') return getDayColumns(viewStart, TOTAL_COLS);
    if (scale === 'week') {
      const start = startOfWeek(viewStart, { weekStartsOn: 1 });
      return Array.from({ length: TOTAL_COLS }, (_, i) => addDays(start, i * 7));
    }
    const start = startOfMonth(viewStart);
    return Array.from({ length: TOTAL_COLS }, (_, i) => startOfMonth(addDays(start, i * 32)));
  }, [viewStart, scale, TOTAL_COLS]);

  // ── Coordinate helpers ───────────────────────────────────────────────────────

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

  // ── Drag handlers ────────────────────────────────────────────────────────────

  const onMouseDown = useCallback((
    e: React.MouseEvent,
    taskId: string,
    mode: 'move' | 'resize-left' | 'resize-right',
    startDate: string | null,
    endDate: string | null,
  ) => {
    e.preventDefault();
    drag.setDrag({ dragging: true, taskId, mode, startX: e.clientX, startDate, endDate, deltaX: 0 });
  }, [drag]);

  useEffect(() => {
    if (!drag.dragging) return;

    const onMove = (e: MouseEvent) => {
      drag.setDrag({ deltaX: e.clientX - drag.startX });
    };

    const onUp = () => {
      if (!drag.taskId || !drag.dragging) { drag.reset(); return; }
      const deltaDays = Math.round(pxToDays(drag.deltaX));
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

      // Guard: start must not be after end
      if (newStart && newEnd && newStart > newEnd) {
        drag.reset(); return;
      }

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

  // ── Conflict detection ───────────────────────────────────────────────────────

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

  // ── Today X position ─────────────────────────────────────────────────────────

  const todayX = dateToX(new Date());

  // ── Header rows for scale ────────────────────────────────────────────────────

  const monthHeaders = useMemo(() => {
    if (scale !== 'day') return [];
    const months: { label: string; x: number; width: number }[] = [];
    let cur: string | null = null;
    let startX = 0;
    for (let i = 0; i < TOTAL_COLS; i++) {
      const d = addDays(viewStart, i);
      const m = format(d, 'MMM yyyy');
      if (m !== cur) {
        if (cur !== null) months.push({ label: cur, x: startX, width: dateToX(addDays(viewStart, i)) - startX });
        cur = m;
        startX = i * colW;
      }
    }
    if (cur) months.push({ label: cur, x: startX, width: TOTAL_COLS * colW - startX });
    return months;
  }, [viewStart, scale, TOTAL_COLS, colW, dateToX]);

  // ── Dependency connector lines ───────────────────────────────────────────────

  const connectors = useMemo(() => {
    return deps
      .filter((d) => d.blocking_task?.due_date && d.blocked_task?.start_date)
      .map((d) => {
        const fromTaskIdx = tasks.findIndex((t) => t.id === d.blocking_task_id);
        const toTaskIdx = tasks.findIndex((t) => t.id === d.blocked_task_id);
        if (fromTaskIdx === -1 || toTaskIdx === -1) return null;

        const fromTask = tasks[fromTaskIdx];
        const toTask = tasks[toTaskIdx];

        // Apply live drag offset to positions
        const getDraggedDate = (t: GanttTask, isEnd: boolean) => {
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

        const x1 = dateToX(dateFromStr(fromDate)) + colW; // right edge of blocking bar
        const y1 = fromTaskIdx * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
        const x2 = dateToX(dateFromStr(toDate)); // left edge of blocked bar
        const y2 = toTaskIdx * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;

        return { id: d.id, x1, y1, x2, y2 };
      })
      .filter(Boolean) as { id: string; x1: number; y1: number; x2: number; y2: number }[];
  }, [deps, tasks, dateToX, colW, drag.dragging, drag.taskId, drag.deltaX, drag.mode, pxToDays]);

  // ── Task bar position (with live drag) ───────────────────────────────────────

  const getBarProps = useCallback((task: GanttTask) => {
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

  // ── Conflict tooltip ─────────────────────────────────────────────────────────

  const [tooltip, setTooltip] = useState<{ taskId: string; text: string; x: number; y: number } | null>(null);

  // ── Render ───────────────────────────────────────────────────────────────────

  const totalGridWidth = TOTAL_COLS * colW;
  const totalGridHeight = tasks.length * (ROW_HEIGHT + ROW_GAP);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Calendar className="w-8 h-8 text-gray-300 mb-2" />
        <p className="text-sm text-gray-400">No tasks in this project yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        <span className="text-xs text-gray-500 font-medium mr-2">Scale</span>
        {(['day', 'week', 'month'] as Scale[]).map((s) => (
          <Button key={s} size="sm" variant={scale === s ? 'default' : 'outline'}
            className={cn('h-7 text-xs capitalize', scale === s && 'bg-sky-600 hover:bg-sky-700')}
            onClick={() => setScale(s)}>
            {s}
          </Button>
        ))}
        <div className="flex-1" />
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
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: task names */}
        <div
          className="shrink-0 border-r border-gray-200 bg-white overflow-y-auto overflow-x-hidden"
          style={{ width: LEFT_PANEL }}
        >
          {/* Header spacer */}
          <div className="h-[48px] border-b border-gray-200 bg-gray-50 px-3 flex items-end pb-1">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Task</span>
          </div>

          {/* Task rows */}
          <div style={{ paddingTop: 4 }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 px-3"
                style={{ height: ROW_HEIGHT, marginBottom: ROW_GAP }}
              >
                <span className={cn('w-2 h-2 rounded-full shrink-0', {
                  'bg-red-500': task.priority === 'urgent',
                  'bg-orange-500': task.priority === 'high',
                  'bg-sky-400': task.priority === 'medium',
                  'bg-blue-300': task.priority === 'low',
                })} />
                <span className="text-xs text-gray-700 truncate">{task.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: scrollable grid */}
        <div className="flex-1 overflow-auto" ref={gridRef}>
          <div style={{ width: totalGridWidth, minWidth: totalGridWidth }}>
            {/* Date header */}
            <div
              className="sticky top-0 z-20 bg-white border-b border-gray-200"
              style={{ height: 48 }}
            >
              {/* Month row (day scale only) */}
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

              {/* Day/week/month numbers */}
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
              style={{ height: totalGridHeight + 8, paddingTop: 4 }}
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
              {tasks.map((_t, rowI) => (
                <div
                  key={rowI}
                  className={cn('absolute left-0 right-0', rowI % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                  style={{ top: rowI * (ROW_HEIGHT + ROW_GAP), height: ROW_HEIGHT }}
                />
              ))}

              {/* Today line */}
              {todayX >= 0 && todayX <= totalGridWidth && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{ left: todayX }}
                >
                  <div className="w-px h-full border-l-2 border-dashed border-red-400 opacity-70" />
                </div>
              )}

              {/* Dependency connector SVG */}
              <svg
                className="absolute inset-0 pointer-events-none z-10"
                style={{ width: totalGridWidth, height: totalGridHeight + 8 }}
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
                      {/* Arrow head */}
                      <polygon
                        points={`${c.x2},${c.y2} ${c.x2 - 6},${c.y2 - 4} ${c.x2 - 6},${c.y2 + 4}`}
                        fill="#9ca3af"
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Task bars */}
              {tasks.map((task, rowIdx) => {
                const { startDate, endDate } = getBarProps(task);
                const top = rowIdx * (ROW_HEIGHT + ROW_GAP) + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                const hasConflict = conflictTaskIds.has(task.id);

                if (!startDate && !endDate) {
                  // Diamond marker at today
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
                    style={{ left: x, top, width, height: BAR_HEIGHT }}
                    title={hasConflict ? `⚠ Dependency conflict: starts before blocker ends` : task.title}
                    onMouseDown={(e) => {
                      // Only move if not on a handle
                      if ((e.target as HTMLElement).dataset.handle) return;
                      onMouseDown(e, task.id, 'move', task.start_date, task.due_date);
                    }}
                    onMouseEnter={(e) => {
                      if (hasConflict) {
                        const conflictDep = deps.find((d) => d.blocked_task_id === task.id && d.blocking_task?.due_date && d.blocked_task?.start_date && d.blocking_task.due_date > d.blocked_task.start_date);
                        if (conflictDep) {
                          setTooltip({
                            taskId: task.id,
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
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onMouseDown(e, task.id, 'resize-left', task.start_date, task.due_date);
                      }}
                    />

                    {/* Label */}
                    <span className="px-2 text-[11px] font-medium text-white truncate pointer-events-none select-none drop-shadow-sm flex-1">
                      {task.title}
                    </span>

                    {/* Right resize handle */}
                    <div
                      data-handle="right"
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-r z-20"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onMouseDown(e, task.id, 'resize-right', task.start_date, task.due_date);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Conflict tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg max-w-56"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          ⚠ {tooltip.text}
        </div>
      )}
    </div>
  );
}
