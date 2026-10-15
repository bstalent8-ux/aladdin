-- rc2: integrate Showroom V2 with the deployed Auth PR #84 (84a747d8) WITHOUT weakening either side.
--
-- 1. CATALOG / SELLER READINESS (P0, Finding A). PR #84 (20261014160000) gates published-product visibility on
--    app.showroom_listing_visible(org, product) through the `products_select_published` row policy. Showroom V2 replaces direct
--    reads with security-definer catalog functions and DROPS that policy (prices are private), so those functions must enforce the
--    same rule themselves. Every non-owner path below now requires showroom_listing_visible (true for every non-showroom
--    organization and for independent publishers, which have no organization). The OWNER's own view of its own draft or pending
--    products is unchanged (a showroom may prepare products before approval, but nobody else can see or buy them).
-- 2. REGISTRATION. The live app calls business_draft_save_v2 / business_draft_submit_v2 (PR #84: contact phone, activity, detailed
--    address). They get Showroom's application model on top: per-user advisory lock, contractor_company guard, one-open-application
--    slot rule, and the 250-character description stored on the organization.
--
-- Every rewrite is applied to the LIVE definition and refuses to run unless the text to replace occurs exactly once, so a body that
-- drifted can never be half-patched silently (same technique as main's 20260929100001 re-tier).

create function pg_temp.patch(p_fn regprocedure, p_pattern text, p_replacement text, p_expect int default 1)
returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  select count(*) into v_n from regexp_matches(v_def, p_pattern, 'g');
  if v_n <> p_expect then
    raise exception 'patch %: expected % match(es) of %, found %', p_fn, p_expect, p_pattern, v_n;
  end if;
  execute regexp_replace(v_def, p_pattern, p_replacement, 'g');
end $$;

-- 1a. public (anonymous-capable) image / product predicate
select pg_temp.patch('app.product_is_public(uuid)'::regprocedure,
  'and app\.publisher_gate_open\(p\.publisher_id\)\)',
  'and app.publisher_gate_open(p.publisher_id) and (p.organization_id is null or app.showroom_listing_visible(p.organization_id, p.id)))');

-- 1b. buyer-visibility predicate: the audience branch (everyone except the owner / owning publisher)
select pg_temp.patch('app.product_visible_to(uuid,uuid,text)'::regprocedure,
  'or \(p_audience is not null\s+and \(\(pb\.kind',
  'or (p_audience is not null and (p.organization_id is null or app.showroom_listing_visible(p.organization_id, p.id)) and ((pb.kind');

-- 1c. the catalog listing
select pg_temp.patch('public.catalog_products(uuid)'::regprocedure,
  'or \(\(pb\.kind = ''organization'' or app\.publisher_gate_open\(pb\.id\)\)\s+and exists',
  'or ((pb.kind = ''organization'' or app.publisher_gate_open(pb.id)) and (p.organization_id is null or app.showroom_listing_visible(p.organization_id, p.id)) and exists');

-- 1d. offers (not in the first release UI, but a direct API call must not get past readiness either)
select pg_temp.patch('app.offer_is_live(uuid)'::regprocedure,
  '\(pb\.kind = ''organization'' and org\.status = ''active''::public\.org_status\)',
  '(pb.kind = ''organization'' and org.status = ''active''::public.org_status and app.showroom_seller_ready(org.id))');

-- 2a. business_draft_save_v2
select pg_temp.patch('public.business_draft_save_v2(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text)'::regprocedure,
  'v_address text := nullif\(btrim\(p_detailed_address\), ''''\);\s+begin',
  E'v_address text := nullif(btrim(p_detailed_address), '''');\n  v_slot text;\nbegin\n  perform pg_advisory_xact_lock(hashtextextended(''org-application:'' || v_uid::text, 0));\n  if p_org_type = ''contractor_company'' and not app.may_hold_contractor_company(v_uid) then\n    raise exception ''this organization type cannot be self-assigned'' using errcode = ''42501'';\n  end if;');
select pg_temp.patch('public.business_draft_save_v2(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text)'::regprocedure,
  'raise exception ''adding a business is not available for this account'' using errcode = ''42501'';\s+end if;\s+end if;',
  E'raise exception ''adding a business is not available for this account'' using errcode = ''42501'';\n    end if;\n    v_slot := app.application_slot(v_uid);\n    if v_slot not in (''first_available'', ''additional_available'') then\n      raise exception ''an organization application is not available right now'' using errcode = ''42501'', hint = v_slot;\n    end if;\n  end if;');
select pg_temp.patch('public.business_draft_save_v2(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text)'::regprocedure,
  'nullif\(left\(btrim\(coalesce\(p_description, ''''\)\), 1000\), ''''\)',
  'app.description_text(p_description)', 2);

-- 2b. business_draft_submit_v2
select pg_temp.patch('public.business_draft_submit_v2(uuid)'::regprocedure,
  'v_custom text;\s+begin',
  E'v_custom text;\n  v_slot   text;\nbegin\n  perform pg_advisory_xact_lock(hashtextextended(''org-application:'' || v_uid::text, 0));');
select pg_temp.patch('public.business_draft_submit_v2(uuid)'::regprocedure,
  'raise exception ''adding a business is not available for this account'' using errcode = ''42501'';\s+end if;',
  E'raise exception ''adding a business is not available for this account'' using errcode = ''42501'';\n  end if;\n  v_slot := app.application_slot(v_uid);\n  if v_slot not in (''first_available'', ''additional_available'') then\n    raise exception ''an organization application is not available right now'' using errcode = ''42501'', hint = v_slot;\n  end if;');
select pg_temp.patch('public.business_draft_submit_v2(uuid)'::regprocedure,
  '  update public\.organizations set contact_phone=v_d\.contact_phone',
  E'  update public.organizations set description = app.description_text(v_d.description) where id = v_org_id;\n  update public.organizations set contact_phone=v_d.contact_phone');

-- 1e. publishing: an organization that is not seller-ready is refused with 42501 FIRST (before the audience check), so the answer
--     does not depend on trigger ordering. The auth trigger showroom_product_publish_complete remains as the second layer.
select pg_temp.patch('public.set_product_published(uuid,boolean,integer)'::regprocedure,
  'if p_published and not exists \(select 1 from public\.product_audiences',
  E'if p_published and v_p.organization_id is not null and not app.showroom_seller_ready(v_p.organization_id) then
    raise exception ''showroom must be active, approved and complete before product publishing'' using errcode = ''42501'';
  end if;
  if p_published and not exists (select 1 from public.product_audiences');
