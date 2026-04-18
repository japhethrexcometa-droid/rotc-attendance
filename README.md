# MSU – Zamboanga Sibugay ROTC Attendance System

## Deployment

This system is deployed live on **Vercel**. All updates are pushed via GitHub and auto-deployed.

### How to push updates

```powershell
git add .
git commit -m "your message"
git push
```

Vercel will automatically rebuild and deploy within ~1 minute.

---

## Supabase (Remote Database)

The app uses **Remote Supabase** (cloud-hosted). No local setup required.

- **URL**: `https://pfkmqrwpdkxgwdnwfrgk.supabase.co`
- Credentials are already configured in the app.

---

## Environment Variables (Vercel)

Set these in the Vercel project dashboard under **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |

---

## Features

- ✅ QR Code scanner for attendance logging
- ✅ Online + Offline (Field Mode) support with auto-sync
- ✅ Role-based access: Admin, Officer, Cadet
- ✅ Officer-to-officer scanning blocked (only Admin can scan Officers)
- ✅ Duplicate scan detection (online and offline)
- ✅ Session management (AM/PM, cutoff enforcement)
- ✅ Duty reports and attendance reporting
