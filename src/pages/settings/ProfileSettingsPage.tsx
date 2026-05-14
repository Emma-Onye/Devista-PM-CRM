import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader as Loader2, Check, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { Profile } from '../../lib/database.types';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function ProfileSettingsPage() {
  const { profile, setProfile, user } = useAuthStore();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'UTC');
  const [success, setSuccess] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Profile>) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await (supabase as any)
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
      if (error) throw error;
      return data as Profile;
    },
    onSuccess: (updated) => {
      setProfile(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) return;
    updateMutation.mutate({ display_name: trimmed, timezone });
  };

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Update your personal display preferences.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Profile Information</CardTitle>
          <CardDescription>Your name and timezone are shown to teammates.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="max-w-sm"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email-display">Email</Label>
              <Input
                id="email-display"
                value={user?.email ?? ''}
                readOnly
                className="max-w-sm bg-gray-50 text-gray-500 cursor-default"
              />
              <p className="text-xs text-gray-400">Email cannot be changed here.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {updateMutation.isError && (
              <p className="text-sm text-red-600 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {(updateMutation.error as Error).message}
              </p>
            )}

            <div className="pt-1">
              <Button
                type="submit"
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 gap-1.5"
                disabled={updateMutation.isPending || !displayName.trim()}
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : success ? (
                  <Check className="w-3.5 h-3.5" />
                ) : null}
                {updateMutation.isPending ? 'Saving...' : success ? 'Saved' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
