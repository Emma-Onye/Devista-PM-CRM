import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { UserPlus, Loader as Loader2, CircleAlert as AlertCircle, MoveHorizontal as MoreHorizontal, ShieldCheck, UserX } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import type { MemberRole, MemberStatus } from '../../lib/database.types';

interface MemberRow {
  id: string;
  workspace_id: string;
  user_id: string | null;
  role: MemberRole;
  invited_email: string | null;
  status: MemberStatus;
  joined_at: string | null;
  profiles: {
    display_name: string;
    avatar_url: string | null;
  } | null;
}

const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

const ROLE_BADGE: Record<MemberRole, string> = {
  owner: 'bg-amber-100 text-amber-800 border-amber-200',
  admin: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  manager: 'bg-blue-100 text-blue-800 border-blue-200',
  member: 'bg-green-100 text-green-800 border-green-200',
  viewer: 'bg-gray-100 text-gray-700 border-gray-200',
};

const STATUS_BADGE: Record<MemberStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  deactivated: 'bg-red-100 text-red-700',
};

function MemberAvatar({ member }: { member: MemberRow }) {
  const name = member.profiles?.display_name ?? member.invited_email ?? '?';
  const initial = name.charAt(0).toUpperCase();
  if (member.profiles?.avatar_url) {
    return (
      <img
        src={member.profiles.avatar_url}
        alt={name}
        className="w-8 h-8 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
      <span className="text-indigo-700 text-xs font-semibold">{initial}</span>
    </div>
  );
}

export function MembersPage() {
  const { activeWorkspace, myRole } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [inviteError, setInviteError] = useState('');

  // Role change confirmation
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ member: MemberRow; newRole: MemberRole } | null>(null);

  // Remove member confirmation
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);

  const canManage = myRole === 'owner' || myRole === 'admin';

  // ── Query ──────────────────────────────────────────────────
  const { data: members = [], isLoading } = useQuery<MemberRow[]>({
    queryKey: ['workspace-members', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workspace_members')
        .select('*, profiles(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id)
        .neq('status', 'deactivated')
        .order('joined_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as MemberRow[];
    },
  });

  // ── Invite mutation ────────────────────────────────────────
  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: MemberRole }) => {
      // Check for existing active/pending member with same email
      const { data: existing } = await (supabase as any)
        .from('workspace_members')
        .select('id, status')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('invited_email', email)
        .maybeSingle();

      if (existing && existing.status !== 'deactivated') {
        throw new Error('This email has already been invited.');
      }

      const { data, error } = await (supabase as any)
        .from('workspace_members')
        .insert({
          workspace_id: activeWorkspace!.id,
          role,
          invited_email: email,
          status: 'pending',
        })
        .select('*, profiles(display_name, avatar_url)')
        .single();

      if (error) throw error;
      return data as MemberRow;
    },
    onMutate: async ({ email, role }) => {
      await qc.cancelQueries({ queryKey: ['workspace-members', activeWorkspace?.id] });
      const prev = qc.getQueryData<MemberRow[]>(['workspace-members', activeWorkspace?.id]);
      const optimistic: MemberRow = {
        id: `optimistic-${Date.now()}`,
        workspace_id: activeWorkspace!.id,
        user_id: null,
        role,
        invited_email: email,
        status: 'pending',
        joined_at: null,
        profiles: null,
      };
      qc.setQueryData<MemberRow[]>(['workspace-members', activeWorkspace?.id], (old = []) => [
        ...old,
        optimistic,
      ]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(['workspace-members', activeWorkspace?.id], ctx?.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', activeWorkspace?.id] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('member');
      setInviteError('');
    },
  });

  // ── Role change mutation ───────────────────────────────────
  const roleMutation = useMutation({
    mutationFn: async ({ memberId, newRole }: { memberId: string; newRole: MemberRole }) => {
      const { error } = await (supabase as any)
        .from('workspace_members')
        .update({ role: newRole })
        .eq('id', memberId)
        .eq('workspace_id', activeWorkspace!.id);
      if (error) throw error;
    },
    onMutate: async ({ memberId, newRole }) => {
      await qc.cancelQueries({ queryKey: ['workspace-members', activeWorkspace?.id] });
      const prev = qc.getQueryData<MemberRow[]>(['workspace-members', activeWorkspace?.id]);
      qc.setQueryData<MemberRow[]>(['workspace-members', activeWorkspace?.id], (old = []) =>
        old.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(['workspace-members', activeWorkspace?.id], ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', activeWorkspace?.id] });
      setRoleChangeTarget(null);
    },
  });

  // ── Remove mutation ────────────────────────────────────────
  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await (supabase as any)
        .from('workspace_members')
        .update({ status: 'deactivated' })
        .eq('id', memberId)
        .eq('workspace_id', activeWorkspace!.id);
      if (error) throw error;
    },
    onMutate: async (memberId) => {
      await qc.cancelQueries({ queryKey: ['workspace-members', activeWorkspace?.id] });
      const prev = qc.getQueryData<MemberRow[]>(['workspace-members', activeWorkspace?.id]);
      qc.setQueryData<MemberRow[]>(['workspace-members', activeWorkspace?.id], (old = []) =>
        old.filter((m) => m.id !== memberId)
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(['workspace-members', activeWorkspace?.id], ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', activeWorkspace?.id] });
      setRemoveTarget(null);
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate(
      { email: inviteEmail.trim().toLowerCase(), role: inviteRole },
      { onError: (err) => setInviteError((err as Error).message) }
    );
  };

  const handleRoleChange = (member: MemberRow, newRole: MemberRole) => {
    // Owners can only be demoted by themselves
    if (member.role === 'owner' && member.user_id !== user?.id) return;
    setRoleChangeTarget({ member, newRole });
  };

  if (!activeWorkspace) {
    return <div className="p-4 sm:p-8 text-sm text-gray-400">No workspace selected.</div>;
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Members</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage who has access to this workspace.
          </p>
        </div>
        {canManage && (
          <Button
            className="bg-indigo-600 hover:bg-indigo-700 gap-2"
            size="sm"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="w-4 h-4" />
            Invite member
          </Button>
        )}
      </div>

      {/* Members table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="w-64">Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="text-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
                </TableCell>
              </TableRow>
            ) : members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="text-center py-12 text-sm text-gray-400">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => {
                const displayName = member.profiles?.display_name ?? member.invited_email ?? 'Unknown';
                const isSelf = member.user_id === user?.id;
                const isOwner = member.role === 'owner';
                const canChangeRole = canManage && (!isOwner || isSelf);
                const canRemove = canManage && !isSelf;

                return (
                  <TableRow key={member.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <MemberAvatar member={member} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {displayName}
                            {isSelf && (
                              <span className="ml-1.5 text-xs text-gray-400 font-normal">(you)</span>
                            )}
                          </p>
                          {member.invited_email && member.status === 'pending' && (
                            <p className="text-xs text-gray-400 truncate">{member.invited_email}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {canChangeRole && member.role !== 'owner' ? (
                        <Select
                          value={member.role}
                          onValueChange={(val) => handleRoleChange(member, val as MemberRole)}
                        >
                          <SelectTrigger className="w-32 h-7 text-xs border-gray-200 focus:ring-indigo-500">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${ROLE_BADGE[member.role]}`}
                        >
                          {member.role === 'owner' && <ShieldCheck className="w-3 h-3 mr-1" />}
                          {member.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-xs capitalize ${STATUS_BADGE[member.status]}`}
                      >
                        {member.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {member.joined_at
                        ? format(new Date(member.joined_at), 'MMM d, yyyy')
                        : '—'}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        {canRemove && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600 gap-2 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                                onClick={() => setRemoveTarget(member)}
                              >
                                <UserX className="w-4 h-4" />
                                Remove from workspace
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Invite Dialog ─────────────────────────────────── */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) { setInviteEmail(''); setInviteRole('member'); setInviteError(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
            <DialogDescription>
              They'll be added as pending and activated when they sign up with this email.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit}>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as MemberRole)}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {inviteError && (
                <p className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {inviteError}
                </p>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700"
                disabled={inviteMutation.isPending || !inviteEmail.trim()}
              >
                {inviteMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Inviting...</>
                ) : (
                  'Send invite'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Role Change Confirmation ───────────────────────── */}
      <AlertDialog open={!!roleChangeTarget} onOpenChange={(o) => !o && setRoleChangeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change role?</AlertDialogTitle>
            <AlertDialogDescription>
              {roleChangeTarget && (
                <>
                  Change{' '}
                  <strong>
                    {roleChangeTarget.member.profiles?.display_name ??
                      roleChangeTarget.member.invited_email}
                  </strong>{' '}
                  from <strong className="capitalize">{roleChangeTarget.member.role}</strong> to{' '}
                  <strong className="capitalize">{roleChangeTarget.newRole}</strong>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() =>
                roleChangeTarget &&
                roleMutation.mutate({
                  memberId: roleChangeTarget.member.id,
                  newRole: roleChangeTarget.newRole,
                })
              }
            >
              Confirm change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Remove Member Confirmation ─────────────────────── */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && (
                <>
                  Remove{' '}
                  <strong>
                    {removeTarget.profiles?.display_name ?? removeTarget.invited_email}
                  </strong>{' '}
                  from <strong>{activeWorkspace.name}</strong>? They will lose access immediately.
                  This can be undone by inviting them again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
