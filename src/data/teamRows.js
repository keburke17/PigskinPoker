/* Pigskin Poker - player pool source data.
 *
 * Extracted verbatim from TEAM_ROWS (LegacyProject/PigskinPokerCode.jsx lines 242-275).
 * Shape: [Team, Coach, QB, [RBs], [WRs], [TEs]] - mirrors the author's spec section 15.
 *
 * Phase 4 makes this regenerable from a stats feed and gives each player a stable
 * externalIds field. Until then it is hand-maintained, exactly as the author had it.
 * Whether the hand-curation is deliberate or was a workaround is OQ-4b in
 * docs/OPEN-QUESTIONS.md - do not replace this wholesale before that is answered.
 */
export const TEAM_ROWS = [
  ["Arizona Cardinals","Mike LaFleur","Jacoby Brisset",["Jeremiyah Love","Tyler Allgeier"],["Marvin Harrison Jr","Michael Wilson"],["Trey McBride"]],
  ["Atlanta Falcons","Kevin Stafanski","Tua Tagovailoa",["Bijan Robinson","Brian Robinson Jr"],["Drake London"],["Kyle Pitts"]],
  ["Baltimore Ravens","Jesse Minter","Lamar Jackson",["Derek Henry"],["Zay Flowers","Rashod Bateman"],["Mark Andrews"]],
  ["Buffalo Bills","Joe Brady","Josh Allen",["James Cook"],["DJ Moore","Kalil Shakir"],["Dalton Kincaid"]],
  ["Carolina Panthers","Dave Canales","Bryce Young",["Chubba Hubbard","Jonathon Brooks"],["Tet McMillan","Jalen Coker"],["Tommy Tremble","Ja'Tavion Sanders"]],
  ["Chicago Bears","Ben Johnson","Caleb Williams",["D'Andre Swift","Kyle Monangai"],["Rome Odunze","Luther Burden"],["Colston Loveland"]],
  ["Cincinnati Bengals","Zac Taylor","Joe Burrow",["Chase Brown"],["Ja'Marr Chase","Tee Higgins"],["Mike Gesicki"]],
  ["Cleveland Browns","Todd Monken","Deshaun Watson",["Quinshon Judkins","Dylan Sampson"],["Jerry Jeudy","KC Concepcion"],["Harold Fannin"]],
  ["Dallas Cowboys","Brian Schottenheimer","Dak Prescott",["Javonte Williams"],["CeeDee Lamb","George Pickens"],["Jake Ferguson"]],
  ["Denver Broncos","Sean Payton","Bo Nix",["J.K. Dobbins","RJ Harvey"],["Courtland Sutton","Jaylen Waddle"],["Evan Engram"]],
  ["Detroit Lions","Dan Campbell","Jared Goff",["Jahmyr Gibbs","Isiah Pacheco"],["Amon-Ra St. Brown","Jameson Williams"],["Sam Laporta"]],
  ["Green Bay Packers","Matt LaFleur","Jordan Love",["Josh Jacobs"],["Christian Watson","Jayden Reed","Matthew Golden"],["Tucker Kraft"]],
  ["Houston Texans","DeMeco Ryans","C.J. Stroud",["David Montgomery","Woody Marks"],["Nico Collins","Jayden Higgins"],["Dalton Schultz"]],
  ["Indianapolis Colts","Shane Steichen","Daniel Jones",["Jonathan Taylor"],["Alec Pierce","Josh Downs"],["Tyler Warren"]],
  ["Jacksonville Jaguars","Liam Coen","Trevor Lawrence",["Bhayshul Tuten","Chris Rodriguez"],["Brian Thomas Jr","Jakobi Meyers","Parker Washington"],["Brenton Strange"]],
  ["Kansas City Chiefs","Andy Reid","Patrick Mahomes",["Kenneth Walker"],["Rashee Rice","Xavier Worthy"],["Travis Kelce"]],
  ["Los Angeles Chargers","Jim Harbaugh","Justin Herbert",["Omarion Hampton","Keaton Mitchell"],["Ladd McConkey","Quentin Johnston"],["Oronde Gadsden","David Njoku"]],
  ["Los Angeles Rams","Sean McVay","Matthew Stafford",["Kyren Williams","Blake Corum"],["Puka Nacua","Davante Adams"],["Colby Parkinson","Tyler Higbee","Terrance Ferguson"]],
  ["Las Vegas Raiders","Klint Kubiak","Kirk Cousins",["Ashton Jeanty"],["Tre Tucker","Jalen Nailor"],["Brock Bowers"]],
  ["Miami Dolphins","Jeff Hafley","Malik Willis",["De'Von Achane"],["Malik Washington","Jalen Tolbert"],["Greg Dulcich"]],
  ["Minnesota Vikings","Kevin O'Connell","Kyler Murray",["Aaron Jones","Jordan Mason"],["Justin Jefferson","Jordan Addison"],["T.J. Hockenson"]],
  ["New England Patriots","Mike Vrabel","Drake Maye",["Rhamondre Stevenson","TreVeyon Henderson"],["A.J. Brown","Romeo Doubs"],["Hunter Henry"]],
  ["New Orleans Saints","Kellen Moore","Tyler Shough",["Travis Etienne","Alvin Kamara"],["Chris Olave","Jordyn Tyson"],["Juwan Johnson"]],
  ["New York Giants","John Harbaugh","Jaxson Dart",["Cam Skattebo","Tyrone Tracy"],["Malik Nabers","Darius Slayton"],["Isaiah Likely","Theo Johnson"]],
  ["New York Jets","Aaron Glenn","Geno Smith",["Breece Hall","Braelon Allen"],["Garrett Wilson","Adonai Mitchell","Omar Cooper"],["Kenyon Sadiq","Mason Taylor"]],
  ["Philadelphia Eagles","Nick Sirianni","Jalen Hurts",["Saquon Barkley","Tank Bigsby"],["DeVonta Smith","Makai Lemon"],["Dallas Goedert"]],
  ["Pittsburgh Steelers","Mike McCarthy","Aaron Rodgers",["Jaylen Warren","Rico Dowdle"],["DK Metcalf","Michael Pittman"],["Pat Freiermuth","Darnell Washington"]],
  ["Seattle Seahawks","Mike Macdonald","Sam Darnold",["Zach Charbonet","Jadarian Price"],["Jaxson Smith-Njigba","Rashid Shaheed"],["AJ Barner"]],
  ["San Francisco 49ers","Kyle Shanahan","Brock Purdy",["Christian McCaffrey"],["Mike Evans","Ricky Pearsall"],["George Kittle"]],
  ["Tampa Bay Buccaneers","Todd Bowles","Baker Mayfield",["Bucky Irving","Kenneth Gainwell"],["Chris Godwin","Emeka Egbuka"],["Cade Otton"]],
  ["Tennessee Titans","Robert Saleh","Cam Ward",["Tony Pollard","Tyjae Spears"],["Carnell Tate","Wan'Dale Robinson"],["Gunnar Helm"]],
  ["Washington Commanders","Dan Quinn","Jayden Daniels",["Jacory Croskey-Merritt","Rachaad White"],["Terry McLaurin","Luke McCaffrey"],["Chig Okonkwo"]],
];
