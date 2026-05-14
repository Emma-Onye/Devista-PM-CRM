import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast } from 'date-fns';
import {
  DragDropContext, Droppable, Draggable, type DropResult,
} from '@hello-pangea/dnd';
import { Plus, Calendar, SquareCheck as CheckSquare, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { useBoardStore, type BoardTask } from '../../stores/board-store';
import { TaskDetailPanel } from './TaskDetailPanel';
import { cn } from '../../lib/utils';
import type { TaskStatus, PriorityLevel } from '../../lib/database.types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const BOARD_COLUMNS: { key: TaskStatus; label: string; accent: string }[] = [
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

// ── TaskKanbanBoard ───────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

export function TaskKanbanBoard({ projectId }: Props) {
  const { activeWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();

  const init = useBoardStore((s) => s.init);
  const reset = useBoardStore((s) => s.reset);
  const moveTask = useBoardStore((s) => s.moveTask);
  const reorderTask = useBoardStore((s) => s.reorderTask);
  const addTask = useBoardStore((s) => s.addTask);
  const initialized = useBoardStore((s) => s.initialized);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rawTasks = [], isLoading } = useQuery<BoardTask[]>({
    queryKey: ['project-tasks', projectId],
    enabled: !!projectId && !!activeWorkspace?.id,
    queryFn: async () => {
      // Fetch tasks with subtask counts
      const { data: tasks, error } = await (supabase as any)
        .from('tasks')
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url)')
        .eq('project_id', projectId)
        .eq('workspace_id', activeWorkspace!.id)
        .is('parent_task_id', null) // only top-level tasks on board
        .order('position');
      if (error) throw error;

      // Fetch subtask counts
      const { data: subtaskCounts } = await (supabase as any)
        .from('tasks')
        .select('parent_task_id, status')
        .eq('project_id', projectId)
        .eq('workspace_id', activeWorkspace!.id)
        .not('parent_task_id', 'is', null);

      const totalMap: Record<string, number> = {};
      const doneMap: Record<string, number> = {};
      for (const s of (subtaskCounts ?? []) as { parent_task_id: string; status: string }[]) {
        totalMap[s.parent_task_id] = (totalMap[s.parent_task_id] ?? 0) + 1;
        if (s.status === 'done') doneMap[s.parent_task_id] = (doneMap[s.parent_task_id] ?? 0) + 1;
      }

      return (tasks as BoardTask[]).map((t) => ({
        ...t,
        subtask_total: totalMap[t.id] ?? 0,
        subtask_done: doneMap[t.id] ?? 0,
      }));
    },
  });

  // Initialize board store whenever fresh data arrives
  useEffect(() => {
    if (rawTasks.length > 0 || !isLoading) {
      init(projectId, rawTasks);
    }
  }, [rawTasks, projectId]);

  // Reset on unmount
  useEffect(() => () => reset(projectId), [projectId]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const moveMutation = useMutation({
    mutationFn: async ({
      taskId, status, newPosition,
    }: { taskId: string; status: TaskStatus; newPosition: number }) => {
      const { error } = await (supabase as any)
        .from('tasks').update({ status, position: newPosition }).eq('id', taskId);
      if (error) throw error;
    },
    onError: () => {
      // On error, re-init from server
      qc.invalidateQueries({ queryKey: ['project-tasks', projectId] });
    },
  });

  // ── DnD ───────────────────────────────────────────────────────────────────

  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const fromStatus = source.droppableId as TaskStatus;
    const toStatus = destination.droppableId as TaskStatus;
    const fromIdx = source.index;
    const toIdx = destination.index;

    if (fromStatus === toStatus && fromIdx === toIdx) return;

    // Optimistic update
    if (fromStatus === toStatus) {
      reorderTask(projectId, fromStatus, fromIdx, toIdx);
    } else {
      moveTask(projectId, draggableId, fromStatus, toStatus, fromIdx, toIdx);
    }

    // Compute new position using gap strategy (1000-step gaps)
    const colTasks = useBoardStore.getState().getColumnTasks(projectId, toStatus);
    let newPosition: number;
    if (colTasks.length === 0) {
      newPosition = 1000;
    } else if (toIdx === 0) {
      newPosition = (colTasks[0]?.position ?? 1000) - 500;
    } else if (toIdx >= colTasks.length - 1) {
      newPosition = (colTasks[colTasks.length - 1]?.position ?? 1000) + 1000;
    } else {
      const before = colTasks[toIdx - 1]?.position ?? 0;
      const after = colTasks[toIdx + 1]?.position ?? before + 2000;
      newPosition = Math.floor((before + after) / 2);
    }

    moveMutation.mutate({ taskId: draggableId, status: toStatus, newPosition });
  }, [projectId, moveTask, reorderTask]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading && !initialized) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Board */}
      <div className={cn(
        'flex-1 overflow-x-auto overflow-y-hidden transition-all duration-300 ease-in-out',
        selectedTaskId ? 'mr-[480px]' : 'mr-0'
      )}>
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 h-full p-4 min-w-max">
            {BOARD_COLUMNS.map((col) => (
              <BoardColumn
                key={col.key}
                col={col}
                projectId={projectId}
                onCardClick={setSelectedTaskId}
                onTaskAdded={(task) => addTask(projectId, task)}
              />
            ))}
          </div>
        </DragDropContext>
      </div>

      {/* Detail Panel — slides in from right within the board area */}
      <div className={cn(
        'absolute right-0 top-0 bottom-0 w-[480px] bg-white border-l border-gray-200 shadow-xl z-20 overflow-hidden flex flex-col',
        'transition-transform duration-300 ease-in-out',
        selectedTaskId ? 'translate-x-0' : 'translate-x-full'
      )}>
        {selectedTaskId && (
          <TaskDetailPanel
            taskId={selectedTaskId}
            projectId={projectId}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── BoardColumn ───────────────────────────────────────────────────────────────

interface ColumnProps {
  col: (typeof BOARD_COLUMNS)[number];
  projectId: string;
  onCardClick: (id: string) => void;
  onTaskAdded: (task: BoardTask) => void;
}

const BoardColumn = memo(function BoardColumn({ col, projectId, onCardClick, onTaskAdded }: ColumnProps) {
  const tasks = useBoardStore((s) => s.getColumnTasks(projectId, col.key));
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const saveTask = async () => {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    try {
      const pos = tasks.length > 0
        ? (tasks[tasks.length - 1].position ?? tasks.length * 1000) + 1000
        : 1000;
      const { data, error } = await (supabase as any)
        .from('tasks')
        .insert({
          workspace_id: activeWorkspace!.id,
          project_id: projectId,
          title: newTitle.trim(),
          status: col.key,
          priority: 'medium',
          reporter: user!.id,
          position: pos,
        })
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url)')
        .single();

      if (!error && data) {
        const task = { ...(data as BoardTask), subtask_total: 0, subtask_done: 0 };
        onTaskAdded(task);
        qc.setQueryData<BoardTask[]>(['project-tasks', projectId], (old = []) => [...old, task]);
        qc.invalidateQueries({ queryKey: ['projects', activeWorkspace?.id] });
        setNewTitle('');
        // Keep open for rapid entry
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(
      'flex flex-col w-72 shrink-0 bg-gray-50 rounded-xl border border-gray-200 border-t-2 overflow-hidden',
      col.accent
    )}>
      {/* Column header */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">{col.label}</span>
            <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 font-medium tabular-nums">
              {tasks.length}
            </span>
          </div>
        </div>
      </div>

      {/* Cards */}
      <Droppable droppableId={col.key}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 overflow-y-auto px-2 space-y-1.5 min-h-[60px] transition-colors',
              snapshot.isDraggingOver ? 'bg-indigo-50/50' : '',
              adding ? 'pb-1' : 'pb-2'
            )}
          >
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                onClick={() => onCardClick(task.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Inline add */}
      {adding ? (
        <div className="px-2 pb-2 shrink-0">
          <div className="bg-white rounded-lg border border-indigo-300 shadow-sm p-2">
            <input
              ref={inputRef}
              className="w-full text-sm text-gray-900 outline-none placeholder:text-gray-300 leading-snug mb-2"
              placeholder="Task title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTask();
                if (e.key === 'Escape') { setAdding(false); setNewTitle(''); }
              }}
            />
            <div className="flex items-center gap-1.5">
              <button
                className={cn(
                  'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                  newTitle.trim()
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                )}
                onClick={saveTask}
                disabled={!newTitle.trim() || saving}
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => { setAdding(false); setNewTitle(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          className="mx-2 mb-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg px-2 py-1.5 transition-colors shrink-0"
          onClick={() => setAdding(true)}
        >
          <Plus className="w-3.5 h-3.5" /> Add Task
        </button>
      )}
    </div>
  );
});

// ── TaskCard ──────────────────────────────────────────────────────────────────

interface CardProps {
  task: BoardTask;
  index: number;
  onClick: () => void;
}

const TaskCard = memo(function TaskCard({ task, index, onClick }: CardProps) {
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
