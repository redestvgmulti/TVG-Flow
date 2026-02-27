-- Ensure the bucket exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('ap_media', 'ap_media', true) 
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop if exist to be safe
DROP POLICY IF EXISTS "ap_media_public_read" ON storage.objects;
DROP POLICY IF EXISTS "ap_media_auth_upload" ON storage.objects;

-- Create policies
CREATE POLICY "ap_media_public_read" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'ap_media');

CREATE POLICY "ap_media_auth_upload" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'ap_media');
