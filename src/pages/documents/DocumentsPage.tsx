import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FileText, Search, Plus, Loader as Loader2, FolderKanban } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  title: string;
  project_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  project: { id: string; name: string } | null;
  creator: { display_name: string; avatar_url: string | null } | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

// ── DocumentsPage ─────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState<string>('__none__');

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: docs = [], isLoading } = useQuery<DocumentRow[]>({
    queryKey: ['documents', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('documents')
        .select('*, project:projects(id, name), creator:profiles!documents_created_by_fkey(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
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

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from('documents')
        .insert({
          workspace_id: activeWorkspace!.id,
          title: newTitle.trim() || 'Untitled Document',
          project_id: newProjectId === '__none__' ? null : newProjectId,
          created_by: user!.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['documents', activeWorkspace?.id] });
      setDialogOpen(false);
      setNewTitle('');
      setNewProjectId('__none__');
      navigate(`/documents/${data.id}`);
    },
  });

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = docs.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    (d.project?.name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
              <FileText className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Documents</h1>
              <p className="text-xs text-gray-400">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                className="pl-8 h-8 text-sm w-56"
                placeholder="Search documents…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="gap-1.5 bg-sky-600 hover:bg-sky-700 text-white h-8"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" /> New Document
            </Button>
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div className="px-6 py-2 border-b border-gray-100 bg-gray-50 shrink-0">
        <div className="flex items-center gap-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
          <div className="w-9 shrink-0" />
          <div className="flex-1">Title</div>
          <div className="w-28 text-right">Last edited</div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mb-3">
              <FileText className="w-6 h-6 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">
              {search ? 'No documents match your search' : 'No documents yet'}
            </p>
            {!search && (
              <p className="text-xs text-gray-400 mt-1">Create your first document to get started</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((doc) => (
              <button
                key={doc.id}
                className="w-full flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors text-left group"
                onClick={() => navigate(`/documents/${doc.id}`)}
              >
                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-sky-500" />
                </div>

                {/* Title + project */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-sky-700 transition-colors">
                    {doc.title}
                  </p>
                  {doc.project && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <FolderKanban className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-400">{doc.project.name}</span>
                    </div>
                  )}
                </div>

                {/* Creator avatar */}
                {doc.creator && (
                  <div
                    className="w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center overflow-hidden shrink-0"
                    title={`Created by ${doc.creator.display_name}`}
                  >
                    {doc.creator.avatar_url ? (
                      <img src={doc.creator.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sky-700 text-[9px] font-bold">
                        {doc.creator.display_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                )}

                {/* Last edited */}
                <span className="text-xs text-gray-400 w-28 text-right shrink-0">
                  {format(new Date(doc.updated_at), 'MMM d, yyyy')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New Document Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                placeholder="Untitled Document"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createMutation.mutate(); }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Link to project{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Select value={newProjectId} onValueChange={setNewProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-sky-600 hover:bg-sky-700"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              Create Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
