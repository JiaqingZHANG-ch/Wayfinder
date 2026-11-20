-- Wayfinder 第 7 周：把 SQLite（src/server/db.py 的 SCHEMA）搬到 Supabase 的 Postgres。
-- 和 SQLite 的区别：user_id 是 Supabase 登录账号的 uuid（auth.users.id）；JSON 列用 jsonb；
-- 时间用 timestamptz，日期用 date；自增 id 用 identity。
-- 还没在真的 Postgres 上跑过（要先装 Docker、supabase start）。

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  lang text not null default 'zh',
  timezone text not null default 'Europe/Paris',
  country text not null default '',
  is_adult boolean,
  created_at timestamptz not null default now()
);

create table public.consents (
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  version text not null,
  at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table public.settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  plan_input jsonb not null
);

create table public.day_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  version int not null,
  plan jsonb not null,
  energy_level int,
  confirmed_at timestamptz,
  in_calendar boolean not null default false,
  unique (user_id, day, version)
);

create table public.day_logs (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  energy_after_class int,
  items jsonb not null,
  blocker text not null,
  note text not null,
  tomorrow_task text not null,
  yesterday_done boolean,
  primary key (user_id, day)
);

create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  mode text not null,
  role text not null,
  content text not null,
  unique (id, user_id)  -- 给 user_quotes 的组合外键用
);
create index on public.messages (user_id);

-- 原话只能挂在同一个人的消息上：外键带上 user_id
create table public.user_quotes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  message_id bigint not null,
  text text not null,
  used_in text not null check (used_in in ('档案', '对账', '复盘', '回信')),
  day date not null,
  foreign key (message_id, user_id) references public.messages (id, user_id) on delete cascade
);
create index on public.user_quotes (user_id);

-- 档案：confirmed_at 为空 = 模型提的、用户还没确认，不能当事实用
create table public.profiles (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  level text not null check (level in ('使命', '目标', '障碍', '策略', '方向', '近期观察')),
  content text not null,
  confirmed_at timestamptz,
  source text not null check (source in ('建档', '复盘', '深度长谈')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index on public.profiles (user_id);

create table public.weekly_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  week_end date not null,
  stats jsonb not null,
  summary text not null,
  adjustments jsonb not null,
  question text not null,
  still_right bigint,
  created_at timestamptz not null default now(),
  unique (user_id, week_end),
  foreign key (still_right, user_id) references public.profiles (id, user_id) on delete set null (still_right)
);

create table public.model_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text not null,
  request jsonb not null,
  reply text,
  error text,
  ms int not null
);
create index on public.model_calls (user_id);

create table public.crisis_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  text text not null,
  resumed boolean not null default false
);
create index on public.crisis_events (user_id);

-- 行级安全（RLS）：每张表都打开。打开了却没有规则 = 谁都看不到（anon 也一样）。
alter table public.users enable row level security;
alter table public.consents enable row level security;
alter table public.settings enable row level security;
alter table public.day_plans enable row level security;
alter table public.day_logs enable row level security;
alter table public.messages enable row level security;
alter table public.user_quotes enable row level security;
alter table public.profiles enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.model_calls enable row level security;
alter table public.crisis_events enable row level security;

-- 「只能看和改自己的」。(select auth.uid()) 套一层 select，Postgres 每条查询只算一次，不是每行算一次。
create policy "只能看和改自己" on public.users for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "只能看和改自己" on public.consents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.day_plans for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.day_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.weekly_reviews for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.model_calls for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.crisis_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 第 7 周循环 ③：家庆在这里写 user_quotes 的「只能看自己」规则（照上面的样子），
-- 然后 supabase test db，supabase/tests/database/isolation.test.sql 里 user_quotes 那条变绿；故意写错，看它变红。
