-- Archived weight goals table (issue #372).
--
-- When a user meets their active weight goal and archives it, the completed
-- goal is preserved here for history. The active kilo.weight_goal singleton
-- is cleared so analytics stay focused on the current active goal only.
--
-- Each row records the goal as it was set (target_weight, target_date,
-- start_weight, start_date), the weight at archive time (completed_weight),
-- and when it was archived (archived_at).
--
-- goal_json carries any extra local fields not promoted to named columns,
-- following the same pattern as kilo.weight_goal.
--
-- RLS and grants follow the same pattern as every other kilo app table:
-- owner-scoped policies using auth.uid(), explicit grants to authenticated
-- and service_role, no grants to anon.

-- ---------------------------------------------------------------------------
-- archived_weight_goals: one row per completed/archived goal, keyed (user_id, id)
-- ---------------------------------------------------------------------------
create table if not exists kilo.archived_weight_goals (
  user_id        uuid not null references auth.users (id) on delete cascade,
  id             text not null,
  target_weight  numeric,
  target_date    date,
  start_weight   numeric,
  start_date     date,
  completed_weight numeric,
  archived_at    timestamptz,
  goal_json      jsonb,
  saved_at       timestamptz,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  primary key (user_id, id)
);

create index if not exists archived_weight_goals_user_archived_at_idx
  on kilo.archived_weight_goals (user_id, archived_at desc);

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table kilo.archived_weight_goals enable row level security;

-- ---------------------------------------------------------------------------
-- Owner-scoped policies
-- ---------------------------------------------------------------------------
create policy "archived_weight_goals_select_own" on kilo.archived_weight_goals
  for select to authenticated using (user_id = (select auth.uid()));
create policy "archived_weight_goals_insert_own" on kilo.archived_weight_goals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "archived_weight_goals_update_own" on kilo.archived_weight_goals
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "archived_weight_goals_delete_own" on kilo.archived_weight_goals
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on kilo.archived_weight_goals to authenticated;
grant all on kilo.archived_weight_goals to service_role;
