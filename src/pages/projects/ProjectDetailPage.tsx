import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft, Loader as Loader2, FolderKanban, Calendar,
  SquareCheck as CheckSquare, Settings, List, LayoutGrid, Clock,
  Handshake, Trash2, TriangleAlert as AlertTriangle,
  ChevronUp, ChevronDown, ChevronsUpDown, FileText, Plus,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import { cn } from '../../lib/utils';
import { STATUS_CONFIG, PRIORITY_DOT, PRIORITY_LABEL } from './ProjectsPage';
import { TaskKanbanBoard } from './TaskKanbanBoard';
import { GanttTimeline } from './GanttTimeline';
import type { Project, Task, ProjectStatus, PriorityLevel, TaskStatus, PriorityLevel as PL } from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskRow extends Task {
  assignee: { display_name: string; avatar_url: string | null } | null;
}

interface LinkedDeal { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived'];
const PRIORITY_OPTIONS: PriorityLevel[] = ['urgent', 'high', 'medium', 'low'];

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; class: string }> = {
  backlog:     { label: 'Backlog',      class: 'bg-gray-100 text-gray-600 border-gray-200' },
  todo:        { label: 'To Do',        class: 'bg-slate-100 text-slate-600 border-slate-200' },
  in_progress: { label: 'In Progress',  class: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_review:   { label: 'In Review',    class: 'bg-amber-100 text-amber-700 border-amber-200' },
  done:        { label: 'Done',         class: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

export const TASK_PRIORITY_DOT: Record<PL, string> = {
  urgent: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-blue-400',
};

type SortKey = 'title' | 'status' | 'priority' | 'due_date' | 'created_at';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<TaskStatus, number> = {
  backlog: 0, todo: 1, in_progress: 2, in_review: 3, done: 4,
};
const PRIORITY_ORDER: Record<PL, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
};

// ── ProjectDetailPage ─────────────────────────────────────────────────────────

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace, myRole } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [newDocDialog, setNewDocDialog] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [settingsForm, setSettingsForm] = useState<{
    name: string; description: string; status: ProjectStatus;
    priority: PriorityLevel; start_date: string; target_end_date: string;
  } | null>(null);

  const canEdit = myRole === 'owner' || myRole === 'admin' || myRole === 'manager' || myRole === 'member';

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ['project', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('projects').select('*')
        .eq('id', id).eq('workspace_id', activeWorkspace!.id).single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (p: Project) => {
      if (!settingsForm) {
        setSettingsForm({
          name: p.name, description: p.description ?? '',
          status: p.status, priority: p.priority,
          start_date: p.start_date ?? '', target_end_date: p.target_end_date ?? '',
        });
      }
    },
  } as any);

  // Tasks for the list view and progress stats
  const { data: tasks = [] } = useQuery<TaskRow[]>({
    queryKey: ['project-tasks', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tasks')
        .select('*, assignee:profiles!tasks_assigned_to_fkey(display_name, avatar_url)')
        .eq('project_id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .is('parent_task_id', null)
        .order('position');
      if (error) throw error;
      return data as TaskRow[];
    },
  });

  const { data: linkedDeal } = useQuery<LinkedDeal | null>({
    queryKey: ['project-linked-deal', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('deals').select('id, name')
        .eq('project_id', id).eq('workspace_id', activeWorkspace!.id)
        .maybeSingle();
      return data as LinkedDeal | null;
    },
  });

  const { data: projectDocs = [] } = useQuery<{ id: string; title: string; updated_at: string; creator: { display_name: string; avatar_url: string | null } | null }[]>({
    queryKey: ['project-documents', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('documents')
        .select('id, title, updated_at, creator:profiles!documents_created_by_fkey(display_name, avatar_url)')
        .eq('project_id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .order('updated_at', { ascending: false });
      return data ?? [];
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from('projects').update({ status: 'archived' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', activeWorkspace?.id] });
      navigate('/projects');
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (vals: NonNullable<typeof settingsForm>) => {
      const { error } = await (supabase as any)
        .from('projects').update({
          name: vals.name.trim(),
          description: vals.description.trim() || null,
          status: vals.status,
          priority: vals.priority,
          start_date: vals.start_date || null,
          target_end_date: vals.target_end_date || null,
        }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['projects', activeWorkspace?.id] });
    },
  });

  const createDocMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from('documents')
        .insert({
          workspace_id: activeWorkspace!.id,
          title: newDocTitle.trim() || 'Untitled Document',
          project_id: id,
          created_by: user!.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['project-documents', id] });
      qc.invalidateQueries({ queryKey: ['documents', activeWorkspace?.id] });
      setNewDocDialog(false);
      setNewDocTitle('');
      navigate(`/documents/${data.id}`);
    },
  });

  // ── List view helpers ─────────────────────────────────────────────────────

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-gray-600 ml-1 inline" />
      : <ChevronDown className="w-3 h-3 text-gray-600 ml-1 inline" />;
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    let av: string | number = '', bv: string | number = '';
    if (sortKey === 'title') { av = a.title; bv = b.title; }
    else if (sortKey === 'status') { av = STATUS_ORDER[a.status]; bv = STATUS_ORDER[b.status]; }
    else if (sortKey === 'priority') { av = PRIORITY_ORDER[a.priority]; bv = PRIORITY_ORDER[b.priority]; }
    else if (sortKey === 'due_date') { av = a.due_date ?? ''; bv = b.due_date ?? ''; }
    else { av = a.created_at; bv = b.created_at; }
    if (typeof av === 'number') return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
    return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
  });

  // ── Computed ──────────────────────────────────────────────────────────────

  const taskTotal = tasks.length;
  const taskDone = tasks.filter((t) => t.status === 'done').length;
  const progress = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-gray-400">Project not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/projects')}>Back to Projects</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" className="w-7 h-7 text-gray-500"
            onClick={() => navigate('/projects')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <FolderKanban className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-gray-900 truncate">{project.name}</h1>
                <Badge variant="outline"
                  className={cn('text-xs border shrink-0', STATUS_CONFIG[project.status].class)}>
                  {STATUS_CONFIG[project.status].label}
                </Badge>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn('w-2 h-2 rounded-full', PRIORITY_DOT[project.priority])} />
                  <span className="text-xs text-gray-500">{PRIORITY_LABEL[project.priority]}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {(project.start_date || project.target_end_date) && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Calendar className="w-3 h-3" />
                    {project.start_date && format(new Date(project.start_date), 'MMM d, yyyy')}
                    {project.start_date && project.target_end_date && ' → '}
                    {project.target_end_date && format(new Date(project.target_end_date), 'MMM d, yyyy')}
                  </div>
                )}
                {linkedDeal && (
                  <button
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                    onClick={() => navigate(`/deals/${linkedDeal.id}`)}
                  >
                    <Handshake className="w-3 h-3" />
                    {linkedDeal.name}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Progress stats */}
        <div className="pl-10">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{taskDone}/{taskTotal} tasks complete</span>
            </div>
            <span className="text-xs font-semibold text-gray-700">{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-xs">
            <div
              className={cn('h-full rounded-full transition-all duration-500',
                progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs defaultValue="board" className="flex-1 flex flex-col min-h-0">
          <div className="px-6 pt-3 bg-white border-b border-gray-200 shrink-0">
            <TabsList className="h-9">
              <TabsTrigger value="board" className="gap-1.5 text-xs">
                <LayoutGrid className="w-3.5 h-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5 text-xs">
                <List className="w-3.5 h-3.5" /> List
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-1.5 text-xs">
                <Clock className="w-3.5 h-3.5" /> Timeline
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5 text-xs">
                <FolderKanban className="w-3.5 h-3.5" /> Documents
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5 text-xs">
                <Settings className="w-3.5 h-3.5" /> Settings
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Board Tab — full Kanban with DnD, Add Task, Task Detail panel */}
          <TabsContent value="board" className="flex-1 overflow-hidden m-0 p-0">
            <TaskKanbanBoard projectId={id!} />
          </TabsContent>

          {/* List Tab */}
          <TabsContent value="list" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center border-2 border-dashed border-gray-200 rounded-xl">
                  <CheckSquare className="w-8 h-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No tasks yet — add them from the Board tab</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('title')}>
                          Task <SortIcon col="title" />
                        </TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('status')}>
                          Status <SortIcon col="status" />
                        </TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('priority')}>
                          Priority <SortIcon col="priority" />
                        </TableHead>
                        <TableHead>Assigned to</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('due_date')}>
                          Due <SortIcon col="due_date" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedTasks.map((task) => (
                        <TableRow key={task.id} className="hover:bg-indigo-50/30">
                          <TableCell className="font-medium text-sm text-gray-900">{task.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline"
                              className={cn('text-xs border', TASK_STATUS_CONFIG[task.status].class)}>
                              {TASK_STATUS_CONFIG[task.status].label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className={cn('w-2 h-2 rounded-full shrink-0', TASK_PRIORITY_DOT[task.priority])} />
                              <span className="text-xs text-gray-600">{PRIORITY_LABEL[task.priority]}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {task.assignee?.display_name ?? <span className="text-gray-300">—</span>}
                          </TableCell>
                          <TableCell className="text-sm text-gray-400 whitespace-nowrap">
                            {task.due_date
                              ? format(new Date(task.due_date), 'MMM d, yyyy')
                              : <span className="text-gray-300">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="flex-1 overflow-hidden m-0 flex flex-col">
            <GanttTimeline projectId={id!} />
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Documents</h3>
                <Button
                  size="sm"
                  className="gap-1.5 bg-sky-600 hover:bg-sky-700 text-white h-7 text-xs"
                  onClick={() => setNewDocDialog(true)}
                >
                  <Plus className="w-3 h-3" /> New Document
                </Button>
              </div>
              {projectDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-gray-200 rounded-xl text-center">
                  <FileText className="w-7 h-7 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No documents yet</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                  {projectDocs.map((doc) => (
                    <button
                      key={doc.id}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group"
                      onClick={() => navigate(`/documents/${doc.id}`)}
                    >
                      <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                        <FileText className="w-3.5 h-3.5 text-sky-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-sky-700 transition-colors">
                          {doc.title}
                        </p>
                      </div>
                      {doc.creator && (
                        <div className="w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center overflow-hidden shrink-0"
                          title={doc.creator.display_name}>
                          {doc.creator.avatar_url ? (
                            <img src={doc.creator.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-sky-700 text-[9px] font-bold">
                              {doc.creator.display_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      )}
                      <span className="text-xs text-gray-400 shrink-0">
                        {format(new Date(doc.updated_at), 'MMM d, yyyy')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="flex-1 overflow-auto m-0">
            <div className="max-w-lg mx-auto p-6 space-y-6">
              {settingsForm && (
                <form onSubmit={(e) => { e.preventDefault(); saveSettingsMutation.mutate(settingsForm); }}
                  className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Project Settings</h3>
                  <div className="space-y-1.5">
                    <Label>Project name</Label>
                    <Input value={settingsForm.name}
                      onChange={(e) => setSettingsForm((f) => f ? { ...f, name: e.target.value } : f)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Textarea rows={3} value={settingsForm.description}
                      onChange={(e) => setSettingsForm((f) => f ? { ...f, description: e.target.value } : f)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={settingsForm.status}
                        onValueChange={(v) => setSettingsForm((f) => f ? { ...f, status: v as ProjectStatus } : f)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Priority</Label>
                      <Select value={settingsForm.priority}
                        onValueChange={(v) => setSettingsForm((f) => f ? { ...f, priority: v as PriorityLevel } : f)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PRIORITY_OPTIONS.map((p) => (
                            <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Start date</Label>
                      <Input type="date" value={settingsForm.start_date}
                        onChange={(e) => setSettingsForm((f) => f ? { ...f, start_date: e.target.value } : f)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Target end date</Label>
                      <Input type="date" value={settingsForm.target_end_date}
                        onChange={(e) => setSettingsForm((f) => f ? { ...f, target_end_date: e.target.value } : f)} />
                    </div>
                  </div>
                  {saveSettingsMutation.isError && (
                    <p className="text-sm text-red-600">{(saveSettingsMutation.error as Error).message}</p>
                  )}
                  {saveSettingsMutation.isSuccess && (
                    <p className="text-sm text-emerald-600">Settings saved.</p>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5"
                      disabled={saveSettingsMutation.isPending}>
                      {saveSettingsMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save Changes
                    </Button>
                  </div>
                </form>
              )}

              {canEdit && (
                <div className="bg-white border border-red-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Danger Zone
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Archiving a project hides it from the default view but preserves all its data.
                  </p>
                  <Button variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50 gap-1.5"
                    onClick={() => setArchiveConfirm(true)}>
                    <Trash2 className="w-3.5 h-3.5" /> Archive Project
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* New Document Dialog */}
      <Dialog open={newDocDialog} onOpenChange={setNewDocDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Document</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>Title</Label>
            <Input
              className="mt-1.5"
              placeholder="Untitled Document"
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createDocMutation.mutate(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDocDialog(false)}>Cancel</Button>
            <Button
              className="bg-sky-600 hover:bg-sky-700"
              disabled={createDocMutation.isPending}
              onClick={() => createDocMutation.mutate()}
            >
              {createDocMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              Create Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <AlertDialog open={archiveConfirm} onOpenChange={setArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{project.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This project will be archived and hidden from the default view. All tasks and data are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700"
              onClick={() => archiveMutation.mutate()}>
              {archiveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Archive Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
