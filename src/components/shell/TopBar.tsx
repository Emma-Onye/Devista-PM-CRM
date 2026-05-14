import { Search, Bell, LogOut, User, ChevronDown, ArrowLeftRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface TopBarProps {
  className?: string;
}

export function TopBar({ className }: TopBarProps) {
  const { profile } = useAuthStore();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <header
      className={cn(
        'h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0',
        className
      )}
    >
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <Input
          placeholder="Search tasks, contacts, deals..."
          className="pl-9 h-8 text-sm bg-gray-50 border-gray-200 focus-visible:ring-indigo-500"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative w-8 h-8 text-gray-500 hover:text-gray-900">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-600 rounded-full" />
          <span className="sr-only">Notifications</span>
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-100 transition-colors">
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <span className="text-indigo-700 text-xs font-semibold">
                    {profile?.display_name?.charAt(0).toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium text-gray-700 hidden sm:block max-w-[120px] truncate">
                {profile?.display_name ?? 'Account'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-gray-500 font-normal truncate">
              {profile?.display_name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => navigate('/settings/profile')}
            >
              <User className="w-4 h-4" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => navigate('/select-workspace')}
            >
              <ArrowLeftRight className="w-4 h-4" />
              Switch Workspace
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-red-600 cursor-pointer focus:text-red-600 focus:bg-red-50"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
