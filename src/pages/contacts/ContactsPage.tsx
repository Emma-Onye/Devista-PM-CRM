import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Users, Search, Plus, ChevronUp, ChevronDown, ChevronsUpDown,
  Phone, Mail, ChevronLeft, ChevronRight, Loader as Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '../../components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import type { Contact, ContactSource, LifecycleStage, MemberRole } from '../../lib/database.types';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContactRow extends Contact {
  companies: { id: string; name: string } | null;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

interface CompanyOption { id: string; name: string }
interface MemberOption {
  user_id: string;
  role: MemberRole;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const LIFECYCLE_BADGE: Record<LifecycleStage, string> = {
  lead: 'bg-blue-100 text-blue-700 border-blue-200',
  qualified: 'bg-amber-100 text-amber-700 border-amber-200',
  opportunity: 'bg-violet-100 text-violet-700 border-violet-200',
  customer: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  churned: 'bg-red-100 text-red-700 border-red-200',
};

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  lead: 'Lead', qualified: 'Qualified', opportunity: 'Opportunity',
  customer: 'Customer', churned: 'Churned',
};

const SOURCE_OPTIONS: ContactSource[] = ['manual', 'import', 'web_form', 'referral'];
const LIFECYCLE_OPTIONS: LifecycleStage[] = ['lead', 'qualified', 'opportunity', 'customer', 'churned'];
const PAGE_SIZE = 20;

type SortKey = 'name' | 'email' | 'lifecycle_stage' | 'created_at';
type SortDir = 'asc' | 'desc';

// ── ContactsPage ──────────────────────────────────────────────────────────────

export function ContactsPage() {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', company_id: '',
    title: '', source: 'manual' as ContactSource, lifecycle_stage: 'lead' as LifecycleStage,
    owner_id: user?.id ?? '', tags: '', notes: '',
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: contacts = [], isLoading } = useQuery<ContactRow[]>({
    queryKey: ['contacts', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contacts')
        .select('*, companies(id, name), profiles!contacts_owner_id_fkey(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ContactRow[];
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

  const { data: members = [] } = useQuery<MemberOption[]>({
    queryKey: ['workspace-members-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workspace_members')
        .select('user_id, role, profiles(display_name, avatar_url)')
        .eq('workspace_id', activeWorkspace!.id)
        .eq('status', 'active');
      if (error) throw error;
      return data as MemberOption[];
    },
  });

  // ── Mutation ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload: Record<string, unknown> = {
        workspace_id: activeWorkspace!.id,
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        company_id: values.company_id || null,
        title: values.title.trim() || null,
        source: values.source,
        lifecycle_stage: values.lifecycle_stage,
        owner_id: values.owner_id || null,
        notes: values.notes.trim() || null,
        tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      };
      const { data, error } = await (supabase as any)
        .from('contacts')
        .insert(payload)
        .select('*, companies(id, name), profiles!contacts_owner_id_fkey(display_name, avatar_url)')
        .single();
      if (error) throw error;
      return data as ContactRow;
    },
    onMutate: async (values) => {
      await qc.cancelQueries({ queryKey: ['contacts', activeWorkspace?.id] });
      const prev = qc.getQueryData<ContactRow[]>(['contacts', activeWorkspace?.id]);
      const optimistic: ContactRow = {
        id: `opt-${Date.now()}`, workspace_id: activeWorkspace!.id,
        first_name: values.first_name, last_name: values.last_name,
        email: values.email || null, phone: values.phone || null,
        company_id: values.company_id || null, title: values.title || null,
        source: values.source, lifecycle_stage: values.lifecycle_stage,
        owner_id: values.owner_id || null, notes: values.notes || null,
        tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        companies: companies.find((c) => c.id === values.company_id) ?? null,
        profiles: members.find((m) => m.user_id === values.owner_id)?.profiles ?? null,
      };
      qc.setQueryData<ContactRow[]>(['contacts', activeWorkspace?.id], (old = []) => [optimistic, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['contacts', activeWorkspace?.id], ctx?.prev); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', activeWorkspace?.id] });
      setSheetOpen(false);
      resetForm();
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const resetForm = () =>
    setForm({ first_name: '', last_name: '', email: '', phone: '', company_id: '',
      title: '', source: 'manual', lifecycle_stage: 'lead', owner_id: user?.id ?? '', tags: '', notes: '' });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3.5 h-3.5 text-gray-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 text-gray-600 ml-1 inline" />
      : <ChevronDown className="w-3.5 h-3.5 text-gray-600 ml-1 inline" />;
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return contacts.filter((c) => {
      if (!q) return true;
      return `${c.first_name} ${c.last_name}`.toLowerCase().includes(q)
        || (c.email ?? '').toLowerCase().includes(q);
    });
  }, [contacts, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = '', bv = '';
      if (sortKey === 'name') { av = `${a.first_name} ${a.last_name}`; bv = `${b.first_name} ${b.last_name}`; }
      else if (sortKey === 'email') { av = a.email ?? ''; bv = b.email ?? ''; }
      else if (sortKey === 'lifecycle_stage') { av = a.lifecycle_stage; bv = b.lifecycle_stage; }
      else { av = a.created_at; bv = b.created_at; }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-gray-500" />
          <h1 className="text-lg font-semibold text-gray-900">Contacts</h1>
          {!isLoading && (
            <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {contacts.length}
            </span>
          )}
        </div>
        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" onClick={() => setSheetOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Add Contact
        </Button>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : pageData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Users className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">{search ? 'No contacts match your search' : 'No contacts yet'}</p>
            {!search && (
              <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => setSheetOpen(true)}>
                <Plus className="w-3.5 h-3.5" /> Add your first contact
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('name')}>
                  Name <SortIcon col="name" />
                </TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('email')}>
                  Email <SortIcon col="email" />
                </TableHead>
                <TableHead className="whitespace-nowrap">Phone</TableHead>
                <TableHead className="whitespace-nowrap">Company</TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('lifecycle_stage')}>
                  Stage <SortIcon col="lifecycle_stage" />
                </TableHead>
                <TableHead className="whitespace-nowrap">Owner</TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('created_at')}>
                  Added <SortIcon col="created_at" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="cursor-pointer hover:bg-indigo-50/40 transition-colors"
                  onClick={() => navigate(`/contacts/${contact.id}`)}
                >
                  <TableCell className="font-medium text-gray-900 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                        <span className="text-indigo-700 text-xs font-semibold">
                          {contact.first_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      {contact.first_name} {contact.last_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500 text-sm">
                    {contact.email
                      ? <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 shrink-0 text-gray-400" />{contact.email}</span>
                      : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-gray-500 text-sm">
                    {contact.phone
                      ? <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 shrink-0 text-gray-400" />{contact.phone}</span>
                      : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {contact.companies?.name ?? <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs border ${LIFECYCLE_BADGE[contact.lifecycle_stage]}`} variant="outline">
                      {LIFECYCLE_LABELS[contact.lifecycle_stage]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {contact.profiles ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                          {contact.profiles.avatar_url
                            ? <img src={contact.profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                            : <span className="text-gray-600 text-xs font-semibold">{contact.profiles.display_name.charAt(0).toUpperCase()}</span>}
                        </div>
                        <span className="text-sm text-gray-600 truncate max-w-[100px]">{contact.profiles.display_name}</span>
                      </div>
                    ) : <span className="text-gray-300 text-sm">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-400 whitespace-nowrap">
                    {format(new Date(contact.created_at), 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white shrink-0">
          <p className="text-xs text-gray-400">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length} contacts
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <Button
                key={p} size="sm"
                variant={page === p ? 'default' : 'outline'}
                className={`w-7 h-7 text-xs ${page === p ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Add Contact Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>Add Contact</SheetTitle>
            <SheetDescription>Add a new contact to this workspace.</SheetDescription>
          </SheetHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cf-first">First name *</Label>
                <Input id="cf-first" required value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-last">Last name *</Label>
                <Input id="cf-last" required value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-email">Email</Label>
              <Input id="cf-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-phone">Phone</Label>
              <Input id="cf-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-company">Company</Label>
              <Select value={form.company_id} onValueChange={(v) => setForm((f) => ({ ...f, company_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger id="cf-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No company</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-title">Title / Job role</Label>
              <Input id="cf-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cf-source">Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v as ContactSource }))}>
                  <SelectTrigger id="cf-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-stage">Lifecycle stage</Label>
                <Select value={form.lifecycle_stage} onValueChange={(v) => setForm((f) => ({ ...f, lifecycle_stage: v as LifecycleStage }))}>
                  <SelectTrigger id="cf-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{LIFECYCLE_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-owner">Owner</Label>
              <Select value={form.owner_id} onValueChange={(v) => setForm((f) => ({ ...f, owner_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger id="cf-owner"><SelectValue placeholder="Assign owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profiles?.display_name ?? m.user_id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-tags">Tags</Label>
              <Input id="cf-tags" placeholder="e.g. vip, enterprise, partner" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              <p className="text-xs text-gray-400">Comma-separated</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-notes">Notes</Label>
              <Textarea id="cf-notes" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            {createMutation.isError && (
              <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
            )}
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setSheetOpen(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Contact
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
