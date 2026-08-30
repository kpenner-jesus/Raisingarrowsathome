-- ============================================================
--  20260619_application_mailing_address.sql
--
--  The apply funnel never collected a mailing address. Addresses
--  existed ONLY on `recipients`, and only ever populated by the
--  legacy bulk-import used to grandfather older families in from a
--  spreadsheet — so every family who applied through the website
--  had no address on file, which is a problem for posting cheques
--  and tax receipts.
--
--  Also records whether the family agreed to receive mail. Consent
--  is stored WITH A TIMESTAMP, not just a boolean: "did they agree"
--  and "when did they agree" are different questions, and only the
--  second one is any use if it is ever challenged.
--
--  `city` already exists on applications, so it is reused rather
--  than duplicated as address_city.
--
--  Safe to re-run.
-- ============================================================

alter table public.applications
  add column if not exists address_street    text,
  add column if not exists address_province  text,
  add column if not exists address_postal    text,
  add column if not exists mail_consent      boolean not null default false,
  add column if not exists mail_consent_at   timestamptz;

-- recipients already carries street/city/postal from the legacy import; add
-- province so an approval can copy the whole address across without losing a
-- line of it.
alter table public.recipients
  add column if not exists address_province  text,
  add column if not exists mail_consent      boolean not null default false;

comment on column public.applications.mail_consent is
  'Family ticked the "happy to receive mail from CEO Ministries" box on the application form.';
comment on column public.applications.mail_consent_at is
  'When that box was ticked. Set server-side at submission, never from the client.';
