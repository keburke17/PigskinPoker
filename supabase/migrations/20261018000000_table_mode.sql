-- ============================================================================
--  Table mode. Issue #75, OQ-30 (Kyle, 2026-09-30 - Scott agreed Kyle takes point).
--
--  A second shape of league. A SEASON is what every league has been: the same teams
--  every week, a running standings table, a bracket at the end. A TABLE is one hand at a
--  time: a dealer, up to `table_seats` players, and no obligation to play the next hand.
--  The tally is hands won and lost - no running points, no playoffs.
--
--  The engine does not change shape for it. A hand is a period, dealt, schemed, scored
--  and finalized exactly as a week is. What a table changes is WHO IS IN THE PERIOD, and
--  that is answered by three columns:
--
--    leagues.mode         'season' or 'table', chosen at creation and never changed
--    leagues.table_seats  how many seats the table has, 2..13
--    teams.seat           'seated', 'sitting_out' or 'left' - a table player's standing
--
--  and by `periods.participant_team_ids`, which already exists for the playoffs: when a
--  hand is dealt it records who was seated, and that list - not `teams.seat` - is who
--  plays that hand. That snapshot is the door closing at the deal.
--
--  NOTHING HERE MOVES AN EXISTING LEAGUE. Every league is a season by default, its
--  table_seats is null, and every team is 'seated', which a season never reads.
-- ============================================================================

-- ------------------------------------------------------------- leagues.mode --
-- Chosen once, at creation. There is no route that changes it: switching a league that
-- has already played would change what its history means.
alter table leagues
  add column mode text not null default 'season'
    check (mode in ('season', 'table'));

-- ------------------------------------------------------ leagues.table_seats --
-- 13 is the most the deal can always serve. Each hand needs two Coaches per player and
-- there is one Coach per NFL team: 32 teams make 16 players, and a week with six teams on
-- a bye (OQ-25 stops dealing them) makes 13. A table can never fill to a size the deal
-- would refuse.
alter table leagues
  add column table_seats int
    check (table_seats is null or table_seats between 2 and 13);

alter table leagues
  add constraint leagues_table_seats_match_mode
    check ((mode = 'table') = (table_seats is not null));

comment on column leagues.mode is
  'Issue #75. season: the same teams every week, standings and playoffs. table: one hand at a time, players sit out or leave, a won-lost tally.';
comment on column leagues.table_seats is
  'Issue #75. Seats at a table (2..13); null for a season. Seated and sitting-out players count against it; a player who has left does not.';

-- ---------------------------------------------------------------- teams.seat --
-- On the TEAM because at a table the team is the person: their name, their record. It
-- outlives a Leave on purpose, so a player who comes back gets their own record back.
--
-- Server-owned, like periods.kickoffs: decompose.js deliberately does not carry it, so
-- no ordinary blob write can put a player back in a seat they got up from. Read by
-- every member through the existing read_teams policy; written only by the server.
alter table teams
  add column seat text not null default 'seated'
    check (seat in ('seated', 'sitting_out', 'left'));

comment on column teams.seat is
  'Issue #75. Table mode only (a season never reads it). seated: dealt into the next hand. sitting_out: keeps the seat, not dealt. left: gave the seat up; can rejoin if one is free.';

-- ------------------------------------------------------------ table invites --
-- A table invite is for a SEAT, not a team: whoever redeems it sits down and their team
-- is made for them. So a manager invite may now name no team - which the original check
-- forbade, because until now a manager always joined an existing team.
--
-- The rule moves to the server rather than disappearing, because a check constraint
-- cannot see the league's mode: createInvite only issues a team-less manager invite for
-- a table, and redeemInvite refuses one anywhere else. tests/server.test.js pins both.
alter table invites drop constraint invites_check;
