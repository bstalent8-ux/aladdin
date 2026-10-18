-- Product Offers — least privilege for the internal helpers.
--
-- The eligibility rule and the audience projection live in SECURITY DEFINER helpers in the
-- non-exposed `app` schema. The two public RPCs (offers_feed / offer_detail) and the owner RPCs
-- run as their definer and call these helpers themselves, so clients need no EXECUTE on them —
-- and a client able to call `offer_public_json(id)` directly would bypass the eligibility checks
-- the RPCs perform. They are therefore revoked from every client role.
--
-- app.offer_phase stays granted: it is a pure function of its arguments (no table access) that the
-- security_invoker owner views call AS THE CALLER.
revoke execute on function
  app.viewer_offer_audience(uuid),
  app.offer_is_live(uuid),
  app.offer_public_json(uuid),
  app.offer_validate_package(uuid, numeric, timestamptz, timestamptz, jsonb, text[]),
  app.offer_validate_text(text, text, numeric, numeric)
  from public, anon, authenticated;
