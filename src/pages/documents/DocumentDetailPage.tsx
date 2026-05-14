import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Loader as Loader2, FolderKanban, Clock, User } from 'lucide-react';
import type { Block } from '@blocknote/core';
import { supabase } from '../../lib/supabase';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { BlockEditor } from '../../components/editor/BlockEditor';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocumentDetail {
  id: string;
  title: string;
  project_id: string | null;
  content_json: Block[] | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  project: { id: string; name: string } | null;
  creator: { display_name: string; avatar_url: string | null } | null;
}

// ── DocumentDetailPage ────────────────────────────────────────────────────────

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceStore();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: doc, isLoading } = useQuery<DocumentDetail>({
    queryKey: ['document', id],
    enabled: !!id && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('documents')
        .select('*, project:projects(id, name), creator:profiles!documents_created_by_fkey(display_name, avatar_url)')
        .eq('id', id)
        .eq('workspace_id', activeWorkspace!.id)
        .single();
      if (error) throw error;
      return data as DocumentDetail;
    },
  });

  useEffect(() => {
    if (doc && !titleEditing) {
      setTitle(doc.title);
    }
  }, [doc?.id]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (updates: { title?: string; content_json?: Block[] }) => {
      const { error } = await (supabase as any)
        .from('documents')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', id] });
      qc.invalidateQueries({ queryKey: ['documents', activeWorkspace?.id] });
      setSavedIndicator(true);
      setTimeout(() => setSavedIndicator(false), 2000);
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const commitTitle = () => {
    setTitleEditing(false);
    const trimmed = title.trim() || 'Untitled Document';
    if (trimmed !== doc?.title) {
      saveMutation.mutate({ title: trimmed });
    }
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => {
      const trimmed = val.trim() || 'Untitled Document';
      saveMutation.mutate({ title: trimmed });
    }, 1500);
  };

  const handleContentChange = useCallback((blocks: Block[]) => {
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
    contentSaveTimer.current = setTimeout(() => {
      saveMutation.mutate({ content_json: blocks });
    }, 2000);
  }, [saveMutation]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-gray-400">Document not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/documents')}>
          Back to Documents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-gray-500 hover:text-gray-800 -ml-2 h-8"
          onClick={() => navigate('/documents')}
        >
          <ArrowLeft className="w-4 h-4" /> Documents
        </Button>

        <div className="flex items-center gap-3">
          {savedIndicator && (
            <span className="text-xs text-emerald-600 font-medium animate-pulse">Saved</span>
          )}
          {saveMutation.isPending && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </span>
          )}
        </div>
      </div>

      {/* Document body — centered Notion-style */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 pb-24">
          {/* Title */}
          <div className="pt-12 pb-2">
            {titleEditing ? (
              <input
                ref={titleRef}
                className="w-full text-3xl font-bold text-gray-900 bg-transparent outline-none leading-tight placeholder:text-gray-300"
                value={title}
                placeholder="Untitled Document"
                onChange={(e) => handleTitleChange(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                  if (e.key === 'Escape') { setTitle(doc.title); setTitleEditing(false); }
                }}
                autoFocus
              />
            ) : (
              <button
                className="w-full text-left text-3xl font-bold text-gray-900 hover:text-gray-700 transition-colors leading-tight"
                onClick={() => setTitleEditing(true)}
              >
                {doc.title}
              </button>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-4 pb-6 pt-2 border-b border-gray-100 flex-wrap">
            {doc.project && (
              <button
                className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-800 transition-colors"
                onClick={() => navigate(`/projects/${doc.project!.id}`)}
              >
                <FolderKanban className="w-3.5 h-3.5" />
                {doc.project.name}
              </button>
            )}
            {doc.creator && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <User className="w-3.5 h-3.5" />
                {doc.creator.display_name}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Clock className="w-3.5 h-3.5" />
              Updated {format(new Date(doc.updated_at), 'MMM d, yyyy · h:mm a')}
            </div>
          </div>

          {/* BlockNote Editor */}
          <div className={cn(
            'mt-4',
            '[&_.bn-editor]:!px-0',
            '[&_.bn-container]:!bg-transparent',
            '[&_.bn-editor_p]:text-gray-800',
            '[&_.bn-editor]:min-h-[400px]',
          )}>
            <BlockEditor
              key={doc.id}
              initialContent={doc.content_json}
              onChange={handleContentChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
