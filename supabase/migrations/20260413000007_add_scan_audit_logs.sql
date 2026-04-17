-- ============================================================
-- Add scanner audit log table for ROTC attendance module
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scan_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scanned_by UUID REFERENCES public.users(id),
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  cadet_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL,
  status TEXT,
  reason TEXT,
  payload_preview TEXT
);

ALTER TABLE public.scan_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scan_audit_logs_select_all" ON public.scan_audit_logs;
CREATE POLICY "scan_audit_logs_select_all"
  ON public.scan_audit_logs FOR SELECT
  USING (public.check_access());

DROP POLICY IF EXISTS "scan_audit_logs_insert_gateway" ON public.scan_audit_logs;
CREATE POLICY "scan_audit_logs_insert_gateway"
  ON public.scan_audit_logs FOR INSERT
  WITH CHECK (public.check_access());
