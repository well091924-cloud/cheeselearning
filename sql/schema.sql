-- Execute once in Supabase SQL Editor. Supabase Auth controls user identities.
create extension if not exists pgcrypto;
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 250),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal integer not null check(ordinal >= 0),
  question text not null,
  answer text not null,
  extra text not null default '',
  unique(course_id,ordinal)
);
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress' check(status in ('in_progress','completed')),
  revision bigint not null default 0,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.word_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal integer not null check(ordinal >= 0),
  first_try boolean not null,
  error_count integer not null check(error_count >= 0),
  correction_count integer not null check(correction_count >= 0),
  response_time numeric(12,2) not null check(response_time >= 0),
  score integer not null check(score in (0,40,60,80,100)),
  level text not null check(level in ('A','B','C','D')),
  completed_at timestamptz,
  unique(session_id,ordinal)
);
create index if not exists idx_courses_owner on public.courses(user_id);
create index if not exists idx_words_course on public.words(course_id,ordinal);
create index if not exists idx_sessions_course on public.sessions(course_id,created_at desc);
create index if not exists idx_results_session on public.word_results(session_id);

alter table public.courses enable row level security;
alter table public.words enable row level security;
alter table public.sessions enable row level security;
alter table public.word_results enable row level security;
-- Restrict both owners AND parent relationships, including writes.
drop policy if exists courses_owner on public.courses;
create policy courses_owner on public.courses for all to authenticated
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists words_owner on public.words;
create policy words_owner on public.words for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.courses c where c.id=course_id and c.user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.courses c where c.id=course_id and c.user_id=(select auth.uid())));
drop policy if exists sessions_owner on public.sessions;
create policy sessions_owner on public.sessions for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.courses c where c.id=course_id and c.user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.courses c where c.id=course_id and c.user_id=(select auth.uid())));
drop policy if exists results_owner on public.word_results;
create policy results_owner on public.word_results for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=(select auth.uid())));

-- Atomic session revision CAS: two devices cannot silently overwrite the same snapshot.
create or replace function public.save_cheese_session(
  p_session_id uuid, p_revision bigint, p_state jsonb, p_status text, p_results jsonb
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_revision bigint; v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('completed','in_progress') then raise exception 'Invalid status'; end if;
  update public.sessions set state=p_state, status=p_status, revision=revision+1, updated_at=now()
  where id=p_session_id and user_id=auth.uid() and revision=p_revision
  returning revision into v_revision;
  if v_revision is null then raise exception 'STALE_SESSION: Reload this session to prevent overwriting concurrent edits'; end if;
  for v_row in select value from jsonb_array_elements(p_results) loop
    insert into public.word_results(session_id,user_id,ordinal,first_try,error_count,correction_count,response_time,score,level,completed_at)
    values(p_session_id,auth.uid(),(v_row->>'ordinal')::integer,(v_row->>'first_try')::boolean,
      (v_row->>'error_count')::integer,(v_row->>'correction_count')::integer,
      (v_row->>'response_time')::numeric,(v_row->>'score')::integer,v_row->>'level',
      nullif(v_row->>'completed_at','')::timestamptz)
    on conflict(session_id,ordinal) do update set
      first_try=excluded.first_try,error_count=excluded.error_count,
      correction_count=excluded.correction_count,response_time=excluded.response_time,
      score=excluded.score,level=excluded.level,completed_at=excluded.completed_at;
  end loop;
  return v_revision;
end $$;
revoke all on function public.save_cheese_session(uuid,bigint,jsonb,text,jsonb) from public;
grant execute on function public.save_cheese_session(uuid,bigint,jsonb,text,jsonb) to authenticated;
