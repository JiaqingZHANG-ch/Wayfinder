-- 季度回顾（和本机 SQLite 的 quarterly_reviews 一一对应）；档案来源多了「季度回顾」
create table public.quarterly_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  scores jsonb not null,
  focus text not null,
  start text not null,
  stop text not null,
  keep text not null,
  goals jsonb not null,
  council jsonb,
  council_status text,
  created_at timestamptz not null default now()
);
create index on public.quarterly_reviews (user_id);

alter table public.quarterly_reviews enable row level security;
create policy "只能看和改自己" on public.quarterly_reviews for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.profiles drop constraint profiles_source_check;
alter table public.profiles add constraint profiles_source_check
  check (source in ('建档', '复盘', '深度长谈', '季度回顾'));
