-- ROTC Attendance System Database Schema

-- Ensure UUID generator exists on remote database
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. USERS TABLE (Handles Cadets, Officers, and Admins)
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_number TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'officer', 'cadet')),
    platoon TEXT,
    year_level TEXT,
    qr_token TEXT UNIQUE,
    photo_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    password_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. SESSIONS TABLE (Handles the AM/PM open/close sessions)
CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    session_type TEXT NOT NULL CHECK (session_type IN ('AM', 'PM')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_date, session_type)
);

-- 3. ATTENDANCE TABLE (Logs the scans)
CREATE TABLE public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cadet_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('present', 'late', 'error')),
    scan_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scanned_by UUID REFERENCES public.users(id), -- Which officer scanned them
    UNIQUE(cadet_id, session_id) -- Prevent duplicate scans in the same session
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- Basic Policies
CREATE POLICY "Sessions are readable by everyone" ON public.sessions FOR SELECT USING (true);
CREATE POLICY "Admins and officers can insert attendance" ON public.attendance FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow reading attendance" ON public.attendance FOR SELECT USING (true);
CREATE POLICY "Users are readable by everyone" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can upload their own photo" ON storage.objects FOR INSERT 
CREATE POLICY "Users can update their own photo" ON public.users FOR UPDATE 
    USING (auth.uid() = id) 
    WITH CHECK (auth.uid() = id);

-- 4. STORAGE SETUP
-- Create bucket for cadet photos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('cadet-photos', 'cadet-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'cadet-photos');
CREATE POLICY "Users can upload their own photo" ON storage.objects FOR INSERT 
    WITH CHECK (bucket_id = 'cadet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can update their own photo" ON storage.objects FOR UPDATE 
    USING (bucket_id = 'cadet-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
