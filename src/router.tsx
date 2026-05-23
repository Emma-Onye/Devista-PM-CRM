import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { AuthGuard } from './components/shell/AuthGuard';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { OnboardingPage } from './pages/onboarding/OnboardingPage';
import { SelectWorkspacePage } from './pages/workspace/SelectWorkspacePage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { BoardPage } from './pages/board/BoardPage';
import { TimelinePage } from './pages/timeline/TimelinePage';
import { ContactsPage } from './pages/contacts/ContactsPage';
import { ContactDetailPage } from './pages/contacts/ContactDetailPage';
import { CompaniesPage } from './pages/companies/CompaniesPage';
import { CompanyDetailPage } from './pages/companies/CompanyDetailPage';
import { DealsPage } from './pages/deals/DealsPage';
import { DealDetailPage } from './pages/deals/DealDetailPage';
import { PipelineSettingsPage } from './pages/settings/PipelineSettingsPage';
import { DocumentsPage } from './pages/documents/DocumentsPage';
import { DocumentDetailPage } from './pages/documents/DocumentDetailPage';
import { AutomationsPage } from './pages/automations/AutomationsPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { GeneralSettingsPage } from './pages/settings/GeneralSettingsPage';
import { MembersPage } from './pages/settings/MembersPage';
import { ProfileSettingsPage } from './pages/settings/ProfileSettingsPage';

export const router = createBrowserRouter([
  // Public routes
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/signup', element: <RegisterPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },

  // Protected: no workspace required
  {
    element: <AuthGuard />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/select-workspace', element: <SelectWorkspacePage /> },
    ],
  },

  // Protected: main app shell
  {
    element: <AuthGuard />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/projects', element: <ProjectsPage /> },
          { path: '/projects/:id', element: <ProjectDetailPage /> },
          { path: '/tasks', element: <TasksPage /> },
          { path: '/board', element: <BoardPage /> },
          { path: '/timeline', element: <TimelinePage /> },
          { path: '/contacts', element: <ContactsPage /> },
          { path: '/contacts/:id', element: <ContactDetailPage /> },
          { path: '/companies', element: <CompaniesPage /> },
          { path: '/companies/:id', element: <CompanyDetailPage /> },
          { path: '/deals', element: <DealsPage /> },
          { path: '/deals/:id', element: <DealDetailPage /> },
          { path: '/documents', element: <DocumentsPage /> },
          { path: '/documents/:id', element: <DocumentDetailPage /> },
          { path: '/automations', element: <AutomationsPage /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/general" replace /> },
              { path: 'general', element: <GeneralSettingsPage /> },
              { path: 'members', element: <MembersPage /> },
              { path: 'profile', element: <ProfileSettingsPage /> },
              { path: 'pipeline', element: <PipelineSettingsPage /> },
            ],
          },
        ],
      },
    ],
  },

  // Fallback
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
