import { create } from 'zustand';
import type { Task, TaskStatus } from '../lib/database.types';

// Extended task with joined data
export interface BoardTask extends Task {
  assignee: { display_name: string; avatar_url: string | null } | null;
  subtask_total?: number;
  subtask_done?: number;
}

interface BoardState {
  // projectId -> status -> taskId[]
  columns: Record<string, Record<string, string[]>>;
  // taskId -> BoardTask
  tasks: Record<string, BoardTask>;
  initialized: boolean;

  // Initialize from server data
  init: (projectId: string, tasks: BoardTask[]) => void;
  // Reset to re-fetch
  reset: (projectId: string) => void;

  // Move a card (optimistic)
  moveTask: (projectId: string, taskId: string, fromStatus: string, toStatus: string, fromIndex: number, toIndex: number) => void;
  // Reorder within a column
  reorderTask: (projectId: string, status: string, fromIndex: number, toIndex: number) => void;

  // Add a new task optimistically
  addTask: (projectId: string, task: BoardTask) => void;
  // Update a task field optimistically
  updateTask: (taskId: string, updates: Partial<BoardTask>) => void;
  // Remove a task
  removeTask: (projectId: string, taskId: string) => void;

  getColumnTasks: (projectId: string, status: TaskStatus) => BoardTask[];
}

const STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];

export const useBoardStore = create<BoardState>((set, get) => ({
  columns: {},
  tasks: {},
  initialized: false,

  init: (projectId, incoming) => {
    const cols: Record<string, string[]> = {};
    const tasksMap: Record<string, BoardTask> = { ...get().tasks };

    for (const s of STATUSES) cols[s] = [];
    // Sort by position before populating columns
    const sorted = [...incoming].sort((a, b) => a.position - b.position);
    for (const t of sorted) {
      if (cols[t.status]) cols[t.status].push(t.id);
      tasksMap[t.id] = t;
    }

    set((state) => ({
      columns: { ...state.columns, [projectId]: cols },
      tasks: tasksMap,
      initialized: true,
    }));
  },

  reset: (projectId) => {
    set((state) => {
      const cols = { ...state.columns };
      delete cols[projectId];
      return { columns: cols, initialized: false };
    });
  },

  moveTask: (projectId, taskId, fromStatus, toStatus, fromIndex, toIndex) => {
    set((state) => {
      const projectCols = state.columns[projectId];
      if (!projectCols) return state;

      const from = [...(projectCols[fromStatus] ?? [])];
      const to = fromStatus === toStatus ? from : [...(projectCols[toStatus] ?? [])];

      from.splice(fromIndex, 1);
      if (fromStatus === toStatus) {
        from.splice(toIndex, 0, taskId);
        return {
          columns: { ...state.columns, [projectId]: { ...projectCols, [fromStatus]: from } },
          tasks: { ...state.tasks, [taskId]: { ...state.tasks[taskId], status: toStatus as TaskStatus } },
        };
      } else {
        to.splice(toIndex, 0, taskId);
        return {
          columns: {
            ...state.columns,
            [projectId]: { ...projectCols, [fromStatus]: from, [toStatus]: to },
          },
          tasks: { ...state.tasks, [taskId]: { ...state.tasks[taskId], status: toStatus as TaskStatus } },
        };
      }
    });
  },

  reorderTask: (projectId, status, fromIndex, toIndex) => {
    set((state) => {
      const projectCols = state.columns[projectId];
      if (!projectCols) return state;
      const col = [...(projectCols[status] ?? [])];
      const [moved] = col.splice(fromIndex, 1);
      col.splice(toIndex, 0, moved);
      return { columns: { ...state.columns, [projectId]: { ...projectCols, [status]: col } } };
    });
  },

  addTask: (projectId, task) => {
    set((state) => {
      const projectCols = state.columns[projectId] ?? {};
      const col = [...(projectCols[task.status] ?? []), task.id];
      return {
        columns: { ...state.columns, [projectId]: { ...projectCols, [task.status]: col } },
        tasks: { ...state.tasks, [task.id]: task },
      };
    });
  },

  updateTask: (taskId, updates) => {
    set((state) => ({
      tasks: { ...state.tasks, [taskId]: { ...state.tasks[taskId], ...updates } },
    }));
  },

  removeTask: (projectId, taskId) => {
    set((state) => {
      const task = state.tasks[taskId];
      if (!task) return state;
      const projectCols = state.columns[projectId] ?? {};
      const col = (projectCols[task.status] ?? []).filter((id) => id !== taskId);
      const tasks = { ...state.tasks };
      delete tasks[taskId];
      return {
        columns: { ...state.columns, [projectId]: { ...projectCols, [task.status]: col } },
        tasks,
      };
    });
  },

  getColumnTasks: (projectId, status) => {
    const state = get();
    const ids = state.columns[projectId]?.[status] ?? [];
    return ids.map((id) => state.tasks[id]).filter(Boolean);
  },
}));
