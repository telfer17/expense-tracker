# Expense Tracker

Minimalist personal income/outgoings tracker. Next.js (App Router) + Supabase.

## Setup

### 1. Run the migrations

Run **every** file in `supabase/migrations/` in numeric order (`0001_init.sql`,
then `0002_...`, and so on through the highest number). Later migrations build
on earlier ones, and the last one grants the app's database roles access to the
tables and functions, so stopping early leaves the app unable to read anything.

Either paste each file into the Supabase dashboard's **SQL Editor** in order, or
run `supabase db push` if you have the CLI linked to your project.

When adding a migration that creates a table, view or function, include its
GRANTs in the same file. See the comment at the top of
`supabase/migrations/0011_data_api_grants.sql` for the pattern.

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
