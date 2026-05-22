import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderKanban, SquareCheck as CheckSquare, Users, Building2,
  Handshake, FileText, Search, Loader as Loader2,
} from 'lucide-react';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  route: string;
}

interface SearchResults {
  tasks: SearchResult[];
  projects: SearchResult[];
  contacts: SearchResult[];
  companies: SearchResult[];
  deals: SearchResult[];
  documents: SearchResult[];
}

const EMPTY: SearchResults = {
  tasks: [], projects: [], contacts: [], companies: [], deals: [], documents: [],
};

const CATEGORY_CONFIG = [
  { key: 'projects'  as const, icon: FolderKanban, label: 'Projects' },
  { key: 'tasks'     as const, icon: CheckSquare,  label: 'Tasks' },
  { key: 'contacts'  as const, icon: Users,        label: 'Contacts' },
  { key: 'companies' as const, icon: Building2,    label: 'Companies' },
  { key: 'deals'     as const, icon: Handshake,    label: 'Deals' },
  { key: 'documents' as const, icon: FileText,     label: 'Documents' },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const wsId = activeWorkspace?.id;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(EMPTY);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !wsId) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Sanitize: strip PostgREST operators to prevent filter injection via .or()
    const sanitized = q.replace(/[%_,().\\]/g, '');
    if (!sanitized.trim()) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    const like = `%${sanitized}%`;

    try {
      const [tasksR, projectsR, contactsR, companiesR, dealsR, docsR] = await Promise.all([
        (supabase as any).from('tasks').select('id, title, status, project:projects!tasks_project_id_fkey(name)')
          .eq('workspace_id', wsId).ilike('title', like).is('parent_task_id', null).limit(5),
        (supabase as any).from('projects').select('id, name, status')
          .eq('workspace_id', wsId).ilike('name', like).limit(5),
        (supabase as any).from('contacts').select('id, first_name, last_name, email')
          .eq('workspace_id', wsId).or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(5),
        (supabase as any).from('companies').select('id, name, industry')
          .eq('workspace_id', wsId).ilike('name', like).limit(5),
        (supabase as any).from('deals').select('id, name, value, currency')
          .eq('workspace_id', wsId).ilike('name', like).limit(5),
        (supabase as any).from('documents').select('id, title')
          .eq('workspace_id', wsId).ilike('title', like).limit(5),
      ]);

      setResults({
        tasks: (tasksR.data ?? []).map((t: any) => ({
          id: t.id, label: t.title,
          sublabel: t.project?.name ? `${t.project.name} · ${t.status}` : t.status,
          route: `/tasks`, // Tasks page (no detail route for individual tasks outside project context)
        })),
        projects: (projectsR.data ?? []).map((p: any) => ({
          id: p.id, label: p.name, sublabel: p.status, route: `/projects/${p.id}`,
        })),
        contacts: (contactsR.data ?? []).map((c: any) => ({
          id: c.id, label: `${c.first_name} ${c.last_name}`,
          sublabel: c.email ?? '', route: `/contacts/${c.id}`,
        })),
        companies: (companiesR.data ?? []).map((c: any) => ({
          id: c.id, label: c.name, sublabel: c.industry ?? '', route: `/companies/${c.id}`,
        })),
        deals: (dealsR.data ?? []).map((d: any) => ({
          id: d.id, label: d.name,
          sublabel: d.value ? `${d.currency} ${d.value.toLocaleString()}` : '',
          route: `/deals/${d.id}`,
        })),
        documents: (docsR.data ?? []).map((d: any) => ({
          id: d.id, label: d.title, sublabel: '', route: `/documents/${d.id}`,
        })),
      });
    } catch {
      // Silently fail — user sees empty state
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  // Handle query change with debounce
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }, [doSearch]);

  const handleSelect = useCallback((route: string) => {
    setOpen(false);
    navigate(route);
  }, [navigate]);

  const hasResults = CATEGORY_CONFIG.some((c) => results[c.key].length > 0);

  return (
    <>
      {/* Trigger button in TopBar */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-8 px-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors flex-1 max-w-md"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
          <span className="text-xs">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</span>K
        </kbd>
      </button>

      {/* Command Dialog */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search tasks, projects, contacts, deals..."
          value={query}
          onValueChange={handleQueryChange}
        />
        <CommandList>
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            </div>
          )}

          {!loading && query.trim() && !hasResults && (
            <CommandEmpty>No results found for "{query}"</CommandEmpty>
          )}

          {!loading && !query.trim() && (
            <div className="py-6 text-center text-sm text-gray-400">
              Start typing to search across your workspace...
            </div>
          )}

          {!loading && CATEGORY_CONFIG.map((cat, catIdx) => {
            const items = results[cat.key];
            if (items.length === 0) return null;
            const Icon = cat.icon;
            return (
              <div key={cat.key}>
                {catIdx > 0 && <CommandSeparator />}
                <CommandGroup heading={cat.label}>
                  {items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${cat.key}-${item.label}`}
                      onSelect={() => handleSelect(item.route)}
                      className="gap-3 cursor-pointer"
                    >
                      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
                        {item.sublabel && (
                          <p className="text-xs text-gray-400 truncate">{item.sublabel}</p>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
