import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import type { Profile, Workspace, MemberRole } from '../../lib/database.types';

async function activatePendingInvites(userId: string, email: string) {
  try {
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
  } catch (err) {
    console.warn('Failed to activate pending invites:', err);
  }
}

async function loadProfile(userId: string, setProfile: (p: Profile | null) => void) {
  try {
    const { data } = await (supabase as any)
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data as Profile | null);
  } catch (err) {
    console.warn('Failed to load profile:', err);
    setProfile(null);
  }
}

async function loadWorkspace(
  workspaceId: string,
  userId: string,
  setActiveWorkspace: (ws: Workspace | null, role: MemberRole | null) => void
) {
  try {
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
  } catch (err) {
    console.warn('Failed to load workspace:', err);
  }
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
        loadProfile(session.user.id, setProfile);
        if (activeWorkspaceId) {
          setWorkspaceLoading(true);
          loadWorkspace(activeWorkspaceId, session.user.id, setActiveWorkspace);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Intercept password recovery — redirect to reset page before anything else
      if (event === 'PASSWORD_RECOVERY') {
        setSession(session);
        if (window.location.pathname !== '/reset-password') {
          window.location.replace('/reset-password');
        }
        return;
      }

      setSession(session);

      if (session?.user) {
        loadProfile(session.user.id, setProfile);
        // Only activate pending invites on fresh sign-in, not every auth change
        if (event === 'SIGNED_IN' && session.user.email) {
          activatePendingInvites(session.user.id, session.user.email);
        }
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
