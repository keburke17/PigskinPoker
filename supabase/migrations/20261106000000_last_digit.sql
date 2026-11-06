-- ============================================================================
--  Last Digit. OQ-37 (Scott, 2026-11-05).
--
--  A third game on the site, and NOT poker. Each player holds one NFL team for the
--  whole season and scores the last digit of that team's real final score every week.
--  A bye keeps the week before's points; most points after Week 18 wins; level on points
--  goes to most 9s, then 8s, and on down. src/engine/lastDigit.js holds every rule.
--
--  Nothing about a week is stored. The board is worked out from the real scores in
--  nflverse's games.csv each time it is drawn, so there is no second copy of a score to
--  disagree with the first. What IS stored is only who holds which team, and how the
--  game was set up:
--
--    leagues.mode        gains 'lastdigit'
--    leagues.start_week  the NFL week the game starts in, 1..18 - chosen at creation
--    leagues.team_draw   'random' (the commissioner presses Deal Teams) or 'manual'
--                        (the commissioner picks a team for each player)
--    teams.nfl_team      the NFL team a player holds, as its abbreviation ('DET')
--
--  A player is an ordinary team row, made when they redeem the game's join link - the
--  same row a season or a table makes - and holds no NFL team until the commissioner
--  hands them one. So members, invites, renames and Delete League all work unchanged.
--
--  NO NEW TABLE, so nothing here is born with hosted Supabase's default grants: the new
--  columns live on tables whose grants and policies are already settled. teams.nfl_team
--  is read by every member through the existing read_teams policy, and written only by
--  the server (decompose.js deliberately does not carry it, like teams.seat).
--
--  NOTHING HERE MOVES AN EXISTING LEAGUE. Every existing league keeps its mode, has no
--  start week and no draw, and every existing team holds no NFL team.
-- ============================================================================

-- ------------------------------------------------------------- leagues.mode --
alter table leagues drop constraint leagues_mode_check;
alter table leagues
  add constraint leagues_mode_check check (mode in ('season', 'table', 'lastdigit'));

comment on column leagues.mode is
  'Issue #75, OQ-37. season: the same teams every week, standings and playoffs. table: one hand at a time, a won-lost tally. lastdigit: one NFL team each, scored on the last digit of its real score.';

-- ------------------------------------------------- leagues.start_week, team_draw --
-- Chosen once, at creation, like mode. A week already played is allowed (Scott,
-- 2026-11-05): its squares fill straight away from the real scores.
alter table leagues
  add column start_week int
    check (start_week is null or start_week between 1 and 18);

alter table leagues
  add column team_draw text
    check (team_draw is null or team_draw in ('random', 'manual'));

-- A Last Digit game always has both; no other league has either.
alter table leagues
  add constraint leagues_last_digit_settings
    check ((mode = 'lastdigit') = (start_week is not null and team_draw is not null));

comment on column leagues.start_week is
  'OQ-37. Last Digit only: the NFL week the game starts in. Earlier weeks are not on the board and count for nothing.';
comment on column leagues.team_draw is
  'OQ-37. Last Digit only: random (the commissioner deals teams at random) or manual (the commissioner picks a team for each player).';

-- ----------------------------------------------------------- teams.nfl_team --
-- The abbreviation, as src/engine/nflTeams.js writes it. Null until handed out.
alter table teams
  add column nfl_team text
    check (nfl_team is null or nfl_team ~ '^[A-Z]{2,3}$');

-- One player per NFL team in a game. Two players holding the Lions would score the same
-- squares and make the board lie about who is ahead of whom.
create unique index teams_one_nfl_team_per_league
  on teams (league_id, nfl_team)
  where nfl_team is not null;

comment on column teams.nfl_team is
  'OQ-37. Last Digit only: the NFL team this player holds for the season (e.g. DET). Server-owned; decompose.js does not carry it.';
