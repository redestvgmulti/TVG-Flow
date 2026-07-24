-- The AutoPublisher stores every immutable visual-title and sponsor PNG in the
-- ap-images bucket and reads them back through getPublicUrl, but no migration
-- provisions it, so a fresh local stack has no bucket and the storage RLS/upload
-- paths cannot be exercised. Create it idempotently. ON CONFLICT DO NOTHING so a
-- pre-existing bucket (e.g. one already configured in another environment) keeps
-- its current configuration untouched.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'ap-images',
    'ap-images',
    true,
    5242880,
    ARRAY['image/png']::text[]
)
ON CONFLICT (id) DO NOTHING;
