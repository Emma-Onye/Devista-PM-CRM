import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft, Loader as Loader2, FileText, Phone, Mail, Calendar, MessageSquare,
  Plus, Building2, User, Tag, StickyNote, Globe, Briefcase, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Separator } from '../../components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import { LIFECYCLE_BADGE, LIFECYCLE_LABELS } from './ContactsPage';
import type {
  Contact, ContactSource, LifecycleStage, ActivityType, Activity, Deal, DealStage,
} from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactDetail extends Contact {
  companies: { id: string; name: string } | null;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

interface ActivityRow extends Activity {
  profiles: { display_name: string } | null;
}

interface DealRow extends Deal {
  deal_stages: DealStage | null;
}

interface MemberOption {
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

interface CompanyOption { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

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

const LIFECYCLE_OPTIONS: LifecycleStage[] = ['lead', 'qualified', 'opportunity', 'customer', 'churned'];
const SOURCE_OPTIONS: ContactSource[] = ['manual', 'import', 'web_form', 'referral'];
const ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'email', 'meeting'];

// ── InlineField ───────────────────────────────────────────────────────────────

function InlineField({
  label, value, onSave, icon: Icon, type = 'text', placeholder,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  icon?: React.ComponentType<{ className?: string }>;
  type?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div className="group flex items-start gap-2 py-2.5 border-b border-gray-100 last:border-0">
      {Icon && <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        {editing ? (
          <input
            ref={inputRef}
            type={type}
            className="w-full text-sm text-gray-900 bg-transparent border-b border-indigo-400 outline-none pb-0.5"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
            autoFocus
            placeholder={placeholder}
          />
        ) : (
          <button
            className="text-sm text-left w-full text-gray-900 hover:text-indigo-600 transition-colors truncate block"
            onClick={() => { setDraft(value); setEditing(true); }}
          >
            {value || <span className="text-gray-300 italic">{placeholder ?? 'Click to edit'}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

function InlineTextarea({
  label, value, onSave, icon: Icon,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div className="flex items-start gap-2 py-2.5 border-b border-gray-100 last:border-0">
      {Icon && <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        {editing ? (
          <textarea
            className="w-full text-sm text-gray-900 bg-transparent border border-indigo-300 rounded p-1 outline-none resize-none focus:ring-1 focus:ring-indigo-400"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
            autoFocus
          />
        ) : (
          <button
            className="text-sm text-left w-full text-gray-900 hover:text-indigo-600 transition-colors whitespace-pre-wrap break-words"
            onClick={() => { setDraft(value); setEditing(true); }}
          >
            {value || <span className="text-gray-300 italic">Click to add notes</span>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── ContactDetailPage ─────────────────────────────────────────────────────────

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  // Add activity dialog
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({
    type: 'note' as ActivityType,
    subject: '',
    body_text: '',
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: contact, isLoading } = useQuery<ContactDetail>({
    queryKey: ['contact', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contacts')
        .select('*, companies(id, name), profiles!contacts_owner_id_fkey(display_name, avatar_url)')
        .eq('id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .single();
      if (error) throw error;
      return data as ContactDetail;
    },
  });

  const { data: activities = [] } = useQuery<ActivityRow[]>({
    queryKey: ['contact-activities', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .select('*, profiles(display_name)')
        .eq('related_contact_id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ActivityRow[];
    },
  });

  const { data: deals = [] } = useQuery<DealRow[]>({
    queryKey: ['contact-deals', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('deals')
        .select('*, deal_stages(*)')
        .eq('contact_id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as DealRow[];
    },
  });

  const { data: members = [] } = useQuery<MemberOption[]>({
    queryKey: ['workspace-members-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workspace_members')
        .select('user_id, profiles(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('status', 'active');
      if (error) throw error;
      return data as MemberOption[];
    },
  });

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ['companies-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('companies').select('id, name').eq('workspace_id', activeWorkspace!.id).order('name');
      if (error) throw error;
      return data as CompanyOption[];
    },
  });

  // ── Update field mutation ─────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Contact>) => {
      const { error } = await (supabase as any)
        .from('contacts')
        .update(updates)
        .eq('id', id)
        .eq('workspace_id', activeWorkspace!.id);
      if (error) throw error;
    },
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: ['contact', id] });
      const prev = qc.getQueryData<ContactDetail>(['contact', id]);
      qc.setQueryData<ContactDetail>(['contact', id], (old) => old ? { ...old, ...updates } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['contact', id], ctx?.prev); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', activeWorkspace?.id] }); },
  });

  // ── Add activity mutation ─────────────────────────────────────────────────

  const addActivityMutation = useMutation({
    mutationFn: async (vals: typeof activityForm) => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .insert({
          workspace_id: activeWorkspace!.id,
          type: vals.type,
          subject: vals.subject.trim(),
          body_text: vals.body_text.trim() || null,
          related_contact_id: id,
          created_by: user!.id,
        })
        .select('*, profiles(display_name)')
        .single();
      if (error) throw error;
      return data as ActivityRow;
    },
    onMutate: async (vals) => {
      await qc.cancelQueries({ queryKey: ['contact-activities', id] });
      const prev = qc.getQueryData<ActivityRow[]>(['contact-activities', id]);
      const optimistic: ActivityRow = {
        id: `opt-${Date.now()}`,
        workspace_id: activeWorkspace!.id,
        type: vals.type,
        subject: vals.subject,
        body_text: vals.body_text || null,
        related_contact_id: id!,
        related_deal_id: null, related_task_id: null, related_project_id: null,
        created_by: user!.id,
        created_at: new Date().toISOString(),
        profiles: null,
      };
      qc.setQueryData<ActivityRow[]>(['contact-activities', id], (old = []) => [optimistic, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['contact-activities', id], ctx?.prev); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-activities', id] });
      setActivityOpen(false);
      setActivityForm({ type: 'note', subject: '', body_text: '' });
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-gray-400">Contact not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/contacts')}>Back to Contacts</Button>
      </div>
    );
  }

  const update = (field: keyof Contact, val: string | null) =>
    updateMutation.mutate({ [field]: val || null });

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white shrink-0">
        <Button variant="ghost" size="icon" className="w-7 h-7 text-gray-500" onClick={() => navigate('/contacts')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
            <span className="text-indigo-700 text-sm font-semibold">
              {contact.first_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">
              {contact.first_name} {contact.last_name}
            </h1>
            {contact.title && <p className="text-xs text-gray-400 truncate">{contact.title}</p>}
          </div>
        </div>
        <Badge className={`text-xs border shrink-0 ${LIFECYCLE_BADGE[contact.lifecycle_stage]}`} variant="outline">
          {LIFECYCLE_LABELS[contact.lifecycle_stage]}
        </Badge>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">

          {/* ── Left: Contact fields ─────────────────────────────────── */}
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact Info</p>

              <InlineField label="First name" value={contact.first_name} icon={User}
                onSave={(v) => updateMutation.mutate({ first_name: v })} />
              <InlineField label="Last name" value={contact.last_name} icon={User}
                onSave={(v) => updateMutation.mutate({ last_name: v })} />
              <InlineField label="Email" value={contact.email ?? ''} icon={Mail} type="email"
                onSave={(v) => update('email', v)} placeholder="Add email" />
              <InlineField label="Phone" value={contact.phone ?? ''} icon={Phone}
                onSave={(v) => update('phone', v)} placeholder="Add phone" />
              <InlineField label="Title / Role" value={contact.title ?? ''} icon={Briefcase}
                onSave={(v) => update('title', v)} placeholder="Add title" />

              {/* Company select */}
              <div className="flex items-start gap-2 py-2.5 border-b border-gray-100">
                <Building2 className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Company</p>
                  <Select
                    value={contact.company_id ?? '__none__'}
                    onValueChange={(v) => updateMutation.mutate({ company_id: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                      <SelectValue placeholder="No company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No company</SelectItem>
                      {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Lifecycle stage select */}
              <div className="flex items-start gap-2 py-2.5 border-b border-gray-100">
                <Globe className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Lifecycle stage</p>
                  <Select
                    value={contact.lifecycle_stage}
                    onValueChange={(v) => updateMutation.mutate({ lifecycle_stage: v as LifecycleStage })}
                  >
                    <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LIFECYCLE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{LIFECYCLE_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Source select */}
              <div className="flex items-start gap-2 py-2.5 border-b border-gray-100">
                <ExternalLink className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Source</p>
                  <Select
                    value={contact.source}
                    onValueChange={(v) => updateMutation.mutate({ source: v as ContactSource })}
                  >
                    <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Owner select */}
              <div className="flex items-start gap-2 py-2.5 border-b border-gray-100">
                <User className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Owner</p>
                  <Select
                    value={contact.owner_id ?? '__none__'}
                    onValueChange={(v) => updateMutation.mutate({ owner_id: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profiles?.display_name ?? m.user_id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tags */}
              <div className="flex items-start gap-2 py-2.5 border-b border-gray-100">
                <Tag className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Tags</p>
                  <InlineTagsField
                    tags={contact.tags}
                    onSave={(tags) => updateMutation.mutate({ tags })}
                  />
                </div>
              </div>

              <InlineTextarea label="Notes" value={contact.notes ?? ''} icon={StickyNote}
                onSave={(v) => update('notes', v)} />
            </div>

            {/* Added date */}
            <p className="text-xs text-gray-400 px-1">
              Added {format(new Date(contact.created_at), 'MMM d, yyyy')}
            </p>
          </div>

          {/* ── Right: Activity + Deals ──────────────────────────────── */}
          <div className="space-y-6">

            {/* Deals section */}
            {deals.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Deals</p>
                <div className="space-y-2">
                  {deals.map((deal) => (
                    <div key={deal.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{deal.name}</p>
                        {deal.expected_close_date && (
                          <p className="text-xs text-gray-400">
                            Close {format(new Date(deal.expected_close_date), 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {deal.deal_stages && (
                          <Badge variant="outline" className="text-xs" style={{ borderColor: deal.deal_stages.color, color: deal.deal_stages.color }}>
                            {deal.deal_stages.name}
                          </Badge>
                        )}
                        <span className="text-sm font-semibold text-gray-700">
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: deal.currency, maximumFractionDigits: 0 }).format(Number(deal.value))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity timeline */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Activity</p>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setActivityOpen(true)}
                >
                  <Plus className="w-3 h-3" /> Add Activity
                </Button>
              </div>

              {activities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="w-6 h-6 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No activity yet</p>
                  <Button size="sm" variant="ghost" className="mt-2 text-xs gap-1" onClick={() => setActivityOpen(true)}>
                    <Plus className="w-3 h-3" /> Log first activity
                  </Button>
                </div>
              ) : (
                <div className="space-y-0">
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
                            <time className="text-xs text-gray-400 whitespace-nowrap shrink-0" title={format(new Date(act.created_at), 'PPpp')}>
                              {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}
                            </time>
                          </div>
                          {act.body_text && (
                            <p className="text-sm text-gray-500 mt-0.5 line-clamp-3">{act.body_text}</p>
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

      {/* Add Activity Dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); addActivityMutation.mutate(activityForm); }}
            className="space-y-4 pt-1"
          >
            <div className="space-y-1.5">
              <Label htmlFor="act-type">Type</Label>
              <Select
                value={activityForm.type}
                onValueChange={(v) => setActivityForm((f) => ({ ...f, type: v as ActivityType }))}
              >
                <SelectTrigger id="act-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-subject">Subject *</Label>
              <Input
                id="act-subject" required
                value={activityForm.subject}
                onChange={(e) => setActivityForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. Follow-up call"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-body">Notes</Label>
              <Textarea
                id="act-body" rows={3}
                value={activityForm.body_text}
                onChange={(e) => setActivityForm((f) => ({ ...f, body_text: e.target.value }))}
                placeholder="What happened?"
              />
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
    </div>
  );
}

// ── InlineTagsField ───────────────────────────────────────────────────────────

function InlineTagsField({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags.join(', '));

  const commit = () => {
    setEditing(false);
    const next = draft.split(',').map((t) => t.trim()).filter(Boolean);
    if (JSON.stringify(next) !== JSON.stringify(tags)) onSave(next);
  };

  if (editing) {
    return (
      <input
        className="w-full text-sm text-gray-900 bg-transparent border-b border-indigo-400 outline-none pb-0.5"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(tags.join(', ')); setEditing(false); } }}
        autoFocus
        placeholder="e.g. vip, enterprise"
      />
    );
  }

  return (
    <button className="flex flex-wrap gap-1 text-left w-full" onClick={() => { setDraft(tags.join(', ')); setEditing(true); }}>
      {tags.length > 0
        ? tags.map((t) => (
            <span key={t} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t}</span>
          ))
        : <span className="text-gray-300 italic text-sm">Add tags</span>}
    </button>
  );
}
