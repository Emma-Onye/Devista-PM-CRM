import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { format, formatDistanceToNow, isPast, differenceInDays, startOfMonth } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  LayoutDashboard, FolderKanban, SquareCheck as CheckSquare,
  TrendingUp, DollarSign, Calendar, Clock,
  Phone, Mail, FileText, MessageSquare, Handshake,
  ArrowUpRight, CircleDot,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useAuthStore } from '../../stores/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import type {
  Project, Task, Deal, DealStage, Activity, ActivityType,
} from '../../lib/database.types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TaskWithProject extends Task {
  projects: { name: string } | null;
}

interface DealWithRelations extends Deal {
  deal_stages: DealStage | null;
  company: { name: string } | null;
  assignee: { display_name: string; avatar_url: string | null } | null;
}

interface ActivityRow extends Activity {
  creator: { display_name: string; avatar_url: string | null } | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-blue-400',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  backlog: '#9ca3af', todo: '#64748b', in_progress: '#f59e0b',
  in_review: '#8b5cf6', done: '#10b981',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  in_review: 'In Review', done: 'Done',
};

const ACTIVITY_ICON: Record<ActivityType, typeof Phone> = {
  note: FileText, call: Phone, email: Mail,
  meeting: Calendar, task_update: CheckSquare,
  deal_update: Handshake, status_change: ArrowUpRight,
};

function fmtCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(value);
}

function fmtCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}

// ── DashboardPage ──────────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const wsId = activeWorkspace?.id;
  const monthStart = startOfMonth(new Date()).toISOString();

  // ── Parallel queries ─────────────────────────────────────────────────────

  const results = useQueries({
    queries: [
      // 0: Active projects count
      {
        queryKey: ['dash-projects', wsId],
        enabled: !!wsId,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('projects').select('id, status')
            .eq('workspace_id', wsId!);
          if (error) throw error;
          return data as Pick<Project, 'id' | 'status'>[];
        },
      },
      // 1: All tasks (for stats + upcoming)
      {
        queryKey: ['dash-tasks', wsId, user?.id],
        enabled: !!wsId,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('tasks')
            .select('id, title, status, priority, due_date, assigned_to, project_id, projects(name)')
            .eq('workspace_id', wsId!)
            .order('due_date', { ascending: true, nullsFirst: false });
          if (error) throw error;
          return data as TaskWithProject[];
        },
      },
      // 2: Deals with stages
      {
        queryKey: ['dash-deals', wsId],
        enabled: !!wsId,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('deals')
            .select('*, deal_stages(*), company:companies(name), assignee:profiles!deals_assigned_to_fkey(display_name, avatar_url)')
            .eq('workspace_id', wsId!);
          if (error) throw error;
          return data as DealWithRelations[];
        },
      },
      // 3: Deal stages (for pipeline funnel)
      {
        queryKey: ['dash-stages', wsId],
        enabled: !!wsId,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('deal_stages').select('*')
            .eq('workspace_id', wsId!)
            .order('position');
          if (error) throw error;
          return data as DealStage[];
        },
      },
      // 4: Recent activities
      {
        queryKey: ['dash-activities', wsId],
        enabled: !!wsId,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('activities')
            .select('*, creator:profiles!activities_created_by_fkey(display_name, avatar_url)')
            .eq('workspace_id', wsId!)
            .order('created_at', { ascending: false })
            .limit(15);
          if (error) throw error;
          return data as ActivityRow[];
        },
      },
    ],
  });

  const [projectsQ, tasksQ, dealsQ, stagesQ, activitiesQ] = results;

  // ── Derived data ─────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const projects = projectsQ.data ?? [];
    const tasks = tasksQ.data ?? [];
    const deals = dealsQ.data ?? [];

    const activeProjects = projects.filter((p) => p.status === 'active').length;

    const archivedProjectIds = new Set(
      projects.filter((p) => p.status === 'archived').map((p) => p.id)
    );
    const openTasks = tasks.filter(
      (t) => t.status !== 'done' && !archivedProjectIds.has(t.project_id)
    ).length;

    const pipelineValue = deals
      .filter((d) => d.deal_stages && !d.deal_stages.is_won && !d.deal_stages.is_lost)
      .reduce((sum, d) => sum + Number(d.value), 0);

    const revenueWon = deals
      .filter((d) => d.deal_stages?.is_won && d.closed_at && d.closed_at >= monthStart)
      .reduce((sum, d) => sum + Number(d.value), 0);

    return { activeProjects, openTasks, pipelineValue, revenueWon };
  }, [projectsQ.data, tasksQ.data, dealsQ.data, monthStart]);

  const pipelineData = useMemo(() => {
    const stages = stagesQ.data ?? [];
    const deals = dealsQ.data ?? [];
    return stages
      .filter((s) => !s.is_won && !s.is_lost)
      .map((stage) => ({
        name: stage.name,
        value: deals
          .filter((d) => d.deal_stage_id === stage.id)
          .reduce((sum, d) => sum + Number(d.value), 0),
        color: stage.color,
        count: deals.filter((d) => d.deal_stage_id === stage.id).length,
      }));
  }, [stagesQ.data, dealsQ.data]);

  const taskDistribution = useMemo(() => {
    const tasks = tasksQ.data ?? [];
    const counts: Record<string, number> = {
      backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0,
    };
    for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({
      name: TASK_STATUS_LABELS[status] ?? status,
      value: count,
      color: TASK_STATUS_COLORS[status] ?? '#999',
    }));
  }, [tasksQ.data]);

  const upcomingTasks = useMemo(() => {
    const tasks = tasksQ.data ?? [];
    return tasks
      .filter((t) => t.assigned_to === user?.id && t.status !== 'done' && t.due_date)
      .slice(0, 10);
  }, [tasksQ.data, user?.id]);

  const dealsClosingSoon = useMemo(() => {
    const deals = dealsQ.data ?? [];
    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);
    return deals
      .filter((d) => {
        if (!d.expected_close_date || d.deal_stages?.is_won || d.deal_stages?.is_lost) return false;
        const close = new Date(d.expected_close_date);
        return close >= now && close <= in30Days;
      })
      .sort((a, b) => new Date(a.expected_close_date!).getTime() - new Date(b.expected_close_date!).getTime());
  }, [dealsQ.data]);

  const activities = activitiesQ.data ?? [];
  const totalTasks = (tasksQ.data ?? []).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 overflow-auto">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
          <LayoutDashboard className="w-4.5 h-4.5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400">
            {activeWorkspace?.name} &middot; {format(new Date(), 'EEEE, MMM d, yyyy')}
          </p>
        </div>
      </div>

      {/* ── TOP STATS ROW ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Projects"
          value={stats.activeProjects}
          icon={FolderKanban}
          accent="bg-indigo-100 text-indigo-600"
          loading={projectsQ.isLoading}
        />
        <StatCard
          label="Open Tasks"
          value={stats.openTasks}
          icon={CheckSquare}
          accent="bg-amber-100 text-amber-600"
          loading={tasksQ.isLoading}
        />
        <StatCard
          label="Pipeline Value"
          value={fmtCompact(stats.pipelineValue)}
          subtext={fmtCurrency(stats.pipelineValue)}
          icon={TrendingUp}
          accent="bg-blue-100 text-blue-600"
          loading={dealsQ.isLoading}
        />
        <StatCard
          label="Won This Month"
          value={fmtCompact(stats.revenueWon)}
          subtext={fmtCurrency(stats.revenueWon)}
          icon={DollarSign}
          accent="bg-emerald-100 text-emerald-600"
          loading={dealsQ.isLoading}
        />
      </div>

      {/* ── CHARTS ROW ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deal Pipeline Funnel */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Handshake className="w-4 h-4 text-indigo-500" />
              Deal Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stagesQ.isLoading || dealsQ.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-8 rounded" />
                ))}
              </div>
            ) : pipelineData.every((d) => d.value === 0) ? (
              <EmptyState icon={Handshake} message="No deals in pipeline yet" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pipelineData} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <XAxis type="number" tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                  <ReTooltip
                    formatter={(value: number) => [fmtCurrency(value), 'Value']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                    {pipelineData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Task Distribution Donut */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-amber-500" />
              Task Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasksQ.isLoading ? (
              <div className="flex items-center justify-center h-[220px]">
                <Skeleton className="w-40 h-40 rounded-full" />
              </div>
            ) : totalTasks === 0 ? (
              <EmptyState icon={CheckSquare} message="No tasks created yet" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={taskDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {taskDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <ReTooltip
                    formatter={(value: number, name: string) => [
                      `${value} (${totalTasks > 0 ? Math.round((value / totalTasks) * 100) : 0}%)`,
                      name,
                    ]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Legend
                    verticalAlign="middle"
                    align="right"
                    layout="vertical"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, lineHeight: '22px' }}
                  />
                  {/* Center label */}
                  <text x="50%" y="47%" textAnchor="middle" className="fill-gray-900 text-xl font-bold">
                    {totalTasks}
                  </text>
                  <text x="50%" y="57%" textAnchor="middle" className="fill-gray-400 text-[11px]">
                    total tasks
                  </text>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── UPCOMING TASKS + RECENT ACTIVITIES ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upcoming Tasks */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              My Upcoming Tasks
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {tasksQ.isLoading ? (
              <div className="px-6 pb-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 rounded" />
                ))}
              </div>
            ) : upcomingTasks.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState icon={CheckSquare} message="No upcoming tasks assigned to you" />
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                {upcomingTasks.map((task) => {
                  const overdue = task.due_date ? isPast(new Date(task.due_date)) : false;
                  return (
                    <button
                      key={task.id}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors text-left group"
                      onClick={() => navigate(`/projects/${task.project_id}`)}
                    >
                      <span className={cn('w-2 h-2 rounded-full shrink-0', PRIORITY_DOT[task.priority])} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                          {task.title}
                        </p>
                        {task.projects?.name && (
                          <p className="text-xs text-gray-400 truncate">{task.projects.name}</p>
                        )}
                      </div>
                      {task.due_date && (
                        <span className={cn(
                          'text-xs shrink-0 font-medium tabular-nums',
                          overdue ? 'text-red-600' : 'text-gray-400'
                        )}>
                          {format(new Date(task.due_date), 'MMM d')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activities */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-violet-500" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {activitiesQ.isLoading ? (
              <div className="px-6 pb-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 rounded" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState icon={MessageSquare} message="No activity recorded yet" />
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                {activities.map((a) => {
                  const Icon = ACTIVITY_ICON[a.type] ?? CircleDot;
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-6 py-3">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className="w-3.5 h-3.5 text-gray-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">
                          <span className="font-medium">{a.subject || 'Activity'}</span>
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {a.creator?.display_name ?? 'Unknown'} &middot;{' '}
                          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-gray-200 text-gray-500 shrink-0 capitalize">
                        {a.type.replace('_', ' ')}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── DEALS CLOSING SOON ────────────────────────────────────────────── */}
      <Card className="border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-rose-500" />
            Deals Closing Soon
            {dealsClosingSoon.length > 0 && (
              <Badge variant="outline" className="text-[10px] ml-1 border-rose-200 text-rose-600">
                {dealsClosingSoon.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dealsQ.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 rounded" />
              ))}
            </div>
          ) : dealsClosingSoon.length === 0 ? (
            <EmptyState icon={Handshake} message="No deals closing in the next 30 days" />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="text-xs">Deal</TableHead>
                    <TableHead className="text-xs">Company</TableHead>
                    <TableHead className="text-xs text-right">Value</TableHead>
                    <TableHead className="text-xs">Stage</TableHead>
                    <TableHead className="text-xs">Owner</TableHead>
                    <TableHead className="text-xs text-right">Days Left</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dealsClosingSoon.map((deal) => {
                    const daysLeft = differenceInDays(new Date(deal.expected_close_date!), new Date());
                    return (
                      <TableRow
                        key={deal.id}
                        className="cursor-pointer hover:bg-indigo-50/30"
                        onClick={() => navigate(`/deals/${deal.id}`)}
                      >
                        <TableCell className="font-medium text-sm text-gray-900">{deal.name}</TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {deal.company?.name ?? <span className="text-gray-300">&mdash;</span>}
                        </TableCell>
                        <TableCell className="text-sm text-gray-900 text-right font-medium tabular-nums">
                          {fmtCurrency(Number(deal.value), deal.currency)}
                        </TableCell>
                        <TableCell>
                          {deal.deal_stages && (
                            <Badge
                              variant="outline"
                              className="text-xs border"
                              style={{
                                borderColor: deal.deal_stages.color,
                                color: deal.deal_stages.color,
                                backgroundColor: `${deal.deal_stages.color}15`,
                              }}
                            >
                              {deal.deal_stages.name}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {deal.assignee?.display_name ?? <span className="text-gray-300">&mdash;</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            'text-xs font-semibold tabular-nums',
                            daysLeft <= 7 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-gray-600'
                          )}>
                            {daysLeft}d
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: typeof FolderKanban;
  accent: string;
  loading?: boolean;
}

function StatCard({ label, value, subtext, icon: Icon, accent, loading }: StatCardProps) {
  return (
    <Card className="border-gray-200">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
            {loading ? (
              <Skeleton className="h-8 w-20 rounded" />
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
                {subtext && <p className="text-xs text-gray-400">{subtext}</p>}
              </>
            )}
          </div>
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', accent)}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: typeof FolderKanban; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[180px] text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
        <Icon className="w-5 h-5 text-gray-300" />
      </div>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
