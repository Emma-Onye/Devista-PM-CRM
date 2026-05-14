import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader as Loader2, Check, CircleAlert as AlertCircle, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { Workspace } from '../../lib/database.types';

export function GeneralSettingsPage() {
  const { activeWorkspace, myRole, setActiveWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();

  const [name, setName] = useState(activeWorkspace?.name ?? '');
  const [nameSuccess, setNameSuccess] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = myRole === 'owner' || myRole === 'admin';

  const updateNameMutation = useMutation({
    mutationFn: async (newName: string) => {
      if (!activeWorkspace) throw new Error('No workspace');
      const { data, error } = await (supabase as any)
        .from('workspaces')
        .update({ name: newName })
        .eq('id', activeWorkspace.id)
        .select()
        .single();
      if (error) throw error;
      return data as Workspace;
    },
    onSuccess: (updated) => {
      setActiveWorkspace(updated, myRole);
      qc.invalidateQueries({ queryKey: ['workspace', activeWorkspace?.id] });
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 2500);
    },
  });

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === activeWorkspace?.name) return;
    updateNameMutation.mutate(trimmed);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWorkspace) return;
    setLogoError('');
    setLogoUploading(true);

    try {
      const ext = file.name.split('.').pop();
      const path = `${activeWorkspace.id}/logo.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('workspace-logos')
        .upload(path, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from('workspace-logos')
        .getPublicUrl(path);

      // Bust cache by appending timestamp
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { data: updated, error: updateErr } = await (supabase as any)
        .from('workspaces')
        .update({ logo_url: publicUrl })
        .eq('id', activeWorkspace.id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      setActiveWorkspace(updated as Workspace, myRole);
      qc.invalidateQueries({ queryKey: ['workspace', activeWorkspace.id] });
    } catch (err: any) {
      setLogoError(err.message ?? 'Upload failed');
    } finally {
      setLogoUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!activeWorkspace) {
    return (
      <div className="p-8 text-sm text-gray-400">No workspace selected.</div>
    );
  }

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">General Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your workspace name and branding.</p>
      </div>

      {/* Workspace Logo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Workspace Logo</CardTitle>
          <CardDescription>Appears in the sidebar and workspace switcher. Max 2 MB.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-xl bg-indigo-600 flex items-center justify-center overflow-hidden shrink-0 border border-gray-200">
            {activeWorkspace.logo_url ? (
              <img
                src={activeWorkspace.logo_url}
                alt="Workspace logo"
                className="w-full h-full object-cover"
              />
            ) : (
              <Building2 className="w-8 h-8 text-white" />
            )}
          </div>

          <div className="space-y-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={handleLogoUpload}
              disabled={!canEdit || logoUploading}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!canEdit || logoUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {logoUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {logoUploading ? 'Uploading...' : 'Upload logo'}
            </Button>
            {logoError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {logoError}
              </p>
            )}
            {!canEdit && (
              <p className="text-xs text-gray-400">Only owners and admins can change the logo.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Workspace Name */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Workspace Name</CardTitle>
          <CardDescription>This is the display name for your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleNameSubmit} className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
                placeholder="Workspace name"
                className="max-w-sm"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 mb-0.5"
              disabled={!canEdit || !name.trim() || name.trim() === activeWorkspace.name || updateNameMutation.isPending}
            >
              {updateNameMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : nameSuccess ? (
                <Check className="w-3.5 h-3.5" />
              ) : null}
              {updateNameMutation.isPending ? 'Saving...' : nameSuccess ? 'Saved' : 'Save'}
            </Button>
          </form>
          {updateNameMutation.isError && (
            <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {(updateNameMutation.error as Error).message}
            </p>
          )}
          {!canEdit && (
            <p className="text-xs text-gray-400 mt-2">Only owners and admins can rename this workspace.</p>
          )}
        </CardContent>
      </Card>

      {/* Workspace Details (read-only) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Workspace Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-gray-500">Slug</Label>
            <div className="flex items-center gap-2">
              <Input
                value={activeWorkspace.slug}
                readOnly
                className="max-w-sm bg-gray-50 text-gray-500 cursor-default"
              />
              <span className="text-xs text-gray-400">Read-only</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-500">Plan</Label>
            <div>
              <Badge
                variant="secondary"
                className={
                  activeWorkspace.plan === 'enterprise'
                    ? 'bg-amber-100 text-amber-800'
                    : activeWorkspace.plan === 'pro'
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'bg-gray-100 text-gray-700'
                }
              >
                {activeWorkspace.plan.charAt(0).toUpperCase() + activeWorkspace.plan.slice(1)}
              </Badge>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-500">Your role</Label>
            <div>
              <Badge variant="outline" className="capitalize">
                {myRole ?? 'unknown'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
