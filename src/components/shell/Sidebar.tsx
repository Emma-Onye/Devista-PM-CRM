import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, SquareCheck as CheckSquare, Kanban, SquareChartGantt as GanttChartSquare, Users, Building2, Handshake, FileText, Zap, Settings, ChevronLeft, ChevronRight, Plus, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Work',
    items: [
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
      { to: '/tasks', icon: CheckSquare, label: 'My Tasks' },
      { to: '/board', icon: Kanban, label: 'Board' },
      { to: '/timeline', icon: GanttChartSquare, label: 'Timeline' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/contacts', icon: Users, label: 'Contacts' },
      { to: '/companies', icon: Building2, label: 'Companies' },
      { to: '/deals', icon: Handshake, label: 'Deals' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { to: '/documents', icon: FileText, label: 'Documents' },
      { to: '/automations', icon: Zap, label: 'Automations' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activeWorkspace } = useWorkspaceStore();
  const { profile } = useAuthStore();
  const navigate = useNavigate();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-slate-900 flex flex-col z-40 transition-all duration-200 ease-in-out',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Workspace Switcher */}
      <div className="flex items-center h-14 px-3 border-b border-slate-700/60 shrink-0">
        {!sidebarCollapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 hover:bg-slate-800 transition-colors group">
                <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs font-bold">
                    {activeWorkspace?.name?.charAt(0).toUpperCase() ?? 'V'}
                  </span>
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-white text-sm font-semibold truncate leading-tight">
                    {activeWorkspace?.name ?? 'Select Workspace'}
                  </p>
                  <p className="text-slate-400 text-xs capitalize leading-tight">
                    {activeWorkspace?.plan ?? 'free'} plan
                  </p>
                </div>
                <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {activeWorkspace && (
                <DropdownMenuItem className="gap-2">
                  <div className="w-5 h-5 rounded bg-indigo-600 flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-bold">
                      {activeWorkspace.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="truncate">{activeWorkspace.name}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-indigo-600"
                onClick={() => navigate('/onboarding')}
              >
                <Plus className="w-4 h-4" />
                Create workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="w-full flex justify-center">
            <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">
                {activeWorkspace?.name?.charAt(0).toUpperCase() ?? 'V'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Nav Sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4 scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            {!sidebarCollapsed && (
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-2 mb-1">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                        sidebarCollapsed && 'justify-center px-0'
                      )
                    }
                    title={sidebarCollapsed ? label : undefined}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span>{label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User Footer */}
      {!sidebarCollapsed && (
        <div className="px-3 py-3 border-t border-slate-700/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center shrink-0">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <span className="text-white text-xs font-semibold">
                  {profile?.display_name?.charAt(0).toUpperCase() ?? '?'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{profile?.display_name ?? 'Loading...'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Collapse Toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-300 hover:bg-slate-600 hover:text-white transition-colors z-50"
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </aside>
  );
}
