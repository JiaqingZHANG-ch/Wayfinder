-- 深度长谈：一轮 4 步，一步一行（和本机 SQLite 的 deep_talks 一一对应）
create table public.deep_talks (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  round int not null,
  step int not null,
  answers jsonb not null default '{}',
  council jsonb,
  council_status text,
  snoozes int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  unique (user_id, round, step)
);
create index on public.deep_talks (user_id);

alter table public.deep_talks enable row level security;
create policy "只能看和改自己" on public.deep_talks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
