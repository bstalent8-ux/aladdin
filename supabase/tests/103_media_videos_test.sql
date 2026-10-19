-- Video (ADR-0020): authoring rules, worker state machine and the media Worker's
-- per-request authority. Every revocation case is a SUBSEQUENT request after a
-- state change, with the same viewer, session and ticket expiry that was allowed.
create extension if not exists pgtap;
begin;
select no_plan();

create function pg_temp.edge(vid uuid, viewer uuid, sess uuid, ws uuid, exp timestamptz) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_video(vid, viewer, sess, ws, exp); reset role; return v;
end $$;

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
update public.organizations set status = 'active', is_verified = true where id = '9d000000-dddd-4ddd-8ddd-000000000002';
\set pro '70000009-0000-4000-8000-000000000009'
\set other '70000003-0000-4000-8000-000000000003'
\set hana '70000001-0000-4000-8000-000000000001'
\set sara '70000002-0000-4000-8000-000000000002'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set ws_other '9d000000-dddd-4ddd-8ddd-000000000002'
\set s_pro 'ea000000-0000-4000-8000-000000000001'
\set s_other 'ea000000-0000-4000-8000-000000000002'
\set s_hana 'ea000000-0000-4000-8000-000000000003'
\set s_sara 'ea000000-0000-4000-8000-000000000004'
\set c_pro '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}'
\set c_other '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set c_hana '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set c_sara '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set exp 'now()+interval ''90 seconds'''
\set rev 'ea100000-0000-4000-8000-000000000001'
insert into auth.sessions(id, user_id, created_at, aal) values
 (:'s_pro', :'pro', now(), 'aal1'), (:'s_other', :'other', now(), 'aal1'),
 (:'s_hana', :'hana', now(), 'aal1'), (:'s_sara', :'sara', now(), 'aal1');
select id as profile from public.profiles where user_id = :'pro' \gset

-- ---------------------------------------------------------------- privileges
select ok(not has_table_privilege('authenticated', 'public.media_videos', 'INSERT')
  and not has_table_privilege('authenticated', 'public.media_videos', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.media_videos', 'DELETE'), 'clients never write media_videos directly');
select ok(not has_table_privilege('anon', 'public.media_videos', 'SELECT'), 'anon cannot read media_videos');
select ok(not has_column_privilege('authenticated', 'public.media_videos', 'upload_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.media_videos', 'revision', 'SELECT')
  and not has_column_privilege('authenticated', 'public.media_videos', 'lease_until', 'SELECT'), 'internal columns are not readable by clients');
select ok(not has_function_privilege(r, f, 'EXECUTE'), format('%s cannot call %s', r, f))
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['public.video_upload_attach(uuid,text)', 'public.video_upload_complete(uuid,bigint)',
         'public.video_job_claim(integer)', 'public.video_job_finish(uuid,uuid,numeric,integer,integer,text[],boolean)',
         'public.video_job_fail(uuid,text,boolean)', 'public.video_purge_candidates(integer)', 'public.video_mark_purged(uuid)',
         'public.video_job_expire()', 'public.media_edge_video(uuid,uuid,uuid,uuid,timestamptz)']) f;
select ok(not has_function_privilege('service_role', 'public.media_edge_video(uuid,uuid,uuid,uuid,timestamptz)', 'EXECUTE'),
  'only the Worker role decides delivery');
select ok(not has_function_privilege('anon', 'public.video_upload_begin(text,uuid,text,text,bigint)', 'EXECUTE'), 'anon cannot start uploads');

-- ---------------------------------------------------------------- authoring
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select throws_ok($$select public.video_upload_begin('portfolio', null, 'Tour', 'video/x-msvideo', 1000)$$, '22023', 'unsupported video type', 'unknown types are refused');
select throws_ok($$select public.video_upload_begin('portfolio', null, 'Tour', 'video/mp4', 524288001)$$, '22023', 'video size is outside policy', 'oversized declarations are refused');
select throws_ok($$select public.video_upload_begin('portfolio', null, '   ', 'video/mp4', 1000)$$, '23514', null, 'blank titles are refused');
select public.video_upload_begin('portfolio', null, 'Kitchen tour', 'video/mp4', 4096) as vid \gset
select is((select state::text from public.media_videos where id = :'vid'), 'uploading', 'owner sees the new upload');
select is((public.video_upload_resolve(:'vid'))->>'state', 'uploading', 'owner resolves the upload');
select throws_ok(format('select public.video_set_visibility(%L, true)', :'vid'), '22023', 'an unfinished video cannot be published', 'unfinished videos cannot be published');
select public.video_upload_begin('portfolio', null, 'Second', 'video/webm', 2048) as vid2 \gset
select public.video_upload_begin('portfolio', null, 'Third', 'video/quicktime', 2048) as vid3 \gset
select throws_ok($$select public.video_upload_begin('portfolio', null, 'Fourth', 'video/mp4', 2048)$$, '23514', 'too many unfinished uploads', 'at most three unfinished uploads');
select is(public.video_delete(:'vid3'), null::text, 'an unattached upload deletes cleanly');
set local request.jwt.claims = :'c_other';
select throws_ok(format('select public.video_upload_resolve(%L)', :'vid'), '42501', 'video not found', 'another user cannot resolve the upload');
select throws_ok(format('select public.video_delete(%L)', :'vid'), '42501', 'video not found', 'another user cannot delete it');
select is((select count(*)::int from public.media_videos where id = :'vid'), 0, 'another user cannot see it');
select throws_ok(format('select public.video_upload_complete(%L, 4096)', :'vid'), '42501', null, 'clients cannot complete uploads themselves');
reset role;

-- ---------------------------------------------------------------- server and worker
set local role service_role;
select lives_ok(format('select public.video_upload_attach(%L, %L)', :'vid', 'mp-upload-1'), 'server attaches the multipart id');
select throws_ok(format('select public.video_upload_attach(%L, %L)', :'vid', 'mp-upload-2'), 'P0002', null, 'the multipart id is attached once');
select throws_ok(format('select public.video_upload_complete(%L, 4095)', :'vid'), '22023', null, 'a stored size different from the declaration is refused');
select lives_ok(format('select public.video_upload_complete(%L, 4096)', :'vid'), 'verified upload moves to processing');
select is((select upload_id from public.media_videos where id = :'vid'), null, 'the multipart id is cleared');
select is((select id from public.video_job_claim(600)), :'vid'::uuid, 'a worker claims the job');
select is((select count(*)::int from public.video_job_claim(600)), 0, 'a leased job is not claimed twice');
select lives_ok(format('select public.video_job_fail(%L, %L, true)', :'vid', 'transcode_failed'), 'a retryable failure returns the job');
select is((select attempts from public.video_job_claim(600)), 2::smallint, 'the retry is claimed again with the attempt counted');
select lives_ok(format($$select public.video_job_finish(%L, %L, 12.5, 1280, 720, array['360p','720p'], true)$$, :'vid', :'rev'), 'worker finishes the job');
select is((select state::text from public.media_videos where id = :'vid'), 'ready', 'video is ready');
reset role;

-- ---------------------------------------------------------------- edge: private portfolio video
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'a private video is not anonymous');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp)->>'prefix', 'video/' || :'vid' || '/' || :'rev' || '/', 'owner plays a private video');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp)->'renditions', '["360p", "720p"]'::jsonb, 'grant names the renditions');
select is(pg_temp.edge(:'vid', :'other', :'s_other', null, :exp), null::jsonb, 'another user cannot play it');
select is(pg_temp.edge(:'vid', :'pro', :'s_other', null, :exp), null::jsonb, 'a borrowed session is refused');
select ok(pg_temp.edge(:'vid', :'pro', :'s_pro', null, now() + interval '4 hours') is not null, 'a four-hour play ticket is accepted');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, now() + interval '5 hours'), null::jsonb, 'a longer ticket is refused');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, now() - interval '1 minute'), null::jsonb, 'an expired ticket is refused');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, null), null::jsonb, 'a ticket without expiry is refused');

-- ---------------------------------------------------------------- edge: publication and revocation
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select lives_ok(format('select public.video_set_visibility(%L, true)', :'vid'), 'owner publishes');
reset role;
select is(pg_temp.edge(:'vid', null, null, null, null)->>'public', 'true', 'a published video of a listed profile is anonymous');
select is(pg_temp.edge(:'vid', :'other', :'s_other', null, :exp)->>'public', 'true', 'signed-in viewers see it too');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.public_portfolio_videos(:'profile'::uuid)), 1, 'the public profile lists it');
select throws_ok(format('select public.media_edge_video(%L, null, null, null, null)', :'vid'), '42501', null, 'anon cannot call the Worker function');
reset role;
update public.profiles set public_profile_status = 'hidden' where user_id = :'pro';
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'delisting withdraws it on the next request');
select ok(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp) is not null, 'the owner still plays it');
update public.profiles set public_profile_status = 'listed' where user_id = :'pro';
update public.users set status = 'suspended' where id = :'pro';
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'suspension withdraws it');
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp), null::jsonb, 'a suspended owner cannot play it');
update public.users set status = 'active' where id = :'pro';
delete from auth.sessions where id = :'s_pro';
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp), null::jsonb, 'a signed-out session ticket is refused, even for a public video');
select ok(pg_temp.edge(:'vid', null, null, null, null) is not null, 'the anonymous public URL still plays');
insert into auth.sessions(id, user_id, created_at, aal) values (:'s_pro', :'pro', now(), 'aal1');
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select lives_ok(format('select public.video_set_visibility(%L, false)', :'vid'), 'owner unpublishes');
reset role;
select is(pg_temp.edge(:'vid', null, null, null, null), null::jsonb, 'unpublish withdraws it on the next request');
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select is(public.video_delete(:'vid'), null::text, 'owner deletes');
reset role;
select is(pg_temp.edge(:'vid', :'pro', :'s_pro', null, :exp), null::jsonb, 'delete denies the owner on the next request');
set local role service_role;
select ok(exists(select 1 from public.video_purge_candidates(50) where id = :'vid'), 'the deleted video is queued for purge');
select lives_ok(format('select public.video_mark_purged(%L)', :'vid'), 'purge is recorded');
select ok(not exists(select 1 from public.video_purge_candidates(50) where id = :'vid'), 'a purged video is not queued again');
reset role;

-- ---------------------------------------------------------------- product videos
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select public.own_product_create(:'org', 'Video product', 'VID-103', 'paints', 'pail', p_base_price => 100) as product \gset
select public.video_upload_begin('product', :'product', 'Application demo', 'video/mp4', 8192) as pvid \gset
set local request.jwt.claims = :'c_sara';
select throws_ok(format($$select public.video_upload_begin('product', %L, 'x', 'video/mp4', 10)$$, :'product'), '42501', 'catalog.write required', 'a member without catalog.write cannot add product video');
set local request.jwt.claims = :'c_other';
select throws_ok(format($$select public.video_upload_begin('product', %L, 'x', 'video/mp4', 10)$$, :'product'), '42501', 'catalog.write required', 'a foreign writer cannot add product video');
select throws_ok(format('select public.video_set_visibility(%L, true)', :'pvid'), '42501', 'video not found', 'a foreign writer cannot touch it');
reset role;
set local role service_role;
select public.video_upload_attach(:'pvid', 'mp-upload-3');
select public.video_upload_complete(:'pvid', 8192);
select id from public.video_job_claim(600);
select public.video_job_finish(:'pvid', :'rev', 30, 1920, 1080, array['360p','720p','1080p'], true);
reset role;
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select throws_ok(format('select public.video_set_visibility(%L, true)', :'pvid'), '22023', 'product videos follow the product audience', 'product videos are never made public directly');
reset role;
select is(pg_temp.edge(:'pvid', null, null, null, null), null::jsonb, 'product video is never anonymous');
select ok(pg_temp.edge(:'pvid', :'sara', :'s_sara', null, :exp) is not null, 'a publisher member plays the draft product video');
select is(pg_temp.edge(:'pvid', :'other', :'s_other', :'ws_other', :exp), null::jsonb, 'a draft product video is private to its publisher');
set local role authenticated;
set local request.jwt.claims = :'c_hana';
select public.product_audiences_set(:'product', array['manufacturer']);
select public.set_product_published(:'product', true, (select version from public.products where id = :'product'));
reset role;
select ok(pg_temp.edge(:'pvid', :'other', :'s_other', :'ws_other', :exp) is not null, 'the targeted audience plays the published product video');
select is(pg_temp.edge(:'pvid', :'other', :'s_other', null, :exp), null::jsonb, 'a personal context cannot borrow the workspace audience');
select is(pg_temp.edge(:'pvid', :'other', :'s_other', :'org', :exp), null::jsonb, 'a forged foreign workspace is refused');
set local role authenticated;
set local request.jwt.claims = :'c_other';
select is((select count(*)::int from public.product_videos(:'product'::uuid, :'ws_other'::uuid)), 1, 'the audience lists the product video');
select is((select count(*)::int from public.product_videos(:'product'::uuid, null)), 0, 'not without the workspace');
set local request.jwt.claims = :'c_hana';
select public.set_product_published(:'product', false, (select version from public.products where id = :'product'));
reset role;
select is(pg_temp.edge(:'pvid', :'other', :'s_other', :'ws_other', :exp), null::jsonb, 'unpublishing the product withdraws its video on the next request');

-- ---------------------------------------------------------------- stale uploads and worker limits
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select public.video_upload_begin('portfolio', null, 'Stale', 'video/mp4', 100) as stale \gset
reset role;
update public.media_videos set created_at = now() - interval '25 hours' where id = :'stale';
set local role service_role;
select throws_ok(format('select public.video_upload_complete(%L, 100)', :'stale'), '22023', null, 'an upload older than a day cannot complete');
select ok(exists(select 1 from public.video_purge_candidates(50) where id = :'stale'), 'stale uploads are expired and queued for purge');
select is((select failure_code from public.media_videos where id = :'stale'), 'expired', 'and say why');
reset role;

select * from finish();
rollback;
