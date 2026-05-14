/*
  # Workspace Logos Storage Bucket

  Creates a public storage bucket for workspace logo uploads.
  - Bucket: workspace-logos (public read)
  - Storage policies: only authenticated workspace owners/admins can upload/update/delete logos
  - Anyone can read (public bucket for displaying logos in the UI)
*/

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-logos',
  'workspace-logos',
  true,
  2097152, -- 2MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload logos (path must be workspace_id/filename)
CREATE POLICY "Workspace admins can upload logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'workspace-logos'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = (storage.foldername(name))[1]::uuid
        AND user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'admin')
    )
  );

-- Allow authenticated users to update logos they can manage
CREATE POLICY "Workspace admins can update logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = (storage.foldername(name))[1]::uuid
        AND user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'admin')
    )
  );

-- Allow authenticated users to delete logos they can manage
CREATE POLICY "Workspace admins can delete logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = (storage.foldername(name))[1]::uuid
        AND user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'admin')
    )
  );

-- Public read for logos (bucket is public)
CREATE POLICY "Anyone can view workspace logos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'workspace-logos');
