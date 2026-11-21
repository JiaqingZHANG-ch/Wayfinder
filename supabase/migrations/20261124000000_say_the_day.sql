-- 说一句话排今天（和本机 SQLite 的 day_items、duration_memory 一一对应）
create table public.day_items (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  items jsonb not null,
  primary key (user_id, day)
);
create table public.duration_memory (
  user_id uuid not null references public.users (id) on delete cascade,
  key text not null,
  minutes int not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.day_items enable row level security;
alter table public.duration_memory enable row level security;
create policy "只能看和改自己" on public.day_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "只能看和改自己" on public.duration_memory for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
