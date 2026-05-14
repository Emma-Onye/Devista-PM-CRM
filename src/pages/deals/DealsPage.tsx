import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  DragDropContext, Droppable, Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Handshake, Plus, LayoutGrid, List, Search,
  ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, Loader as Loader2,
  Calendar, User, Building2, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '../../components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../../components/ui/command';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '../../components/ui/popover';
import { cn } from '../../lib/utils';
import type { Deal, DealStage } from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DealRow extends Deal {
  deal_stages: DealStage | null;
  contact: { id: string; first_name: string; last_name: string } | null;
  company: { id: string; name: string } | null;
  assignee: { display_name: string; avatar_url: string | null } | null;
}

interface MemberOption {
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'JPY'];
const PAGE_SIZE = 25;
type SortKey = 'name' | 'value' | 'deal_stages' | 'expected_close_date' | 'created_at';
type SortDir = 'asc' | 'desc';

export function fmtCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

// ── DealsPage ─────────────────────────────────────────────────────────────────

export function DealsPage() {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [view, setView] = useState<'board' | 'table'>('board');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [sheetOpen, setSheetOpen] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const [form, setForm] = useState({
    name: '', value: '', currency: 'USD',
    contact_id: '', company_id: '', deal_stage_id: '',
    assigned_to: user?.id ?? '', expected_close_date: '', project_id: '',
  });

  // Optimistic board order: stageId -> dealId[]
  const [boardOrder, setBoardOrder] = useState<Record<string, string[]> | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

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

  const { data: deals = [], isLoading: dealsLoading } = useQuery<DealRow[]>({
    queryKey: ['deals', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('deals')
        .select(`
          *,
          deal_stages(*),
          contact:contacts!deals_contact_id_fkey(id,first_name,last_name),
          company:companies!deals_company_id_fkey(id,name),
          assignee:profiles!deals_assigned_to_fkey(display_name,avatar_url)
        `)
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBoardOrder(null);
      return data as DealRow[];
    },
  });

  const { data: contacts = [] } = useQuery<{ id: string; first_name: string; last_name: string; company_id: string | null }[]>({
    queryKey: ['contacts-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('contacts').select('id,first_name,last_name,company_id')
        .eq('workspace_id', activeWorkspace!.id).order('first_name');
      return data ?? [];
    },
  });

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('companies').select('id,name')
        .eq('workspace_id', activeWorkspace!.id).order('name');
      return data ?? [];
    },
  });

  const { data: projects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['projects-list', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('projects').select('id,name')
        .eq('workspace_id', activeWorkspace!.id).order('name');
      return data ?? [];
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

  const createMutation = useMutation({
    mutationFn: async (vals: typeof form) => {
      const { data, error } = await (supabase as any)
        .from('deals')
        .insert({
          workspace_id: activeWorkspace!.id,
          name: vals.name.trim(),
          value: Number(vals.value) || 0,
          currency: vals.currency,
          contact_id: vals.contact_id || null,
          company_id: vals.company_id || null,
          deal_stage_id: vals.deal_stage_id,
          assigned_to: vals.assigned_to || null,
          expected_close_date: vals.expected_close_date || null,
          project_id: vals.project_id || null,
        })
        .select('*,deal_stages(*),contact:contacts!deals_contact_id_fkey(id,first_name,last_name),company:companies!deals_company_id_fkey(id,name),assignee:profiles!deals_assigned_to_fkey(display_name,avatar_url)')
        .single();
      if (error) throw error;
      return data as DealRow;
    },
    onSuccess: (newDeal) => {
      qc.setQueryData<DealRow[]>(['deals', activeWorkspace?.id], (old = []) => [newDeal, ...old]);
      setBoardOrder(null);
      setSheetOpen(false);
      resetForm();
    },
  });

  const moveStageMutation = useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error } = await (supabase as any)
        .from('deals').update({ deal_stage_id: stageId }).eq('id', dealId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals', activeWorkspace?.id] }),
  });

  // ── Board helpers ─────────────────────────────────────────────────────────

  const effectiveOrder = useMemo<Record<string, string[]>>(() => {
    if (boardOrder) return boardOrder;
    const order: Record<string, string[]> = {};
    for (const s of stages) order[s.id] = [];
    for (const d of deals) {
      if (d.deal_stage_id && order[d.deal_stage_id]) {
        order[d.deal_stage_id].push(d.id);
      }
    }
    return order;
  }, [boardOrder, deals, stages]);

  const dealMap = useMemo(() => {
    const m: Record<string, DealRow> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const next: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(effectiveOrder)) next[k] = [...v];
    next[source.droppableId].splice(source.index, 1);
    next[destination.droppableId].splice(destination.index, 0, draggableId);
    setBoardOrder(next);

    if (source.droppableId !== destination.droppableId) {
      moveStageMutation.mutate({ dealId: draggableId, stageId: destination.droppableId });
    }
  };

  // ── Table helpers ─────────────────────────────────────────────────────────

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-gray-600 ml-1 inline" />
      : <ChevronDown className="w-3 h-3 text-gray-600 ml-1 inline" />;
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return deals.filter((d) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.company?.name ?? '').toLowerCase().includes(q) ||
      (d.contact ? `${d.contact.first_name} ${d.contact.last_name}`.toLowerCase().includes(q) : false)
    );
  }, [deals, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'value') { av = Number(a.value); bv = Number(b.value); }
      else if (sortKey === 'deal_stages') { av = a.deal_stages?.position ?? 0; bv = b.deal_stages?.position ?? 0; }
      else if (sortKey === 'expected_close_date') { av = a.expected_close_date ?? ''; bv = b.expected_close_date ?? ''; }
      else { av = a.created_at; bv = b.created_at; }
      if (typeof av === 'number') return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
      return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const resetForm = () => setForm({
    name: '', value: '', currency: 'USD', contact_id: '', company_id: '',
    deal_stage_id: stages[0]?.id ?? '', assigned_to: user?.id ?? '',
    expected_close_date: '', project_id: '',
  });

  const handleContactSelect = (contactId: string) => {
    const c = contacts.find((x) => x.id === contactId);
    setForm((f) => ({ ...f, contact_id: contactId, company_id: c?.company_id ?? f.company_id }));
    setContactOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <Handshake className="w-5 h-5 text-gray-500" />
          <h1 className="text-lg font-semibold text-gray-900">Deals</h1>
          {!dealsLoading && (
            <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {deals.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-gray-200 overflow-hidden">
            <button
              className={cn('px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors',
                view === 'board' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')}
              onClick={() => setView('board')}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Board
            </button>
            <button
              className={cn('px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors border-l border-gray-200',
                view === 'table' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')}
              onClick={() => setView('table')}
            >
              <List className="w-3.5 h-3.5" /> Table
            </button>
          </div>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5"
            onClick={() => { resetForm(); setSheetOpen(true); }}>
            <Plus className="w-3.5 h-3.5" /> Add Deal
          </Button>
        </div>
      </div>

      {/* ── Board View ────────────────────────────────────────────────────── */}
      {view === 'board' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          {dealsLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex gap-3 h-full p-4 min-w-max">
                {stages.map((stage) => {
                  const stageDeals = (effectiveOrder[stage.id] ?? []).map((id) => dealMap[id]).filter(Boolean);
                  const stageTotal = stageDeals.reduce((s, d) => s + Number(d.value), 0);
                  return (
                    <div key={stage.id}
                      className={cn(
                        'flex flex-col w-72 shrink-0 bg-gray-50 rounded-xl border overflow-hidden',
                        stage.is_won ? 'border-l-4 border-l-emerald-500 border-gray-200' :
                          stage.is_lost ? 'border-l-4 border-l-red-400 border-gray-200' : 'border-gray-200'
                      )}>
                      {/* Column header */}
                      <div className="px-3 pt-3 pb-2 shrink-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
                          <span className="text-sm font-semibold text-gray-900">{stage.name}</span>
                          <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 font-medium">
                            {stageDeals.length}
                          </span>
                        </div>
                        <p className={cn('text-xs font-semibold',
                          stage.is_won ? 'text-emerald-600' : stage.is_lost ? 'text-red-500' : 'text-gray-500')}>
                          {fmtCurrency(stageTotal)}
                        </p>
                      </div>

                      {/* Droppable cards area */}
                      <Droppable droppableId={stage.id}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              'flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px] transition-colors',
                              snapshot.isDraggingOver ? 'bg-indigo-50/60' : ''
                            )}
                          >
                            {stageDeals.map((deal, index) => (
                              <Draggable key={deal.id} draggableId={deal.id} index={index}>
                                {(drag, snap) => (
                                  <div
                                    ref={drag.innerRef}
                                    {...drag.draggableProps}
                                    {...drag.dragHandleProps}
                                    className={cn(
                                      'bg-white rounded-lg border border-gray-200 p-3 cursor-pointer select-none',
                                      'hover:shadow-md transition-all',
                                      snap.isDragging ? 'shadow-lg rotate-1 border-indigo-300 ring-1 ring-indigo-200' : ''
                                    )}
                                    onClick={() => navigate(`/deals/${deal.id}`)}
                                  >
                                    <p className="text-sm font-semibold text-gray-900 mb-1.5 leading-tight line-clamp-2">
                                      {deal.name}
                                    </p>
                                    {deal.company && (
                                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
                                        <Building2 className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{deal.company.name}</span>
                                      </div>
                                    )}
                                    {deal.contact && (
                                      <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
                                        <User className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{deal.contact.first_name} {deal.contact.last_name}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                                      <span className={cn('text-sm font-bold',
                                        stage.is_won ? 'text-emerald-600' : stage.is_lost ? 'text-red-500' : 'text-gray-900')}>
                                        {fmtCurrency(Number(deal.value), deal.currency)}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        {deal.expected_close_date && (
                                          <div className="flex items-center gap-0.5 text-xs text-gray-400">
                                            <Calendar className="w-3 h-3" />
                                            {format(new Date(deal.expected_close_date), 'MMM d')}
                                          </div>
                                        )}
                                        {deal.assignee && (
                                          <div
                                            className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 overflow-hidden"
                                            title={deal.assignee.display_name}
                                          >
                                            {deal.assignee.avatar_url ? (
                                              <img src={deal.assignee.avatar_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                              <span className="text-indigo-700 text-[9px] font-bold">
                                                {initials(deal.assignee.display_name)}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          )}
        </div>
      )}

      {/* ── Table View ────────────────────────────────────────────────────── */}
      {view === 'table' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-6 py-3 border-b border-gray-100 bg-white shrink-0">
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <Input placeholder="Search deals…" value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-8 h-8 text-sm" />
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {dealsLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              </div>
            ) : pageData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48">
                <Handshake className="w-8 h-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-400">{search ? 'No matching deals' : 'No deals yet'}</p>
                {!search && (
                  <Button size="sm" variant="outline" className="mt-3 gap-1.5"
                    onClick={() => { resetForm(); setSheetOpen(true); }}>
                    <Plus className="w-3.5 h-3.5" /> Add your first deal
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('name')}>
                      Deal <SortIcon col="name" />
                    </TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('deal_stages')}>
                      Stage <SortIcon col="deal_stages" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort('value')}>
                      Value <SortIcon col="value" />
                    </TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('expected_close_date')}>
                      Close date <SortIcon col="expected_close_date" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('created_at')}>
                      Created <SortIcon col="created_at" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((deal) => (
                    <TableRow key={deal.id} className="cursor-pointer hover:bg-indigo-50/40"
                      onClick={() => navigate(`/deals/${deal.id}`)}>
                      <TableCell className="font-medium text-gray-900 max-w-[200px] truncate">{deal.name}</TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {deal.company?.name ?? <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {deal.contact ? `${deal.contact.first_name} ${deal.contact.last_name}` : <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell>
                        {deal.deal_stages && (
                          <Badge variant="outline" className="text-xs whitespace-nowrap"
                            style={{ borderColor: deal.deal_stages.color, color: deal.deal_stages.color }}>
                            {deal.deal_stages.name}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-semibold text-gray-700 text-right whitespace-nowrap">
                        {fmtCurrency(Number(deal.value), deal.currency)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {deal.assignee?.display_name ?? <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-gray-400 whitespace-nowrap">
                        {deal.expected_close_date
                          ? format(new Date(deal.expected_close_date), 'MMM d, yyyy')
                          : <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-gray-400 whitespace-nowrap">
                        {format(new Date(deal.created_at), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white shrink-0">
              <p className="text-xs text-gray-400">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
                  <Button key={p} size="sm" variant={page === p ? 'default' : 'outline'}
                    className={`w-7 h-7 text-xs ${page === p ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                    onClick={() => setPage(p)}>{p}</Button>
                ))}
                <Button variant="outline" size="icon" className="w-7 h-7" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add Deal Sheet ────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>Add Deal</SheetTitle>
            <SheetDescription>Add a new deal to the pipeline.</SheetDescription>
          </SheetHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="df-name">Deal name *</Label>
              <Input id="df-name" required value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="df-value">Value</Label>
                <Input id="df-value" type="number" min="0" value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Stage *</Label>
              <Select value={form.deal_stage_id} onValueChange={(v) => setForm((f) => ({ ...f, deal_stage_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Contact */}
            <div className="space-y-1.5">
              <Label>Contact</Label>
              <Popover open={contactOpen} onOpenChange={setContactOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {form.contact_id
                      ? (() => { const c = contacts.find((x) => x.id === form.contact_id); return c ? `${c.first_name} ${c.last_name}` : 'Select contact'; })()
                      : 'Select contact'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search contacts…" />
                    <CommandList>
                      <CommandEmpty>No contact found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__none__" onSelect={() => { setForm((f) => ({ ...f, contact_id: '' })); setContactOpen(false); }}>
                          <Check className={cn('mr-2 h-4 w-4', !form.contact_id ? 'opacity-100' : 'opacity-0')} />
                          None
                        </CommandItem>
                        {contacts.map((c) => (
                          <CommandItem key={c.id} value={`${c.first_name} ${c.last_name}`}
                            onSelect={() => handleContactSelect(c.id)}>
                            <Check className={cn('mr-2 h-4 w-4', form.contact_id === c.id ? 'opacity-100' : 'opacity-0')} />
                            {c.first_name} {c.last_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Company */}
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {form.company_id ? (companies.find((x) => x.id === form.company_id)?.name ?? 'Select company') : 'Select company'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search companies…" />
                    <CommandList>
                      <CommandEmpty>No company found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__none__" onSelect={() => { setForm((f) => ({ ...f, company_id: '' })); setCompanyOpen(false); }}>
                          <Check className={cn('mr-2 h-4 w-4', !form.company_id ? 'opacity-100' : 'opacity-0')} />
                          None
                        </CommandItem>
                        {companies.map((c) => (
                          <CommandItem key={c.id} value={c.name}
                            onSelect={() => { setForm((f) => ({ ...f, company_id: c.id })); setCompanyOpen(false); }}>
                            <Check className={cn('mr-2 h-4 w-4', form.company_id === c.id ? 'opacity-100' : 'opacity-0')} />
                            {c.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label>Assigned to</Label>
              <Select value={form.assigned_to} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
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

            <div className="space-y-1.5">
              <Label htmlFor="df-close">Expected close date</Label>
              <Input id="df-close" type="date" value={form.expected_close_date}
                onChange={(e) => setForm((f) => ({ ...f, expected_close_date: e.target.value }))} />
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <Label>Linked project (optional)</Label>
              <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {form.project_id ? (projects.find((x) => x.id === form.project_id)?.name ?? 'Select project') : 'Select project'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search projects…" />
                    <CommandList>
                      <CommandEmpty>No project found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__none__" onSelect={() => { setForm((f) => ({ ...f, project_id: '' })); setProjectOpen(false); }}>
                          <Check className={cn('mr-2 h-4 w-4', !form.project_id ? 'opacity-100' : 'opacity-0')} />
                          None
                        </CommandItem>
                        {projects.map((p) => (
                          <CommandItem key={p.id} value={p.name}
                            onSelect={() => { setForm((f) => ({ ...f, project_id: p.id })); setProjectOpen(false); }}>
                            <Check className={cn('mr-2 h-4 w-4', form.project_id === p.id ? 'opacity-100' : 'opacity-0')} />
                            {p.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {createMutation.isError && (
              <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
            )}
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setSheetOpen(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" disabled={createMutation.isPending || !form.deal_stage_id}>
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Deal
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
