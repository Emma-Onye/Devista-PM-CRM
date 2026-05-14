import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import type { Profile, Workspace, MemberRole } from '../../lib/database.types';

async function activatePendingInvites(userId: string, email: string) {
  const { data: pending } = await (supabase as any)
    .from('workspace_members')
    .select('id')
    .eq('invited_email', email.toLowerCase())
    .eq('status', 'pending');

  if (!pending || pending.length === 0) return;

  for (const row of pending as { id: string }[]) {
    await (supabase as any)
      .from('workspace_members')
      .update({ user_id: userId, status: 'active', joined_at: new Date().toISOString() })
      .eq('id', row.id);
  }
}

async function loadProfile(userId: string, email: string | undefined, setProfile: (p: Profile | null) => void) {
  const { data } = await (supabase as any)
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  setProfile(data as Profile | null);
  if (email) activatePendingInvites(userId, email);
}

async function loadWorkspace(
  workspaceId: string,
  userId: string,
  setActiveWorkspace: (ws: Workspace | null, role: MemberRole | null) => void
) {
  const { data: wsData } = await (supabase as any)
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .maybeSingle();

  const ws = wsData as Workspace | null;
  if (!ws) return;

  const { data: memberData } = await (supabase as any)
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', ws.id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  setActiveWorkspace(ws, (memberData as { role: MemberRole } | null)?.role ?? null);
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { setSession, setProfile, setLoading } = useAuthStore();
  const { activeWorkspaceId, setActiveWorkspace, setWorkspaceLoading } = useWorkspaceStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);

      if (session?.user) {
        loadProfile(session.user.id, session.user.email, setProfile);
        if (activeWorkspaceId) {
          setWorkspaceLoading(true);
          loadWorkspace(activeWorkspaceId, session.user.id, setActiveWorkspace);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);

      if (session?.user) {
        loadProfile(session.user.id, session.user.email, setProfile);
        if (activeWorkspaceId) {
          setWorkspaceLoading(true);
          loadWorkspace(activeWorkspaceId, session.user.id, setActiveWorkspace);
        }
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return <>{children}</>;
}
