# Expense Tracker

Minimalist personal income/outgoings tracker. Next.js (App Router) + Supabase.

## Setup

### 1. Run the migration

In the Supabase dashboard, open **SQL Editor** and run the contents of
`supabase/migrations/0001_init.sql` (or use `supabase db push` if you have the
CLI linked to your project).

### 2. Create the user

Supabase dashboard → **Authentication → Users → Add user**. Enter your email
and password, and tick **Auto Confirm User**. There is no signup UI.

### 3. Set env vars

```sh
cp .env.example .env.local
```

Fill in both values from the Supabase dashboard → **Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` — the project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the anon/public key

### 4. Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000 and log in.

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel (framework preset:
   Next.js — detected automatically).
2. Add the two env vars from `.env.example` in the Vercel project settings.
3. Deploy.
