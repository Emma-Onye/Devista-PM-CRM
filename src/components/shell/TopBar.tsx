import { useCallback } from 'react';
import { Bell, LogOut, User, ChevronDown, ArrowLeftRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlobalSearch } from './GlobalSearch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

// ── Notification types ────────────────────────────────────────────────────────

interface Notification {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ROUTES: Record<string, (entityId: string) => string> = {
  project: (entityId) => `/projects/${entityId}`,
  task: () => `/tasks`,
  contact: (entityId) => `/contacts/${entityId}`,
  deal: (entityId) => `/deals/${entityId}`,
  document: (entityId) => `/documents/${entityId}`,
};

// ── TopBar ────────────────────────────────────────────────────────────────────

interface TopBarProps {
  className?: string;
}

export function TopBar({ className }: TopBarProps) {
  const { profile, user } = useAuthStore();
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  // ── Notifications query ──────────────────────────────────────────────────

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ['notifications', wsId, user?.id],
    enabled: !!wsId && !!user?.id,
    refetchInterval: 30_000, // Poll every 30s
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('notifications')
        .select('*')
        .eq('workspace_id', wsId!)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        // Table might not exist yet — fail silently
        console.warn('Notifications query failed (table may not exist):', error.message);
        return [];
      }
      return data as Notification[];
    },
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // ── Mark all read ────────────────────────────────────────────────────────

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from('notifications')
        .update({ is_read: true })
        .eq('workspace_id', wsId!)
        .eq('user_id', user!.id)
        .eq('is_read', false);
      if (error) throw error;
    },
    onMutate: () => {
      qc.setQueryData<Notification[]>(['notifications', wsId, user?.id], (old = []) =>
        old.map((n) => ({ ...n, is_read: true }))
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications', wsId, user?.id] });
    },
  });

  // ── Mark single read + navigate ──────────────────────────────────────────

  const handleNotificationClick = useCallback(async (n: Notification) => {
    if (!n.is_read) {
      await (supabase as any)
        .from('notifications')
        .update({ is_read: true })
        .eq('id', n.id);
      qc.invalidateQueries({ queryKey: ['notifications', wsId, user?.id] });
    }
    if (n.related_entity_type && n.related_entity_id) {
      const routeFn = TYPE_ROUTES[n.related_entity_type];
      if (routeFn) navigate(routeFn(n.related_entity_id));
    }
  }, [wsId, user?.id, navigate, qc]);

  // ── Group notifications ──────────────────────────────────────────────────

  const grouped = groupByDate(notifications);

  const handleSignOut = async () => {
    // Clear persisted workspace data to prevent tenant leakage on shared devices
    useWorkspaceStore.getState().setActiveWorkspace(null, null);
    useWorkspaceStore.getState().setActiveWorkspaceId(null);
    localStorage.removeItem('vantage-workspace');
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <header
      className={cn(
        'h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0',
        className
      )}
    >
      {/* Search */}
      <GlobalSearch />

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative w-8 h-8 text-gray-500 hover:text-gray-900">
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              <span className="sr-only">Notifications</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0 max-h-[420px] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                >
                  <Check className="w-3 h-3" /> Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <Bell className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No notifications yet</p>
                </div>
              ) : (
                Object.entries(grouped).map(([label, items]) => (
                  <div key={label}>
                    <p className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 bg-gray-50">
                      {label}
                    </p>
                    {items.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={cn(
                          'w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex gap-3',
                          !n.is_read && 'bg-indigo-50/40'
                        )}
                      >
                        {!n.is_read && (
                          <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-1.5" />
                        )}
                        <div className={cn('flex-1 min-w-0', n.is_read && 'ml-5')}>
                          <p className="text-sm font-medium text-gray-900 truncate">{n.title}</p>
                          {n.body && (
                            <p className="text-xs text-gray-500 truncate mt-0.5">{n.body}</p>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-100 transition-colors">
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <span className="text-indigo-700 text-xs font-semibold">
                    {profile?.display_name?.charAt(0).toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium text-gray-700 hidden sm:block max-w-[120px] truncate">
                {profile?.display_name ?? 'Account'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-gray-500 font-normal truncate">
              {profile?.display_name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => navigate('/settings/profile')}>
              <User className="w-4 h-4" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => navigate('/select-workspace')}>
              <ArrowLeftRight className="w-4 h-4" />
              Switch Workspace
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-red-600 cursor-pointer focus:text-red-600 focus:bg-red-50"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// ── Helper: group notifications by Today / Yesterday / Earlier ──────────────

function groupByDate(notifications: Notification[]): Record<string, Notification[]> {
  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const date = new Date(n.created_at);
    const label = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : 'Earlier';
    if (!groups[label]) groups[label] = [];
    groups[label].push(n);
  }
  return groups;
}
