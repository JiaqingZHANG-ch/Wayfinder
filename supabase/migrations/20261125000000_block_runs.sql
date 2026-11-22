-- 做事记录（和本机 SQLite 的 block_runs 一一对应）
create table public.block_runs (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  block_id text not null,
  started_at timestamptz not null,
  pauses jsonb not null,
  done_at timestamptz,
  planned_start text not null,
  planned_end text not null,
  primary key (user_id, day, block_id)
);

alter table public.block_runs enable row level security;
create policy "只能看和改自己" on public.block_runs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
