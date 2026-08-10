-- The original POSIX regex was over-escaped, rejecting valid chatgpt.com GPT URLs.
-- Use explicit URL prefixes to keep the constraint readable and deterministic.
ALTER TABLE public.assistentes
  DROP CONSTRAINT IF EXISTS assistentes_gpt_url_check;

ALTER TABLE public.assistentes
  ADD CONSTRAINT assistentes_gpt_url_check
  CHECK (
    gpt_url LIKE 'https://chatgpt.com/g/%'
    OR gpt_url LIKE 'https://chat.openai.com/g/%'
  );
