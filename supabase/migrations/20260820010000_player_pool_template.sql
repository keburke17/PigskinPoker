-- ============================================================================
--  THE PLAYER POOL BECOMES A TABLE.
--
--  Until now the 223-player pool lived in `src/data/teamRows.js`, was expanded by
--  `generatePlayerPool()` in JavaScript, and was written out row by row every time a
--  league was created. Three separate paths did that - the seed generator, the bootstrap
--  script, and `createLeague` - and each one carried its own copy of the loop.
--
--  Now there is one template table and one way to copy from it.
--
--  WHY PER-LEAGUE `players` ROWS STAY. It would be tidier to point every league at this
--  table and delete `players` entirely, and it would be wrong: a commissioner marking
--  someone OUT or IR is making a statement about THEIR league. Sharing one row would
--  leak that into everybody else's. So `player_pool` is a TEMPLATE - copied at league
--  creation, diverging freely afterwards.
--
--  WHY IT IS STILL GENERATED FROM teamRows.js. `tests/parity.test.js` lifts TEAM_ROWS
--  straight out of the original artifact and replays dealing against it, so that file
--  is load-bearing and cannot move. The rows below come from
--  `node scripts/generate-pool-migration.mjs`, so there is one source and no second copy
--  to drift. Migrations are forward-only: to change the pool later, add a migration.
-- ============================================================================

create table player_pool (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text not null unique,        -- 'p1' .. 'pN', matching the artifact
  name          text not null,
  position      text not null check (position in ('Coach','QB','RB','WR','TE')),
  nfl_team      text not null,
  status        text not null default 'Active'
                  check (status in ('Active','OUT','IR','BYE')),
  -- Phase 4 seam, same as players.external_ids: once a stats provider is chosen, this
  -- is what a pool refresh reconciles against.
  external_ids  jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on player_pool (position, active);

-- --------------------------------------------------------------------- RLS --
-- Readable by anyone, writable by nobody through the API.
--
-- There is nothing secret here - it is public NFL names, and every league already
-- exposes the same names through `players`. Refusing reads would buy no privacy and
-- would stop a future "browse the pool" screen for no reason. Writes go through the
-- function holding the secret key, like every other write in this app.
alter table player_pool enable row level security;
create policy player_pool_read on player_pool for select using (true);

grant select on player_pool to anon, authenticated;
revoke insert, update, delete on player_pool from anon, authenticated;
-- The function's role. Hosted Supabase grants this by default and the local stack does
-- not, which is exactly the difference `npm run verify:grants` exists to catch - so it
-- is stated here rather than assumed either way.
grant all privileges on player_pool to service_role;

-- ------------------------------------------------------- copy into a league --
-- INSERT ... SELECT, which PostgREST cannot express - hence a function.
--
-- SECURITY DEFINER because the caller is the Netlify function's secret role today, but
-- the point of pinning it here is that the copy stays correct if a future caller is
-- something else. `search_path` is pinned for the usual reason: a definer function that
-- resolves table names through a caller-controlled search_path is how privilege
-- escalation happens.
create or replace function copy_player_pool_into(target_league uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  copied integer;
begin
  insert into players (league_id, name, position, nfl_team, status, external_ids, legacy_id, active)
  select target_league, p.name, p.position, p.nfl_team, p.status, p.external_ids, p.legacy_id, true
    from player_pool p
   where p.active
   -- Idempotent: `players` is unique on (league_id, legacy_id), so a retried league
   -- creation tops the pool up rather than failing halfway through.
   on conflict (league_id, legacy_id) do nothing;

  get diagnostics copied = row_count;
  return copied;
end;
$$;

-- No browser may call this: it writes 223 rows into any league id it is handed.
revoke all on function copy_player_pool_into(uuid) from public, anon, authenticated;
grant execute on function copy_player_pool_into(uuid) to service_role;

-- ------------------------------------------------------------ the pool itself --
insert into player_pool (legacy_id, name, position, nfl_team, status) values
  ('p1', 'Mike LaFleur', 'Coach', 'Arizona Cardinals', 'Active'),
  ('p2', 'Jacoby Brisset', 'QB', 'Arizona Cardinals', 'Active'),
  ('p3', 'Jeremiyah Love', 'RB', 'Arizona Cardinals', 'Active'),
  ('p4', 'Tyler Allgeier', 'RB', 'Arizona Cardinals', 'Active'),
  ('p5', 'Marvin Harrison Jr', 'WR', 'Arizona Cardinals', 'Active'),
  ('p6', 'Michael Wilson', 'WR', 'Arizona Cardinals', 'Active'),
  ('p7', 'Trey McBride', 'TE', 'Arizona Cardinals', 'Active'),
  ('p8', 'Kevin Stafanski', 'Coach', 'Atlanta Falcons', 'Active'),
  ('p9', 'Tua Tagovailoa', 'QB', 'Atlanta Falcons', 'Active'),
  ('p10', 'Bijan Robinson', 'RB', 'Atlanta Falcons', 'Active'),
  ('p11', 'Brian Robinson Jr', 'RB', 'Atlanta Falcons', 'Active'),
  ('p12', 'Drake London', 'WR', 'Atlanta Falcons', 'Active'),
  ('p13', 'Kyle Pitts', 'TE', 'Atlanta Falcons', 'Active'),
  ('p14', 'Jesse Minter', 'Coach', 'Baltimore Ravens', 'Active'),
  ('p15', 'Lamar Jackson', 'QB', 'Baltimore Ravens', 'Active'),
  ('p16', 'Derek Henry', 'RB', 'Baltimore Ravens', 'Active'),
  ('p17', 'Zay Flowers', 'WR', 'Baltimore Ravens', 'Active'),
  ('p18', 'Rashod Bateman', 'WR', 'Baltimore Ravens', 'Active'),
  ('p19', 'Mark Andrews', 'TE', 'Baltimore Ravens', 'Active'),
  ('p20', 'Joe Brady', 'Coach', 'Buffalo Bills', 'Active'),
  ('p21', 'Josh Allen', 'QB', 'Buffalo Bills', 'Active'),
  ('p22', 'James Cook', 'RB', 'Buffalo Bills', 'Active'),
  ('p23', 'DJ Moore', 'WR', 'Buffalo Bills', 'Active'),
  ('p24', 'Kalil Shakir', 'WR', 'Buffalo Bills', 'Active'),
  ('p25', 'Dalton Kincaid', 'TE', 'Buffalo Bills', 'Active'),
  ('p26', 'Dave Canales', 'Coach', 'Carolina Panthers', 'Active'),
  ('p27', 'Bryce Young', 'QB', 'Carolina Panthers', 'Active'),
  ('p28', 'Chubba Hubbard', 'RB', 'Carolina Panthers', 'Active'),
  ('p29', 'Jonathon Brooks', 'RB', 'Carolina Panthers', 'Active'),
  ('p30', 'Tet McMillan', 'WR', 'Carolina Panthers', 'Active'),
  ('p31', 'Jalen Coker', 'WR', 'Carolina Panthers', 'Active'),
  ('p32', 'Tommy Tremble', 'TE', 'Carolina Panthers', 'Active'),
  ('p33', 'Ja''Tavion Sanders', 'TE', 'Carolina Panthers', 'Active'),
  ('p34', 'Ben Johnson', 'Coach', 'Chicago Bears', 'Active'),
  ('p35', 'Caleb Williams', 'QB', 'Chicago Bears', 'Active'),
  ('p36', 'D''Andre Swift', 'RB', 'Chicago Bears', 'Active'),
  ('p37', 'Kyle Monangai', 'RB', 'Chicago Bears', 'Active'),
  ('p38', 'Rome Odunze', 'WR', 'Chicago Bears', 'Active'),
  ('p39', 'Luther Burden', 'WR', 'Chicago Bears', 'Active'),
  ('p40', 'Colston Loveland', 'TE', 'Chicago Bears', 'Active'),
  ('p41', 'Zac Taylor', 'Coach', 'Cincinnati Bengals', 'Active'),
  ('p42', 'Joe Burrow', 'QB', 'Cincinnati Bengals', 'Active'),
  ('p43', 'Chase Brown', 'RB', 'Cincinnati Bengals', 'Active'),
  ('p44', 'Ja''Marr Chase', 'WR', 'Cincinnati Bengals', 'Active'),
  ('p45', 'Tee Higgins', 'WR', 'Cincinnati Bengals', 'Active'),
  ('p46', 'Mike Gesicki', 'TE', 'Cincinnati Bengals', 'Active'),
  ('p47', 'Todd Monken', 'Coach', 'Cleveland Browns', 'Active'),
  ('p48', 'Deshaun Watson', 'QB', 'Cleveland Browns', 'Active'),
  ('p49', 'Quinshon Judkins', 'RB', 'Cleveland Browns', 'Active'),
  ('p50', 'Dylan Sampson', 'RB', 'Cleveland Browns', 'Active'),
  ('p51', 'Jerry Jeudy', 'WR', 'Cleveland Browns', 'Active'),
  ('p52', 'KC Concepcion', 'WR', 'Cleveland Browns', 'Active'),
  ('p53', 'Harold Fannin', 'TE', 'Cleveland Browns', 'Active'),
  ('p54', 'Brian Schottenheimer', 'Coach', 'Dallas Cowboys', 'Active'),
  ('p55', 'Dak Prescott', 'QB', 'Dallas Cowboys', 'Active'),
  ('p56', 'Javonte Williams', 'RB', 'Dallas Cowboys', 'Active'),
  ('p57', 'CeeDee Lamb', 'WR', 'Dallas Cowboys', 'Active'),
  ('p58', 'George Pickens', 'WR', 'Dallas Cowboys', 'Active'),
  ('p59', 'Jake Ferguson', 'TE', 'Dallas Cowboys', 'Active'),
  ('p60', 'Sean Payton', 'Coach', 'Denver Broncos', 'Active'),
  ('p61', 'Bo Nix', 'QB', 'Denver Broncos', 'Active'),
  ('p62', 'J.K. Dobbins', 'RB', 'Denver Broncos', 'Active'),
  ('p63', 'RJ Harvey', 'RB', 'Denver Broncos', 'Active'),
  ('p64', 'Courtland Sutton', 'WR', 'Denver Broncos', 'Active'),
  ('p65', 'Jaylen Waddle', 'WR', 'Denver Broncos', 'Active'),
  ('p66', 'Evan Engram', 'TE', 'Denver Broncos', 'Active'),
  ('p67', 'Dan Campbell', 'Coach', 'Detroit Lions', 'Active'),
  ('p68', 'Jared Goff', 'QB', 'Detroit Lions', 'Active'),
  ('p69', 'Jahmyr Gibbs', 'RB', 'Detroit Lions', 'Active'),
  ('p70', 'Isiah Pacheco', 'RB', 'Detroit Lions', 'Active'),
  ('p71', 'Amon-Ra St. Brown', 'WR', 'Detroit Lions', 'Active'),
  ('p72', 'Jameson Williams', 'WR', 'Detroit Lions', 'Active'),
  ('p73', 'Sam Laporta', 'TE', 'Detroit Lions', 'Active'),
  ('p74', 'Matt LaFleur', 'Coach', 'Green Bay Packers', 'Active'),
  ('p75', 'Jordan Love', 'QB', 'Green Bay Packers', 'Active'),
  ('p76', 'Josh Jacobs', 'RB', 'Green Bay Packers', 'Active'),
  ('p77', 'Christian Watson', 'WR', 'Green Bay Packers', 'Active'),
  ('p78', 'Jayden Reed', 'WR', 'Green Bay Packers', 'Active'),
  ('p79', 'Matthew Golden', 'WR', 'Green Bay Packers', 'Active'),
  ('p80', 'Tucker Kraft', 'TE', 'Green Bay Packers', 'Active'),
  ('p81', 'DeMeco Ryans', 'Coach', 'Houston Texans', 'Active'),
  ('p82', 'C.J. Stroud', 'QB', 'Houston Texans', 'Active'),
  ('p83', 'David Montgomery', 'RB', 'Houston Texans', 'Active'),
  ('p84', 'Woody Marks', 'RB', 'Houston Texans', 'Active'),
  ('p85', 'Nico Collins', 'WR', 'Houston Texans', 'Active'),
  ('p86', 'Jayden Higgins', 'WR', 'Houston Texans', 'Active'),
  ('p87', 'Dalton Schultz', 'TE', 'Houston Texans', 'Active'),
  ('p88', 'Shane Steichen', 'Coach', 'Indianapolis Colts', 'Active'),
  ('p89', 'Daniel Jones', 'QB', 'Indianapolis Colts', 'Active'),
  ('p90', 'Jonathan Taylor', 'RB', 'Indianapolis Colts', 'Active'),
  ('p91', 'Alec Pierce', 'WR', 'Indianapolis Colts', 'Active'),
  ('p92', 'Josh Downs', 'WR', 'Indianapolis Colts', 'Active'),
  ('p93', 'Tyler Warren', 'TE', 'Indianapolis Colts', 'Active'),
  ('p94', 'Liam Coen', 'Coach', 'Jacksonville Jaguars', 'Active'),
  ('p95', 'Trevor Lawrence', 'QB', 'Jacksonville Jaguars', 'Active'),
  ('p96', 'Bhayshul Tuten', 'RB', 'Jacksonville Jaguars', 'Active'),
  ('p97', 'Chris Rodriguez', 'RB', 'Jacksonville Jaguars', 'Active'),
  ('p98', 'Brian Thomas Jr', 'WR', 'Jacksonville Jaguars', 'Active'),
  ('p99', 'Jakobi Meyers', 'WR', 'Jacksonville Jaguars', 'Active'),
  ('p100', 'Parker Washington', 'WR', 'Jacksonville Jaguars', 'Active'),
  ('p101', 'Brenton Strange', 'TE', 'Jacksonville Jaguars', 'Active'),
  ('p102', 'Andy Reid', 'Coach', 'Kansas City Chiefs', 'Active'),
  ('p103', 'Patrick Mahomes', 'QB', 'Kansas City Chiefs', 'Active'),
  ('p104', 'Kenneth Walker', 'RB', 'Kansas City Chiefs', 'Active'),
  ('p105', 'Rashee Rice', 'WR', 'Kansas City Chiefs', 'Active'),
  ('p106', 'Xavier Worthy', 'WR', 'Kansas City Chiefs', 'Active'),
  ('p107', 'Travis Kelce', 'TE', 'Kansas City Chiefs', 'Active'),
  ('p108', 'Jim Harbaugh', 'Coach', 'Los Angeles Chargers', 'Active'),
  ('p109', 'Justin Herbert', 'QB', 'Los Angeles Chargers', 'Active'),
  ('p110', 'Omarion Hampton', 'RB', 'Los Angeles Chargers', 'Active'),
  ('p111', 'Keaton Mitchell', 'RB', 'Los Angeles Chargers', 'Active'),
  ('p112', 'Ladd McConkey', 'WR', 'Los Angeles Chargers', 'Active'),
  ('p113', 'Quentin Johnston', 'WR', 'Los Angeles Chargers', 'Active'),
  ('p114', 'Oronde Gadsden', 'TE', 'Los Angeles Chargers', 'Active'),
  ('p115', 'David Njoku', 'TE', 'Los Angeles Chargers', 'Active'),
  ('p116', 'Sean McVay', 'Coach', 'Los Angeles Rams', 'Active'),
  ('p117', 'Matthew Stafford', 'QB', 'Los Angeles Rams', 'Active'),
  ('p118', 'Kyren Williams', 'RB', 'Los Angeles Rams', 'Active'),
  ('p119', 'Blake Corum', 'RB', 'Los Angeles Rams', 'Active'),
  ('p120', 'Puka Nacua', 'WR', 'Los Angeles Rams', 'Active'),
  ('p121', 'Davante Adams', 'WR', 'Los Angeles Rams', 'Active'),
  ('p122', 'Colby Parkinson', 'TE', 'Los Angeles Rams', 'Active'),
  ('p123', 'Tyler Higbee', 'TE', 'Los Angeles Rams', 'Active'),
  ('p124', 'Terrance Ferguson', 'TE', 'Los Angeles Rams', 'Active'),
  ('p125', 'Klint Kubiak', 'Coach', 'Las Vegas Raiders', 'Active'),
  ('p126', 'Kirk Cousins', 'QB', 'Las Vegas Raiders', 'Active'),
  ('p127', 'Ashton Jeanty', 'RB', 'Las Vegas Raiders', 'Active'),
  ('p128', 'Tre Tucker', 'WR', 'Las Vegas Raiders', 'Active'),
  ('p129', 'Jalen Nailor', 'WR', 'Las Vegas Raiders', 'Active'),
  ('p130', 'Brock Bowers', 'TE', 'Las Vegas Raiders', 'Active'),
  ('p131', 'Jeff Hafley', 'Coach', 'Miami Dolphins', 'Active'),
  ('p132', 'Malik Willis', 'QB', 'Miami Dolphins', 'Active'),
  ('p133', 'De''Von Achane', 'RB', 'Miami Dolphins', 'Active'),
  ('p134', 'Malik Washington', 'WR', 'Miami Dolphins', 'Active'),
  ('p135', 'Jalen Tolbert', 'WR', 'Miami Dolphins', 'Active'),
  ('p136', 'Greg Dulcich', 'TE', 'Miami Dolphins', 'Active'),
  ('p137', 'Kevin O''Connell', 'Coach', 'Minnesota Vikings', 'Active'),
  ('p138', 'Kyler Murray', 'QB', 'Minnesota Vikings', 'Active'),
  ('p139', 'Aaron Jones', 'RB', 'Minnesota Vikings', 'Active'),
  ('p140', 'Jordan Mason', 'RB', 'Minnesota Vikings', 'Active'),
  ('p141', 'Justin Jefferson', 'WR', 'Minnesota Vikings', 'Active'),
  ('p142', 'Jordan Addison', 'WR', 'Minnesota Vikings', 'Active'),
  ('p143', 'T.J. Hockenson', 'TE', 'Minnesota Vikings', 'Active'),
  ('p144', 'Mike Vrabel', 'Coach', 'New England Patriots', 'Active'),
  ('p145', 'Drake Maye', 'QB', 'New England Patriots', 'Active'),
  ('p146', 'Rhamondre Stevenson', 'RB', 'New England Patriots', 'Active'),
  ('p147', 'TreVeyon Henderson', 'RB', 'New England Patriots', 'Active'),
  ('p148', 'A.J. Brown', 'WR', 'New England Patriots', 'Active'),
  ('p149', 'Romeo Doubs', 'WR', 'New England Patriots', 'Active'),
  ('p150', 'Hunter Henry', 'TE', 'New England Patriots', 'Active'),
  ('p151', 'Kellen Moore', 'Coach', 'New Orleans Saints', 'Active'),
  ('p152', 'Tyler Shough', 'QB', 'New Orleans Saints', 'Active'),
  ('p153', 'Travis Etienne', 'RB', 'New Orleans Saints', 'Active'),
  ('p154', 'Alvin Kamara', 'RB', 'New Orleans Saints', 'Active'),
  ('p155', 'Chris Olave', 'WR', 'New Orleans Saints', 'Active'),
  ('p156', 'Jordyn Tyson', 'WR', 'New Orleans Saints', 'Active'),
  ('p157', 'Juwan Johnson', 'TE', 'New Orleans Saints', 'Active'),
  ('p158', 'John Harbaugh', 'Coach', 'New York Giants', 'Active'),
  ('p159', 'Jaxson Dart', 'QB', 'New York Giants', 'Active'),
  ('p160', 'Cam Skattebo', 'RB', 'New York Giants', 'Active'),
  ('p161', 'Tyrone Tracy', 'RB', 'New York Giants', 'Active'),
  ('p162', 'Malik Nabers', 'WR', 'New York Giants', 'Active'),
  ('p163', 'Darius Slayton', 'WR', 'New York Giants', 'Active'),
  ('p164', 'Isaiah Likely', 'TE', 'New York Giants', 'Active'),
  ('p165', 'Theo Johnson', 'TE', 'New York Giants', 'Active'),
  ('p166', 'Aaron Glenn', 'Coach', 'New York Jets', 'Active'),
  ('p167', 'Geno Smith', 'QB', 'New York Jets', 'Active'),
  ('p168', 'Breece Hall', 'RB', 'New York Jets', 'Active'),
  ('p169', 'Braelon Allen', 'RB', 'New York Jets', 'Active'),
  ('p170', 'Garrett Wilson', 'WR', 'New York Jets', 'Active'),
  ('p171', 'Adonai Mitchell', 'WR', 'New York Jets', 'Active'),
  ('p172', 'Omar Cooper', 'WR', 'New York Jets', 'Active'),
  ('p173', 'Kenyon Sadiq', 'TE', 'New York Jets', 'Active'),
  ('p174', 'Mason Taylor', 'TE', 'New York Jets', 'Active'),
  ('p175', 'Nick Sirianni', 'Coach', 'Philadelphia Eagles', 'Active'),
  ('p176', 'Jalen Hurts', 'QB', 'Philadelphia Eagles', 'Active'),
  ('p177', 'Saquon Barkley', 'RB', 'Philadelphia Eagles', 'Active'),
  ('p178', 'Tank Bigsby', 'RB', 'Philadelphia Eagles', 'Active'),
  ('p179', 'DeVonta Smith', 'WR', 'Philadelphia Eagles', 'Active'),
  ('p180', 'Makai Lemon', 'WR', 'Philadelphia Eagles', 'Active'),
  ('p181', 'Dallas Goedert', 'TE', 'Philadelphia Eagles', 'Active'),
  ('p182', 'Mike McCarthy', 'Coach', 'Pittsburgh Steelers', 'Active'),
  ('p183', 'Aaron Rodgers', 'QB', 'Pittsburgh Steelers', 'Active'),
  ('p184', 'Jaylen Warren', 'RB', 'Pittsburgh Steelers', 'Active'),
  ('p185', 'Rico Dowdle', 'RB', 'Pittsburgh Steelers', 'Active'),
  ('p186', 'DK Metcalf', 'WR', 'Pittsburgh Steelers', 'Active'),
  ('p187', 'Michael Pittman', 'WR', 'Pittsburgh Steelers', 'Active'),
  ('p188', 'Pat Freiermuth', 'TE', 'Pittsburgh Steelers', 'Active'),
  ('p189', 'Darnell Washington', 'TE', 'Pittsburgh Steelers', 'Active'),
  ('p190', 'Mike Macdonald', 'Coach', 'Seattle Seahawks', 'Active'),
  ('p191', 'Sam Darnold', 'QB', 'Seattle Seahawks', 'Active'),
  ('p192', 'Zach Charbonet', 'RB', 'Seattle Seahawks', 'Active'),
  ('p193', 'Jadarian Price', 'RB', 'Seattle Seahawks', 'Active'),
  ('p194', 'Jaxson Smith-Njigba', 'WR', 'Seattle Seahawks', 'Active'),
  ('p195', 'Rashid Shaheed', 'WR', 'Seattle Seahawks', 'Active'),
  ('p196', 'AJ Barner', 'TE', 'Seattle Seahawks', 'Active'),
  ('p197', 'Kyle Shanahan', 'Coach', 'San Francisco 49ers', 'Active'),
  ('p198', 'Brock Purdy', 'QB', 'San Francisco 49ers', 'Active'),
  ('p199', 'Christian McCaffrey', 'RB', 'San Francisco 49ers', 'Active'),
  ('p200', 'Mike Evans', 'WR', 'San Francisco 49ers', 'Active'),
  ('p201', 'Ricky Pearsall', 'WR', 'San Francisco 49ers', 'Active'),
  ('p202', 'George Kittle', 'TE', 'San Francisco 49ers', 'Active'),
  ('p203', 'Todd Bowles', 'Coach', 'Tampa Bay Buccaneers', 'Active'),
  ('p204', 'Baker Mayfield', 'QB', 'Tampa Bay Buccaneers', 'Active'),
  ('p205', 'Bucky Irving', 'RB', 'Tampa Bay Buccaneers', 'Active'),
  ('p206', 'Kenneth Gainwell', 'RB', 'Tampa Bay Buccaneers', 'Active'),
  ('p207', 'Chris Godwin', 'WR', 'Tampa Bay Buccaneers', 'Active'),
  ('p208', 'Emeka Egbuka', 'WR', 'Tampa Bay Buccaneers', 'Active'),
  ('p209', 'Cade Otton', 'TE', 'Tampa Bay Buccaneers', 'Active'),
  ('p210', 'Robert Saleh', 'Coach', 'Tennessee Titans', 'Active'),
  ('p211', 'Cam Ward', 'QB', 'Tennessee Titans', 'Active'),
  ('p212', 'Tony Pollard', 'RB', 'Tennessee Titans', 'Active'),
  ('p213', 'Tyjae Spears', 'RB', 'Tennessee Titans', 'Active'),
  ('p214', 'Carnell Tate', 'WR', 'Tennessee Titans', 'Active'),
  ('p215', 'Wan''Dale Robinson', 'WR', 'Tennessee Titans', 'Active'),
  ('p216', 'Gunnar Helm', 'TE', 'Tennessee Titans', 'Active'),
  ('p217', 'Dan Quinn', 'Coach', 'Washington Commanders', 'Active'),
  ('p218', 'Jayden Daniels', 'QB', 'Washington Commanders', 'Active'),
  ('p219', 'Jacory Croskey-Merritt', 'RB', 'Washington Commanders', 'Active'),
  ('p220', 'Rachaad White', 'RB', 'Washington Commanders', 'Active'),
  ('p221', 'Terry McLaurin', 'WR', 'Washington Commanders', 'Active'),
  ('p222', 'Luke McCaffrey', 'WR', 'Washington Commanders', 'Active'),
  ('p223', 'Chig Okonkwo', 'TE', 'Washington Commanders', 'Active')
on conflict (legacy_id) do nothing;
