-- ============================================================================
--  The table's lobby. OQ-39 (Scott, 2026-11-12).
--
--  Until now a table had SEATS: a number of chairs, and sitting out kept yours. A table
--  of 12 with two sitting out dealt ten, and nobody new could get in. Scott's rule is
--  that the 12 counts THE HAND, not the membership:
--
--    - at most 12 are dealt into any hand (and a dealer may set fewer, down to 2)
--    - anyone invited can be a member; whoever is not in the next hand is in the LOBBY
--    - the lobby keeps a line, in the order people entered it, which the dealer can
--      reorder
--    - who moves from the line into an open seat is a per-table setting, `table_fill`
--
--  Columns:
--
--    leagues.table_seats  now the most in one hand, 2..12 (was seats, 2..13)
--    leagues.table_fill   'dealer' | 'line' | 'player' - who sits in. Default 'line'.
--    teams.seat           gains 'waiting': in the lobby, in the line
--    teams.lobby_order    place in the line; null when not waiting
--    teams.lobby_ready    said "I'm In" - read only when table_fill is 'player'
--    teams.lobby_hold     the dealer is holding them back from the automatic fill
--    teams.removed_at     the dealer removed them from the table (and the league)
--    teams.removed_user_id  who they were, so a new invite gives them their record back
--
--  NOTHING ABOUT A SEASON MOVES. Every new column has a default a season never reads.
--  An existing table keeps everyone where they are, except that a table with more than
--  12 seated keeps the 12 who joined first and puts the rest at the front of the line.
-- ============================================================================

-- --------------------------------------------------------- 12, not 13 --
update leagues set table_seats = 12 where table_seats > 12;

alter table leagues drop constraint if exists leagues_table_seats_check;
alter table leagues
  add constraint leagues_table_seats_check
    check (table_seats is null or table_seats between 2 and 12);

comment on column leagues.table_seats is
  'OQ-39. The most players dealt into one hand at a table (2..12); null for a season. Members beyond it wait in the lobby.';

-- ---------------------------------------------------------- table_fill --
alter table leagues
  add column table_fill text not null default 'line'
    check (table_fill in ('dealer', 'line', 'player'));

comment on column leagues.table_fill is
  'OQ-39. Table mode only. Who moves people from the lobby into an open seat at the deal: dealer (only the dealer, by hand), line (open seats fill from the front of the line), player (players who said I''m In, in line order).';

-- ---------------------------------------------------------- teams.seat --
alter table teams drop constraint if exists teams_seat_check;
alter table teams
  add constraint teams_seat_check
    check (seat in ('seated', 'waiting', 'sitting_out', 'left'));

comment on column teams.seat is
  'Table mode only (a season never reads it). seated: in the next hand. waiting: in the lobby, in line. sitting_out: in the lobby, not in line. left: gone from the table, record kept.';

-- ------------------------------------------------------------ the line --
alter table teams add column lobby_order int;
alter table teams add column lobby_ready boolean not null default false;
alter table teams add column lobby_hold boolean not null default false;
alter table teams add column removed_at timestamptz;
alter table teams add column removed_user_id uuid;

comment on column teams.lobby_order is 'OQ-39. Place in the lobby line (lower is sooner). Null unless seat = waiting.';
comment on column teams.lobby_ready is 'OQ-39. The player said I''m In. Read only when the table''s table_fill is player.';
comment on column teams.lobby_hold is 'OQ-39. The dealer is holding this player back from the automatic fill.';
comment on column teams.removed_at is 'OQ-39. When the dealer removed this player from the table. Their record stays.';
comment on column teams.removed_user_id is 'OQ-39. The account the dealer removed, so redeeming a new invite gives them this team, and its record, back.';

-- ------------------------------------------- a table seated past 12 --
-- Only possible for a table made with 13 seats. The 12 who sat down first stay; the rest
-- go to the front of the line, in the order they joined, and are dealt in when a seat
-- opens. Nobody is pulled out of a hand: a hand already dealt keeps its snapshot.
with ranked as (
  select t.id,
         row_number() over (partition by t.league_id order by t.created_at, t.id) as n
  from teams t
  join leagues l on l.id = t.league_id
  where l.mode = 'table' and t.seat = 'seated' and t.active
)
update teams set seat = 'waiting', lobby_order = ranked.n - 12
from ranked
where teams.id = ranked.id and ranked.n > 12;
