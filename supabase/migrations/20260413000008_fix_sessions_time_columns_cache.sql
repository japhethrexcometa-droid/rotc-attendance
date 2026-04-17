-- Ensure session time columns exist and PostgREST cache is refreshed

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS late_time TIME,
  ADD COLUMN IF NOT EXISTS cutoff_time TIME;

-- Refresh API schema cache so new columns are visible immediately
NOTIFY pgrst, 'reload schema';
