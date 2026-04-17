-- ============================================================
-- Digital ID UX improvements:
-- - Ensure QR token exists for new users (cadets/officers) automatically
-- - Allow public portal photo update via credential verification RPC
-- ============================================================

-- Ensure pgcrypto exists for digest() + gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Auto-generate qr_token if missing (cadet/officer)
CREATE OR REPLACE FUNCTION public.users_ensure_qr_token()
RETURNS trigger AS $$
DECLARE
  generated_token text;
BEGIN
  IF NEW.qr_token IS NULL OR length(trim(NEW.qr_token)) = 0 THEN
    -- 64-char hex string (sha256)
    generated_token := encode(digest(gen_random_uuid()::text, 'sha256'), 'hex');
    NEW.qr_token := generated_token;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_ensure_qr_token ON public.users;
CREATE TRIGGER trg_users_ensure_qr_token
BEFORE INSERT ON public.users
FOR EACH ROW
WHEN (NEW.role IN ('cadet', 'officer'))
EXECUTE FUNCTION public.users_ensure_qr_token();

-- 2) Secure-ish photo update for public portal:
--    Cadet provides ID Number + Password (ROTCxxxx). We verify against password_hash.
--    The app uses SHA256(plain) via expo-crypto, stored as hex; pgcrypto digest() matches.
CREATE OR REPLACE FUNCTION public.set_user_photo_by_credentials(
  p_id_number text,
  p_password text,
  p_photo_url text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid;
  expected_hash text;
BEGIN
  IF p_id_number IS NULL OR length(trim(p_id_number)) = 0 THEN
    RAISE EXCEPTION 'Missing id_number';
  END IF;
  IF p_password IS NULL OR length(trim(p_password)) = 0 THEN
    RAISE EXCEPTION 'Missing password';
  END IF;
  IF p_photo_url IS NULL OR length(trim(p_photo_url)) = 0 THEN
    RAISE EXCEPTION 'Missing photo_url';
  END IF;

  SELECT id, password_hash
    INTO target_id, expected_hash
  FROM public.users
  WHERE id_number = trim(p_id_number)
    AND role IN ('cadet', 'officer')
    AND is_active = true
    AND is_deleted = false
  LIMIT 1;

  IF target_id IS NULL THEN
    RETURN false;
  END IF;

  IF expected_hash IS NULL OR length(trim(expected_hash)) = 0 THEN
    RETURN false;
  END IF;

  IF lower(expected_hash) <> lower(encode(digest(p_password, 'sha256'), 'hex')) THEN
    RETURN false;
  END IF;

  UPDATE public.users
  SET photo_url = p_photo_url,
      updated_at = now()
  WHERE id = target_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_photo_by_credentials(text, text, text) TO anon, authenticated;

