import { NavLink, Outlet } from 'react-router-dom';
import { Settings, Users, User, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';

const SETTINGS_NAV = [
  { to: '/settings/general', icon: Settings, label: 'General' },
  { to: '/settings/members', icon: Users, label: 'Members' },
  { to: '/settings/profile', icon: User, label: 'My Profile' },
  { to: '/settings/pipeline', icon: TrendingUp, label: 'Pipeline' },
];

export function SettingsLayout() {
  return (
    <div className="flex h-full min-h-0">
      {/* Settings sidebar */}
      <aside className="w-48 shrink-0 border-r border-gray-200 bg-white px-3 py-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-2 mb-2">Settings</p>
        <nav className="space-y-0.5">
          {SETTINGS_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Settings content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
