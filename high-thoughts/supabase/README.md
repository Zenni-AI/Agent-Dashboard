# The credit ledger in Postgres

The app runs on a JSON file by default and does not need any of this. Switch to
Postgres when other people can reach the app, for two reasons the file cannot
fix: the file lives on the container's disk, so a redeploy can take everybody's
purchases with it, and it is single-process, so two instances against one file
will sell the same credit twice.

## Switching over

1. **Apply the migration.** Paste `migrations/0001_credit_ledger.sql` into the
   project's SQL editor and run it. It is safe to re-run.
2. **Set two environment variables** on the server, from Project settings →
   API:

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```

   That is all it takes — `HIGH_THOUGHTS_LEDGER` does not need setting, because
   having both of these is taken as the answer. The startup banner says which
   ledger is live; check it before anybody tries to spend anything.
3. **Move existing credits across**, if there are any. Tokens are stored as
   hashes, so there is nothing to re-issue — for each entry in
   `.high-thoughts/credits.json`, run:

   ```sql
   select public.ht_grant('<token_hash>', <credits>, '<note>');
   ```

   Existing tokens keep working; nothing a person holds changes.

The service role key bypasses row-level security. It belongs on the server and
nowhere else — never in the app, never in the repo, never in a client bundle.

## What the schema is doing

The tables are in a `high_thoughts` schema, which PostgREST does not expose, so
no API key reaches them directly. Everything goes through six functions in
`public`, each `security definer` with a pinned `search_path`, and execute is
revoked from `anon` and `authenticated` — the roles a leaked publishable key
maps to — and granted only to `service_role`.

A spend is one conditional `UPDATE ... WHERE credits >= 1`, so the database
decides atomicity rather than the server. The free allowance is a row with a
primary key on the claim hash, so two simultaneous claims cannot both win.

## Before you change any of it

```
npm run ledger:sql
```

That stands up a throwaway PostgreSQL, applies this migration exactly as
Supabase would, and asserts the behaviour that costs money if it is wrong —
including two overlapping transactions racing for the last credit, and the
privilege boundary above. It needs a local `postgresql` server installed and
skips cleanly when there isn't one.
