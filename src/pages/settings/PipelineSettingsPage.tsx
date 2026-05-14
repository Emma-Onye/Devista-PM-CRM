import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DragDropContext, Droppable, Draggable, type DropResult,
} from '@hello-pangea/dnd';
import {
  GripVertical, Plus, Trash2, Loader as Loader2, Check, X, Pencil,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { cn } from '../../lib/utils';
import type { DealStage } from '../../lib/database.types';

// Preset colors for new stages
const STAGE_COLORS = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#f59e0b', '#f97316', '#ef4444', '#8b5cf6', '#10b981',
];

export function PipelineSettingsPage() {
  const { activeWorkspace, myRole } = useWorkspaceStore();
  const qc = useQueryClient();
  const canEdit = myRole === 'owner' || myRole === 'admin';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editProbability, setEditProbability] = useState('');
  const [editColor, setEditColor] = useState('');

  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProbability, setNewProbability] = useState('20');
  const [newColor, setNewColor] = useState(STAGE_COLORS[0]);

  const [deleteTarget, setDeleteTarget] = useState<DealStage | null>(null);
  const [fallbackStageId, setFallbackStageId] = useState('');

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: stages = [], isLoading } = useQuery<DealStage[]>({
    queryKey: ['deal-stages', activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('deal_stages').select('*')
        .eq('workspace_id', activeWorkspace!.id).order('position');
      if (error) throw error;
      return data as DealStage[];
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const reorderMutation = useMutation({
    mutationFn: async (reordered: DealStage[]) => {
      await Promise.all(reordered.map((s, i) =>
        (supabase as any).from('deal_stages').update({ position: i }).eq('id', s.id)
      ));
    },
    onMutate: async (reordered) => {
      await qc.cancelQueries({ queryKey: ['deal-stages', activeWorkspace?.id] });
      const prev = qc.getQueryData<DealStage[]>(['deal-stages', activeWorkspace?.id]);
      qc.setQueryData<DealStage[]>(['deal-stages', activeWorkspace?.id], reordered.map((s, i) => ({ ...s, position: i })));
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['deal-stages', activeWorkspace?.id], ctx?.prev); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deal-stages', activeWorkspace?.id] }),
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<DealStage> }) => {
      const { error } = await (supabase as any).from('deal_stages').update(updates).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: ['deal-stages', activeWorkspace?.id] });
      const prev = qc.getQueryData<DealStage[]>(['deal-stages', activeWorkspace?.id]);
      qc.setQueryData<DealStage[]>(['deal-stages', activeWorkspace?.id],
        (old = []) => old.map((s) => s.id === id ? { ...s, ...updates } : s));
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(['deal-stages', activeWorkspace?.id], ctx?.prev); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deal-stages', activeWorkspace?.id] }); setEditingId(null); },
  });

  const addStageMutation = useMutation({
    mutationFn: async () => {
      const position = stages.length;
      const { error } = await (supabase as any).from('deal_stages').insert({
        workspace_id: activeWorkspace!.id,
        name: newName.trim(),
        position,
        probability: Number(newProbability),
        color: newColor,
        is_won: false,
        is_lost: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deal-stages', activeWorkspace?.id] });
      setAddingNew(false);
      setNewName('');
      setNewProbability('20');
      setNewColor(STAGE_COLORS[0]);
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: async ({ stageId, moveToId }: { stageId: string; moveToId: string }) => {
      // Move all deals to fallback stage first
      await (supabase as any).from('deals')
        .update({ deal_stage_id: moveToId })
        .eq('deal_stage_id', stageId);
      // Delete the stage
      const { error } = await (supabase as any).from('deal_stages').delete().eq('id', stageId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deal-stages', activeWorkspace?.id] });
      qc.invalidateQueries({ queryKey: ['deals', activeWorkspace?.id] });
      setDeleteTarget(null);
      setFallbackStageId('');
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const reordered = Array.from(stages);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    reorderMutation.mutate(reordered);
  };

  const startEdit = (stage: DealStage) => {
    setEditingId(stage.id);
    setEditName(stage.name);
    setEditProbability(String(stage.probability));
    setEditColor(stage.color);
  };

  const commitEdit = (stage: DealStage) => {
    updateStageMutation.mutate({
      id: stage.id,
      updates: {
        name: editName.trim() || stage.name,
        probability: Math.min(100, Math.max(0, Number(editProbability))),
        color: editColor,
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Deal Pipeline</h2>
        <p className="text-sm text-gray-500 mt-1">
          Customize the stages in your sales pipeline. Drag to reorder.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[32px_1fr_100px_60px_80px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Stage name</p>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Probability</p>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Color</p>
            <div />
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="stages">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {stages.map((stage, index) => (
                    <Draggable key={stage.id} draggableId={stage.id} index={index} isDragDisabled={!canEdit || editingId === stage.id}>
                      {(drag, snap) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={cn(
                            'grid grid-cols-[32px_1fr_100px_60px_80px] gap-3 items-center px-4 py-3 border-b border-gray-100 last:border-0',
                            snap.isDragging ? 'bg-indigo-50 shadow-md' : 'hover:bg-gray-50/60',
                          )}
                        >
                          {/* Drag handle */}
                          <div {...drag.dragHandleProps} className={cn('text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing', !canEdit && 'invisible')}>
                            <GripVertical className="w-4 h-4" />
                          </div>

                          {/* Name */}
                          {editingId === stage.id ? (
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                              className="h-7 text-sm" autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(stage); if (e.key === 'Escape') setEditingId(null); }} />
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
                              <span className="text-sm font-medium text-gray-900">{stage.name}</span>
                              {stage.is_won && <span className="text-xs bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">Won</span>}
                              {stage.is_lost && <span className="text-xs bg-red-100 text-red-600 rounded px-1.5 py-0.5">Lost</span>}
                            </div>
                          )}

                          {/* Probability */}
                          {editingId === stage.id ? (
                            <div className="flex items-center gap-1">
                              <Input type="number" min="0" max="100" value={editProbability}
                                onChange={(e) => setEditProbability(e.target.value)}
                                className="h-7 text-sm w-16" />
                              <span className="text-xs text-gray-400">%</span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-600">{stage.probability}%</span>
                          )}

                          {/* Color swatch */}
                          {editingId === stage.id ? (
                            <div className="flex flex-wrap gap-1">
                              {STAGE_COLORS.map((c) => (
                                <button key={c} title={c}
                                  className={cn('w-4 h-4 rounded-full border-2 transition-transform hover:scale-110',
                                    editColor === c ? 'border-gray-700 scale-110' : 'border-transparent')}
                                  style={{ background: c }}
                                  onClick={() => setEditColor(c)}
                                />
                              ))}
                            </div>
                          ) : (
                            <span className="w-5 h-5 rounded-full border border-gray-200" style={{ background: stage.color }} />
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-1 justify-end">
                            {editingId === stage.id ? (
                              <>
                                <Button size="icon" variant="ghost" className="w-6 h-6 text-emerald-600 hover:text-emerald-700"
                                  onClick={() => commitEdit(stage)} disabled={updateStageMutation.isPending}>
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="w-6 h-6 text-gray-400"
                                  onClick={() => setEditingId(null)}>
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : canEdit ? (
                              <>
                                <Button size="icon" variant="ghost" className="w-6 h-6 text-gray-400 hover:text-gray-700"
                                  onClick={() => startEdit(stage)}>
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                {!stage.is_won && !stage.is_lost && (
                                  <Button size="icon" variant="ghost"
                                    className="w-6 h-6 text-gray-300 hover:text-red-500 transition-colors"
                                    onClick={() => {
                                      setDeleteTarget(stage);
                                      const fallback = stages.find((s) => s.id !== stage.id);
                                      setFallbackStageId(fallback?.id ?? '');
                                    }}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                )}
                              </>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {/* Add new stage row */}
          {addingNew && (
            <div className="grid grid-cols-[32px_1fr_100px_1fr_80px] gap-3 items-center px-4 py-3 border-t border-indigo-100 bg-indigo-50/30">
              <div />
              <Input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="Stage name" className="h-7 text-sm" autoFocus
                onKeyDown={(e) => { if (e.key === 'Escape') setAddingNew(false); }} />
              <div className="flex items-center gap-1">
                <Input type="number" min="0" max="100" value={newProbability}
                  onChange={(e) => setNewProbability(e.target.value)}
                  className="h-7 text-sm w-16" />
                <span className="text-xs text-gray-400">%</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {STAGE_COLORS.map((c) => (
                  <button key={c} title={c}
                    className={cn('w-4 h-4 rounded-full border-2 transition-transform hover:scale-110',
                      newColor === c ? 'border-gray-700 scale-110' : 'border-transparent')}
                    style={{ background: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1 justify-end">
                <Button size="icon" variant="ghost" className="w-6 h-6 text-emerald-600"
                  onClick={() => addStageMutation.mutate()} disabled={!newName.trim() || addStageMutation.isPending}>
                  {addStageMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="w-6 h-6 text-gray-400"
                  onClick={() => setAddingNew(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {canEdit && !addingNew && (
        <Button variant="outline" size="sm" className="mt-4 gap-1.5"
          onClick={() => setAddingNew(true)}>
          <Plus className="w-3.5 h-3.5" /> Add Stage
        </Button>
      )}

      <p className="text-xs text-gray-400 mt-4">
        "Closed Won" and "Closed Lost" stages cannot be deleted. Drag rows to reorder.
      </p>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setFallbackStageId(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stage "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All deals in this stage will be moved to the selected stage before deletion. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <Label className="text-sm">Move deals to</Label>
            <select
              className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm bg-white"
              value={fallbackStageId}
              onChange={(e) => setFallbackStageId(e.target.value)}
            >
              {stages.filter((s) => s.id !== deleteTarget?.id).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={!fallbackStageId || deleteStageMutation.isPending}
              onClick={() => deleteTarget && deleteStageMutation.mutate({ stageId: deleteTarget.id, moveToId: fallbackStageId })}
            >
              {deleteStageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete Stage'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
