-- Retiring a player from the pool is not the same as marking him OUT for a week.
--
-- Scott, 2026-09-04, after the first live refresh: "the players that it took out of the
-- game for misspellings or whatever reason, it has them listed as OUT. so now for example
-- i have a James Cook III listed as active from a roster refresh, but James Cook listed
-- as out... the league managers playing should not be able to see those players listed
-- as out."
--
-- He is right, and the two things had been conflated. OUT / IR / BYE are FOOTBALL
-- statements about a player who is in this league's pool - a manager needs to see them,
-- and the Free Agents screen gives each its own tab. A player the refresh retired is a
-- different thing entirely: he is not in the pool any more, and showing him under OUT
-- puts "James Cook" in front of every manager while "James Cook III" is starting for
-- somebody. That reads as a duplicate, or as a bug.
--
-- WHY A COLUMN AND NOT A DELETE. Deleting would break the rosters, stat lines and
-- weekly results that already reference him - `legacyOf` in src/storage/hydrate.js
-- resolves a missing player to null, which would silently blank a starter slot in a week
-- that has already been played.
--
-- WHY A COLUMN AND NOT status = 'OUT' + status_source = 'feed'. That pair identifies
-- exactly these rows today, so it is what the backfill below matches on - but it is not
-- safe to KEEP deriving it from. The moment the commissioner touches a retired player's
-- status dropdown, src/storage/decompose.js records the change as `status_source =
-- 'manual'`, and the player would silently reappear in front of every manager.
--
-- Forward-only. Adds one defaulted column and backfills it. No row is deleted, and no
-- player's `status` is changed.

alter table players
  -- True when the pool refresh dropped this player: he stopped being one of his team's
  -- listed starters, or he was a misspelling that the feed replaced with the real man.
  -- Retired players are the COMMISSIONER'S to see and nobody else's. They stay in the
  -- table so the weeks they already played still resolve, they are never dealt (their
  -- status is not 'Active'), and the Free Agents screen filters them out entirely.
  add column if not exists retired boolean not null default false;

comment on column players.retired is
  'Dropped from the pool by a refresh - hidden from managers, visible to the commissioner. '
  'Distinct from status OUT/IR/BYE, which are football statements about a player who is '
  'still in the pool. Never set by hand; a refresh that claims the player again clears it.';

-- Backfill: exactly the rows an earlier refresh retired.
--
-- `status_source = 'feed'` is what makes this safe. 20260828010000 set status_source to
-- 'manual' for every non-Active status that existed before the feed did, so a commissioner
-- who had marked somebody OUT himself is not swept up here. 'manual' SOURCE rows - players
-- he added - are excluded too, though no refresh would have retired one.
update players
   set retired = true
 where status = 'OUT'
   and status_source = 'feed'
   and source <> 'manual';

-- Coaches caught by that backfill are deliberately left retired. No FUTURE refresh can
-- retire one - the feed does not touch a Coach row at all now (OQ-4d) - but the single
-- refresh that ran while coaches were still the feed's left four of them replaced:
-- "Klint Kubiak" retired beside an active "Klint Kubliak", and the same for Buffalo,
-- Atlanta and Arizona. Those are duplicates of exactly the kind this migration exists to
-- hide, so they stay out of the managers' sight. The commissioner sees them in his own
-- Retired list and can restore, rename or delete any of them.

-- No new table, so scripts/verify-grants.mjs has nothing further to check. The column
-- inherits the existing players policies and grants unchanged.
