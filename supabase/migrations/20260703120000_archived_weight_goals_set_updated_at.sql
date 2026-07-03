-- Attach the server-authoritative updated_at trigger to
-- kilo.archived_weight_goals (issue #421).
--
-- The server_authoritative_updated_at migration (20260622120000) applied
-- kilo.set_updated_at() to every kilo app table that carries updated_at, but
-- it predates archived_weight_goals (20260625120000, issue #372), and that
-- table's migration never attached the trigger. Until now a client could
-- write arbitrary updated_at values on archived goals. This closes the gap
-- so all eight kilo app tables share the same invariant: the server owns
-- the updated_at clock.

drop trigger if exists set_updated_at on kilo.archived_weight_goals;
create trigger set_updated_at
  before insert or update on kilo.archived_weight_goals
  for each row execute function kilo.set_updated_at();
