-- 隔离测试：两个测试账号互相看不到、改不了对方的数据。运行：supabase test db（要先 supabase start）。
-- user_quotes 那条在第 7 周循环 ③ 写好规则之前是红的。
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- 以管理员身份（不受 RLS 管）给 A、B 各放一份数据
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.local');

do $$
declare
  u uuid;
  m bigint;
  p bigint;
begin
  foreach u in array array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002']::uuid[] loop
    insert into public.users (id) values (u);
    insert into public.consents (user_id, kind, version) values (u, '隐私', '隐私说明-v1');
    insert into public.settings (user_id, plan_input) values (u, '{"wake": "07:00"}');
    insert into public.day_plans (user_id, day, version, plan) values (u, '2026-11-20', 1, '{"blocks": []}');
    insert into public.day_logs (user_id, day, items, blocker, note, tomorrow_task)
      values (u, '2026-11-20', '{}', '', '今天读得很顺', '');
    insert into public.messages (user_id, day, mode, role, content)
      values (u, '2026-11-20', '对账', 'user', '今天读得很顺') returning id into m;
    insert into public.user_quotes (user_id, message_id, text, used_in, day) values (u, m, '读得很顺', '对账', '2026-11-20');
    insert into public.profiles (user_id, level, content, source, confirmed_at)
      values (u, '方向', '想做能帮人理清方向的产品', '建档', now()) returning id into p;
    insert into public.weekly_reviews (user_id, week_end, stats, summary, adjustments, question, still_right)
      values (u, '2026-11-20', '{}', '这 7 天记录了 7 天。', '[]', '下周哪天最容易被打乱？', p);
    insert into public.model_calls (user_id, model, request, reply, ms) values (u, 'fake', '{}', '{}', 1);
    insert into public.crisis_events (user_id, day, text) values (u, '2026-11-20', '（测试）');
    insert into public.deep_talks (user_id, round, step, answers) values (u, 1, 1, '{"scores": {}}');
    insert into public.letters (user_id, written_on, due, days, text, created_at)
      values (u, '2026-11-20', '2026-12-20', 30, '给自己', '2026-11-20T21:00:00+00:00');
  end loop;
end $$;

-- 变成 A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}', true);

select is((select array_agg(id::text) from public.users), array['aaaaaaaa-0000-0000-0000-000000000001'], 'A 只看到自己的 users');
select is((select count(*)::int from public.consents), 1, 'A 只看到自己的 consents');
select is((select count(*)::int from public.settings), 1, 'A 只看到自己的 settings');
select is((select count(*)::int from public.day_plans), 1, 'A 只看到自己的 day_plans');
select is((select count(*)::int from public.day_logs), 1, 'A 只看到自己的 day_logs');
select is((select count(*)::int from public.messages), 1, 'A 只看到自己的 messages');
select is((select count(*)::int from public.user_quotes), 1, 'A 只看到自己的 user_quotes（循环 ③）');
select is((select count(*)::int from public.profiles), 1, 'A 只看到自己的 profiles');
select is((select count(*)::int from public.weekly_reviews), 1, 'A 只看到自己的 weekly_reviews');
select is((select count(*)::int from public.model_calls), 1, 'A 只看到自己的 model_calls');
select is((select count(*)::int from public.crisis_events), 1, 'A 只看到自己的 crisis_events');
select is((select count(*)::int from public.deep_talks), 1, 'A 只看到自己的 deep_talks');
select is((select count(*)::int from public.letters), 1, 'A 只看到自己的 letters');

select throws_ok(
  $$insert into public.profiles (user_id, level, content, source)
    values ('bbbbbbbb-0000-0000-0000-000000000002', '方向', '替 B 写的', '建档')$$,
  '42501', null, 'A 不能替 B 写档案');
select is(
  (with changed as (update public.day_logs set note = '改了' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
   select count(*)::int from changed),
  0, 'A 改不到 B 的对账');
select is(
  (with gone as (delete from public.messages where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
   select count(*)::int from gone),
  0, 'A 删不到 B 的消息');

-- 没登录的人什么都看不到
reset role;
set local role anon;
select is((select count(*)::int from public.day_logs), 0, '没登录看不到对账');
select is((select count(*)::int from public.user_quotes), 0, '没登录看不到原话');

select * from finish();
rollback;
