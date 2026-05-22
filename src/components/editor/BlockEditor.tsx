import { useRef, useCallback } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { Block } from '@blocknote/core';
import { supabase } from '../../lib/supabase';

interface Props {
  initialContent: Block[] | null | undefined;
  onChange: (blocks: Block[]) => void;
  editable?: boolean;
  className?: string;
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

async function uploadFileToSupabase(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are allowed.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File must be under 5 MB.');
  }
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'png';
  const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png';
  const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
  const { error } = await supabase.storage
    .from('document-images')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('document-images').getPublicUrl(path);
  return data.publicUrl;
}

export function BlockEditor({ initialContent, onChange, editable = true, className }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useCreateBlockNote({
    initialContent: initialContent && initialContent.length > 0
      ? (initialContent as Block[])
      : undefined,
    uploadFile: uploadFileToSupabase,
  });

  const handleChange = useCallback(() => {
    onChangeRef.current(editor.document as Block[]);
  }, [editor]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={handleChange}
      className={className}
      theme="light"
    />
  );
}
