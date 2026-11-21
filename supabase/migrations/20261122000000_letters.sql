-- 回信：写给将来的自己（和本机 SQLite 的 letters 一一对应）
create table public.letters (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  written_on date not null,
  due date not null,
  days int not null,
  text text not null,
  prototype text,
  habit_id text,
  created_at text not null
);
create index on public.letters (user_id);

alter table public.letters enable row level security;
create policy "只能看和改自己" on public.letters for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
