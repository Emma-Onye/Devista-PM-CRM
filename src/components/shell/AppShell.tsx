import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { cn } from '../../lib/utils';

export function AppShell() {
  const { sidebarCollapsed, isWorkspaceLoading, setMobileMenuOpen } = useWorkspaceStore();

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />

      <div
        className={cn(
          'flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-in-out',
          // Mobile: no margin (sidebar is overlay)
          'ml-0',
          // Desktop
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
        )}
      >
        {/* TopBar with hamburger on mobile */}
        <div className="flex items-center h-14 bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex items-center justify-center w-10 h-10 text-gray-500 hover:text-gray-900 ml-2 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <TopBar className="flex-1 border-b-0 h-full" />
        </div>

        <main className="flex-1 overflow-auto flex flex-col min-h-0">
          {isWorkspaceLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
