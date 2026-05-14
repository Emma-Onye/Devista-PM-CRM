import { SquareCheck as CheckSquare } from 'lucide-react';

export function TasksPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <CheckSquare className="w-5 h-5 text-indigo-600" />
        <h1 className="text-lg font-semibold text-gray-900">My Tasks</h1>
      </div>
      <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
        <p className="text-sm text-gray-400">My Tasks — coming soon</p>
      </div>
    </div>
  );
}
