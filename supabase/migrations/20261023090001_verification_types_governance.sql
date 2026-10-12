-- ===========================================================================
-- M3 prerequisite: three more kinds of review on the EXISTING verifications system.
--
--   organization_identity  an approved organization asking to change its verified name / slug
--   co_owner               a member asking to be recognised as a verified co-owner / partner
--   branch_location        a branch asking to be shown publicly as a verified location
--
-- Enum values must be committed before they can be used, so this is its own migration
-- (same pattern as 20261022090002).
-- ===========================================================================
alter type public.verification_type add value if not exists 'organization_identity';
alter type public.verification_type add value if not exists 'co_owner';
alter type public.verification_type add value if not exists 'branch_location';
