-- M4a prerequisite: the review type for an independent professional's commercial-publishing approval.
-- Enum values must be committed before use, so this is its own migration.
alter type public.verification_type add value if not exists 'independent_publisher';
