import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Layers, ArrowRight } from 'lucide-react';
import type { Workspace } from '../../lib/database.types';

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { setActiveWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setLoading(true);

    const slug = slugify(name) || 'workspace';
    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    // Single atomic RPC call: creates workspace + owner membership + deal stages
    // Uses SECURITY DEFINER to bypass the chicken-and-egg RLS problem
    const { data, error: rpcErr } = await supabase.rpc('create_workspace_with_owner', {
      ws_name: name,
      ws_slug: uniqueSlug,
    });

    if (rpcErr || !data) {
      setError(rpcErr?.message ?? 'Failed to create workspace');
      setLoading(false);
      return;
    }

    const ws = data as unknown as Workspace;
    setActiveWorkspace(ws, 'owner');
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 mb-8">
        <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold text-gray-900">Vantage PM</span>
      </div>

      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Create your workspace</CardTitle>
          <CardDescription>A workspace is the hub for your team's projects and deals.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ws_name">Workspace name</Label>
              <Input
                id="ws_name"
                placeholder="Acme Corp"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 gap-2"
              disabled={loading || !name.trim()}
            >
              {loading ? 'Creating...' : 'Create workspace'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
