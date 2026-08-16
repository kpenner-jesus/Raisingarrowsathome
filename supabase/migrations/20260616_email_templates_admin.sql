-- ============================================================
--  Email templates: archiving + the family welcome email.
--
--  1. archived_at — templates can now be retired without being
--     destroyed. Archiving must be reversible and must not lose the
--     copy someone wrote, so this is a nullable timestamp rather than
--     a delete. loadTemplate() ignores archived rows, so archiving a
--     key makes the sender fall back to its hardcoded copy instead of
--     sending nothing.
--
--  2. welcome_family — sent when a family is approved and gets portal
--     access. Until now that moment sent a bare Supabase sign-in link
--     plus the approval notice; nothing explained how the grant
--     actually works. Seeded for EVERY tenant, including the canonical
--     raising-arrows org that new tenants copy their templates from
--     (app/api/signup/create-org/route.ts) — without that row, every
--     future tenant would be missing it.
--
--  Safe to re-run: add column if not exists + on conflict do nothing.
-- ============================================================

alter table public.email_templates
  add column if not exists archived_at timestamptz;

comment on column public.email_templates.archived_at is
  'When set, the template is retired: hidden from the admin editor and ignored by loadTemplate(), which then falls back to the hardcoded copy. Null = active.';

create index if not exists idx_email_templates_active
  on public.email_templates (org_id, key) where archived_at is null;

insert into public.email_templates (org_id, key, label, subject, body_html, body_text, vars)
select
  t.id,
  'welcome_family',
  'Welcome — portal access',
  'Welcome to {{org_name}} — your portal is ready',
  '<p>Hi {{parent_names}},</p>
<p>Your grant is approved and your portal is ready. Here is what you have to work with.</p>
<p style="background:#fdf3e3;border-left:3px solid #e8793a;padding:12px 16px;margin:20px 0;">
  <strong>Your grant:</strong> {{approved_amount}}<br>
  <strong>You get back:</strong> {{rate}} of what you spend on qualifying items<br>
  <strong>Send receipts by:</strong> {{deadline}}
</p>
<p><strong>How it works</strong></p>
<ol>
  <li>Buy the curriculum and supplies your family needs.</li>
  <li>Take a photo of the receipt, or save the PDF.</li>
  <li>Upload it in your portal. We review it and it goes into your balance.</li>
</ol>
<p>Your portal also shows what has been paid, what is still being checked, and how much of your grant is left.</p>
<p style="margin:24px 0;"><a href="{{portal_url}}" style="background:#e8793a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:100px;display:inline-block;font-weight:500;">Open your portal</a></p>
<p>There is no password to remember. You will get a separate email with a sign-in link — click it and you are in.</p>
<p>If anything is unclear, just reply to this email. We would rather answer a small question early than have you wait.</p>
<p>In Him,<br>The {{org_name}} team</p>',
  'Hi {{parent_names}},

Your grant is approved and your portal is ready.

Your grant: {{approved_amount}}
You get back: {{rate}} of what you spend on qualifying items
Send receipts by: {{deadline}}

How it works:
1. Buy the curriculum and supplies your family needs.
2. Take a photo of the receipt, or save the PDF.
3. Upload it in your portal. We review it and it goes into your balance.

Open your portal: {{portal_url}}

There is no password to remember. You will get a separate email with a sign-in link.

If anything is unclear, just reply to this email.

In Him,
The {{org_name}} team',
  array['parent_names','approved_amount','rate','deadline','portal_url','org_name']
from public.tenants t
on conflict (org_id, key) do nothing;
