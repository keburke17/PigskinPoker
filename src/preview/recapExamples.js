/* Sample weekly recaps - hand-written, for Scott to judge the idea and the look.
 *
 * All twelve are the SAME week (Week 6) told from each team's side, so the jabs line up:
 * the Gangsters' heist is the Cowboys' robbery, the receiver Mahomes Alone dropped is the
 * one the Flyers redrew, and so on. None of this is generated from real stats yet - if
 * the recap is built, these are the tone and the shape it is aiming at.
 *
 * Shape of one recap:
 *   place / of / score       - the week's finish
 *   points                   - standings points the finish earned (12 for 1st .. 1 for 12th)
 *   rankNow / rankMove       - where the team now sits overall, and how far it moved
 *   margin                   - one line on how close it was
 *   headline / story         - the write-up
 *   mvp / dud                - best and worst starter
 *   notes                    - the moments: kind is one of
 *                              steal, redraw, block, bench, injury, close, league
 *
 * Source stays ASCII (CLAUDE.md), so the glyphs live in the component, keyed on `kind`.
 */

export const RECAP_EXAMPLES = [
  {
    id: "first-heist",
    label: "1st - the heist",
    team: "Gridiron Gangsters",
    week: 6,
    place: 1,
    of: 12,
    score: 142.6,
    points: 12,
    rankNow: 2,
    rankMove: 3,
    margin: "Won the week by 0.3 over Pocket Aces",
    headline: "Somebody Check This Man's Search History",
    story:
      "You stole Bijan Robinson off the Couch Cowboys. He put up 31.4 for you, the Cowboys finished dead last, and you won the week. You didn't just win, you robbed the guy in last place on your way out the door.",
    mvp: { name: "Bijan Robinson", pos: "RB", pts: 31.4, note: "Stolen goods" },
    dud: { name: "Kyle Pitts", pos: "TE", pts: 3.2, note: "Still waiting on the breakout" },
    notes: [
      { kind: "steal", title: "The steal of the week", text: "Steal: RB. You got Bijan Robinson from the team that finished 12th. He scored more on your roster than four of their starters put together." },
      { kind: "close", title: "By a hair", text: "Pocket Aces finished 0.3 behind you. Three-tenths. One extra yard from anybody and this recap is about them." },
      { kind: "league", title: "Around the league", text: "The Couch Cowboys would like their running back back. They would also like to stop finishing 12th." },
    ],
  },
  {
    id: "second-photo",
    label: "2nd - lost by 0.3",
    team: "Pocket Aces",
    week: 6,
    place: 2,
    of: 12,
    score: 142.3,
    points: 11,
    rankNow: 1,
    rankMove: 0,
    margin: "Lost the week by 0.3",
    headline: "Three-Tenths of a Point. Three. Tenths.",
    story:
      "A monster week, and it wasn't enough. Your Coach card was the Lions, who lost on a 58-yard field goal as time expired. A tie would have been worth 1 point, and you lost the week by 0.3. Dan Campbell owes you a fruit basket.",
    mvp: { name: "Ja'Marr Chase", pos: "WR", pts: 29.9, note: "Did his part" },
    dud: { name: "Dan Campbell", pos: "Coach", pts: 0, note: "Went for it on 4th and 9. Twice." },
    notes: [
      { kind: "close", title: "So close it hurts", text: "142.3 would have won 9 of the last 10 weeks in this league. This week it got you a silver medal and a long Tuesday." },
      { kind: "bench", title: "Bench check", text: "Your bench scored 14.0. Nothing to see here, which is honestly the most painful part - you did everything right." },
      { kind: "league", title: "The good news", text: "You're still 1st overall. The Gangsters are coming, though, and they're stealing on the way." },
    ],
  },
  {
    id: "third-bench",
    label: "3rd - bench outscored a starter",
    team: "Hail Mary Poppins",
    week: 6,
    place: 3,
    of: 12,
    score: 118.9,
    points: 10,
    rankNow: 4,
    rankMove: -1,
    margin: "23.7 behind 1st",
    headline: "Close, But the Bench Had Other Plans",
    story:
      "A strong week, and it could have been a winning one. Your bench WR scored 27.8 while your starting WR scored 4.1. That is a 23.7-point swing, which is exactly how far you finished behind 1st. You'd have tied for the week. Think about that until Sunday.",
    mvp: { name: "Saquon Barkley", pos: "RB", pts: 24.6, note: "Hurdled a linebacker. Again." },
    dud: { name: "Rashid Shaheed", pos: "WR", pts: 4.1, note: "Started over a 27.8" },
    notes: [
      { kind: "bench", title: "Bench Mob", text: "Garrett Wilson scored 27.8 on your bench. Bench points don't count, so that was 27.8 points of nothing, performed beautifully." },
      { kind: "block", title: "Your block", text: "You blocked Saquon and nobody even tried to steal him. Safe and sound, like locking your car in your own garage." },
      { kind: "league", title: "Around the league", text: "At least you're not Sofa King Good, who blocked a tight end that scored 1.8. Nobody was coming for him. Nobody." },
    ],
  },
  {
    id: "fourth-block",
    label: "4th - the block that paid off",
    team: "Dead Man's Hand",
    week: 6,
    place: 4,
    of: 12,
    score: 112.4,
    points: 9,
    rankNow: 3,
    rankMove: 1,
    margin: "6.5 behind 3rd",
    headline: "Big-Brain Block, We're Writing It Down",
    story:
      "You blocked Josh Allen, and he threw four touchdowns. Without that block he was the best QB in the steal pool, and Royal Flush Runners went fishing for a QB this week. For once in your life you saw it coming.",
    mvp: { name: "Josh Allen", pos: "QB", pts: 29.6, note: "Protected and paid" },
    dud: { name: "Tyreek Hill", pos: "WR", pts: 3.8, note: "Fastest man to 3.8 points" },
    notes: [
      { kind: "block", title: "Shields up", text: "Royal Flush Runners tried to steal a QB. Allen was off the table, so they got scraps. You're welcome, league." },
      { kind: "league", title: "Moving on up", text: "Up one spot to 3rd overall. Keep blocking like you know something." },
    ],
  },
  {
    id: "fifth-medium",
    label: "5th - aggressively medium",
    team: "Fantasy Island Boys",
    week: 6,
    place: 5,
    of: 12,
    score: 101.2,
    points: 8,
    rankNow: 6,
    rankMove: 1,
    margin: "11.2 behind 4th, 2.5 ahead of 6th",
    headline: "The Beige Sedan of Fantasy Football",
    story:
      "Nothing broke, nothing impressed. You redrew your RB and got a free agent who scored 9.8 - a whole 0.6 more than the guy you dropped. Congratulations on the most sideways move since a crab changed lanes.",
    mvp: { name: "Jalen Hurts", pos: "QB", pts: 21.0, note: "Tush pushed his way here" },
    dud: { name: "Najee Harris", pos: "RB", pts: 9.8, note: "The redraw. Technically an upgrade." },
    notes: [
      { kind: "redraw", title: "Redraw review", text: "Dropped 9.2, picked up 9.8. Net gain: 0.6 points. Somewhere an accountant is very proud of you." },
      { kind: "league", title: "Around the league", text: "Up one spot, mostly because other people were worse. That counts. We checked." },
    ],
  },
  {
    id: "sixth-jackpot",
    label: "6th - the jackpot redraw",
    team: "Full House Flyers",
    week: 6,
    place: 6,
    of: 12,
    score: 98.7,
    points: 7,
    rankNow: 7,
    rankMove: -1,
    margin: "2.5 behind 5th",
    headline: "Hit the Jackpot, Lost It at the Buffet",
    story:
      "Your redraw was a scratch-off ticket that paid out: you dropped a 3.1-point receiver and pulled Puka Nacua out of free agency, who went for 28.7. Then the other five starters combined for 70.0 and you finished 6th anyway.",
    mvp: { name: "Puka Nacua", pos: "WR", pts: 28.7, note: "Mahomes Alone's loss" },
    dud: { name: "Bryce Young", pos: "QB", pts: 6.4, note: "Threw for 112. Not a typo." },
    notes: [
      { kind: "redraw", title: "Redraw of the week", text: "Puka was only in free agency because Mahomes Alone dropped him to make a steal. Steals and redraws run in the same shuffle, and the shuffle loves you." },
      { kind: "league", title: "Send a thank-you card", text: "Mahomes Alone finished 8th. Puka's 28.7 would have put them 5th. Their loss, your lottery." },
    ],
  },
  {
    id: "seventh-injury",
    label: "7th - QB hurt in the 1st quarter",
    team: "All-In Antlers",
    week: 6,
    place: 7,
    of: 12,
    score: 92.0,
    points: 6,
    rankNow: 8,
    rankMove: 0,
    margin: "6.7 behind 6th",
    headline: "Thoughts and Prayers for Your Quarterback",
    story:
      "Joe Burrow left on the third drive with an ankle and finished with 2.4 points. Once his game kicked off he was locked in your lineup, so your bench QB threw for 290 and two scores in the late window for an audience of zero. A rough way to lose a week you were winning at 1:15.",
    mvp: { name: "Brock Bowers", pos: "TE", pts: 22.5, note: "Carried the whole roster" },
    dud: { name: "Joe Burrow", pos: "QB", pts: 2.4, note: "Hurt on drive three" },
    notes: [
      { kind: "injury", title: "The injury report tried to warn you", text: "Burrow was listed QUES all week with a limited practice Thursday. The notepad doesn't lie. You just didn't open it." },
      { kind: "bench", title: "Bench check", text: "Your bench QB scored 21.2. Starting him would have put you 5th. Starting a QB with two healthy ankles generally helps." },
    ],
  },
  {
    id: "eighth-donation",
    label: "8th - the steal that backfired",
    team: "Mahomes Alone",
    week: 6,
    place: 8,
    of: 12,
    score: 84.7,
    points: 5,
    rankNow: 9,
    rankMove: 1,
    margin: "7.3 behind 7th",
    headline: "That Wasn't a Steal, It Was a Donation",
    story:
      "You dropped Puka Nacua to steal a receiver. Puka landed on the Full House Flyers and scored 28.7. The receiver you stole scored 2.3. That isn't a steal. That's a donation with extra steps.",
    mvp: { name: "Derrick Henry", pos: "RB", pts: 26.1, note: "Stiff-armed the whole state of Ohio" },
    dud: { name: "Rome Odunze", pos: "WR", pts: 2.3, note: "The guy you stole" },
    notes: [
      { kind: "steal", title: "Steal review", text: "Gave up Puka (28.7 elsewhere). Got back 2.3. Net: -26.4. Bold strategy, Cotton." },
      { kind: "league", title: "Around the league", text: "Royal Flush Runners say thank you for stealing their worst receiver. They mean it." },
    ],
  },
  {
    id: "ninth-scraps",
    label: "9th - stole a backup",
    team: "Royal Flush Runners",
    week: 6,
    place: 9,
    of: 12,
    score: 79.5,
    points: 4,
    rankNow: 10,
    rankMove: 1,
    margin: "5.2 behind 8th",
    headline: "You Went Shopping and Came Home With Coupons",
    story:
      "You tried to steal a QB. Dead Man's Hand had blocked Josh Allen, so the steal pulled a random unprotected one instead: 6.1 points. Meanwhile Allen threw four touchdowns. You could hear him laughing from the parking lot.",
    mvp: { name: "Amon-Ra St. Brown", pos: "WR", pts: 19.2, note: "Did his job, ate a kneecap" },
    dud: { name: "Spencer Rattler", pos: "QB", pts: 6.1, note: "Hand-picked by the shuffle" },
    notes: [
      { kind: "steal", title: "Steal review", text: "Steal: QB. Result: Spencer Rattler. The dropped QB you gave up scored 14.0 for nobody, in free agency, where he lives now." },
      { kind: "league", title: "Silver lining", text: "Mahomes Alone stole your WR and he scored 2.3 for them. The only thing that went right this week happened to somebody else." },
    ],
  },
  {
    id: "tenth-pointless-block",
    label: "10th - blocked a nobody",
    team: "Sofa King Good",
    week: 6,
    place: 10,
    of: 12,
    score: 74.0,
    points: 3,
    rankNow: 11,
    rankMove: 1,
    margin: "5.5 behind 9th",
    headline: "Guarding an Empty Vault",
    story:
      "You used your scheme to block your tight end. He scored 1.8. Of all the starters in this league, nobody was less likely to be stolen, and you put a shield on him like he was the crown jewels.",
    mvp: { name: "Kyren Williams", pos: "RB", pts: 18.3, note: "The one bright spot" },
    dud: { name: "Cade Otton", pos: "TE", pts: 1.8, note: "Personally protected by you" },
    notes: [
      { kind: "block", title: "Block review", text: "Number of teams trying to steal a TE this week: zero. Points from your blocked TE: 1.8. Points from the steal you didn't make: also zero, but at least that one's free." },
      { kind: "close", title: "Out of reach", text: "You were within 6 points of 9th, which is the kind of stat you say out loud only when nobody is listening." },
    ],
  },
  {
    id: "eleventh-bench",
    label: "11th - the bench would have won",
    team: "Tua Legit Tua Quit",
    week: 6,
    place: 11,
    of: 12,
    score: 61.3,
    points: 2,
    rankNow: 5,
    rankMove: -3,
    margin: "12.7 behind 10th",
    headline: "Your Bench Would Like a Word",
    story:
      "Your starters scored 61.3. Your bench scored 102.0. If you'd started the bench, you'd have finished 5th. Instead you played the worst six of your twelve players, which is a lineup decision in the way falling down the stairs is a dance move.",
    mvp: { name: "Mike Evans", pos: "WR", pts: 15.0, note: "Tried. Alone." },
    dud: { name: "Tua Tagovailoa", pos: "QB", pts: 4.9, note: "Team name, meet prophecy" },
    notes: [
      { kind: "bench", title: "Bench Mob", text: "Three of your bench players outscored the starter they could have replaced. Your bench was a better team than your team." },
      { kind: "steal", title: "No scheme", text: "You didn't submit a scheme, so you got No Action. You also tried to steal a QB last week. Both went about the same." },
      { kind: "league", title: "Around the league", text: "Down three spots to 5th overall, which is still the top half. Enjoy it while it lasts, because the Couch Cowboys can't be under you forever. Actually, they might." },
    ],
  },
  {
    id: "twelfth-robbed",
    label: "12th - robbed and ridiculed",
    team: "Couch Cowboys",
    week: 6,
    place: 12,
    of: 12,
    score: 48.0,
    points: 1,
    rankNow: 12,
    rankMove: -3,
    margin: "13.3 behind 11th. Not close.",
    headline: "Robbed, Ranked and Ridiculed",
    story:
      "Somebody stole Bijan Robinson off your roster and he scored 31.4 for them while they won the week. Meanwhile you redrew your TE and got a guy who was inactive. Zero points. He didn't even dress. You traded a body for a ghost.",
    mvp: { name: "Mike McCarthy", pos: "Coach", pts: 1, note: "A tie. Your best result of the week." },
    dud: { name: "Theo Johnson", pos: "TE", pts: 0, note: "Inactive. The redraw." },
    notes: [
      { kind: "steal", title: "Crime scene", text: "The Gridiron Gangsters stole Bijan and finished 1st with him. Your RB slot is now a missing-persons poster." },
      { kind: "redraw", title: "Redraw review", text: "Dropped a TE who scored 6.8. Got one who never left the locker room. Net: -6.8, plus your dignity." },
      { kind: "league", title: "The streak", text: "Third straight week in the bottom three. That isn't a slump anymore, that's a lifestyle. Fresh deal Tuesday - new cards, new hope, same you." },
    ],
  },
];
