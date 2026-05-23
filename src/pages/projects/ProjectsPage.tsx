import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FolderKanban, Plus, Search, Loader as Loader2, Calendar, SquareCheck as CheckSquare, Handshake } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { cn } from '../../lib/utils';
import type { Project, ProjectStatus, PriorityLevel } from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectCard extends Project {
  task_total: number;
  task_done: number;
  creator: { display_name: string; avatar_url: string | null } | null;
  linked_deal: { id: string; name: string } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; class: string }> = {
  active:    { label: 'Active',     class: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  on_hold:   { label: 'On Hold',    class: 'bg-amber-100 text-amber-700 border-amber-200' },
  completed: { label: 'Completed',  class: 'bg-blue-100 text-blue-700 border-blue-200' },
  archived:  { label: 'Archived',   class: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export const PRIORITY_DOT: Record<PriorityLevel, string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-500',
  medium: 'bg-amber-400',
  low:    'bg-blue-400',
};

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived'];
const PRIORITY_OPTIONS: PriorityLevel[] = ['urgent', 'high', 'medium', 'low'];

// ── ProjectsPage ──────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '',
    status: 'active' as ProjectStatus,
    priority: 'medium' as PriorityLevel,
    start_date: '', target_end_date: '',
  });

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: projects = [], isLoading } = useQuery<ProjectCard[]>({
    queryKey: ['projects', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data: projData, error } = await (supabase as any)
        .from('projects')
        .select('*, profiles!projects_created_by_fkey(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Task counts per project
      const { data: taskData } = await (supabase as any)
        .from('tasks')
        .select('project_id, status')
        .eq('workspace_id', activeWorkspace!.id);

      const totalMap: Record<string, number> = {};
      const doneMap: Record<string, number> = {};
      for (const t of (taskData ?? []) as { project_id: string; status: string }[]) {
        totalMap[t.project_id] = (totalMap[t.project_id] ?? 0) + 1;
        if (t.status === 'done') doneMap[t.project_id] = (doneMap[t.project_id] ?? 0) + 1;
      }

      // Linked deals
      const { data: dealData } = await (supabase as any)
        .from('deals').select('id, name, project_id')
        .eq('workspace_id', activeWorkspace!.id)
        .not('project_id', 'is', null);

      const dealMap: Record<string, { id: string; name: string }> = {};
      for (const d of (dealData ?? []) as { id: string; name: string; project_id: string }[]) {
        dealMap[d.project_id] = { id: d.id, name: d.name };
      }

      return (projData as (Project & { profiles: { display_name: string; avatar_url: string | null } | null })[])
        .map((p) => ({
          ...p,
          task_total: totalMap[p.id] ?? 0,
          task_done: doneMap[p.id] ?? 0,
          creator: p.profiles,
          linked_deal: dealMap[p.id] ?? null,
        }));
    },
  });

  // ── Mutation ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (vals: typeof form) => {
      const { data, error } = await (supabase as any)
        .from('projects')
        .insert({
          workspace_id: activeWorkspace!.id,
          name: vals.name.trim(),
          description: vals.description.trim() || null,
          status: vals.status,
          priority: vals.priority,
          start_date: vals.start_date || null,
          target_end_date: vals.target_end_date || null,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (newProject) => {
      qc.invalidateQueries({ queryKey: ['projects', activeWorkspace?.id] });
      setDialogOpen(false);
      resetForm();
      navigate(`/projects/${newProject.id}`);
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const resetForm = () => setForm({
    name: '', description: '', status: 'active', priority: 'medium',
    start_date: '', target_end_date: '',
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, search, statusFilter]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <FolderKanban className="w-5 h-5 text-gray-500 shrink-0" />
          <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Projects</h1>
          {!isLoading && (
            <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
              {projects.length}
            </span>
          )}
        </div>
        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 shrink-0"
          onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
        </Button>
      </div>

      {/* Toolbar */}
      <div className="px-4 sm:px-6 py-3 border-b border-gray-100 bg-white shrink-0 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <Input placeholder="Search projects…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ProjectStatus | 'all')}>
          <SelectTrigger className="h-8 text-sm w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 py-4 sm:py-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <FolderKanban className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">
              {search || statusFilter !== 'all' ? 'No projects match your filters' : 'No projects yet'}
            </p>
            {!search && statusFilter === 'all' && (
              <Button size="sm" variant="outline" className="mt-3 gap-1.5"
                onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="w-3.5 h-3.5" /> Create your first project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((project) => {
              const progress = project.task_total > 0
                ? Math.round((project.task_done / project.task_total) * 100)
                : 0;
              return (
                <button
                  key={project.id}
                  className="group text-left bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-200 transition-all"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', PRIORITY_DOT[project.priority])} />
                      <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                        {project.name}
                      </h3>
                    </div>
                    <Badge variant="outline"
                      className={cn('text-xs border shrink-0 ml-2', STATUS_CONFIG[project.status].class)}>
                      {STATUS_CONFIG[project.status].label}
                    </Badge>
                  </div>

                  {/* Description */}
                  {project.description && (
                    <p className="text-xs text-gray-400 mb-3 line-clamp-2 leading-relaxed">
                      {project.description}
                    </p>
                  )}

                  {/* Linked deal badge */}
                  {project.linked_deal && (
                    <div className="flex items-center gap-1 mb-3">
                      <Handshake className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span className="text-xs text-indigo-600 truncate">{project.linked_deal.name}</span>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <CheckSquare className="w-3 h-3" />
                        <span>
                          {project.task_total > 0
                            ? `${project.task_done}/${project.task_total} tasks`
                            : 'No tasks yet'}
                        </span>
                      </div>
                      {project.task_total > 0 && (
                        <span className="text-xs font-medium text-gray-600">{progress}%</span>
                      )}
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500',
                          progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Dates + avatar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      {(project.start_date || project.target_end_date) && (
                        <>
                          <Calendar className="w-3 h-3 shrink-0" />
                          {project.start_date && (
                            <span>{format(new Date(project.start_date), 'MMM d')}</span>
                          )}
                          {project.start_date && project.target_end_date && (
                            <span>→</span>
                          )}
                          {project.target_end_date && (
                            <span>{format(new Date(project.target_end_date), 'MMM d, yyyy')}</span>
                          )}
                        </>
                      )}
                    </div>
                    {project.creator && (
                      <div
                        className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 overflow-hidden"
                        title={project.creator.display_name}
                      >
                        {project.creator.avatar_url ? (
                          <img src={project.creator.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-indigo-700 text-[10px] font-bold">
                            {project.creator.display_name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">Project name *</Label>
              <Input id="pf-name" required value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Website Redesign" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-desc">Description</Label>
              <Textarea id="pf-desc" rows={3} value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What is this project about?" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as ProjectStatus }))}>
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
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as PriorityLevel }))}>
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
                <Label htmlFor="pf-start">Start date</Label>
                <Input id="pf-start" type="date" value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-end">Target end date</Label>
                <Input id="pf-end" type="date" value={form.target_end_date}
                  onChange={(e) => setForm((f) => ({ ...f, target_end_date: e.target.value }))} />
              </div>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5"
                disabled={createMutation.isPending || !form.name.trim()}>
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
