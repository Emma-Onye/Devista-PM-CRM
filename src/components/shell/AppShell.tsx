import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { cn } from '../../lib/utils';

export function AppShell() {
  const { sidebarCollapsed, isWorkspaceLoading } = useWorkspaceStore();

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />

      <div
        className={cn(
          'flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-in-out',
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        )}
      >
        <TopBar />
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
