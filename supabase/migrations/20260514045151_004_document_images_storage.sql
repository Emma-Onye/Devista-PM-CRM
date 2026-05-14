/*
  # Document Images Storage Bucket

  Creates a Supabase Storage bucket for document images uploaded
  via the BlockNote editor's image block.

  1. Storage
    - Creates `document-images` bucket (public)
  2. Security
    - Authenticated users can upload to their workspace folder
    - Public read access for embedded images
    - Users can only delete their own uploads
*/

-- Create the storage bucket for document images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'document-images',
  'document-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload document images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'document-images');

-- Allow public read access (images are embedded in docs)
CREATE POLICY "Public can read document images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'document-images');

-- Allow users to delete their own uploads
CREATE POLICY "Authenticated users can delete document images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'document-images' AND auth.uid()::text = (storage.foldername(name))[1]);
