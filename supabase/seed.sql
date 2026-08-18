-- ============================================================================
--  Pigskin Poker - LOCAL DEVELOPMENT SEED
--
--  GENERATED FILE - DO NOT EDIT BY HAND.
--  Regenerate with:  npm run seed:generate
--  Source of truth:  src/storage/demoLeague.js + src/storage/decompose.js
--
--  Runs automatically on `supabase start` and `supabase db reset`, so
--  `supabase db reset` is the one-command way back to a clean, populated league.
--
--  ============================ DEVELOPMENT CREDENTIALS ======================
--  Obviously-fake, local-only. Never use these for a real league.
--      Commissioner:  DEMO-COMMISH
--      Managers:      DEMO-TEAM-1 .. DEMO-TEAM-6
--
--  The hashes below are sha256(salt:code) - adequate for fake local codes, NOT for
--  production credentials. Phase 3 replaces this with a real KDF in the login
--  function; see docs/AUTH.md when it lands.
--  ===========================================================================
--
--  Contents: a six-team league with Week 1 played and finalized (so standings and
--  results have data) and Week 2 dealt, schemes resolved, and stats part-entered -
--  which is the state the app is actually in on a Sunday afternoon.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  SAFETY GUARD - refuse to run against a database holding real data.
--
--  In the normal workflow this file only ever runs locally: `supabase db reset`
--  and `supabase start` target the local stack, and `supabase db push` (which is
--  what touches a hosted project) does NOT run seeds. This guard is for the
--  abnormal case - someone piping this file at a real database by hand.
--
--  It keys off DATA rather than hostname, because that is what actually matters
--  and what can be checked reliably from inside SQL.
-- ---------------------------------------------------------------------------
do $guard$
declare
  foreign_leagues int;
  finalized       int;
begin
  select count(*) into foreign_leagues
    from leagues where id <> '8ea81188-8bb6-5aae-bef2-fba50410aa24'::uuid;

  -- Scoped to OTHER leagues on purpose: the demo league contains its own finalized
  -- Week 1, so an unscoped count would make this file refuse to re-run over itself.
  select count(*) into finalized
    from periods p
    join seasons s on s.id = p.season_id
   where p.phase = 'finalized'
     and s.league_id <> '8ea81188-8bb6-5aae-bef2-fba50410aa24'::uuid;

  if foreign_leagues > 0 or finalized > 0 then
    raise exception
      'REFUSING TO SEED: this database already holds real data (% other league(s), % finalized period(s) outside the demo league). The demo seed is for local development only.',
      foreign_leagues, finalized
      using hint = 'If this really is a scratch database, delete its contents first.';
  end if;
end
$guard$;

-- Idempotent: wipe any previous demo league, then rebuild it. Everything else
-- cascades from the league row.
delete from leagues where id = '8ea81188-8bb6-5aae-bef2-fba50410aa24'::uuid;

insert into leagues (id, name) values
  ('8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Pigskin Poker (Demo League)');

insert into seasons (id, league_id, year, label, status, schema_version, scoring_config, standings_points_override, playoff_bracket_size, playoff_advancement, playoff_started, playoff_completed, playoff_round_index, champion_team_id) values
  ('4727208d-93cc-5aef-bde8-c1cc766d085d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 2026, '2026 Season', 'active', 2, '{"yardsPerPoint":10,"pointsPerTD":5,"coachWin":2,"coachTie":1,"coachLoss":0}'::jsonb, NULL, 4, '{4,2,1}', false, false, 0, NULL);

insert into teams (id, league_id, name, legacy_id, active) values
  ('58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Gridiron Gamblers', 'demo_team_1', true),
  ('5bec4e5d-1c6a-5487-887b-95a4696f7645', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Full House Flyers', 'demo_team_2', true),
  ('5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Royal Flush Runners', 'demo_team_3', true),
  ('55ec44eb-1a6a-5161-92de-4a421f0d8b27', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Pocket Aces', 'demo_team_4', true),
  ('54ec4358-196a-5fce-b767-db2db2221244', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dead Man''s Hand', 'demo_team_5', true),
  ('57ec4811-186a-5e3b-a416-9530add50dd9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'All-In Antlers', 'demo_team_6', true);

insert into players (id, league_id, name, position, nfl_team, status, external_ids, legacy_id, active) values
  ('f4cf6d00-f221-56d2-8f88-79c57f566158', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mike LaFleur', 'Coach', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p1', true),
  ('f7cf71b9-f121-553f-9c38-2fa81a6af50d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jacoby Brisset', 'QB', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p2', true),
  ('f6cf7026-f021-53ac-b1ea-8aab1cf45072', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jeremiyah Love', 'RB', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p3', true),
  ('f9cf74df-ef21-5219-8ec6-188eb008d78f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tyler Allgeier', 'RB', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p4', true),
  ('f8cf734c-ee21-5086-93ee-1159c3bbf8ec', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Marvin Harrison Jr', 'WR', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p5', true),
  ('fbcf7805-ed20-5ef3-a09c-fdbcde31f261', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Michael Wilson', 'WR', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p6', true),
  ('facf7672-ec20-5d60-b650-223f6159e806', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Trey McBride', 'TE', 'Arizona Cardinals', 'Active', '{}'::jsonb, 'p7', true),
  ('fdcf7b2b-fb21-54fd-932a-e6a2750d0963', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kevin Stafanski', 'Coach', 'Atlanta Falcons', 'Active', '{}'::jsonb, 'p8', true),
  ('fccf7998-fa21-536a-b8f1-ac0d8820c700', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tua Tagovailoa', 'QB', 'Atlanta Falcons', 'Active', '{}'::jsonb, 'p9', true),
  ('9288e290-0bfd-55c6-a680-d55d7742389c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Bijan Robinson', 'RB', 'Atlanta Falcons', 'Active', '{}'::jsonb, 'p10', true),
  ('9388e423-0cfd-5759-8158-aa32638f173f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Brian Robinson Jr', 'RB', 'Atlanta Falcons', 'Active', '{}'::jsonb, 'p11', true),
  ('9488e5b6-09fd-52a0-a7a6-48e314e027b6', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Drake London', 'WR', 'Atlanta Falcons', 'Active', '{}'::jsonb, 'p12', true),
  ('9588e749-0afd-5433-9330-58e0925602d1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kyle Pitts', 'TE', 'Atlanta Falcons', 'Active', '{}'::jsonb, 'p13', true),
  ('9688e8dc-0ffd-5c12-aae6-6cf1b23e06c8', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jesse Minter', 'Coach', 'Baltimore Ravens', 'Active', '{}'::jsonb, 'p14', true),
  ('9788ea6f-10fd-5da5-85be-41c61f297fab', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Lamar Jackson', 'QB', 'Baltimore Ravens', 'Active', '{}'::jsonb, 'p15', true),
  ('9888ec02-0dfd-58ec-8c0b-495751192a62', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Derek Henry', 'RB', 'Baltimore Ravens', 'Active', '{}'::jsonb, 'p16', true),
  ('9988ed95-0efd-5a7f-b6f6-bf14cdf134bd', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Zay Flowers', 'WR', 'Baltimore Ravens', 'Active', '{}'::jsonb, 'p17', true),
  ('9a88ef28-13fd-525e-bd18-6c95200c0724', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rashod Bateman', 'WR', 'Baltimore Ravens', 'Active', '{}'::jsonb, 'p18', true),
  ('9b88f0bb-14fd-53f1-b7ef-aa4a0cf84987', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mark Andrews', 'TE', 'Baltimore Ravens', 'Active', '{}'::jsonb, 'p19', true),
  ('a48fbaab-a5fa-569d-af2f-1a5a51f15ae3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Joe Brady', 'Coach', 'Buffalo Bills', 'Active', '{}'::jsonb, 'p20', true),
  ('a38fb918-a4fa-550a-b4f5-ad6565051880', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Josh Allen', 'QB', 'Buffalo Bills', 'Active', '{}'::jsonb, 'p21', true),
  ('a68fbdd1-a3fa-5377-81a4-99c87f7b11f5', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'James Cook', 'RB', 'Buffalo Bills', 'Active', '{}'::jsonb, 'p22', true),
  ('a58fbc3e-a2fa-51e4-961a-89cba341d43a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'DJ Moore', 'WR', 'Buffalo Bills', 'Active', '{}'::jsonb, 'p23', true),
  ('a88fc0f7-a1fa-5051-b432-82ae36565b57', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kalil Shakir', 'WR', 'Buffalo Bills', 'Active', '{}'::jsonb, 'p24', true),
  ('a78fbf64-a0fa-5ebe-b95a-7b7948cc4834', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dalton Kincaid', 'TE', 'Buffalo Bills', 'Active', '{}'::jsonb, 'p25', true),
  ('aa8fc41d-9ffa-5d2b-860a-315cc3e0a989', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dave Canales', 'Coach', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p26', true),
  ('a98fc28a-9efa-5b98-9a7f-57dfe7a76bce', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Bryce Young', 'QB', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p27', true),
  ('9c8fae13-9dfa-5a05-b898-1a42c8885afb', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Chubba Hubbard', 'RB', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p28', true),
  ('9b8fac80-9cfa-5872-9d21-ab2d5c3ab2d8', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jonathon Brooks', 'RB', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p29', true),
  ('9e8d72a2-9ff8-5e94-847c-cd6f5946408a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tet McMillan', 'WR', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p30', true),
  ('9f8d7435-a0f8-5027-aec9-a8ecb61e1885', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jalen Coker', 'WR', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p31', true),
  ('9c8d6f7c-a1f8-51ba-a21a-bc891a6bb410', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tommy Tremble', 'TE', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p32', true),
  ('9d8d710f-a2f8-534d-9d90-947e07f5c733', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Ja''Tavion Sanders', 'TE', 'Carolina Panthers', 'Active', '{}'::jsonb, 'p33', true),
  ('9a8d6c56-9bf8-5848-bf78-9b9b9dabd81e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Ben Johnson', 'Coach', 'Chicago Bears', 'Active', '{}'::jsonb, 'p34', true),
  ('9b8d6de9-9cf8-59db-aa64-1158fa83b019', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Caleb Williams', 'QB', 'Chicago Bears', 'Active', '{}'::jsonb, 'p35', true),
  ('988d6930-9df8-5b6e-9e53-bf35fed0b484', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'D''Andre Swift', 'RB', 'Chicago Bears', 'Active', '{}'::jsonb, 'p36', true),
  ('998d6ac3-9ef8-5d01-992b-c66a6bbc2d67', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kyle Monangai', 'RB', 'Chicago Bears', 'Active', '{}'::jsonb, 'p37', true),
  ('a68d7f3a-97f8-51fc-ad46-9bf72fddd7c2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rome Odunze', 'WR', 'Chicago Bears', 'Active', '{}'::jsonb, 'p38', true),
  ('a78d80cd-98f8-538f-9832-db342cb5189d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Luther Burden', 'WR', 'Chicago Bears', 'Active', '{}'::jsonb, 'p39', true),
  ('3095143d-99f6-568b-a5f7-1d0c23e1c1e9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Colston Loveland', 'TE', 'Chicago Bears', 'Active', '{}'::jsonb, 'p40', true),
  ('2f9512aa-98f6-54f8-ba6d-0d0f466b4fae', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Zac Taylor', 'Coach', 'Cincinnati Bengals', 'Active', '{}'::jsonb, 'p41', true),
  ('2e951117-9bf6-59b1-9381-9d9e951a3f37', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Joe Burrow', 'QB', 'Cincinnati Bengals', 'Active', '{}'::jsonb, 'p42', true),
  ('2d950f84-9af6-581e-9948-30a9a8cd6094', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Chase Brown', 'RB', 'Cincinnati Bengals', 'Active', '{}'::jsonb, 'p43', true),
  ('2c950df1-9df6-5cd7-a192-4ef85f7cf3d5', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Ja''Marr Chase', 'WR', 'Cincinnati Bengals', 'Active', '{}'::jsonb, 'p44', true),
  ('2b950c5e-9cf6-5b44-b6a6-d93b8206819a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tee Higgins', 'WR', 'Cincinnati Bengals', 'Active', '{}'::jsonb, 'p45', true),
  ('2a950acb-9ff6-5ffd-8f1c-060ab0b53ec3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mike Gesicki', 'TE', 'Cincinnati Bengals', 'Active', '{}'::jsonb, 'p46', true),
  ('29950938-9ef6-5e6a-9444-c85543c9c5e0', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Todd Monken', 'Coach', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p47', true),
  ('289507a5-91f6-59f3-8e23-1ad41b175c41', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Deshaun Watson', 'QB', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p48', true),
  ('27950612-90f6-5860-a337-a5179e3f51e6', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Quinshon Judkins', 'RB', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p49', true),
  ('2a92cc34-93f4-5e82-82a6-4279b3670e98', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dylan Sampson', 'RB', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p50', true),
  ('2b92cdc7-94f4-5015-bd7e-49ae1fb4b6bb', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jerry Jeudy', 'WR', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p51', true),
  ('2c92cf5a-91f4-5b5c-a3cb-1edf5104fdb2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'KC Concepcion', 'WR', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p52', true),
  ('2d92d0ed-92f4-5cef-8f55-f85c4e7ba24d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Harold Fannin', 'TE', 'Cleveland Browns', 'Active', '{}'::jsonb, 'p53', true),
  ('2692c5e8-8ff4-5836-be41-7465f7cca62c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Brian Schottenheimer', 'Coach', 'Dallas Cowboys', 'Active', '{}'::jsonb, 'p54', true),
  ('2792c77b-90f4-59c9-b87a-e15ae41984cf', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dak Prescott', 'QB', 'Dallas Cowboys', 'Active', '{}'::jsonb, 'p55', true),
  ('2892c90e-8df4-5510-9f66-50cb956a9546', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Javonte Williams', 'RB', 'Dallas Cowboys', 'Active', '{}'::jsonb, 'p56', true),
  ('2992caa1-8ef4-56a3-8af0-60c812429fa1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'CeeDee Lamb', 'WR', 'Dallas Cowboys', 'Active', '{}'::jsonb, 'p57', true),
  ('2292bf9c-9bf4-5b1a-aad2-4041bc317440', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'George Pickens', 'WR', 'Dallas Cowboys', 'Active', '{}'::jsonb, 'p58', true),
  ('2392c12f-9cf4-5cad-8648-af56a91db6a3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jake Ferguson', 'TE', 'Dallas Cowboys', 'Active', '{}'::jsonb, 'p59', true),
  ('9c9a3b6f-0df1-5cf9-af1c-53961abc8b5f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Sean Payton', 'Coach', 'Denver Broncos', 'Active', '{}'::jsonb, 'p60', true),
  ('9b9a39dc-0cf1-5b66-93a5-e4812d32783c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Bo Nix', 'QB', 'Denver Broncos', 'Active', '{}'::jsonb, 'p61', true),
  ('9e9a3e95-0bf1-59d3-a054-d0e4c8470bf1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'J.K. Dobbins', 'RB', 'Denver Broncos', 'Active', '{}'::jsonb, 'p62', true),
  ('9d9a3d02-0af1-5840-b607-f567cc0d9bd6', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'RJ Harvey', 'RB', 'Denver Broncos', 'Active', '{}'::jsonb, 'p63', true),
  ('989a3523-11f1-5345-aab7-85825657bd4b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Courtland Sutton', 'WR', 'Denver Broncos', 'Active', '{}'::jsonb, 'p64', true),
  ('979a3390-10f1-51b2-8f41-166de96c4468', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jaylen Waddle', 'WR', 'Denver Broncos', 'Active', '{}'::jsonb, 'p65', true),
  ('9a9a3849-0ff1-501f-bbef-d07083e1745d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Evan Engram', 'TE', 'Denver Broncos', 'Active', '{}'::jsonb, 'p66', true),
  ('999a36b6-0ef1-5e8c-9104-5ab3870a3382', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dan Campbell', 'Coach', 'Detroit Lions', 'Active', '{}'::jsonb, 'p67', true),
  ('a49a4807-15f1-5991-a651-edeec2e88927', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jared Goff', 'QB', 'Detroit Lions', 'Active', '{}'::jsonb, 'p68', true),
  ('a39a4674-14f1-57fe-ab79-e6b955fd1044', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jahmyr Gibbs', 'RB', 'Detroit Lions', 'Active', '{}'::jsonb, 'p69', true),
  ('169729e6-07ee-54f0-80a1-a36bf56bada6', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Isiah Pacheco', 'RB', 'Detroit Lions', 'Active', '{}'::jsonb, 'p70', true),
  ('17972b79-08ee-5683-aaef-48687243b801', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Amon-Ra St. Brown', 'WR', 'Detroit Lions', 'Active', '{}'::jsonb, 'p71', true),
  ('149726c0-09ee-5816-9e3f-928556908a0c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jameson Williams', 'WR', 'Detroit Lions', 'Active', '{}'::jsonb, 'p72', true),
  ('15972853-0aee-59a9-99b6-33fac41b66af', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Sam Laporta', 'TE', 'Detroit Lions', 'Active', '{}'::jsonb, 'p73', true),
  ('1a973032-0bee-5b3c-8507-3aff3106df92', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Matt LaFleur', 'Coach', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p74', true),
  ('1b9731c5-0cee-5ccf-af54-167c2d404fad', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jordan Love', 'QB', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p75', true),
  ('18972d0c-0dee-5e62-a2a5-2a19922bbbf8', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Josh Jacobs', 'RB', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p76', true),
  ('19972e9f-0eee-5ff5-9d7d-314e7fb5cf1b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Christian Watson', 'WR', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p77', true),
  ('1e97367e-0fee-5188-896c-09139d97ab6e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jayden Reed', 'WR', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p78', true),
  ('1f973811-10ee-531b-b458-48507b0e1da9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Matthew Golden', 'WR', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p79', true),
  ('a89ecb81-2213-5eb7-a21c-bc885f68c725', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tucker Kraft', 'TE', 'Green Bay Packers', 'Active', '{}'::jsonb, 'p80', true),
  ('a79ec9ee-2113-5d24-b692-ac8b0290ef2a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'DeMeco Ryans', 'Coach', 'Houston Texans', 'Active', '{}'::jsonb, 'p81', true),
  ('a69ec85b-2413-51dd-8fa7-3d1a313fac53', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'C.J. Stroud', 'QB', 'Houston Texans', 'Active', '{}'::jsonb, 'p82', true),
  ('a59ec6c8-2313-504a-956d-d02544f2cdb0', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'David Montgomery', 'RB', 'Houston Texans', 'Active', '{}'::jsonb, 'p83', true),
  ('ac9ed1cd-1e13-586b-a682-541c23cd9539', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Woody Marks', 'RB', 'Houston Texans', 'Active', '{}'::jsonb, 'p84', true),
  ('ab9ed03a-1d13-56d8-baf7-7a9fc6f5bd3e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Nico Collins', 'WR', 'Houston Texans', 'Active', '{}'::jsonb, 'p85', true),
  ('aa9ecea7-2013-5b91-94aa-a56e16441087', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jayden Higgins', 'WR', 'Houston Texans', 'Active', '{}'::jsonb, 'p86', true),
  ('a99ecd14-1f13-59fe-99d2-9e392957ce24', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dalton Schultz', 'TE', 'Houston Texans', 'Active', '{}'::jsonb, 'p87', true),
  ('a09ebee9-1a13-521f-aa48-87f0d73cfbbd', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Shane Steichen', 'Coach', 'Indianapolis Colts', 'Active', '{}'::jsonb, 'p88', true),
  ('9f9ebd56-1913-508c-bf5d-12335a64f162', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Daniel Jones', 'QB', 'Indianapolis Colts', 'Active', '{}'::jsonb, 'p89', true),
  ('a29c8378-1c11-56ae-becb-e1f552180f34', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jonathan Taylor', 'RB', 'Indianapolis Colts', 'Active', '{}'::jsonb, 'p90', true),
  ('a39c850b-1d11-5841-b9a3-e92a3fa22257', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Alec Pierce', 'WR', 'Indianapolis Colts', 'Active', '{}'::jsonb, 'p91', true),
  ('a49c869e-1a11-5388-9ff0-be5bf0f332ce', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Josh Downs', 'WR', 'Indianapolis Colts', 'Active', '{}'::jsonb, 'p92', true),
  ('a59c8831-1b11-551b-8adc-3418cd2c7089', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tyler Warren', 'TE', 'Indianapolis Colts', 'Active', '{}'::jsonb, 'p93', true),
  ('a69c89c4-2011-5cfa-8292-df496e50df80', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Liam Coen', 'Coach', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p94', true),
  ('a79c8b57-2111-5e8d-be08-b73e5b3d21e3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Trevor Lawrence', 'QB', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p95', true),
  ('a89c8cea-1e11-59d4-a4f4-f02fac8d9b3a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Bhayshul Tuten', 'RB', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p96', true),
  ('a99c8e7d-1f11-5b67-8f41-cbac88c6d8f5', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Chris Rodriguez', 'RB', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p97', true),
  ('9a9c76e0-1411-5a16-a6f7-dfbda9ec116c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Brian Thomas Jr', 'WR', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p98', true),
  ('9b9c7873-1511-5ba9-81cf-b4929638f00f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jakobi Meyers', 'WR', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p99', true),
  ('4d7cc1e0-d697-5242-83b0-d4c501f93248', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Parker Washington', 'WR', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p100', true),
  ('4e7cc373-d797-53d5-bf27-763a6ee4ab2b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Brenton Strange', 'TE', 'Jacksonville Jaguars', 'Active', '{}'::jsonb, 'p101', true),
  ('4f7cc506-d497-5f1c-a612-e5aba0d455e2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Andy Reid', 'Coach', 'Kansas City Chiefs', 'Active', '{}'::jsonb, 'p102', true),
  ('507cc699-d597-50af-9060-8aa81dac603d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Patrick Mahomes', 'QB', 'Kansas City Chiefs', 'Active', '{}'::jsonb, 'p103', true),
  ('517cc82c-d297-5bf6-8816-6c59c6fd641c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kenneth Walker', 'RB', 'Kansas City Chiefs', 'Active', '{}'::jsonb, 'p104', true),
  ('527cc9bf-d397-5d89-82ee-738eb34a42bf', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rashee Rice', 'WR', 'Kansas City Chiefs', 'Active', '{}'::jsonb, 'p105', true),
  ('537ccb52-d097-58d0-aa78-7d3f649b5336', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Xavier Worthy', 'WR', 'Kansas City Chiefs', 'Active', '{}'::jsonb, 'p106', true),
  ('547ccce5-d197-5a63-94c5-58bce2112e51', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Travis Kelce', 'TE', 'Kansas City Chiefs', 'Active', '{}'::jsonb, 'p107', true),
  ('557cce78-de97-5eda-ad1a-070d8b623230', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jim Harbaugh', 'Coach', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p108', true),
  ('567cd00b-df97-506d-8753-41a277af10d3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Justin Herbert', 'QB', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p109', true),
  ('537f09e9-dc9a-5a4b-a701-af58f3127fd9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Omarion Hampton', 'RB', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p110', true),
  ('527f0856-db9a-58b8-bc16-399b963aa7de', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Keaton Mitchell', 'RB', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p111', true),
  ('517f06c3-de9a-5d71-95c9-646a644afd27', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Ladd McConkey', 'WR', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p112', true),
  ('507f0530-dd9a-5bde-9af1-5d35f75f8444', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Quentin Johnston', 'WR', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p113', true),
  ('577f1035-e09a-5097-ab67-46ecaeace845', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Oronde Gadsden', 'TE', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p114', true),
  ('567f0ea2-df9a-5f04-811a-6b6f51d5104a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'David Njoku', 'TE', 'Los Angeles Chargers', 'Active', '{}'::jsonb, 'p115', true),
  ('557f0d0f-e29a-53bd-9a2e-327e008496f3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Sean McVay', 'Coach', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p116', true),
  ('547f0b7c-e19a-522a-9eb8-5a8912fa83d0', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Matthew Stafford', 'QB', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p117', true),
  ('5b7f1681-d49a-5db3-afcc-150069a97ff1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kyren Williams', 'RB', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p118', true),
  ('5a7f14ee-d39a-5c20-857f-39836d700fd6', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Blake Corum', 'RB', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p119', true),
  ('598151f2-4a92-58b0-b17c-8b97c49c6b96', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Puka Nacua', 'WR', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p120', true),
  ('5a815385-4b92-5a43-9c68-0154c0d5dbb1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Davante Adams', 'WR', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p121', true),
  ('57814ecc-4c92-5bd6-9057-af3125c147fc', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Colby Parkinson', 'TE', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p122', true),
  ('5881505f-4d92-5d69-ab2f-8406134b5b1f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tyler Higbee', 'TE', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p123', true),
  ('55814ba6-4e92-5efc-8d17-8b237f990342', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Terrance Ferguson', 'TE', 'Los Angeles Rams', 'Active', '{}'::jsonb, 'p124', true),
  ('56814d39-4f92-508f-b8a1-9b207c70441d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Klint Kubiak', 'Coach', 'Las Vegas Raiders', 'Active', '{}'::jsonb, 'p125', true),
  ('53814880-5092-5222-8bf2-179de1fb1428', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kirk Cousins', 'QB', 'Las Vegas Raiders', 'Active', '{}'::jsonb, 'p126', true),
  ('54814a13-5192-53b5-a6c9-ec724ee68d0b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Ashton Jeanty', 'RB', 'Las Vegas Raiders', 'Active', '{}'::jsonb, 'p127', true),
  ('61815e8a-5292-5548-88b1-f38fed67039e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tre Tucker', 'WR', 'Las Vegas Raiders', 'Active', '{}'::jsonb, 'p128', true),
  ('6281601d-5392-56db-b43c-038c4a3edb99', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jalen Nailor', 'WR', 'Las Vegas Raiders', 'Active', '{}'::jsonb, 'p129', true),
  ('df84637b-5094-50b9-b026-e5e2dca8548f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Brock Bowers', 'TE', 'Las Vegas Raiders', 'Active', '{}'::jsonb, 'p130', true),
  ('de8461e8-4f94-5f26-95ed-ab4df05b75ec', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jeff Hafley', 'Coach', 'Miami Dolphins', 'Active', '{}'::jsonb, 'p131', true),
  ('e18466a1-4e94-5d93-829d-2ed00ad16f61', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Malik Willis', 'QB', 'Miami Dolphins', 'Active', '{}'::jsonb, 'p132', true),
  ('e084650e-4d94-5c00-97b0-ef938df96506', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'De''Von Achane', 'RB', 'Miami Dolphins', 'Active', '{}'::jsonb, 'p133', true),
  ('e38469c7-5494-5705-b48c-7d761843867b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Malik Washington', 'WR', 'Miami Dolphins', 'Active', '{}'::jsonb, 'p134', true),
  ('e2846834-5394-5572-9a53-42e1abf5de58', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jalen Tolbert', 'WR', 'Miami Dolphins', 'Active', '{}'::jsonb, 'p135', true),
  ('e5846ced-5294-53df-a702-2f44470a720d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Greg Dulcich', 'TE', 'Miami Dolphins', 'Active', '{}'::jsonb, 'p136', true),
  ('e4846b5a-5194-524c-bb78-1f474993cd72', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kevin O''Connell', 'Coach', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p137', true),
  ('d78456e3-5894-5d51-a7fb-1a7a861186d7', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kyler Murray', 'QB', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p138', true),
  ('d6845550-5794-5bbe-ac84-7905988773b4', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Aaron Jones', 'RB', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p139', true),
  ('e586ab84-4ea1-5986-a39f-09e145d392cc', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jordan Mason', 'RB', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p140', true),
  ('e686ad17-4fa1-5b19-bdd8-4476b35e6f6f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Justin Jefferson', 'WR', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p141', true),
  ('e786aeaa-4ca1-5660-84c3-e647e4aeb666', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jordan Addison', 'WR', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p142', true),
  ('e886b03d-4da1-57f3-b04d-f6446186c0c1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'T.J. Hockenson', 'TE', 'Minnesota Vikings', 'Active', '{}'::jsonb, 'p143', true),
  ('e186a538-52a1-5fd2-9f39-724d816ec4b8', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mike Vrabel', 'Coach', 'New England Patriots', 'Active', '{}'::jsonb, 'p144', true),
  ('e286a6cb-53a1-5165-b972-ace26ef8d7db', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Drake Maye', 'QB', 'New England Patriots', 'Active', '{}'::jsonb, 'p145', true),
  ('e386a85e-50a1-5cac-a0fc-b6932049e852', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rhamondre Stevenson', 'RB', 'New England Patriots', 'Active', '{}'::jsonb, 'p146', true),
  ('e486a9f1-51a1-5e3f-8be8-f5d01c83586d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'TreVeyon Henderson', 'RB', 'New England Patriots', 'Active', '{}'::jsonb, 'p147', true),
  ('dd869eec-56a1-561e-ba35-d799ef3cc514', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'A.J. Brown', 'WR', 'New England Patriots', 'Active', '{}'::jsonb, 'p148', true),
  ('de86a07f-57a1-57b1-b50d-decedb89a3b7', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Romeo Doubs', 'WR', 'New England Patriots', 'Active', '{}'::jsonb, 'p149', true),
  ('eb88f38d-54a3-518f-86ef-e47473247d1d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Hunter Henry', 'TE', 'New England Patriots', 'Active', '{}'::jsonb, 'p150', true),
  ('ea88f1fa-53a3-5ffc-9c03-a537764d3c42', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kellen Moore', 'Coach', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p151', true),
  ('e988f067-56a3-54b5-9479-6926459ac60b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tyler Shough', 'QB', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p152', true),
  ('e888eed4-55a3-5322-b9a1-9451d8af4d28', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Travis Etienne', 'RB', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p153', true),
  ('e788ed41-50a3-5b43-a1eb-8040b78a14b1', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Alvin Kamara', 'RB', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p154', true),
  ('e688ebae-4fa3-59b0-b79e-a4c3bb50a496', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Chris Olave', 'WR', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p155', true),
  ('e588ea1b-52a3-5e69-9014-9b1209ff941f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jordyn Tyson', 'WR', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p156', true),
  ('e488e888-51a3-5cd6-b53c-c63d1c7580fc', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Juwan Johnson', 'TE', 'New Orleans Saints', 'Active', '{}'::jsonb, 'p157', true),
  ('e388e6f5-5ca3-5e27-9d86-b22cfc8d7d05', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'John Harbaugh', 'Coach', 'New York Giants', 'Active', '{}'::jsonb, 'p158', true),
  ('e288e562-5ba3-5c94-b339-d6af9fb5a50a', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jaxson Dart', 'QB', 'New York Giants', 'Active', '{}'::jsonb, 'p159', true),
  ('518bd2b6-e29c-5254-8da1-f8b39bd0a3fa', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Cam Skattebo', 'RB', 'New York Giants', 'Active', '{}'::jsonb, 'p160', true),
  ('528bd449-e39c-53e7-b88d-6e707809e1b5', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tyrone Tracy', 'RB', 'New York Giants', 'Active', '{}'::jsonb, 'p161', true),
  ('4f8bcf90-e49c-557a-8bde-b46d5d93e840', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Malik Nabers', 'WR', 'New York Giants', 'Active', '{}'::jsonb, 'p162', true),
  ('508bd123-e59c-570d-a755-23824a802aa3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Darius Slayton', 'WR', 'New York Giants', 'Active', '{}'::jsonb, 'p163', true),
  ('558bd902-de9c-5c08-b2a5-9367e0363b8e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Isaiah Likely', 'TE', 'New York Giants', 'Active', '{}'::jsonb, 'p164', true),
  ('568bda95-df9c-5d9b-9cf2-6ee4bc6f7949', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Theo Johnson', 'TE', 'New York Giants', 'Active', '{}'::jsonb, 'p165', true),
  ('538bd5dc-e09c-5f2e-9043-8281415b17f4', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Aaron Glenn', 'Coach', 'New York Jets', 'Active', '{}'::jsonb, 'p166', true),
  ('548bd76f-e19c-50c1-abb9-f1962ee52b17', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Geno Smith', 'QB', 'New York Jets', 'Active', '{}'::jsonb, 'p167', true),
  ('598bdf4e-da9c-55bc-84d7-930bf26771b2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Breece Hall', 'RB', 'New York Jets', 'Active', '{}'::jsonb, 'p168', true),
  ('5a8be0e1-db9c-574f-b061-a308efde164d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Braelon Allen', 'RB', 'New York Jets', 'Active', '{}'::jsonb, 'p169', true),
  ('578e1abf-e89e-5a5d-b8f2-dfde2082b513', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Garrett Wilson', 'WR', 'New York Jets', 'Active', '{}'::jsonb, 'p170', true),
  ('568e192c-e79e-58ca-beb9-72e93435d670', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Adonai Mitchell', 'WR', 'New York Jets', 'Active', '{}'::jsonb, 'p171', true),
  ('598e1de5-e69e-5737-8b68-5f4c4eabcfe5', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Omar Cooper', 'WR', 'New York Jets', 'Active', '{}'::jsonb, 'p172', true),
  ('588e1c52-e59e-55a4-9fde-4f4ff1d3f7ea', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kenyon Sadiq', 'TE', 'New York Jets', 'Active', '{}'::jsonb, 'p173', true),
  ('538e1473-e49e-5411-b48d-484a05871947', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mason Taylor', 'TE', 'New York Jets', 'Active', '{}'::jsonb, 'p174', true),
  ('528e12e0-e39e-527e-b9b6-0a95189ad6e4', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Nick Sirianni', 'Coach', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p175', true),
  ('558e1799-e29e-50eb-8703-913813109df9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jalen Hurts', 'QB', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p176', true),
  ('548e1606-e19e-5f58-9c18-1b7bb638c5fe', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Saquon Barkley', 'RB', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p177', true),
  ('5f8e2757-e09e-5dc5-825b-dfc617b84f6b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tank Bigsby', 'RB', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p178', true),
  ('5e8e25c4-df9e-5c32-a784-0af1aaccd688', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'DeVonta Smith', 'WR', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p179', true),
  ('5d9062c8-e6ab-532a-ab66-91adbe0c0b00', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Makai Lemon', 'WR', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p180', true),
  ('5e90645b-e7ab-54bd-86dd-00c2aaf84d63', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dallas Goedert', 'TE', 'Philadelphia Eagles', 'Active', '{}'::jsonb, 'p181', true),
  ('5f9065ee-e4ab-5004-ad29-d5f3fc48c6ba', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mike McCarthy', 'Coach', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p182', true),
  ('60906781-e5ab-5197-9815-4bb0d8820475', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Aaron Rodgers', 'QB', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p183', true),
  ('61906914-e2ab-5cde-afcb-5fc1a1d33ab4', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jaylen Warren', 'RB', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p184', true),
  ('62906aa7-e3ab-5e71-8b41-ced68f5d4dd7', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rico Dowdle', 'RB', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p185', true),
  ('63906c3a-e0ab-59b8-922d-70a740ae5e4e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'DK Metcalf', 'WR', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p186', true),
  ('64906dcd-e1ab-5b4b-bc7a-4c241ce79c09', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Michael Pittman', 'WR', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p187', true),
  ('55905630-deab-5692-833a-93e5b541a558', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Pat Freiermuth', 'TE', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p188', true),
  ('569057c3-dfab-5825-bd74-00da218f4d7b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Darnell Washington', 'TE', 'Pittsburgh Steelers', 'Active', '{}'::jsonb, 'p189', true),
  ('6392aad1-ccad-58d3-af55-d420eb5cf551', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mike Macdonald', 'Coach', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p190', true),
  ('6292a93e-cbad-5740-83cb-c4236de71a36', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Sam Darnold', 'QB', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p191', true),
  ('6192a7ab-cead-5bf9-9d7e-2572bc9609bf', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Zach Charbonet', 'RB', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p192', true),
  ('6092a618-cdad-5a66-82a6-509dd0492b1c', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jadarian Price', 'RB', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p193', true),
  ('6792b11d-d0ad-5f1f-931c-3a5426f8273d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jaxson Smith-Njigba', 'WR', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p194', true),
  ('6692af8a-cfad-5d8c-a830-c497aa201ce2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rashid Shaheed', 'WR', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p195', true),
  ('6592adf7-d2ad-5245-a1e3-bd067830722b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'AJ Barner', 'TE', 'Seattle Seahawks', 'Active', '{}'::jsonb, 'p196', true),
  ('6492ac64-d1ad-50b2-870b-e8310b44f948', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kyle Shanahan', 'Coach', 'San Francisco 49ers', 'Active', '{}'::jsonb, 'p197', true),
  ('5b929e39-d4ad-556b-a68b-6e787388c0b9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Brock Purdy', 'QB', 'San Francisco 49ers', 'Active', '{}'::jsonb, 'p198', true),
  ('5a929ca6-d3ad-53d8-bb9f-f8bb16b0e8be', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Christian McCaffrey', 'RB', 'San Francisco 49ers', 'Active', '{}'::jsonb, 'p199', true),
  ('a942c201-f712-5257-b37c-f2b09ad513a5', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Mike Evans', 'WR', 'San Francisco 49ers', 'Active', '{}'::jsonb, 'p200', true),
  ('a842c06e-f612-50c4-8891-7cf33dfd3baa', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Ricky Pearsall', 'WR', 'San Francisco 49ers', 'Active', '{}'::jsonb, 'p201', true),
  ('a742bedb-f912-557d-a244-a7c26cabf8d3', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'George Kittle', 'TE', 'San Francisco 49ers', 'Active', '{}'::jsonb, 'p202', true),
  ('a642bd48-f812-53ea-86ce-38ad805f1a30', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Todd Bowles', 'Coach', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p203', true),
  ('ad42c84d-f312-5c0b-97e1-f3245f39e1b9', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Baker Mayfield', 'QB', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p204', true),
  ('ac42c6ba-f212-5a78-ad95-17a7026209be', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Bucky Irving', 'RB', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p205', true),
  ('ab42c527-f512-5f31-a6a9-75d651b05d07', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Kenneth Gainwell', 'RB', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p206', true),
  ('aa42c394-f412-5d9e-8b33-06c164c41aa4', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Chris Godwin', 'WR', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p207', true),
  ('a142b569-ef12-55bf-ab51-274812a9483d', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Emeka Egbuka', 'WR', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p208', true),
  ('a042b3d6-ee12-542c-bfc7-174b95d13de2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Cade Otton', 'TE', 'Tampa Bay Buccaneers', 'Active', '{}'::jsonb, 'p209', true),
  ('a34079f8-f110-5a4e-b02c-4a7d8d845bb4', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Robert Saleh', 'Coach', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p210', true),
  ('a4407b8b-f210-5be1-8b04-1f527b0e6ed7', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Cam Ward', 'QB', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p211', true),
  ('a5407d1e-ef10-5728-b28e-29032c5f7f4e', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tony Pollard', 'RB', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p212', true),
  ('a6407eb1-f010-58bb-9cdb-04800898bd09', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Tyjae Spears', 'RB', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p213', true),
  ('a7408044-f510-509a-b491-1891a9bd2c00', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Carnell Tate', 'WR', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p214', true),
  ('a84081d7-f610-522d-8f68-ed6696a96e63', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Wan''Dale Robinson', 'WR', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p215', true),
  ('a940836a-f310-5d74-96f3-2977e7f9e7ba', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Gunnar Helm', 'TE', 'Tennessee Titans', 'Active', '{}'::jsonb, 'p216', true),
  ('aa4084fd-f410-5f07-81df-68b4c4332575', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Dan Quinn', 'Coach', 'Washington Commanders', 'Active', '{}'::jsonb, 'p217', true),
  ('9b406d60-e90f-5db6-8800-4cb5e5585dec', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jayden Daniels', 'QB', 'Washington Commanders', 'Active', '{}'::jsonb, 'p218', true),
  ('9c406ef3-ea0f-5f49-82d8-53ead1a53c8f', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Jacory Croskey-Merritt', 'RB', 'Washington Commanders', 'Active', '{}'::jsonb, 'p219', true),
  ('1547e933-6b0c-58c5-ba16-fa7a124e775b', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Rachaad White', 'RB', 'Washington Commanders', 'Active', '{}'::jsonb, 'p220', true),
  ('1447e7a0-6a0c-5732-bea0-590524c46438', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Terry McLaurin', 'WR', 'Washington Commanders', 'Active', '{}'::jsonb, 'p221', true),
  ('1747ec59-690c-559f-8b50-0ee8bfd8f7ed', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Luke McCaffrey', 'WR', 'Washington Commanders', 'Active', '{}'::jsonb, 'p222', true),
  ('1647eac6-680c-540c-a102-69ebc39f87d2', '8ea81188-8bb6-5aae-bef2-fba50410aa24', 'Chig Okonkwo', 'TE', 'Washington Commanders', 'Active', '{}'::jsonb, 'p223', true);

insert into periods (id, season_id, type, number, phase, roster_locked, participant_team_ids, finalized_at) values
  ('2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '4727208d-93cc-5aef-bde8-c1cc766d085d', 'week', 1, 'finalized', true, '{"54ec4358-196a-5fce-b767-db2db2221244","5bec4e5d-1c6a-5487-887b-95a4696f7645","5aec4cca-1b6a-52f4-9e2e-ba270c979e4a","55ec44eb-1a6a-5161-92de-4a421f0d8b27","58ec49a4-1d6a-561a-bbcc-a941cdbd11d0","57ec4811-186a-5e3b-a416-9530add50dd9"}', NULL),
  ('29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '4727208d-93cc-5aef-bde8-c1cc766d085d', 'week', 2, 'stats', true, '{"58ec49a4-1d6a-561a-bbcc-a941cdbd11d0","5bec4e5d-1c6a-5487-887b-95a4696f7645","5aec4cca-1b6a-52f4-9e2e-ba270c979e4a","55ec44eb-1a6a-5161-92de-4a421f0d8b27","54ec4358-196a-5fce-b767-db2db2221244","57ec4811-186a-5e3b-a416-9530add50dd9"}', NULL);

insert into team_totals (id, season_id, team_id, scope, standings_points, week_wins, coach_wins, total_tds, total_yards, best_player) values
  ('8e5baf6c-7ed9-5a52-ab7c-2ff179e110f8', '4727208d-93cc-5aef-bde8-c1cc766d085d', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'regular', 2, 0, 0, 4, 446, '{"name":"Ricky Pearsall","position":"WR","points":20,"periodLabel":"Week 1"}'::jsonb),
  ('7fa1513f-da80-590d-a4ac-0a0673acf043', '4727208d-93cc-5aef-bde8-c1cc766d085d', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'playoff', 0, 0, 0, 0, 0, NULL),
  ('35e45d41-0876-5c8b-a06f-bfd006244ff9', '4727208d-93cc-5aef-bde8-c1cc766d085d', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'regular', 5, 0, 0, 6, 589, '{"name":"Brock Purdy","position":"QB","points":30,"periodLabel":"Week 1"}'::jsonb),
  ('27b0a31a-bb51-5e24-a35a-2fcf4b52626a', '4727208d-93cc-5aef-bde8-c1cc766d085d', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'playoff', 0, 0, 0, 0, 0, NULL),
  ('170e8dfe-ea2b-58b0-8a5b-f7f3775b7c96', '4727208d-93cc-5aef-bde8-c1cc766d085d', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'regular', 4, 0, 1, 6, 462, '{"name":"Patrick Mahomes","position":"QB","points":33,"periodLabel":"Week 1"}'::jsonb),
  ('6ddc8d19-5c18-5c23-a9c4-71989af92251', '4727208d-93cc-5aef-bde8-c1cc766d085d', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'playoff', 0, 0, 0, 0, 0, NULL),
  ('b648b88b-8811-5141-9a6d-aaaab58be4d7', '4727208d-93cc-5aef-bde8-c1cc766d085d', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'regular', 3, 0, 1, 4, 501, '{"name":"C.J. Stroud","position":"QB","points":19,"periodLabel":"Week 1"}'::jsonb),
  ('69246a24-79dd-571a-b4df-10f146ed4420', '4727208d-93cc-5aef-bde8-c1cc766d085d', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'playoff', 0, 0, 0, 0, 0, NULL),
  ('97fe04b0-693b-51fe-9afb-222d28fe2da4', '4727208d-93cc-5aef-bde8-c1cc766d085d', '54ec4358-196a-5fce-b767-db2db2221244', 'regular', 6, 1, 0, 8, 677, '{"name":"Justin Herbert","position":"QB","points":50,"periodLabel":"Week 1"}'::jsonb),
  ('09eb5823-c009-5119-a19c-262253750dcf', '4727208d-93cc-5aef-bde8-c1cc766d085d', '54ec4358-196a-5fce-b767-db2db2221244', 'playoff', 0, 0, 0, 0, 0, NULL),
  ('9120b805-a57c-5087-b594-f28c076cd515', '4727208d-93cc-5aef-bde8-c1cc766d085d', '57ec4811-186a-5e3b-a416-9530add50dd9', 'regular', 1, 0, 0, 5, 365, '{"name":"Tua Tagovailoa","position":"QB","points":26,"periodLabel":"Week 1"}'::jsonb),
  ('afdf06ce-d8c5-5fd0-9a0c-47bb9db66a76', '4727208d-93cc-5aef-bde8-c1cc766d085d', '57ec4811-186a-5e3b-a416-9530add50dd9', 'playoff', 0, 0, 0, 0, 0, NULL);

insert into roster_slots (id, period_id, team_id, area, slot, bench_index, player_id, locked) values
  ('20db13e3-a04e-58c5-a3e2-685228effd5b', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'starter', 'Coach', NULL, '557f0d0f-e29a-53bd-9a2e-327e008496f3', false),
  ('f20c7b58-e2b4-520e-90e7-5615fa1cd604', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'starter', 'QB', NULL, '6292a93e-cbad-5740-83cb-c4236de71a36', false),
  ('01fd89fe-d2c2-5368-a303-b243c0837f3e', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'starter', 'WR', NULL, 'a84081d7-f610-522d-8f68-ed6696a96e63', false),
  ('4c09376f-d4ba-57c9-a952-930e18a658cf', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'starter', 'RB', NULL, 'a99c8e7d-1f11-5b67-8f41-cbac88c6d8f5', false),
  ('05044a7c-99c0-5b16-b1b6-d20906046b0c', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'starter', 'TE', NULL, 'a99ecd14-1f13-59fe-99d2-9e392957ce24', false),
  ('3be7f598-7657-5a2e-a24a-b92d77d3b984', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'starter', 'FLEX', NULL, '9a9c76e0-1411-5a16-a6f7-dfbda9ec116c', false),
  ('691fac06-3351-505c-a197-2c5b22af59e2', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'bench', NULL, 0, 'e388e6f5-5ca3-5e27-9d86-b22cfc8d7d05', false),
  ('6a1fad99-3451-51ef-8c82-a2189f87643d', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'bench', NULL, 1, '507cc699-d597-50af-9060-8aa81dac603d', false),
  ('671fa8e0-3551-5382-8072-4ff583d43648', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'bench', NULL, 2, '9b9c7873-1511-5ba9-81cf-b4929638f00f', false),
  ('681faa73-3651-5515-bb4a-572af0bfaf2b', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'bench', NULL, 3, '2892c90e-8df4-5510-9f66-50cb956a9546', false),
  ('6d1fb252-2f51-5a10-a69b-5e2fe6765736', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'bench', NULL, 4, '5e90645b-e7ab-54bd-86dd-00c2aaf84d63', false),
  ('6e1fb3e5-3051-5ba3-90e8-39ac63ec3251', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'bench', NULL, 5, '537f09e9-dc9a-5a4b-a701-af58f3127fd9', false),
  ('ecea46e6-ee8e-5ca4-8145-80f31890f02a', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'starter', 'Coach', NULL, '6492ac64-d1ad-50b2-870b-e8310b44f948', false),
  ('7221ecd7-cdcd-5e51-bedf-f2d6b1202097', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'starter', 'QB', NULL, '53814880-5092-5222-8bf2-179de1fb1428', false),
  ('3a1d1781-25d3-5607-9d5a-b83006c1fa45', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'starter', 'WR', NULL, '2c92cf5a-91f4-5b5c-a3cb-1edf5104fdb2', false),
  ('182530c0-dbc7-5896-927c-a87de5f010ec', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'starter', 'RB', NULL, 'ab42c527-f512-5f31-a6a9-75d651b05d07', false),
  ('3b165d4f-c2d6-5bc5-8339-3a5e11139e2b', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'starter', 'TE', NULL, 'e886b03d-4da1-57f3-b04d-f6446186c0c1', false),
  ('9d497cbb-ce20-5265-9f37-b852088f830b', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'starter', 'FLEX', NULL, '9b8fac80-9cfa-5872-9d21-ab2d5c3ab2d8', false),
  ('3b74418b-05eb-532d-bbdd-4492c6439d03', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'bench', NULL, 0, 'a34079f8-f110-5a4e-b02c-4a7d8d845bb4', false),
  ('3a743ff8-04eb-519a-a105-6fbd59582420', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'bench', NULL, 1, '9b406d60-e90f-5db6-8800-4cb5e5585dec', false),
  ('3d7444b1-03eb-5007-8db4-29c0750b5215', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'bench', NULL, 2, '9a88ef28-13fd-525e-bd18-6c95200c0724', false),
  ('3c74431e-02eb-5e74-a367-4e439794dfda', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'bench', NULL, 3, '548e1606-e19e-5f58-9c18-1b7bb638c5fe', false),
  ('3f7447d7-01eb-5ce1-8042-12a6aaa89d77', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'bench', NULL, 4, '558bd902-de9c-5c08-b2a5-9367e0363b8e', false),
  ('3e744644-00eb-5b4e-a56a-3dd1be5bbed4', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'bench', NULL, 5, '998d6ac3-9ef8-5d01-992b-c66a6bbc2d67', false),
  ('db7a11b1-0042-59e7-a97f-6218666fea15', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'starter', 'Coach', NULL, '9a8d6c56-9bf8-5848-bf78-9b9b9dabd81e', false),
  ('91e516da-ba81-525c-b71c-65a71f7e50b2', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'starter', 'QB', NULL, '1b9731c5-0cee-5ccf-af54-167c2d404fad', false),
  ('31e0028c-7a86-5dca-a661-9d4101cb2080', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'starter', 'WR', NULL, '508bd123-e59c-570d-a755-23824a802aa3', false),
  ('83ebbc95-947e-57f3-86ff-8acc6de1d091', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'starter', 'RB', NULL, '1547e933-6b0c-58c5-ba16-fa7a124e775b', false),
  ('20dda932-758d-51b0-8304-c42f74460c66', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'starter', 'TE', NULL, '3095143d-99f6-568b-a5f7-1d0c23e1c1e9', false),
  ('37317ab2-af29-50f4-8fd3-1567014a0a4a', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'starter', 'FLEX', NULL, '5b7f1681-d49a-5db3-afcc-150069a97ff1', false),
  ('77b75a30-0a2c-5b92-a42f-28c5ca834678', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'bench', NULL, 0, '56814d39-4f92-508f-b8a1-9b207c70441d', false),
  ('78b75bc3-0b2c-5d25-9fa5-ca3ab80d599b', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'bench', NULL, 1, 'e286a6cb-53a1-5165-b972-ace26ef8d7db', false),
  ('79b75d56-082c-586c-8691-39ab695e6a12', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'bench', NULL, 2, '578e1abf-e89e-5a5d-b8f2-dfde2082b513', false),
  ('7ab75ee9-092c-59ff-b0de-dea86597da2d', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'bench', NULL, 3, '9c406ef3-ea0f-5f49-82d8-53ead1a53c8f', false),
  ('7bb7607c-062c-5546-a894-c0598ee8148c', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'bench', NULL, 4, 'e488e888-51a3-5cd6-b53c-c63d1c7580fc', false),
  ('7cb7620f-072c-56d9-a36c-c78efc72f12f', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'bench', NULL, 5, 'e486a9f1-51a1-5e3f-8be8-f5d01c83586d', false),
  ('dbeb7bf4-5c7c-59d6-9fbb-6e29b02e43fc', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'starter', 'Coach', NULL, 'ea88f1fa-53a3-5ffc-9c03-a537764d3c42', false),
  ('59ff28a1-d8ad-50c7-a467-0e70713b9ba5', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'starter', 'QB', NULL, '289507a5-91f6-59f3-8e23-1ad41b175c41', false),
  ('12033477-80a8-5911-a224-7cf60ef29df7', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'starter', 'WR', NULL, 'dd869eec-56a1-561e-ba35-d799ef3cc514', false),
  ('e7f7b966-7eaf-51b0-9483-e94ba376b606', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'starter', 'RB', NULL, 'a5407d1e-ef10-5728-b28e-29032c5f7f4e', false),
  ('4f05d315-a1a0-5e3f-b9a7-1f44e5533d1d', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'starter', 'TE', NULL, '9c8d6f7c-a1f8-51ba-a21a-bc891a6bb410', false),
  ('2fe9c6b5-9d08-526b-a7fa-5ecce028a3e9', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'starter', 'FLEX', NULL, '2d950f84-9af6-581e-9948-30a9a8cd6094', false),
  ('f237ed7d-4f27-573b-b85b-16b438c179a9', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'bench', NULL, 0, '2f9512aa-98f6-54f8-ba6d-0d0f466b4fae', false),
  ('f137ebea-4e27-55a8-8d6e-d7775b4b076e', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'bench', NULL, 1, '9b9a39dc-0cf1-5b66-93a5-e4812d32783c', false),
  ('f037ea57-5127-5a61-85e4-9b66a9f9f6f7', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'bench', NULL, 2, '5d9062c8-e6ab-532a-ab66-91adbe0c0b00', false),
  ('ef37e8c4-5027-58ce-ab0c-c691bdad1854', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'bench', NULL, 3, '18972d0c-0dee-5e62-a2a5-2a19922bbbf8', false),
  ('ee37e731-5327-5d87-9356-b280745cab95', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'bench', NULL, 4, 'a940836a-f310-5d74-96f3-2977e7f9e7ba', false),
  ('ed37e59e-5227-5bf4-a909-d70396e6395a', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 'bench', NULL, 5, '6281601d-5392-56db-b43c-038c4a3edb99', false),
  ('a4bc6a77-5bec-54e1-badf-6cded8296817', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'starter', 'Coach', NULL, 'e4846b5a-5194-524c-bb78-1f474993cd72', false),
  ('ffb42c2c-786f-514a-bc27-2421beb7d6e0', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'starter', 'QB', NULL, '60906781-e5ab-5197-9815-4bb0d8820475', false),
  ('dfba09fa-b86a-55dc-9c72-fc67e092f0f2', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'starter', 'WR', NULL, 'a842c06e-f612-50c4-8891-7cf33dfd3baa', false),
  ('d9b1b1c3-6a76-5705-874d-6c5af139cbcb', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'starter', 'RB', NULL, 'a6407eb1-f010-58bb-9cdb-04800898bd09', false),
  ('bac08b80-8767-5a22-98de-5b8580737278', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'starter', 'TE', NULL, '57814ecc-4c92-5bd6-9057-af3125c147fc', false),
  ('47372504-e90b-5322-8610-7e0166110ef8', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'starter', 'FLEX', NULL, '5e8e25c4-df9e-5c32-a784-0af1aaccd688', false),
  ('e05a0d62-d1bd-5d20-8806-a9bf8e6258e6', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'bench', NULL, 0, '538bd5dc-e09c-5f2e-9043-8281415b17f4', false),
  ('e15a0ef5-d2bd-5eb3-b253-853c0b3a6341', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'bench', NULL, 1, 'a98fc28a-9efa-5b98-9a7f-57dfe7a76bce', false),
  ('de5a0a3c-d3bd-5046-a5a4-98d9ef87354c', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'bench', NULL, 2, '527cc9bf-d397-5d89-82ee-738eb34a42bf', false),
  ('df5a0bcf-d4bd-51d9-a07c-a00e5d1211ef', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'bench', NULL, 3, 'a89c8cea-1e11-59d4-a4f4-f02fac8d9b3a', false),
  ('dc5a0716-d5bd-536c-83a1-122bc9fd8ad2', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'bench', NULL, 4, 'e5846ced-5294-53df-a702-2f44470a720d', false),
  ('dd5a08a9-d6bd-54ff-adee-b728c636faed', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '54ec4358-196a-5fce-b767-db2db2221244', 'bench', NULL, 5, '528bd449-e39c-53e7-b88d-6e707809e1b5', false),
  ('a221d57a-c635-5500-b760-a21f71361106', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'starter', 'Coach', NULL, '557cce78-de97-5eda-ad1a-070d8b623230', false),
  ('3f7b1a0b-92a8-56ad-832b-1d22e8f71573', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'starter', 'QB', NULL, '547f0b7c-e19a-522a-9eb8-5a8912fa83d0', false),
  ('1789e59d-3a9a-549b-840c-1ad489ddb5d9', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'starter', 'WR', NULL, '2292bf9c-9bf4-5b1a-aad2-4041bc317440', false),
  ('657d9474-20a0-5772-ab5e-7a695713ed28', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'starter', 'RB', NULL, '5f8e2757-e09e-5dc5-825b-dfc617b84f6b', false),
  ('30835133-4f9c-5441-9df6-d31a3d988c07', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'starter', 'TE', NULL, 'df84637b-5094-50b9-b026-e5e2dca8548f', false),
  ('b67b71a7-8d40-5029-ae3a-bee6c1fe92cf', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'starter', 'FLEX', NULL, '5a7f14ee-d39a-5c20-857f-39836d700fd6', false),
  ('ec834e97-54dc-5621-9f89-0866f8c758b7', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'bench', NULL, 0, 'f4cf6d00-f221-56d2-8f88-79c57f566158', false),
  ('eb834d04-53dc-548e-84b1-33910c7a7a14', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'bench', NULL, 1, '2e951117-9bf6-59b1-9381-9d9e951a3f37', false),
  ('ee8351bd-52dc-52fb-91ff-83b4878edb69', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'bench', NULL, 2, '517f06c3-de9a-5d71-95c9-646a644afd27', false),
  ('ed83502a-51dc-5168-a713-4477aa18692e', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'bench', NULL, 3, '6092a618-cdad-5a66-82a6-509dd0492b1c', false),
  ('e883484b-58dc-5c6d-9b24-3a5214625843', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'bench', NULL, 4, 'a742bedb-f912-557d-a244-a7c26cabf8d3', false),
  ('e78346b8-57dc-5ada-804c-657da776df60', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '57ec4811-186a-5e3b-a416-9530add50dd9', 'bench', NULL, 5, 'a59ec6c8-2313-504a-956d-d02544f2cdb0', false);

insert into stat_lines (id, period_id, team_id, slot, player_id, yards, tds, coach_result, source) values
  ('1d5aafbe-ff13-5dc4-acde-29c36df8935a', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'Coach', '557f0d0f-e29a-53bd-9a2e-327e008496f3', NULL, NULL, 'Loss', 'manual'),
  ('a96332ff-34c0-5cb1-81bd-4ca69be2d407', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'QB', '6292a93e-cbad-5740-83cb-c4236de71a36', 257, 2, NULL, 'manual'),
  ('715e5da9-0cc5-5de7-849f-41e027a830d5', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'WR', 'a84081d7-f610-522d-8f68-ed6696a96e63', 65, 0, NULL, 'manual'),
  ('cf65ad68-42b9-56f6-9697-36cde9ff795c', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'RB', 'a99c8e7d-1f11-5b67-8f41-cbac88c6d8f5', 19, 1, NULL, 'manual'),
  ('72561077-29c8-5a25-a0a0-7dae95c1a0db', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'TE', 'a99ecd14-1f13-59fe-99d2-9e392957ce24', 93, 1, NULL, 'manual'),
  ('6d095fc3-1af6-5bc5-b8e7-bb225726d8fb', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 'FLEX', '9a9c76e0-1411-5a16-a6f7-dfbda9ec116c', 31, 2, NULL, 'manual'),
  ('714ad2c7-8cce-5aa9-8243-f9ce1f4005cf', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'Coach', '6492ac64-d1ad-50b2-870b-e8310b44f948', NULL, NULL, 'Win', 'manual'),
  ('6a079efc-48e9-57c2-ab41-0c910773dfe8', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'QB', '53814880-5092-5222-8bf2-179de1fb1428', 230, 0, NULL, 'manual'),
  ('aa0c80ea-08e4-55d4-bbfb-d4f7429baefa', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'WR', '2c92cf5a-91f4-5b5c-a3cb-1edf5104fdb2', 102, 0, NULL, 'manual'),
  ('44052493-3aef-5d7d-b705-ef0ab2a3bd33', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'RB', 'ab42c527-f512-5f31-a6a9-75d651b05d07', 11, 2, NULL, 'manual'),
  ('a514c7d0-57e0-509a-8936-41f541dd63e0', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'TE', 'e886b03d-4da1-57f3-b04d-f6446186c0c1', 106, 1, NULL, 'manual'),
  ('0702ae94-6962-551a-a5d3-0ff19c8a2ce0', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 'FLEX', '9b8fac80-9cfa-5872-9d21-ab2d5c3ab2d8', 41, 2, NULL, 'manual'),
  ('157ee7f8-501d-5eba-b461-d14d0b16ddd0', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'Coach', '9a8d6c56-9bf8-5848-bf78-9b9b9dabd81e', NULL, NULL, 'Win', 'manual'),
  ('438ec615-ed17-5c4b-93f5-ea142c8d2719', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'QB', '1b9731c5-0cee-5ccf-af54-167c2d404fad', 310, 1, NULL, 'manual'),
  ('eb80c403-c526-57dd-9314-ec62618ac3d3', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'WR', '508bd123-e59c-570d-a755-23824a802aa3', 40, 0, NULL, 'manual'),
  ('5188205a-1319-56b4-a412-928ffe29d99a', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'RB', '1547e933-6b0c-58c5-ba16-fa7a124e775b', 100, 1, NULL, 'manual'),
  ('008323a9-de1d-5073-812f-25e87d8cc921', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'TE', '3095143d-99f6-568b-a5f7-1d0c23e1c1e9', 62, 1, NULL, 'manual'),
  ('70821c31-bec2-52e7-b934-b308a2225f95', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'FLEX', '5b7f1681-d49a-5db3-afcc-150069a97ff1', 75, 1, NULL, 'manual');

insert into period_results (id, period_id, team_id, rank, raw_score, standings_points, coach_result, tds, yards, best_player) values
  ('06ce6388-a859-5c2a-9f16-211d81bc9150', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '54ec4358-196a-5fce-b767-db2db2221244', 1, 106, 6, 'Tie', 8, 677, '{"name":"Justin Herbert","position":"QB","points":50}'::jsonb),
  ('4f6149ba-0a17-5ce8-83bd-25ffa39f7a0e', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '5bec4e5d-1c6a-5487-887b-95a4696f7645', 2, 87, 5, 'Tie', 6, 589, '{"name":"Brock Purdy","position":"QB","points":30}'::jsonb),
  ('bd4062a8-04de-596a-8067-15859b4f2da0', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 3, 76, 4, 'Win', 6, 462, '{"name":"Patrick Mahomes","position":"QB","points":33}'::jsonb),
  ('43e13df3-3412-53f1-b833-d082801c5b57', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '55ec44eb-1a6a-5161-92de-4a421f0d8b27', 4, 70, 3, 'Win', 4, 501, '{"name":"C.J. Stroud","position":"QB","points":19}'::jsonb),
  ('7e4ef025-eaf7-588f-82d3-fb9421618bfd', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', 5, 62, 2, 'Loss', 4, 446, '{"name":"Ricky Pearsall","position":"WR","points":20}'::jsonb),
  ('f74a9582-b52d-5490-9855-68074dab8606', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', '57ec4811-186a-5e3b-a416-9530add50dd9', 6, 60, 1, 'Tie', 5, 365, '{"name":"Tua Tagovailoa","position":"QB","points":26}'::jsonb);

insert into events (id, season_id, period_id, type, text, payload, created_at) values
  ('e09fa3a2-8dfc-5628-b95c-036f9f114b9e', '4727208d-93cc-5aef-bde8-c1cc766d085d', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', 'block', 'Gridiron Gamblers blocked Jalen Hurts (QB) from being stolen this week.', '{}'::jsonb, '2026-08-18T05:23:21.214Z'),
  ('0feacf7f-94c9-5ce9-92ad-3cb61f7a000f', '4727208d-93cc-5aef-bde8-c1cc766d085d', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', 'steal', 'Dead Man''s Hand stole TE Dalton Schultz from All-In Antlers (dropped Brock Bowers). All-In Antlers received Colby Parkinson (free agent) in return.', '{}'::jsonb, '2026-08-18T05:23:21.220Z'),
  ('ce556b96-a56d-586c-bd93-6c1b9daf51f2', '4727208d-93cc-5aef-bde8-c1cc766d085d', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', 'steal', 'Full House Flyers stole QB Brock Purdy from All-In Antlers (dropped Drake Maye). All-In Antlers received Tua Tagovailoa (free agent) in return.', '{}'::jsonb, '2026-08-18T05:23:21.220Z'),
  ('a84ecb58-48e6-5c7e-a1b7-a295875cf934', '4727208d-93cc-5aef-bde8-c1cc766d085d', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', 'redraw', 'Royal Flush Runners redrew Ja''Marr Chase (WR) for Rashid Shaheed (free agent).', '{}'::jsonb, '2026-08-18T05:23:21.220Z'),
  ('00b7330d-9049-5b5b-947f-7754fd2099c9', '4727208d-93cc-5aef-bde8-c1cc766d085d', '2c309ff5-8bbf-5cbb-83a5-700cf62ee989', 'result', 'Week 1 final - #1 Dead Man''s Hand (106 pts), #2 Full House Flyers (87 pts), #3 Royal Flush Runners (76 pts), #4 Pocket Aces (70 pts), #5 Gridiron Gamblers (62 pts), #6 All-In Antlers (60 pts). Winner: Dead Man''s Hand!', '{}'::jsonb, '2026-08-18T05:23:21.222Z'),
  ('f7d0e57e-33a9-50e0-9eca-c62b5b06afc6', '4727208d-93cc-5aef-bde8-c1cc766d085d', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', 'block', 'Royal Flush Runners blocked Darius Slayton (WR) from being stolen this week.', '{}'::jsonb, '2026-08-18T05:23:21.222Z'),
  ('1ee95275-434d-567f-b6dd-492ce89a797d', '4727208d-93cc-5aef-bde8-c1cc766d085d', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', 'redraw', 'Gridiron Gamblers redrew Woody Marks (RB) for Chris Rodriguez (free agent).', '{}'::jsonb, '2026-08-18T05:23:21.222Z'),
  ('465b510d-01e4-53d3-880f-c2ec28dc75b1', '4727208d-93cc-5aef-bde8-c1cc766d085d', '29309b3c-8cbf-5e4e-b6f6-83a97b1a8834', 'steal', 'All-In Antlers stole QB Matthew Stafford from Royal Flush Runners (dropped Lamar Jackson). Royal Flush Runners received Jordan Love (free agent) in return.', '{}'::jsonb, '2026-08-18T05:23:21.222Z');

insert into league_secrets (league_id, commissioner_code_hash) values
  ('8ea81188-8bb6-5aae-bef2-fba50410aa24', 'a7717ebb54c2db892736ce430108fe7d872809907b1589e08f297fbd7f2e6e70');

insert into team_secrets (team_id, join_code_hash) values
  ('58ec49a4-1d6a-561a-bbcc-a941cdbd11d0', '454cf237ac19edb425a9c22b92342efe7ea6c692123fdefb79153d9ca36ebdb8'),
  ('5bec4e5d-1c6a-5487-887b-95a4696f7645', 'a8ff3626d8db2b25deac06190d4f8b88ea62ae2ab2b36b780b057c6dbea68a29'),
  ('5aec4cca-1b6a-52f4-9e2e-ba270c979e4a', 'dda80ad91911d28e338f64c99a8aae9edbc5378c7cd3c139bfcfacba38935ea2'),
  ('55ec44eb-1a6a-5161-92de-4a421f0d8b27', '67c78b9cc0d890ddd214ebb09878e819051173024faa7e8ef92f51d61050d911'),
  ('54ec4358-196a-5fce-b767-db2db2221244', 'ace5134a603f00a1633b6f2904bca9193ff2289d2a58af450778421f4dd2d57a'),
  ('57ec4811-186a-5e3b-a416-9530add50dd9', '9fcb647bbbca09afb44392d4cb746159065e7b18d88a81e052779bb898966bee');

-- ---------------------------------------------------------------------------
--  Sanity check: fail loudly if the seed did not land as expected, rather than
--  leaving a half-populated database that looks fine until someone logs in.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n_teams int; n_players int; n_slots int; n_results int;
begin
  select count(*) into n_teams   from teams;
  select count(*) into n_players from players;
  select count(*) into n_slots   from roster_slots;
  select count(*) into n_results from period_results;

  if n_teams <> 6 or n_players <> 223
     or n_slots <> 72 or n_results <> 6 then
    raise exception 'SEED VERIFICATION FAILED: teams=% players=% slots=% results=%',
      n_teams, n_players, n_slots, n_results;
  end if;

  raise notice 'Pigskin Poker demo league seeded: % teams, % players, % roster slots.',
    n_teams, n_players, n_slots;
end
$verify$;
