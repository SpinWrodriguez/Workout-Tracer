-- Run once in the Supabase SQL editor, in the same project the nutrition app
-- uses. Mirrors `nutrition_data`: one JSONB row per user, readable and
-- writable only by that user.

create table if not exists public.workout_data (
  id         uuid primary key references auth.users on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workout_data enable row level security;

-- Each policy is scoped to the caller's own row. Without these RLS denies
-- everything, which is the safe default but not a working app.
drop policy if exists "workout_data own row select" on public.workout_data;
create policy "workout_data own row select" on public.workout_data
  for select using (auth.uid() = id);

drop policy if exists "workout_data own row insert" on public.workout_data;
create policy "workout_data own row insert" on public.workout_data
  for insert with check (auth.uid() = id);

drop policy if exists "workout_data own row update" on public.workout_data;
create policy "workout_data own row update" on public.workout_data
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- The app compares this against what it last pushed to decide whether the
-- cloud copy is ahead, so it has to move on every write rather than only on
-- insert.
create or replace function public.touch_workout_data()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workout_data_touch on public.workout_data;
create trigger workout_data_touch
  before update on public.workout_data
  for each row execute function public.touch_workout_data();
