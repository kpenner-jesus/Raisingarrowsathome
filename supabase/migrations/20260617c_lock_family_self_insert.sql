-- ============================================================
--  SECURITY: stop a family writing their own APPROVED receipt.
--
--  The three "self insert" policies checked one thing — that the row's
--  recipient_id belonged to the caller:
--
--      with check (recipient_id in
--        (select id from recipients where profile_id = auth.uid()))
--
--  They constrained nothing else. Because the anon key is public and a
--  signed-in family holds a real Supabase session in the browser (the portal
--  uploads with it), a family could POST straight to PostgREST, bypassing
--  every check in app/api/portal/receipts/route.ts, and insert:
--
--      { recipient_id: <their own>, status: 'approved',
--        reimbursable_amount: <their entire grant cap> }
--
--  generatePayoutsForOrg() pays approved receipts. No admin ever sees it.
--  That is theft of real charity money by anyone holding a portal login.
--
--  Two further holes in the same policies:
--    * org_id was not pinned to the recipient's own tenant, so a family in
--      charity A could write rows carrying charity B's org_id into B's admin
--      screens, exports and public website.
--    * testimonials did not pin status/featured, so a family could publish
--      arbitrary text straight to the charity's public homepage, which reads
--      status='approved' with no admin step.
--
--  Every column a family may set is now enumerated. Anything that represents
--  a DECISION (status, money, who decided, featured) must be null/default and
--  can only be changed by an admin, whose own policy is unaffected.
--
--  Safe to re-run.
-- ============================================================

begin;

-- ── RECEIPTS ────────────────────────────────────────────────
drop policy if exists receipts_self_insert on public.receipts;
create policy receipts_self_insert on public.receipts
  for insert to authenticated
  with check (
    -- the row must belong to the caller AND to that recipient's own tenant
    recipient_id in (
      select r.id from public.recipients r
       where r.profile_id = auth.uid()
         and r.org_id = receipts.org_id
    )
    -- a family submits for REVIEW; they never decide
    and status = 'pending'
    and reimbursable_amount is null
    and decided_at is null
    and decided_by is null
    and duplicate_of_id is null
    and admin_notes is null
    -- and the amount has to be a real one
    and amount > 0
    and amount <= 50000
  );

-- ── PHOTOS ──────────────────────────────────────────────────
drop policy if exists photos_self_insert on public.photos;
create policy photos_self_insert on public.photos
  for insert to authenticated
  with check (
    recipient_id in (
      select r.id from public.recipients r
       where r.profile_id = auth.uid()
         and r.org_id = photos.org_id
    )
  );

-- ── TESTIMONIALS ────────────────────────────────────────────
drop policy if exists testimonials_self_insert on public.testimonials;
create policy testimonials_self_insert on public.testimonials
  for insert to authenticated
  with check (
    recipient_id in (
      select r.id from public.recipients r
       where r.profile_id = auth.uid()
         and r.org_id = testimonials.org_id
    )
    -- goes to the admin review queue, never straight to the public site
    and status = 'pending'
    and featured = false
    and reviewed_by is null
    and reviewed_at is null
  );

commit;
