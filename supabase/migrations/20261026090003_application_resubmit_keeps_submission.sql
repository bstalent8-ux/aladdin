-- B3-D: an organization application that an Admin sent back ("needs changes") could never be resubmitted.
--
-- organization_application_submit() moved the open verification from needs_more_info back to submitted with
--   update public.verifications set status = 'submitted', submitted_at = now(), decided_at = null
-- but app.guard_verification_update() (20260804090001) makes submitted_at immutable ("verification subject, type,
-- target, submission, and metadata are immutable", SQLSTATE 23514). Every Resubmit therefore failed, the applicant
-- saw only "That didn't work. Please try again.", and the application stayed in needs_more_info forever although
-- the screen offered the button (my_organization_applications reports can_submit = true).
--
-- Fix (smallest, guard untouched): a resubmission keeps the original submission timestamp and only returns the
-- verification to the review queue (status = submitted, decided_at cleared). The resubmission instant is still
-- recorded, by the existing 'organization.application_submitted' audit event this function already writes. The
-- immutability guard, the lifecycle, authorization and every other statement are unchanged: the live definition is
-- rewritten in place and the migration aborts unless exactly that one assignment was found.
do $$
declare
  v_def text := pg_get_functiondef('public.organization_application_submit(uuid)'::regprocedure);
  v_new text := replace(v_def, 'set status = ''submitted'', submitted_at = now(), decided_at = null',
                               'set status = ''submitted'', decided_at = null');
begin
  if v_new = v_def then
    raise exception 'B3-D: the resubmission update was not found in organization_application_submit';
  end if;
  execute v_new;
end;
$$;
