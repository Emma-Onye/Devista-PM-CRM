import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent } from '../../components/ui/card';
import { Layers, Building2, Plus, ArrowRight, Check, Loader as Loader2 } from 'lucide-react';
import type { Workspace, MemberRole } from '../../lib/database.types';

interface WorkspaceWithRole {
  workspace: Workspace;
  role: MemberRole;
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export function SelectWorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { setActiveWorkspace } = useWorkspaceStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);

  const { data: workspaces = [], isLoading } = useQuery<WorkspaceWithRole[]>({
    queryKey: ['my-workspaces', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workspace_members')
        .select('role, workspaces(*)')
        .eq('user_id', user!.id)
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? []).map((row: { role: MemberRole; workspaces: Workspace }) => ({
        workspace: row.workspaces,
        role: row.role,
      })) as WorkspaceWithRole[];
    },
  });

  const handleSelect = (item: WorkspaceWithRole) => {
    setSelecting(item.workspace.id);
    setActiveWorkspace(item.workspace, item.role);
    navigate('/dashboard');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCreateError('');
    setCreateLoading(true);

    const slug = slugify(newName) || 'workspace';
    const { data: wsData, error: wsErr } = await (supabase as any)
      .from('workspaces')
      .insert({ name: newName, slug: `${slug}-${Date.now().toString(36)}`, created_by: user.id })
      .select()
      .single();

    if (wsErr || !wsData) {
      setCreateError(wsErr?.message ?? 'Failed to create workspace');
      setCreateLoading(false);
      return;
    }

    const ws = wsData as Workspace;

    await (supabase as any).from('workspace_members').insert({
      workspace_id: ws.id,
      user_id: user.id,
      role: 'owner',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    await (supabase as any).from('deal_stages').insert([
      { workspace_id: ws.id, name: 'Qualification', position: 0, probability: 10, color: '#6366f1' },
      { workspace_id: ws.id, name: 'Proposal', position: 1, probability: 30, color: '#3b82f6' },
      { workspace_id: ws.id, name: 'Negotiation', position: 2, probability: 50, color: '#f59e0b' },
      { workspace_id: ws.id, name: 'Verbal Commit', position: 3, probability: 70, color: '#8b5cf6' },
      { workspace_id: ws.id, name: 'Closed Won', position: 4, probability: 100, is_won: true, color: '#10b981' },
      { workspace_id: ws.id, name: 'Closed Lost', position: 5, probability: 0, is_lost: true, color: '#ef4444' },
    ]);

    setActiveWorkspace(ws, 'owner');
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-8">
        <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold text-gray-900">Vantage PM</span>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Select a workspace</h1>
          <p className="text-sm text-gray-500 mt-1">Choose where you want to work, or create a new one.</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Existing workspaces */}
            {workspaces.map((item) => (
              <Card
                key={item.workspace.id}
                className="cursor-pointer border-gray-200 hover:border-indigo-400 hover:shadow-md transition-all group"
                onClick={() => handleSelect(item)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.workspace.logo_url ? (
                      <img src={item.workspace.logo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-white text-sm font-bold">
                        {item.workspace.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{item.workspace.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{item.role} · {item.workspace.plan} plan</p>
                  </div>
                  {selecting === item.workspace.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500 shrink-0" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                  )}
                </CardContent>
              </Card>
            ))}

            {/* Create new workspace toggle */}
            {!creating ? (
              <button
                className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all text-left group"
                onClick={() => setCreating(true)}
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-indigo-100 flex items-center justify-center shrink-0 transition-colors">
                  <Plus className="w-5 h-5 text-gray-400 group-hover:text-indigo-600 transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-600 group-hover:text-indigo-700 transition-colors">
                    {workspaces.length === 0 ? 'Create your first workspace' : 'Create a new workspace'}
                  </p>
                  <p className="text-xs text-gray-400">Set up a workspace for your team</p>
                </div>
              </button>
            ) : (
              <Card className="border-indigo-200 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-md bg-indigo-100 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-indigo-600" />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">New workspace</p>
                  </div>
                  <form onSubmit={handleCreate} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ws-name" className="text-xs">Workspace name</Label>
                      <Input
                        id="ws-name"
                        placeholder="Acme Corp"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                        autoFocus
                        className="h-8 text-sm"
                      />
                    </div>
                    {createError && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                        {createError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => { setCreating(false); setNewName(''); setCreateError(''); }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        className="flex-1 h-8 text-xs bg-indigo-600 hover:bg-indigo-700 gap-1"
                        disabled={createLoading || !newName.trim()}
                      >
                        {createLoading ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        {createLoading ? 'Creating...' : 'Create'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
