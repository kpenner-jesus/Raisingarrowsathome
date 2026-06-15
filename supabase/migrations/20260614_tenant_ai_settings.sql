-- ============================================================
--  20260614_tenant_ai_settings.sql — per-tenant AI provider config
--
--  A tenant can supply their OWN OpenRouter API key + chosen model so they
--  carry their own LLM cost. When unset, the in-app AI chat falls back to the
--  platform Anthropic model (Sonnet 4.6), and any OpenRouter error auto-fails-
--  over to it too.
--
--  - ai_model (non-secret) lives on tenants.
--  - The API key (AES-256-GCM ciphertext, app/lib/crypto.ts) lives in a
--    SEPARATE table tenant_ai_secrets with RLS enabled and NO policies, so no
--    anon/authenticated client can read it even via a direct PostgREST query.
--    (A column on tenants would be member-readable via tenants_member_read +
--    the table-level SELECT grant — a column REVOKE can't override that.)
--    The service role bypasses RLS, so app/lib/ai/provider.ts still reads it.
-- ============================================================

alter table public.tenants
  add column if not exists ai_model text;

-- Drop the earlier (member-readable) location if it was created by a prior run.
alter table public.tenants
  drop column if exists openrouter_key_encrypted;

create table if not exists public.tenant_ai_secrets (
  org_id                   uuid primary key references public.tenants(id) on delete cascade,
  openrouter_key_encrypted text not null,
  updated_at               timestamptz not null default now()
);

-- RLS on, NO policies → unreachable by anon/authenticated. service_role bypasses.
alter table public.tenant_ai_secrets enable row level security;

comment on table public.tenant_ai_secrets is
  'Per-tenant third-party AI keys (AES-256-GCM ciphertext). Service-role only — RLS on with no policies; never exposed to the client.';
comment on column public.tenants.ai_model is
  'OpenRouter model slug (e.g. anthropic/claude-sonnet-4.6) used when an OpenRouter key is set in tenant_ai_secrets; otherwise the platform Anthropic model.';
