import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace, MemberRole } from '../lib/database.types';

interface WorkspaceState {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  myRole: MemberRole | null;
  isWorkspaceLoading: boolean;
  sidebarCollapsed: boolean;
  mobileMenuOpen: boolean;
  setActiveWorkspace: (workspace: Workspace | null, role: MemberRole | null) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setWorkspaceLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      activeWorkspace: null,
      myRole: null,
      isWorkspaceLoading: false,
      sidebarCollapsed: false,
      mobileMenuOpen: false,
      setActiveWorkspace: (workspace, role) =>
        set({ activeWorkspace: workspace, activeWorkspaceId: workspace?.id ?? null, myRole: role, isWorkspaceLoading: false }),
      setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
      setWorkspaceLoading: (loading) => set({ isWorkspaceLoading: loading }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
    }),
    {
      name: 'vantage-workspace',
      partialize: (s) => ({ activeWorkspaceId: s.activeWorkspaceId, sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
);