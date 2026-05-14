import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft, Loader as Loader2, Building2, Globe, Phone,
  Users, DollarSign, TrendingUp, Plus, FileText, Mail, Calendar,
  MessageSquare, ExternalLink,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '../../components/ui/sheet';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../../components/ui/command';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '../../components/ui/popover';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { INDUSTRIES, INDUSTRY_COLORS } from './CompaniesPage';
import { LIFECYCLE_BADGE, LIFECYCLE_LABELS } from '../contacts/ContactsPage';
import type {
  Company, Contact, Deal, DealStage, Activity, ActivityType, ContactSource, LifecycleStage,
} from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactRow extends Contact {
  profiles: { display_name: string; avatar_url: string | null } | null;
}

interface DealRow extends Deal {
  deal_stages: DealStage | null;
  profiles: { display_name: string } | null;
}

interface ActivityRow extends Activity {
  profiles: { display_name: string } | null;
}

interface MemberOption {
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Finland',
  'Switzerland', 'Austria', 'Belgium', 'Spain', 'Italy', 'Portugal',
  'Japan', 'South Korea', 'China', 'India', 'Singapore', 'UAE',
  'Brazil', 'Mexico', 'Argentina', 'South Africa', 'Nigeria', 'Kenya',
  'New Zealand', 'Ireland', 'Israel', 'Poland', 'Czech Republic', 'Hungary',
];

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
  label, value, onSave, type = 'text', placeholder,
}: {
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
        <input
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
  );
}

// ── CompanyDetailPage ─────────────────────────────────────────────────────────

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [activityOpen, setActivityOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({ type: 'note' as ActivityType, subject: '', body_text: '' });
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    title: '', source: 'manual' as ContactSource, lifecycle_stage: 'lead' as LifecycleStage,
    owner_id: user?.id ?? '', tags: '', notes: '',
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ['company', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('companies').select('*')
        .eq('id', id).eq('workspace_id', activeWorkspace!.id).single();
      if (error) throw error;
      return data as Company;
    },
  });

  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['company-contacts', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contacts')
        .select('*, profiles!contacts_owner_id_fkey(display_name, avatar_url)')
        .eq('company_id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ContactRow[];
    },
  });

  const { data: deals = [] } = useQuery<DealRow[]>({
    queryKey: ['company-deals', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('deals')
        .select('*, deal_stages(*), profiles!deals_assigned_to_fkey(display_name)')
        .eq('company_id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as DealRow[];
    },
  });

  const { data: activities = [] } = useQuery<ActivityRow[]>({
    queryKey: ['company-activities', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      // Get contact IDs for this company
      const { data: contactIds } = await (supabase as any)
        .from('contacts').select('id').eq('company_id', id).eq('workspace_id', activeWorkspace!.id);
      const { data: dealIds } = await (supabase as any)
        .from('deals').select('id').eq('company_id', id).eq('workspace_id', activeWorkspace!.id);

      const cids = (contactIds ?? []).map((r: { id: string }) => r.id);
      const dids = (dealIds ?? []).map((r: { id: string }) => r.id);

      if (cids.length === 0 && dids.length === 0) return [];

      const filters: string[] = [];
      if (cids.length > 0) filters.push(`related_contact_id.in.(${cids.join(',')})`);
      if (dids.length > 0) filters.push(`related_deal_id.in.(${dids.join(',')})`);

      const { data, error } = await (supabase as any)
        .from('activities')
        .select('*, profiles(display_name)')
        .eq('workspace_id', activeWorkspace!.id)
        .or(filters.join(','))
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ActivityRow[];
    },
  });

  const { data: members = [] } = useQuery<MemberOption[]>({
    queryKey: ['workspace-members-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workspace_members')
        .select('user_id, profiles(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id).eq('status', 'active');
      if (error) throw error;
      return data as MemberOption[];
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Company>) => {
      const { error } = await (supabase as any)
        .from('companies').update(updates).eq('id', id).eq('workspace_id', activeWorkspace!.id);
      if (error) throw error;
    },
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: ['company', id] });
      const prev = qc.getQueryData<Company>(['company', id]);
      qc.setQueryData<Company>(['company', id], (old) => old ? { ...old, ...updates } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['company', id], ctx?.prev); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies', activeWorkspace?.id] }); },
  });

  const addActivityMutation = useMutation({
    mutationFn: async (vals: typeof activityForm) => {
      const { data, error } = await (supabase as any)
        .from('activities')
        .insert({
          workspace_id: activeWorkspace!.id,
          type: vals.type, subject: vals.subject.trim(),
          body_text: vals.body_text.trim() || null,
          created_by: user!.id,
        })
        .select('*, profiles(display_name)').single();
      if (error) throw error;
      return data as ActivityRow;
    },
    onMutate: async (vals) => {
      await qc.cancelQueries({ queryKey: ['company-activities', id] });
      const prev = qc.getQueryData<ActivityRow[]>(['company-activities', id]);
      const optimistic: ActivityRow = {
        id: `opt-${Date.now()}`, workspace_id: activeWorkspace!.id,
        type: vals.type, subject: vals.subject, body_text: vals.body_text || null,
        related_contact_id: null, related_deal_id: null, related_task_id: null, related_project_id: null,
        created_by: user!.id, created_at: new Date().toISOString(), profiles: null,
      };
      qc.setQueryData<ActivityRow[]>(['company-activities', id], (old = []) => [optimistic, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['company-activities', id], ctx?.prev); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-activities', id] });
      setActivityOpen(false);
      setActivityForm({ type: 'note', subject: '', body_text: '' });
    },
  });

  const addContactMutation = useMutation({
    mutationFn: async (vals: typeof contactForm) => {
      const { data, error } = await (supabase as any)
        .from('contacts')
        .insert({
          workspace_id: activeWorkspace!.id,
          first_name: vals.first_name.trim(), last_name: vals.last_name.trim(),
          email: vals.email.trim() || null, phone: vals.phone.trim() || null,
          company_id: id, title: vals.title.trim() || null,
          source: vals.source, lifecycle_stage: vals.lifecycle_stage,
          owner_id: vals.owner_id || null,
          notes: vals.notes.trim() || null,
          tags: vals.tags ? vals.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        })
        .select('*, profiles!contacts_owner_id_fkey(display_name, avatar_url)')
        .single();
      if (error) throw error;
      return data as ContactRow;
    },
    onMutate: async (vals) => {
      await qc.cancelQueries({ queryKey: ['company-contacts', id] });
      const prev = qc.getQueryData<ContactRow[]>(['company-contacts', id]);
      const optimistic: ContactRow = {
        id: `opt-${Date.now()}`, workspace_id: activeWorkspace!.id,
        first_name: vals.first_name, last_name: vals.last_name,
        email: vals.email || null, phone: vals.phone || null,
        company_id: id!, title: vals.title || null,
        source: vals.source, lifecycle_stage: vals.lifecycle_stage,
        owner_id: vals.owner_id || null, notes: vals.notes || null,
        tags: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        profiles: members.find((m) => m.user_id === vals.owner_id)?.profiles ?? null,
      };
      qc.setQueryData<ContactRow[]>(['company-contacts', id], (old = []) => [optimistic, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['company-contacts', id], ctx?.prev); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-contacts', id] });
      qc.invalidateQueries({ queryKey: ['companies', activeWorkspace?.id] });
      setAddContactOpen(false);
      resetContactForm();
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const resetContactForm = () => setContactForm({
    first_name: '', last_name: '', email: '', phone: '', title: '',
    source: 'manual', lifecycle_stage: 'lead', owner_id: user?.id ?? '', tags: '', notes: '',
  });

  const update = (field: keyof Company, val: string | number | null) =>
    updateMutation.mutate({ [field]: val });

  // Stats
  const totalDealValue = deals.reduce((sum, d) => sum + Number(d.value), 0);
  const activeDeals = deals.filter((d) => d.deal_stages && !d.deal_stages.is_won && !d.deal_stages.is_lost).length;

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-gray-400">Company not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/companies')}>Back to Companies</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" className="w-7 h-7 text-gray-500" onClick={() => navigate('/companies')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-gray-500" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{company.name}</h1>
              {company.domain && (
                <a
                  href={`https://${company.domain.replace(/^https?:\/\//, '')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <Globe className="w-3 h-3" /> {company.domain} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            {company.industry && (
              <Badge
                variant="outline"
                className={`text-xs border shrink-0 ${INDUSTRY_COLORS[company.industry] ?? INDUSTRY_COLORS.Other}`}
              >
                {company.industry}
              </Badge>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 pl-10">
          <div className="flex items-center gap-1.5 text-sm">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-semibold text-gray-900">{contacts.length}</span>
            <span className="text-gray-400">contacts</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-semibold text-gray-900">{activeDeals}</span>
            <span className="text-gray-400">active deals</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <DollarSign className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-semibold text-gray-900">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalDealValue)}
            </span>
            <span className="text-gray-400">total pipeline</span>
          </div>
        </div>
      </div>

      {/* Body: left info panel + tabs */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

          {/* ── Left: Info panel ──────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Company Info</p>

              <InlineField label="Company name" value={company.name}
                onSave={(v) => update('name', v)} />
              <InlineField label="Domain" value={company.domain ?? ''}
                onSave={(v) => update('domain', v)} placeholder="acme.com" />
              <InlineField label="Website" value={company.website ?? ''}
                onSave={(v) => update('website', v)} placeholder="https://acme.com" />
              <InlineField label="Phone" value={company.phone ?? ''}
                onSave={(v) => update('phone', v)} placeholder="Add phone" />

              {/* Industry select */}
              <div className="py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Industry</p>
                <Select value={company.industry ?? '__none__'}
                  onValueChange={(v) => update('industry', v === '__none__' ? null : v)}>
                  <SelectTrigger className="h-7 text-sm border-0 p-0 shadow-none focus:ring-0 hover:text-indigo-600">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <InlineField label="Employee count" value={company.employee_count?.toString() ?? ''}
                type="number" onSave={(v) => update('employee_count', v ? Number(v) : null)} placeholder="e.g. 500" />
              <InlineField label="Annual revenue (USD)" value={company.annual_revenue?.toString() ?? ''}
                type="number" onSave={(v) => update('annual_revenue', v ? Number(v) : null)} placeholder="e.g. 10000000" />
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Address</p>
              <InlineField label="Address" value={company.address_line ?? ''} onSave={(v) => update('address_line', v)} />
              <InlineField label="City" value={company.city ?? ''} onSave={(v) => update('city', v)} />
              <InlineField label="State / Province" value={company.state ?? ''} onSave={(v) => update('state', v)} />

              {/* Country searchable dropdown */}
              <div className="py-2 border-b border-gray-100 last:border-0">
                <p className="text-xs text-gray-400 mb-1">Country</p>
                <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                  <PopoverTrigger asChild>
                    <button className="text-sm text-left w-full text-gray-900 hover:text-indigo-600 transition-colors">
                      {company.country || <span className="text-gray-300 italic">Click to edit</span>}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search country…" />
                      <CommandList>
                        <CommandEmpty>No country found.</CommandEmpty>
                        <CommandGroup>
                          {COUNTRIES.map((c) => (
                            <CommandItem key={c} value={c}
                              onSelect={() => { update('country', c); setCountryOpen(false); }}>
                              <Check className={cn('mr-2 h-4 w-4', company.country === c ? 'opacity-100' : 'opacity-0')} />
                              {c}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Tags */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tags</p>
              <CompanyTagsField
                tags={company.tags}
                onSave={(tags) => updateMutation.mutate({ tags })}
              />
            </div>

            <p className="text-xs text-gray-400 px-1">
              Added {format(new Date(company.created_at), 'MMM d, yyyy')}
            </p>
          </div>

          {/* ── Right: Tabs ───────────────────────────────────────────── */}
          <div>
            <Tabs defaultValue="contacts">
              <TabsList className="mb-4">
                <TabsTrigger value="contacts">
                  Contacts <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">{contacts.length}</span>
                </TabsTrigger>
                <TabsTrigger value="deals">
                  Deals <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">{deals.length}</span>
                </TabsTrigger>
                <TabsTrigger value="activity">
                  Activity <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">{activities.length}</span>
                </TabsTrigger>
              </TabsList>

              {/* Contacts tab */}
              <TabsContent value="contacts">
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-700">Contacts at {company.name}</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setAddContactOpen(true)}>
                      <Plus className="w-3 h-3" /> Add Contact
                    </Button>
                  </div>
                  {contacts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <Users className="w-6 h-6 text-gray-300 mb-2" />
                      <p className="text-sm text-gray-400">No contacts yet</p>
                      <Button size="sm" variant="ghost" className="mt-2 text-xs gap-1"
                        onClick={() => setAddContactOpen(true)}>
                        <Plus className="w-3 h-3" /> Add first contact
                      </Button>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Owner</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacts.map((c) => (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer hover:bg-indigo-50/40"
                            onClick={() => navigate(`/contacts/${c.id}`)}
                          >
                            <TableCell className="font-medium text-sm text-gray-900 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                                  <span className="text-indigo-700 text-xs font-semibold">
                                    {c.first_name.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                {c.first_name} {c.last_name}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {c.email ?? <span className="text-gray-300">—</span>}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs border ${LIFECYCLE_BADGE[c.lifecycle_stage]}`} variant="outline">
                                {LIFECYCLE_LABELS[c.lifecycle_stage]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {c.profiles?.display_name ?? <span className="text-gray-300">—</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </TabsContent>

              {/* Deals tab */}
              <TabsContent value="deals">
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-700">Deals for {company.name}</p>
                  </div>
                  {deals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <TrendingUp className="w-6 h-6 text-gray-300 mb-2" />
                      <p className="text-sm text-gray-400">No deals yet</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
                          <TableHead>Deal name</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead>Assigned to</TableHead>
                          <TableHead>Close date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {deals.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium text-sm text-gray-900">{d.name}</TableCell>
                            <TableCell>
                              {d.deal_stages && (
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                  style={{ borderColor: d.deal_stages.color, color: d.deal_stages.color }}
                                >
                                  {d.deal_stages.name}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-gray-700 text-right">
                              {new Intl.NumberFormat('en-US', { style: 'currency', currency: d.currency, maximumFractionDigits: 0 }).format(Number(d.value))}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {d.profiles?.display_name ?? <span className="text-gray-300">—</span>}
                            </TableCell>
                            <TableCell className="text-sm text-gray-400">
                              {d.expected_close_date
                                ? format(new Date(d.expected_close_date), 'MMM d, yyyy')
                                : <span className="text-gray-300">—</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </TabsContent>

              {/* Activity tab */}
              <TabsContent value="activity">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-gray-700">Activity feed</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setActivityOpen(true)}>
                      <Plus className="w-3 h-3" /> Log Activity
                    </Button>
                  </div>

                  {activities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <FileText className="w-6 h-6 text-gray-300 mb-2" />
                      <p className="text-sm text-gray-400">No activity yet</p>
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
                                <time className="text-xs text-gray-400 whitespace-nowrap shrink-0"
                                  title={format(new Date(act.created_at), 'PPpp')}>
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
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Add Activity Dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); addActivityMutation.mutate(activityForm); }} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="act-type">Type</Label>
              <Select value={activityForm.type} onValueChange={(v) => setActivityForm((f) => ({ ...f, type: v as ActivityType }))}>
                <SelectTrigger id="act-type"><SelectValue /></SelectTrigger>
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

      {/* Add Contact Sheet */}
      <Sheet open={addContactOpen} onOpenChange={(o) => { setAddContactOpen(o); if (!o) resetContactForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>Add Contact</SheetTitle>
            <SheetDescription>Adding to {company.name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={(e) => { e.preventDefault(); addContactMutation.mutate(contactForm); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ccf-first">First name *</Label>
                <Input id="ccf-first" required value={contactForm.first_name}
                  onChange={(e) => setContactForm((f) => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ccf-last">Last name *</Label>
                <Input id="ccf-last" required value={contactForm.last_name}
                  onChange={(e) => setContactForm((f) => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ccf-email">Email</Label>
              <Input id="ccf-email" type="email" value={contactForm.email}
                onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ccf-phone">Phone</Label>
              <Input id="ccf-phone" value={contactForm.phone}
                onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ccf-title">Title / Role</Label>
              <Input id="ccf-title" value={contactForm.title}
                onChange={(e) => setContactForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select value={contactForm.source} onValueChange={(v) => setContactForm((f) => ({ ...f, source: v as ContactSource }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Lifecycle stage</Label>
                <Select value={contactForm.lifecycle_stage} onValueChange={(v) => setContactForm((f) => ({ ...f, lifecycle_stage: v as LifecycleStage }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{LIFECYCLE_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Select value={contactForm.owner_id} onValueChange={(v) => setContactForm((f) => ({ ...f, owner_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Assign owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profiles?.display_name ?? m.user_id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {addContactMutation.isError && (
              <p className="text-sm text-red-600">{(addContactMutation.error as Error).message}</p>
            )}
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setAddContactOpen(false); resetContactForm(); }}>Cancel</Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" disabled={addContactMutation.isPending}>
                {addContactMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Contact
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── CompanyTagsField ──────────────────────────────────────────────────────────

function CompanyTagsField({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
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
        autoFocus placeholder="e.g. enterprise, partner"
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
