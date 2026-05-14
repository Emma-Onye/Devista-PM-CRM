import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Loader as Loader2, Handshake, Building2, FileText, Phone, Mail, Calendar, MessageSquare, Plus, Trophy, Circle as XCircle, ExternalLink, FolderKanban } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Separator } from '../../components/ui/separator';
import { Textarea } from '../../components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { cn } from '../../lib/utils';
import { fmtCurrency } from './DealsPage';
import type { Deal, DealStage, Activity, ActivityType } from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DealDetail extends Deal {
  deal_stages: DealStage | null;
  contact: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null } | null;
  company: { id: string; name: string; domain: string | null } | null;
  assignee: { display_name: string; avatar_url: string | null } | null;
  project: { id: string; name: string } | null;
}

interface ActivityRow extends Activity {
  profiles: { display_name: string } | null;
}

interface MemberOption {
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'JPY'];
const ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'email', 'meeting'];

const ACTIVITY_ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  note: FileText, call: Phone, email: Mail, meeting: Calendar,
  task_update: MessageSquare, deal_update: MessageSquare, status_change: MessageSquare,
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  note: 'bg-gray-100 text-gray-600', call: 'bg-green-100 text-green-600',
  email: 'bg-blue-100 text-blue-600', meeting: 'bg-amber-100 text-amber-600',
  task_update: 'bg-violet-100 text-violet-600', deal_update: 'bg-indigo-100 text-indigo-600',
  status_change: 'bg-slate-100 text-slate-600',
};

// ── InlineField ───────────────────────────────────────────────────────────────

function InlineField({ label, value, onSave, type = 'text', placeholder }: {
  label: string; value: string; onSave: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { setEditing(false); if (draft !== value) onSave(draft); };
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      {editing ? (
        <input type={type}
          className="w-full text-sm text-gray-900 bg-transparent border-b border-indigo-400 outline-none pb-0.5"
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
          autoFocus placeholder={placeholder} />
      ) : (
        <button className="text-sm text-left w-full text-gray-900 hover:text-indigo-600 transition-colors truncate block"
          onClick={() => { setDraft(value); setEditing(true); }}>
          {value || <span className="text-gray-300 italic">{placeholder ?? 'Click to edit'}</span>}
        </button>
      )}
    </div>
  );
}

// ── DealDetailPage ────────────────────────────────────────────────────────────

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [activityOpen, setActivityOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({ type: 'note' as ActivityType, subject: '', body_text: '' });
  const [wonConfirm, setWonConfirm] = useState(false);
  const [lostConfirm, setLostConfirm] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: deal, isLoading } = useQuery<DealDetail>({
    queryKey: ['deal', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('deals')
        .select(`
          *,
          deal_stages(*),
          contact:contacts!deals_contact_id_fkey(id,first_name,last_name,email,phone),
          company:companies!deals_company_id_fkey(id,name,domain),
          assignee:profiles!deals_assigned_to_fkey(display_name,avatar_url),
          project:projects!deals_project_id_fkey(id,name)
        `)
        .eq('id', id).eq('workspace_id', activeWorkspace!.id).single();
      if (error) throw error;
      return data as DealDetail;
    },
  });

  const { data: stages = [] } = useQuery<DealStage[]>({
    queryKey: ['deal-stages', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('deal_stages').select('*')
        .eq('workspace_id', activeWorkspace!.id).order('position');
      if (error) throw error;
      return data as DealStage[];
    },
  });

  const { data: activities = [] } = useQuery<ActivityRow[]>({
    queryKey: ['deal-activities', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .select('*, profiles(display_name)')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('related_deal_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ActivityRow[];
    },
  });

  const { data: members = [] } = useQuery<MemberOption[]>({
    queryKey: ['workspace-members-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('workspace_members')
        .select('user_id,profiles(display_name,avatar_url)')
        .eq('workspace_id', activeWorkspace!.id).eq('status', 'active');
      return data as MemberOption[];
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Deal>) => {
      const { error } = await (supabase as any)
        .from('deals').update(updates).eq('id', id);
      if (error) throw error;
    },
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: ['deal', id] });
      const prev = qc.getQueryData<DealDetail>(['deal', id]);
      qc.setQueryData<DealDetail>(['deal', id], (old) => old ? { ...old, ...updates } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['deal', id], ctx?.prev); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deals', activeWorkspace?.id] }); },
  });

  const closeWonMutation = useMutation({
    mutationFn: async () => {
      const wonStage = stages.find((s) => s.is_won);
      if (!wonStage) throw new Error('No Won stage configured');
      const { error } = await (supabase as any)
        .from('deals').update({ deal_stage_id: wonStage.id, closed_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deal', id] });
      qc.invalidateQueries({ queryKey: ['deals', activeWorkspace?.id] });
      setWonConfirm(false);
    },
  });

  const closeLostMutation = useMutation({
    mutationFn: async () => {
      const lostStage = stages.find((s) => s.is_lost);
      if (!lostStage) throw new Error('No Lost stage configured');
      const { error } = await (supabase as any)
        .from('deals').update({ deal_stage_id: lostStage.id, closed_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deal', id] });
      qc.invalidateQueries({ queryKey: ['deals', activeWorkspace?.id] });
      setLostConfirm(false);
    },
  });

  const addActivityMutation = useMutation({
    mutationFn: async (vals: typeof activityForm) => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .insert({
          workspace_id: activeWorkspace!.id,
          type: vals.type, subject: vals.subject.trim(),
          body_text: vals.body_text.trim() || null,
          related_deal_id: id,
          created_by: user!.id,
        })
        .select('*, profiles(display_name)').single();
      if (error) throw error;
      return data as ActivityRow;
    },
    onMutate: async (vals) => {
      await qc.cancelQueries({ queryKey: ['deal-activities', id] });
      const prev = qc.getQueryData<ActivityRow[]>(['deal-activities', id]);
      const optimistic: ActivityRow = {
        id: `opt-${Date.now()}`, workspace_id: activeWorkspace!.id,
        type: vals.type, subject: vals.subject, body_text: vals.body_text || null,
        related_contact_id: null, related_deal_id: id!, related_task_id: null, related_project_id: null,
        created_by: user!.id, created_at: new Date().toISOString(), profiles: null,
      };
      qc.setQueryData<ActivityRow[]>(['deal-activities', id], (old = []) => [optimistic, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['deal-activities', id], ctx?.prev); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deal-activities', id] });
      setActivityOpen(false);
      setActivityForm({ type: 'note', subject: '', body_text: '' });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const update = (field: keyof Deal, val: string | number | null) =>
    updateMutation.mutate({ [field]: val });

  const currentStageIndex = stages.findIndex((s) => s.id === deal?.deal_stage_id);
  const currentStage = stages[currentStageIndex];
  const isWon = currentStage?.is_won;
  const isLost = currentStage?.is_lost;

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-gray-400">Deal not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/deals')}>Back to Deals</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" className="w-7 h-7 text-gray-500" onClick={() => navigate('/deals')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
              isWon ? 'bg-emerald-100' : isLost ? 'bg-red-100' : 'bg-indigo-100'
            )}>
              <Handshake className={cn('w-4 h-4',
                isWon ? 'text-emerald-600' : isLost ? 'text-red-500' : 'text-indigo-600')} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{deal.name}</h1>
              <p className={cn('text-sm font-semibold',
                isWon ? 'text-emerald-600' : isLost ? 'text-red-500' : 'text-gray-500')}>
                {fmtCurrency(Number(deal.value), deal.currency)}
              </p>
            </div>
          </div>

          {/* Won / Lost buttons */}
          {!isWon && !isLost && (
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline"
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-1.5"
                onClick={() => setWonConfirm(true)}>
                <Trophy className="w-3.5 h-3.5" /> Won
              </Button>
              <Button size="sm" variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50 gap-1.5"
                onClick={() => setLostConfirm(true)}>
                <XCircle className="w-3.5 h-3.5" /> Lost
              </Button>
            </div>
          )}
          {(isWon || isLost) && (
            <Badge className={cn('text-sm px-3 py-1',
              isWon ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200')}
              variant="outline">
              {isWon ? '🏆 Won' : '❌ Lost'} · {deal.closed_at ? format(new Date(deal.closed_at), 'MMM d, yyyy') : ''}
            </Badge>
          )}
        </div>

        {/* Stage progress bar */}
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {stages.map((stage, i) => {
            const isCurrent = stage.id === deal.deal_stage_id;
            const isPast = i < currentStageIndex && !stage.is_lost;
            return (
              <button
                key={stage.id}
                className={cn(
                  'flex items-center h-7 px-3 text-xs font-medium whitespace-nowrap transition-all shrink-0',
                  'border-t border-b first:border-l first:rounded-l-md last:border-r last:rounded-r-md',
                  isCurrent
                    ? 'text-white border-transparent'
                    : isPast
                      ? 'text-white bg-gray-400 border-gray-400'
                      : 'text-gray-400 bg-gray-50 border-gray-200 hover:border-gray-300 hover:text-gray-600',
                  i > 0 ? 'border-l-0' : ''
                )}
                style={isCurrent ? { background: stage.color, borderColor: stage.color } : {}}
                onClick={() => !isCurrent && update('deal_stage_id', stage.id)}
                title={`Move to ${stage.name}`}
              >
                {stage.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">

          {/* ── Left: Field panel ─────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Deal Info</p>

              <InlineField label="Deal name" value={deal.name} onSave={(v) => update('name', v)} />

              {/* Value + currency inline */}
              <div className="py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Value</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0"
                    className="flex-1 text-sm text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 outline-none pb-0.5 transition-colors"
                    defaultValue={deal.value}
                    onBlur={(e) => update('value', Number(e.target.value))}
                  />
                  <Select value={deal.currency} onValueChange={(v) => update('currency', v)}>
                    <SelectTrigger className="h-6 w-20 text-xs border-0 p-0 shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Stage select */}
              <div className="py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Stage</p>
                <Select value={deal.deal_stage_id}
                  onValueChange={(v) => update('deal_stage_id', v)}>
                  <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Assigned to */}
              <div className="py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Assigned to</p>
                <Select value={deal.assigned_to ?? '__none__'}
                  onValueChange={(v) => update('assigned_to', v === '__none__' ? null : v)}>
                  <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profiles?.display_name ?? m.user_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <InlineField label="Expected close date" value={deal.expected_close_date ?? ''} type="date"
                onSave={(v) => update('expected_close_date', v || null)} />

              {deal.closed_at && (
                <InlineField label="Closed date" value={format(new Date(deal.closed_at), 'yyyy-MM-dd')} type="date"
                  onSave={(v) => update('closed_at', v || null)} />
              )}
            </div>

            {/* Linked contact */}
            {deal.contact && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact</p>
                <button
                  className="w-full text-left hover:bg-indigo-50/40 rounded-md p-2 -mx-2 transition-colors group"
                  onClick={() => navigate(`/contacts/${deal.contact!.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <span className="text-indigo-700 text-xs font-semibold">
                        {deal.contact.first_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700">
                        {deal.contact.first_name} {deal.contact.last_name}
                      </p>
                      {deal.contact.email && (
                        <p className="text-xs text-gray-400 truncate">{deal.contact.email}</p>
                      )}
                    </div>
                    <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-indigo-500" />
                  </div>
                </button>
              </div>
            )}

            {/* Linked company */}
            {deal.company && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Company</p>
                <button
                  className="w-full text-left hover:bg-indigo-50/40 rounded-md p-2 -mx-2 transition-colors group"
                  onClick={() => navigate(`/companies/${deal.company!.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                      <Building2 className="w-3.5 h-3.5 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700">
                        {deal.company.name}
                      </p>
                      {deal.company.domain && (
                        <p className="text-xs text-gray-400 truncate">{deal.company.domain}</p>
                      )}
                    </div>
                    <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-indigo-500" />
                  </div>
                </button>
              </div>
            )}

            {/* Linked project */}
            {deal.project && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Project</p>
                <button
                  className="w-full text-left hover:bg-indigo-50/40 rounded-md p-2 -mx-2 transition-colors group"
                  onClick={() => navigate(`/projects/${deal.project!.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
                      <FolderKanban className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700">
                        {deal.project.name}
                      </p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-indigo-500" />
                  </div>
                </button>
              </div>
            )}

            <p className="text-xs text-gray-400 px-1">
              Created {format(new Date(deal.created_at), 'MMM d, yyyy')}
            </p>
          </div>

          {/* ── Right: Activity feed ──────────────────────────────────── */}
          <div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-gray-700">Activity</p>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => setActivityOpen(true)}>
                  <Plus className="w-3 h-3" /> Log Activity
                </Button>
              </div>

              {activities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <FileText className="w-6 h-6 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No activity yet</p>
                  <Button size="sm" variant="ghost" className="mt-2 text-xs gap-1"
                    onClick={() => setActivityOpen(true)}>
                    <Plus className="w-3 h-3" /> Log first activity
                  </Button>
                </div>
              ) : (
                <div>
                  {activities.map((act, i) => {
                    const Icon = ACTIVITY_ICON[act.type] ?? FileText;
                    return (
                      <div key={act.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${ACTIVITY_COLORS[act.type]}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          {i < activities.length - 1 && <div className="w-px flex-1 bg-gray-100 my-1" />}
                        </div>
                        <div className="pb-4 flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-gray-900">{act.subject}</p>
                            <time className="text-xs text-gray-400 whitespace-nowrap shrink-0"
                              title={format(new Date(act.created_at), 'PPpp')}>
                              {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}
                            </time>
                          </div>
                          {act.body_text && (
                            <p className="text-sm text-gray-500 mt-0.5 whitespace-pre-line">{act.body_text}</p>
                          )}
                          {act.profiles && (
                            <p className="text-xs text-gray-400 mt-1">by {act.profiles.display_name}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log Activity Dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); addActivityMutation.mutate(activityForm); }} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={activityForm.type} onValueChange={(v) => setActivityForm((f) => ({ ...f, type: v as ActivityType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-subject">Subject *</Label>
              <Input id="act-subject" required value={activityForm.subject}
                onChange={(e) => setActivityForm((f) => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-body">Notes</Label>
              <Textarea id="act-body" rows={3} value={activityForm.body_text}
                onChange={(e) => setActivityForm((f) => ({ ...f, body_text: e.target.value }))} />
            </div>
            {addActivityMutation.isError && (
              <p className="text-sm text-red-600">{(addActivityMutation.error as Error).message}</p>
            )}
            <Separator />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setActivityOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" disabled={addActivityMutation.isPending}>
                {addActivityMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Log Activity
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Won confirmation */}
      <AlertDialog open={wonConfirm} onOpenChange={setWonConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Won?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the deal to "Closed Won" and set the close date to today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => closeWonMutation.mutate()}
            >
              {closeWonMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark Won'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lost confirmation */}
      <AlertDialog open={lostConfirm} onOpenChange={setLostConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Lost?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the deal to "Closed Lost" and set the close date to today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => closeLostMutation.mutate()}
            >
              {closeLostMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark Lost'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
