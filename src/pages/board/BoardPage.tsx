import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast } from 'date-fns';
import {
  DragDropContext, Droppable, Draggable, type DropResult,
} from '@hello-pangea/dnd';
import {
  Kanban, Plus, Calendar, SquareCheck as CheckSquare,
  Loader as Loader2, Filter, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { TaskDetailPanel } from '../projects/TaskDetailPanel';
import { cn } from '../../lib/utils';
import type { TaskStatus, PriorityLevel, Project } from '../../lib/database.types';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_COLUMNS: { key: TaskStatus; label: string; accent: string }[] = [
  { key: 'backlog',     label: 'Backlog',      accent: 'border-t-gray-400' },
  { key: 'todo',        label: 'To Do',        accent: 'border-t-slate-500' },
  { key: 'in_progress', label: 'In Progress',  accent: 'border-t-blue-500' },
  { key: 'in_review',   label: 'In Review',    accent: 'border-t-amber-500' },
  { key: 'done',        label: 'Done',         accent: 'border-t-emerald-500' },
];

const PRIORITY_LEFT_BORDER: Record<PriorityLevel, string> = {
  urgent: 'border-l-red-500',
  high:   'border-l-orange-500',
  medium: 'border-l-amber-400',
  low:    'border-l-blue-400',
};

const PROJECT_COLORS = [
  'bg-indigo-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-pink-500', 'bg-purple-500', 'bg-teal-500', 'bg-rose-500',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface WsBoardTask {
  id: string;
  project_id: string;
  workspace_id: string;
  parent_task_id: string | null;
  title: string;
  status: TaskStatus;
  priority: PriorityLevel;
  assigned_to: string | null;
  reporter: string;
  due_date: string | null;
  start_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  assignee: { display_name: string; avatar_url: string | null } | null;
  project: { name: string } | null;
  subtask_total: number;
  subtask_done: number;
}

// ── BoardPage ─────────────────────────────────────────────────────────────────

export function BoardPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  // ── Fetch projects for filter dropdown ──────────────────────────────────────

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

  // ── Fetch ALL tasks across workspace ────────────────────────────────────────

  const { data: allTasks = [], isLoading } = useQuery<WsBoardTask[]>({
    queryKey: ['ws-board-tasks', wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data: tasks, error } = await (supabase as any)
        .from('tasks')
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url), project:projects!tasks_project_id_fkey(name)')
        .eq('workspace_id', wsId!)
        .is('parent_task_id', null)
        .order('position');
      if (error) throw error;

      // Subtask counts
      const { data: subs } = await (supabase as any)
        .from('tasks')
        .select('parent_task_id, status')
        .eq('workspace_id', wsId!)
        .not('parent_task_id', 'is', null);

      const totalMap: Record<string, number> = {};
      const doneMap: Record<string, number> = {};
      for (const s of (subs ?? []) as { parent_task_id: string; status: string }[]) {
        totalMap[s.parent_task_id] = (totalMap[s.parent_task_id] ?? 0) + 1;
        if (s.status === 'done') doneMap[s.parent_task_id] = (doneMap[s.parent_task_id] ?? 0) + 1;
      }

      return (tasks as WsBoardTask[]).map((t) => ({
        ...t,
        subtask_total: totalMap[t.id] ?? 0,
        subtask_done: doneMap[t.id] ?? 0,
      }));
    },
  });

  // ── Filter tasks by project ──────────────────────────────────────────────────

  const tasks = useMemo(() => {
    if (!filterProjectId) return allTasks;
    return allTasks.filter((t) => t.project_id === filterProjectId);
  }, [allTasks, filterProjectId]);

  // ── Group by status ──────────────────────────────────────────────────────────

  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, WsBoardTask[]> = {
      backlog: [], todo: [], in_progress: [], in_review: [], done: [],
    };
    for (const t of tasks) {
      if (map[t.status]) map[t.status].push(t);
    }
    return map;
  }, [tasks]);

  // ── Color map for project badges ────────────────────────────────────────────

  const projectColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const uniqueProjectIds = [...new Set(allTasks.map((t) => t.project_id))];
    uniqueProjectIds.forEach((pid, i) => {
      map.set(pid, PROJECT_COLORS[i % PROJECT_COLORS.length]);
    });
    return map;
  }, [allTasks]);

  // ── DnD move mutation ───────────────────────────────────────────────────────

  const moveMutation = useMutation({
    mutationFn: async ({
      taskId, status, newPosition,
    }: { taskId: string; status: TaskStatus; newPosition: number }) => {
      const { error } = await (supabase as any)
        .from('tasks').update({ status, position: newPosition }).eq('id', taskId);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ws-board-tasks', wsId] });
    },
  });

  // ── DnD handler ─────────────────────────────────────────────────────────────

  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const toStatus = destination.droppableId as TaskStatus;
    const toIdx = destination.index;
    if (source.droppableId === toStatus && source.index === toIdx) return;

    // Optimistic: update in query cache
    qc.setQueryData<WsBoardTask[]>(['ws-board-tasks', wsId], (old = []) =>
      old.map((t) => t.id === draggableId ? { ...t, status: toStatus } : t)
    );

    // Compute position
    const colTasks = columnTasks[toStatus];
    let newPosition: number;
    if (colTasks.length === 0) {
      newPosition = 1000;
    } else if (toIdx === 0) {
      newPosition = (colTasks[0]?.position ?? 1000) - 500;
    } else if (toIdx >= colTasks.length) {
      newPosition = (colTasks[colTasks.length - 1]?.position ?? 1000) + 1000;
    } else {
      const before = colTasks[toIdx - 1]?.position ?? 0;
      const after = colTasks[toIdx]?.position ?? before + 2000;
      newPosition = Math.floor((before + after) / 2);
    }

    moveMutation.mutate({ taskId: draggableId, status: toStatus, newPosition });
  }, [columnTasks, wsId, qc, moveMutation]);

  // ── Find task's project_id for detail panel ─────────────────────────────────

  const selectedTask = selectedTaskId ? allTasks.find((t) => t.id === selectedTaskId) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <Kanban className="w-5 h-5 text-indigo-600" />
        <h1 className="text-lg font-semibold text-gray-900">Board</h1>

        <div className="flex-1" />

        {/* Project filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={filterProjectId ?? ''}
            onChange={(e) => setFilterProjectId(e.target.value || null)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {filterProjectId && (
            <button
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              onClick={() => setFilterProjectId(null)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Board body */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </div>
      ) : allTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Kanban className="w-8 h-8 text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No tasks in this workspace yet</p>
          <p className="text-xs text-gray-300 mt-1">Create tasks inside a project to see them here</p>
        </div>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          <div className={cn(
            'flex-1 overflow-x-auto overflow-y-hidden transition-all duration-300 ease-in-out',
            selectedTaskId ? 'mr-[480px]' : 'mr-0'
          )}>
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex gap-3 h-full p-4 min-w-max">
                {BOARD_COLUMNS.map((col) => (
                  <WsColumn
                    key={col.key}
                    col={col}
                    tasks={columnTasks[col.key]}
                    projectColorMap={projectColorMap}
                    onCardClick={setSelectedTaskId}
                  />
                ))}
              </div>
            </DragDropContext>
          </div>

          {/* Detail slide-over */}
          <div className={cn(
            'absolute right-0 top-0 bottom-0 w-[480px] bg-white border-l border-gray-200 shadow-xl z-20 overflow-hidden flex flex-col',
            'transition-transform duration-300 ease-in-out',
            selectedTaskId ? 'translate-x-0' : 'translate-x-full'
          )}>
            {selectedTask && (
              <TaskDetailPanel
                taskId={selectedTask.id}
                projectId={selectedTask.project_id}
                onClose={() => setSelectedTaskId(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── WsColumn ──────────────────────────────────────────────────────────────────

interface ColumnProps {
  col: (typeof BOARD_COLUMNS)[number];
  tasks: WsBoardTask[];
  projectColorMap: Map<string, string>;
  onCardClick: (id: string) => void;
}

const WsColumn = memo(function WsColumn({ col, tasks, projectColorMap, onCardClick }: ColumnProps) {
  return (
    <div className={cn(
      'flex flex-col w-72 shrink-0 bg-gray-50 rounded-xl border border-gray-200 border-t-2 overflow-hidden',
      col.accent
    )}>
      {/* Column header */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">{col.label}</span>
          <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 font-medium tabular-nums">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <Droppable droppableId={col.key}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 overflow-y-auto px-2 space-y-1.5 min-h-[60px] pb-2 transition-colors',
              snapshot.isDraggingOver ? 'bg-indigo-50/50' : '',
            )}
          >
            {tasks.map((task, index) => (
              <WsTaskCard
                key={task.id}
                task={task}
                index={index}
                projectColor={projectColorMap.get(task.project_id) ?? 'bg-gray-400'}
                onClick={() => onCardClick(task.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
});

// ── WsTaskCard ────────────────────────────────────────────────────────────────

interface CardProps {
  task: WsBoardTask;
  index: number;
  projectColor: string;
  onClick: () => void;
}

const WsTaskCard = memo(function WsTaskCard({ task, index, projectColor, onClick }: CardProps) {
  const isOverdue = task.due_date && isPast(new Date(task.due_date)) && task.status !== 'done';

  return (
    <Draggable draggableId={task.id} index={index}>
      {(drag, snap) => (
        <div
          ref={drag.innerRef}
          {...drag.draggableProps}
          {...drag.dragHandleProps}
          onClick={onClick}
          className={cn(
            'bg-white rounded-lg border border-l-2 border-gray-200 px-3 py-2 cursor-pointer select-none',
            'hover:shadow-sm transition-all group',
            PRIORITY_LEFT_BORDER[task.priority],
            snap.isDragging ? 'shadow-lg ring-1 ring-indigo-200 rotate-1' : ''
          )}
        >
          {/* Project badge */}
          {task.project?.name && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', projectColor)} />
              <span className="text-[10px] font-medium text-gray-400 truncate">
                {task.project.name}
              </span>
            </div>
          )}

          {/* Title */}
          <p className="text-xs font-medium text-gray-900 leading-snug line-clamp-2 mb-2 group-hover:text-indigo-700 transition-colors">
            {task.title}
          </p>

          {/* Footer row */}
          <div className="flex items-center justify-between gap-1 min-h-[16px]">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Due date */}
              {task.due_date && (
                <div className={cn(
                  'flex items-center gap-0.5 text-[10px] shrink-0',
                  isOverdue ? 'text-red-500' : 'text-gray-400'
                )}>
                  <Calendar className="w-2.5 h-2.5" />
                  {format(new Date(task.due_date), 'MMM d')}
                </div>
              )}
              {/* Subtask indicator */}
              {(task.subtask_total ?? 0) > 0 && (
                <div className="flex items-center gap-0.5 text-[10px] text-gray-400 shrink-0">
                  <CheckSquare className="w-2.5 h-2.5" />
                  <span className={cn(
                    (task.subtask_done ?? 0) === (task.subtask_total ?? 0) ? 'text-emerald-600' : ''
                  )}>
                    {task.subtask_done}/{task.subtask_total}
                  </span>
                </div>
              )}
            </div>

            {/* Assignee avatar */}
            {task.assignee && (
              <div
                className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden shrink-0"
                title={task.assignee.display_name}
              >
                {task.assignee.avatar_url ? (
                  <img src={task.assignee.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-indigo-700 text-[9px] font-bold">
                    {task.assignee.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
});
