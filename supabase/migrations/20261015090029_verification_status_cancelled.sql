-- An application the APPLICANT closes (abandoned / replaced) is not a rejection and not an
-- expiry. It needs its own terminal state so the rejection history stays untouched and the
-- one-open-application index (uq_verifications_open_per_org) is released. Added in its own
-- migration: a new enum value cannot be used in the transaction that adds it.
alter type public.verification_status add value if not exists 'cancelled';
