-- Add school column to users table for export grouping
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS school text DEFAULT NULL;
