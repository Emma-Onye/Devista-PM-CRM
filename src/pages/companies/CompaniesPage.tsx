import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Building2, Search, Plus, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, Loader as Loader2, Globe, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
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
import { Check, ChevronsUpDown as ChevronsUpDownIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Company } from '../../lib/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyRow extends Company {
  contact_count: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Manufacturing', 'Retail',
  'Education', 'Logistics', 'Consulting', 'Other',
];

export const INDUSTRY_COLORS: Record<string, string> = {
  Technology: 'bg-blue-100 text-blue-700 border-blue-200',
  Healthcare: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Finance: 'bg-amber-100 text-amber-700 border-amber-200',
  Manufacturing: 'bg-orange-100 text-orange-700 border-orange-200',
  Retail: 'bg-pink-100 text-pink-700 border-pink-200',
  Education: 'bg-violet-100 text-violet-700 border-violet-200',
  Logistics: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  Consulting: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  Other: 'bg-gray-100 text-gray-600 border-gray-200',
};

// Common countries for the dropdown
const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Finland',
  'Switzerland', 'Austria', 'Belgium', 'Spain', 'Italy', 'Portugal',
  'Japan', 'South Korea', 'China', 'India', 'Singapore', 'UAE',
  'Brazil', 'Mexico', 'Argentina', 'South Africa', 'Nigeria', 'Kenya',
  'New Zealand', 'Ireland', 'Israel', 'Poland', 'Czech Republic', 'Hungary',
];

const PAGE_SIZE = 20;
type SortKey = 'name' | 'industry' | 'employee_count' | 'contact_count' | 'created_at';
type SortDir = 'asc' | 'desc';

// ── CompaniesPage ─────────────────────────────────────────────────────────────

export function CompaniesPage() {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', domain: '', industry: '', employee_count: '',
    annual_revenue: '', address_line: '', city: '', state: '',
    country: '', phone: '', website: '', tags: '',
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: companies = [], isLoading } = useQuery<CompanyRow[]>({
    queryKey: ['companies', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data: compData, error } = await (supabase as any)
        .from('companies')
        .select('*')
        .eq('workspace_id', activeWorkspace!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Get contact counts
      const { data: countData } = await (supabase as any)
        .from('contacts')
        .select('company_id')
        .eq('workspace_id', activeWorkspace!.id)
        .not('company_id', 'is', null);

      const counts: Record<string, number> = {};
      for (const row of (countData ?? []) as { company_id: string }[]) {
        counts[row.company_id] = (counts[row.company_id] ?? 0) + 1;
      }

      return (compData as Company[]).map((c) => ({
        ...c,
        contact_count: counts[c.id] ?? 0,
      }));
    },
  });

  // ── Mutation ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload: Record<string, unknown> = {
        workspace_id: activeWorkspace!.id,
        name: values.name.trim(),
        domain: values.domain.trim() || null,
        industry: values.industry || null,
        employee_count: values.employee_count ? Number(values.employee_count) : null,
        annual_revenue: values.annual_revenue ? Number(values.annual_revenue) : null,
        address_line: values.address_line.trim() || null,
        city: values.city.trim() || null,
        state: values.state.trim() || null,
        country: values.country || null,
        phone: values.phone.trim() || null,
        website: values.website.trim() || null,
        tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      };
      const { data, error } = await (supabase as any)
        .from('companies').insert(payload).select().single();
      if (error) throw error;
      return data as Company;
    },
    onMutate: async (values) => {
      await qc.cancelQueries({ queryKey: ['companies', activeWorkspace?.id] });
      const prev = qc.getQueryData<CompanyRow[]>(['companies', activeWorkspace?.id]);
      const optimistic: CompanyRow = {
        id: `opt-${Date.now()}`,
        workspace_id: activeWorkspace!.id,
        name: values.name, domain: values.domain || null,
        industry: values.industry || null,
        employee_count: values.employee_count ? Number(values.employee_count) : null,
        annual_revenue: values.annual_revenue ? Number(values.annual_revenue) : null,
        address_line: values.address_line || null, city: values.city || null,
        state: values.state || null, country: values.country || null,
        phone: values.phone || null, website: values.website || null,
        tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        contact_count: 0,
      };
      qc.setQueryData<CompanyRow[]>(['companies', activeWorkspace?.id], (old = []) => [optimistic, ...old]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['companies', activeWorkspace?.id], ctx?.prev); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies', activeWorkspace?.id] });
      setSheetOpen(false);
      resetForm();
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const resetForm = () => setForm({
    name: '', domain: '', industry: '', employee_count: '', annual_revenue: '',
    address_line: '', city: '', state: '', country: '', phone: '', website: '', tags: '',
  });

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
    return companies.filter((c) =>
      !q || c.name.toLowerCase().includes(q) || (c.domain ?? '').toLowerCase().includes(q)
    );
  }, [companies, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'industry') { av = a.industry ?? ''; bv = b.industry ?? ''; }
      else if (sortKey === 'employee_count') { av = a.employee_count ?? 0; bv = b.employee_count ?? 0; }
      else if (sortKey === 'contact_count') { av = a.contact_count; bv = b.contact_count; }
      else { av = a.created_at; bv = b.created_at; }
      if (typeof av === 'number') return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
      return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
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
          <Building2 className="w-5 h-5 text-gray-500" />
          <h1 className="text-lg font-semibold text-gray-900">Companies</h1>
          {!isLoading && (
            <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {companies.length}
            </span>
          )}
        </div>
        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" onClick={() => setSheetOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Add Company
        </Button>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Search by name or domain…"
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
            <Building2 className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">{search ? 'No companies match your search' : 'No companies yet'}</p>
            {!search && (
              <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => setSheetOpen(true)}>
                <Plus className="w-3.5 h-3.5" /> Add your first company
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('name')}>
                  Company <SortIcon col="name" />
                </TableHead>
                <TableHead className="whitespace-nowrap">Domain</TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('industry')}>
                  Industry <SortIcon col="industry" />
                </TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap text-right" onClick={() => toggleSort('employee_count')}>
                  Employees <SortIcon col="employee_count" />
                </TableHead>
                <TableHead className="whitespace-nowrap">Country</TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap text-right" onClick={() => toggleSort('contact_count')}>
                  Contacts <SortIcon col="contact_count" />
                </TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('created_at')}>
                  Added <SortIcon col="created_at" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.map((company) => (
                <TableRow
                  key={company.id}
                  className="cursor-pointer hover:bg-indigo-50/40 transition-colors"
                  onClick={() => navigate(`/companies/${company.id}`)}
                >
                  <TableCell className="font-medium text-gray-900 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                        <Building2 className="w-3.5 h-3.5 text-gray-500" />
                      </div>
                      {company.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {company.domain ? (
                      <a
                        href={`https://${company.domain.replace(/^https?:\/\//, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Globe className="w-3.5 h-3.5 shrink-0" />
                        {company.domain}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    ) : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell>
                    {company.industry ? (
                      <Badge
                        variant="outline"
                        className={`text-xs border ${INDUSTRY_COLORS[company.industry] ?? INDUSTRY_COLORS.Other}`}
                      >
                        {company.industry}
                      </Badge>
                    ) : <span className="text-gray-300 text-sm">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 text-right">
                    {company.employee_count != null
                      ? company.employee_count.toLocaleString()
                      : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {company.country ?? <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 text-right">
                    <span className="font-medium">{company.contact_count}</span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-400 whitespace-nowrap">
                    {format(new Date(company.created_at), 'MMM d, yyyy')}
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
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length} companies
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

      {/* Add Company Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>Add Company</SheetTitle>
            <SheetDescription>Add a new company to this workspace.</SheetDescription>
          </SheetHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cf-name">Company name *</Label>
              <Input id="cf-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cf-domain">Domain</Label>
                <Input id="cf-domain" placeholder="acme.com" value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-website">Website</Label>
                <Input id="cf-website" placeholder="https://acme.com" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-industry">Industry</Label>
              <Select value={form.industry} onValueChange={(v) => setForm((f) => ({ ...f, industry: v === '__none__' ? '' : v }))}>
                <SelectTrigger id="cf-industry"><SelectValue placeholder="Select industry" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cf-employees">Employee count</Label>
                <Input id="cf-employees" type="number" min="0" value={form.employee_count} onChange={(e) => setForm((f) => ({ ...f, employee_count: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-revenue">Annual revenue (USD)</Label>
                <Input id="cf-revenue" type="number" min="0" value={form.annual_revenue} onChange={(e) => setForm((f) => ({ ...f, annual_revenue: e.target.value }))} />
              </div>
            </div>

            <div className="pt-1 pb-0.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Address</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-address">Address line</Label>
              <Input id="cf-address" value={form.address_line} onChange={(e) => setForm((f) => ({ ...f, address_line: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cf-city">City</Label>
                <Input id="cf-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-state">State / Province</Label>
                <Input id="cf-state" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Country</Label>
              <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {form.country || 'Select country'}
                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search country…" />
                    <CommandList>
                      <CommandEmpty>No country found.</CommandEmpty>
                      <CommandGroup>
                        {COUNTRIES.map((c) => (
                          <CommandItem
                            key={c}
                            value={c}
                            onSelect={() => { setForm((f) => ({ ...f, country: c })); setCountryOpen(false); }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', form.country === c ? 'opacity-100' : 'opacity-0')} />
                            {c}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-phone">Phone</Label>
              <Input id="cf-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-tags">Tags</Label>
              <Input id="cf-tags" placeholder="e.g. enterprise, partner" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              <p className="text-xs text-gray-400">Comma-separated</p>
            </div>

            {createMutation.isError && (
              <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
            )}
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setSheetOpen(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Company
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
