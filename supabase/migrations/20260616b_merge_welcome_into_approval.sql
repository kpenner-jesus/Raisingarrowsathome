-- ============================================================
--  Fold the welcome copy into the approval email.
--
--  Approval was sending two emails a second apart — a short decision
--  notice and a longer welcome — and both ended with the same next
--  action: open your portal. The family ALSO gets Supabase's separate
--  sign-in link, which we can't merge because that email is what
--  actually logs them in. Three emails in one minute means the useful
--  one gets skipped, so this collapses ours into one.
--
--  application_approved survives rather than welcome_family: the name
--  matches the moment, it pairs with application_denied, and every
--  existing tenant already has that row.
--
--  ── The important bit ──────────────────────────────────────
--  The UPDATE is guarded by `where body_html = <the original seeded
--  text>`. A program that has already rewritten its approval email
--  keeps its wording untouched. A migration that blindly overwrites
--  editable content destroys work someone did on purpose, and they
--  find out when a family quotes an email back at them.
--
--  welcome_family is ARCHIVED, not deleted, so the copy survives and
--  can be restored. Archiving alone would NOT have stopped it sending
--  (loadTemplate falls back to hardcoded copy) — the code no longer
--  calls it, which is what actually retires it.
--
--  Safe to re-run.
-- ============================================================

update public.email_templates set
  subject = 'Your grant is approved — welcome to {{org_name}}',
  body_html = '<p>Hi {{parent_names}},</p>
<p>Your application is approved and your portal is ready. Here is what you have to work with.</p>
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
  body_text = 'Hi {{parent_names}},

Your application is approved and your portal is ready.

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
  vars = array['parent_names','approved_amount','rate','deadline','portal_url','org_name'],
  updated_at = now()
where key = 'application_approved'
  -- ONLY rows still holding the original seeded copy. Anyone who edited
  -- their approval email keeps exactly what they wrote.
  and body_html = '<p>Hi {{parent_names}},</p><p>Your application has been approved. Sign in to your portal to start submitting receipts.</p><p><a href="{{portal_url}}">Open my portal</a></p>';

-- Retire the short-lived separate welcome. Reversible: archive_email_template
-- with restore: true, or set archived_at back to null.
update public.email_templates
   set archived_at = now()
 where key = 'welcome_family'
   and archived_at is null;
