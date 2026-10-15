create extension if not exists pgtap;
begin;
select no_plan();
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='business_draft_save'),1,'old save has one unambiguous signature');
select is((select pronargs::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='business_draft_save'),9,'old nine-argument signature preserved');
select is((select pronargs::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='business_draft_save_v2'),13,'new contacts use separately named v2 signature');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='business_draft_submit'),1,'old submit remains unambiguous');
select ok(has_function_privilege('authenticated','public.business_draft_save(uuid,text,text,public.organization_type,text,text,text,text,text)','execute'),'old caller grants preserved');
select ok(not has_function_privilege('anon','public.business_draft_save_v2(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text)','execute'),'anonymous v2 writes denied');
select ok(not has_table_privilege('authenticated','app.business_phone_numbering_plans','select'),'metadata not exposed to client');
select ok(not has_table_privilege('service_role','app.business_phone_numbering_plans','insert'),'service role cannot rewrite numbering rules');

insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('9300000'||n||'-0000-4000-8000-000000000093')::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','compat93-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,2)n;
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at)
select ('9300000'||n||'-0000-4000-8000-000000000093')::uuid,'business','showroom_dealer',now(),now() from generate_series(1,2)n;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"93000001-0000-4000-8000-000000000093","role":"authenticated"}',true);
select lives_ok($$select public.business_draft_save(p_display_name=>'Old client showroom',p_legal_name=>'Old Client LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi')$$,'old deployed named-argument save works without new contact fields');
select lives_ok($$select public.business_draft_submit()$$,'old deployed submit still creates only pending business');
select set_config('test.old_org',public.business_draft_submit()::text,true);
reset role;
select is((select status::text from public.organizations where id=current_setting('test.old_org')::uuid),'pending_verification','old caller does not gain activation');
select ok(not app.showroom_seller_ready(current_setting('test.old_org')::uuid),'incomplete old-client business cannot sell');
select set_config('test.foreign_draft',(select id::text from public.business_creation_drafts where user_id='93000001-0000-4000-8000-000000000093'),true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"93000002-0000-4000-8000-000000000093","role":"authenticated"}',true);
select lives_ok($$select public.business_draft_save_v2(p_display_name=>'New showroom',p_legal_name=>'New Showroom LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345678',p_activity_type=>'decor_showroom')$$,'v2 accepts valid Egyptian contact');
select throws_ok($$select public.business_draft_save_v2(p_contact_phone=>'+201399999999')$$,'22023',null,'direct v2 rejects invalid Egyptian numbering pattern despite valid E164 shape');
select throws_ok($$select public.business_draft_save_v2(p_contact_phone=>'+2001012345678')$$,'22023',null,'direct v2 rejects duplicated/trunk code');
select throws_ok($$select public.business_draft_save_v2(p_contact_phone=>'+999123456789')$$,'22023',null,'direct v2 rejects unsupported calling code');
select throws_ok($$select public.business_draft_save_v2(p_contact_phone=>'01012345678')$$,'22023',null,'direct v2 requires canonical E164');
select throws_ok($$select public.business_draft_save(p_contact_phone=>'+201399999999')$$,'42883',null,'old RPC cannot accept/bypass new contact parameters');
select lives_ok($$select public.business_draft_save_v2(p_display_name=>'US showroom',p_legal_name=>'US Showroom LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+14155552671',p_activity_type=>'decor_showroom')$$,'v2 accepts valid international number with different length');
select set_config('test.new_org',public.business_draft_submit_v2()::text,true);
select throws_ok(format('update public.organizations set contact_phone=%L where id=%L','+201399999999',current_setting('test.new_org')),'42501',null,'authenticated direct organization contact update has no unrestricted grant');
select throws_ok($$select public.business_draft_save_v2(p_draft_id=>current_setting('test.foreign_draft')::uuid)$$,'42501',null,'v2 keeps caller-scoped draft ownership');
reset role;
select is((select contact_phone from public.organizations where id=current_setting('test.new_org')::uuid),'+14155552671','canonical international contact persisted');
select throws_ok(format('update public.organizations set contact_phone=%L where id=%L','+201399999999',current_setting('test.new_org')),'22023',null,'DB-owner direct write also cannot bypass numbering trigger');
select throws_ok($$update public.business_creation_drafts set contact_phone='+201399999999' where user_id='93000002-0000-4000-8000-000000000093'$$,'22023',null,'direct draft write also cannot bypass numbering trigger');
select ok(app.business_contact_phone_valid('+442079460000'),'valid UK fixed line');
select ok(app.business_contact_phone_valid('+919876543210'),'valid India mobile');
select ok(app.business_contact_phone_valid('+971501234567'),'valid UAE mobile');
select ok(not app.business_contact_phone_valid('+80012345678'),'unsupported non-geographic number refused consistently');
select ok(not app.business_contact_phone_valid('+'||repeat('1',10000)),'oversized input rejected before pattern work');
select * from finish();
rollback;
