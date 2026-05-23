-- ============================================================
-- API tokens — Bearer auth for /api/mcp
-- Already applied via MCP apply_migration in dev environment.
-- ============================================================

create table api_tokens (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  prefix text not null,
  token_hash text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index on api_tokens(token_hash);
create index on api_tokens(profile_id);

alter table api_tokens enable row level security;
create policy "api_tokens admin" on api_tokens for all to authenticated using (is_admin()) with check (is_admin());
