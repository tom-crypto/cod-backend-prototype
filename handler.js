// Dependencies
const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');

// Credentials
const { COD_RAPID_API_KEY } = process.env;
const { COD_RAPID_API_HOST } = process.env;
const config = {
  headers: {
    'x-rapidapi-key': COD_RAPID_API_KEY,
    'x-rapidapi-host': COD_RAPID_API_HOST,
    useQueryString: true,
  },
};

// Global Variables
const THIS_WEEKS_GAME_MODE = 'wz';
const TOURNAMENT_TIME_WINDOW = 7500; // 2hr5min
const QUERY_DELAY = 10200;
const DOC = new GoogleSpreadsheet('1rTrJACi-IsX2B194ZWlkwNLi5jE_09PFNzhr6-iUc-8');
const UTC_TO_EST_DST = 14400; // EST is 4 hours behind UTC during daylight savings
const LAMBDA_TIME_NOW = Math.floor(+new Date() / 1000);

// Helper Functions
function normalizePlayerName(playerName) {
  if (typeof playerName === 'undefined') {
    return 'empty_cell';
  }
  const result = playerName.replace('#', '%23');
  return result;
}
function normalizePlatformName(platformName) {
  if (typeof platformName === 'undefined') {
    return 'empty_cell';
  }
  switch (platformName) {
    case '1':
      return 'battle';
    case '2':
      return 'xbl';
    case '3':
      return 'psn';
    default:
      console.log('Error: Incorrect Platform ID Type');
      return 'Incorrect Platform ID Type'
  }
}
function normalizeTime(time12h) {
  const [time, modifier] = time12h.split(' ');

  // eslint-disable-next-line prefer-const
  let [hours, minutes] = time.split(':');

  if (hours === '12') {
    hours = '00';
  }

  if (modifier === 'PM') {
    hours = parseInt(hours, 10) + 12;
  }

  return `${hours}:${minutes}`;
}
function sleep(miliseconds) {
  const currentTime = new Date().getTime();
  while (currentTime + miliseconds >= new Date().getTime()) {
    // empty
  }
}
function placementPointsConverter(n) {
  switch (n) {
    case 1:
      return 20;
    case 2:
      return 15;
    case 3:
      return 10;
    case 4:
      return 7;
    case 5:
      return 5;
    default:
      return 0;
  }
}
function sumObjectsByKey(...objs) {
  return objs.reduce((a, b) => {
    for (const k in b) {
      if (b.hasOwnProperty(k)) a[k] = (a[k] || 0) + b[k];
    }
    return a;
  }, {});
}

// Main Function
module.exports.run = async () => {
  // Main Function Outputs
  let totalTeamKDR;
  let bestGameKills;
  let bestGamePP;
  let secondBestGameKills;
  let secondBestGamePP;
  let totalScore;

  // Google Sheets Credentials and Parameters
  await DOC.useServiceAccountAuth({
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.GS_PRIVATE_KEY,
  });
  await DOC.loadInfo();
  const sheet = DOC.sheetsByIndex[0];
  const rows = await sheet.getRows();

  let tournamentForm;
  let currentRow;
  for (let i = 0; i < rows.length; i += 1) {
    currentRow = rows[i];
    try { // Try to read Date and Start Time, if it cant be read skip row
      let timeToQuery = new Date(`${currentRow.Date} ${normalizeTime(currentRow['Start Time'])}`).getTime() / 1000;
      timeToQuery += UTC_TO_EST_DST + QUERY_DELAY;
      if (LAMBDA_TIME_NOW >= timeToQuery && typeof currentRow['Total Team KDR'] === 'undefined') {
        console.log(`Pulling row ${i + 2} to be processed.`);
        console.log(`Tournament ID: ${currentRow['Tournament ID']}`);
        console.log(`EST Start Time = ${currentRow.Date}, ${currentRow['Start Time']}`);
        console.log('Unix Epoch Start Time = ', new Date(`${currentRow.Date} ${normalizeTime(currentRow['Start Time'])}`).getTime() / 1000 + UTC_TO_EST_DST);
        console.log(`Team Name = "${currentRow['Team Name']}"`);
        tournamentForm = {
          playerOne: {
            playerName: normalizePlayerName(currentRow['Account 1']),
            playerPlatform: normalizePlatformName(currentRow['ID Type 1']),
            startTime: new Date(`${currentRow.Date} ${normalizeTime(currentRow['Start Time'])}`).getTime() / 1000 + UTC_TO_EST_DST,
          },
          playerTwo: {
            playerName: normalizePlayerName(currentRow['Account 2']),
            playerPlatform: normalizePlatformName(currentRow['ID Type 2']),
            startTime: new Date(`${currentRow.Date} ${normalizeTime(currentRow['Start Time'])}`).getTime() / 1000 + UTC_TO_EST_DST,
          },
          playerThree: {
            playerName: normalizePlayerName(currentRow['Account 3']),
            playerPlatform: normalizePlatformName(currentRow['ID Type 3']),
            startTime: new Date(`${currentRow.Date} ${normalizeTime(currentRow['Start Time'])}`).getTime() / 1000 + UTC_TO_EST_DST,
          },
          playerFour: {
            playerName: normalizePlayerName(currentRow['Account 4']),
            playerPlatform: normalizePlatformName(currentRow['ID Type 4']),
            startTime: new Date(`${currentRow.Date} ${normalizeTime(currentRow['Start Time'])}`).getTime() / 1000 + UTC_TO_EST_DST,
          },
        };
        break;
      }
    } catch {
      console.log(`Row Number ${i + 2}: 'Date' or 'Start Time' fields appear to empty, skipping row...`);
    }
  }
  if (typeof tournamentForm === 'undefined') {
    console.log('No records ready to process at this time. Returning...');
    return;
  }
  // Delete empty vacant player slots in tournamentForm
  for (const key in tournamentForm) {
    if (tournamentForm[key].playerName === 'empty_cell') {
      delete tournamentForm[key];
    }
  }
  // Create playerNameLst and playerPlatformLst
  const playerNameLst = [];
  const playerPlatformLst = [];
  for (const key in tournamentForm) {
    playerNameLst.push(tournamentForm[key].playerName);
    playerPlatformLst.push(tournamentForm[key].playerPlatform);
  }

  const teamSize = playerNameLst.length;
  // In the even at tournamentForm is submitted with no users on it
  if (teamSize === 0) {
    console.log('Error: No players were found in Google Sheets');
    currentRow['Total Team KDR'] = 'ERROR: No players were found in Google Sheets';
    await currentRow.save();
    return;
  }
  const tournamentStart = tournamentForm.playerOne.startTime;
  const tournamentStop = tournamentForm.playerOne.startTime + TOURNAMENT_TIME_WINDOW;

  console.log(`Scoring all matches >= ${tournamentStart} AND < ${tournamentStop}`);
  console.log(`Players on Team: ${teamSize}`);
  console.log('Now processing scores for players:', playerNameLst);
  console.log('With the ID Types of:', playerPlatformLst);

  /* BEGIN Compute Total Team KDR */
  let warZoneStats;
  totalTeamKDR = 0;
  for (let i = 0; i < teamSize; i += 1) {
    try {
      sleep(1000);
      warZoneStats = await axios.get(
        `https://call-of-duty-modern-warfare.p.rapidapi.com/warzone/
        ${playerNameLst[i]}/${playerPlatformLst[i]}`, config,
      );
      totalTeamKDR += parseFloat(warZoneStats.data.br.kdRatio);
    } catch (error) {
      currentRow['Total Team KDR'] = 'ERROR: Account is set to private OR Invalid Account OR ID Type';
      await currentRow.save();
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.log(error.response.config);
        console.log(error.response.status);
        console.log(error.response.headers);
      } else {
        // The request was made and the server responded with a 2xx status code
        console.log("Error: User's account is set to private, or invalid username or platform_id, HALTING PROCESS");
        console.log('CoD Rapid API Response:', warZoneStats.data);
      }
      return;
    }
  }
  console.log('Total Team KDR = ', totalTeamKDR);
  /* END Compute Total Team KDR */

  /* BEGIN Find all matches within time window AND gameType == THIS_WEEKS_GAME_MODE */
  let warZoneMatches;
  const matchIdPool = [];
  // matchIdPool = all the matches played within
  // the tournament window AND has the correct gameType
  const warZoneMatchHistory = []; // stores the last 20 match history for each player
  const qualifiedwarZoneMatchHistory = []; // stores the match history for each player inside the tournament window AND correct gameType
  for (let i = 0; i < teamSize; i += 1) {
    try {
      sleep(1000);
      warZoneMatches = await axios.get(`https://call-of-duty-modern-warfare.p.rapidapi.com/warzone-matches/
      ${playerNameLst[i]}/${playerPlatformLst[i]}`, config);
    } catch (error) {
      console.log(error);
    }
    warZoneMatchHistory.push(warZoneMatches.data.matches);
  }
  for (let i = 0; i < warZoneMatchHistory.length; i += 1) {
    for (let j = 0; j < warZoneMatchHistory[i].length; j += 1) {
      if (warZoneMatchHistory[i][j].utcStartSeconds >= tournamentStart
        && warZoneMatchHistory[i][j].utcStartSeconds < tournamentStop
        && warZoneMatchHistory[i][j].gameType === THIS_WEEKS_GAME_MODE) {
        matchIdPool.push(warZoneMatchHistory[i][j].matchID);
        qualifiedwarZoneMatchHistory.push(warZoneMatchHistory[i][j]);
      }
    }
  }
  /* END Find all matches within time window AND gameType == THIS_WEEKS_GAME_MODE */

  /* BEGIN Verify all team members were present in each match */
  // A matchID has a 1 to 1 relationship with its player
  // therefore, a matchID must be repeated as manytimes, as players on the
  // team. For example, there exists a team of two. A matchID must exist in
  // the matchIdPool two times, to prove the players were present in the same
  // game.

  // Remove duplicate matchIDs
  const uniqueMatchIdPoolSet = new Set(matchIdPool);
  // Write de-duped matchIDs to an array
  const uniqueMatchIdPoolLst = Array.from(uniqueMatchIdPoolSet);

  // Convert uniqueMatchIdPoolLst to objects, with values of 0
  const matchesPlayedAsTeam = uniqueMatchIdPoolLst.reduce(
    (a, b) => (a[b] = 0, a), {});

  // For each unique matchId in matchesPlayedAsTeam count how many times
  // they occur in the matchIdPoool
  for (const key in matchesPlayedAsTeam) {
    for (let i = 0; i < matchIdPool.length; i+=1) {
      if (key === matchIdPool[i]) {
        matchesPlayedAsTeam[key] += 1;
      }
    }
  }
  // A match will only be scored IF and ONLY IF it occurred in the
  // matchIdPool as many times, as there are players on the team
  for (const key in matchesPlayedAsTeam) {
    if (matchesPlayedAsTeam[key] !== teamSize) {
      delete matchesPlayedAsTeam[key];
    }
  }
  const matchesQualifiedToBeScored = Object.keys(matchesPlayedAsTeam);
  if (matchesQualifiedToBeScored.length < 2) {
    console.log('ERROR: Less than two matches qualified to be scored, HALTING PROCESS');
    currentRow['Total Team KDR'] = 'ERROR: Less than two matches qualified to be scored';
    await currentRow.save();
    return;
  }
  /* END Verify all team members were present in each match */

  /* BEGIN Score all matches that qualify to be scored */
  const killsTracker = matchesQualifiedToBeScored.reduce(
    (a, b) => (a[b] = 0, a), {});
  const teamPlacementTracker = matchesQualifiedToBeScored.reduce(
    (a, b) => (a[b] = 0, a), {});
  const teamPlacementsPointsTracker = matchesQualifiedToBeScored.reduce(
    (a, b) => (a[b] = 0, a), {});

  for (let i = 0; i < qualifiedwarZoneMatchHistory.length; i += 1) {
    for (let j = 0; j < matchesQualifiedToBeScored.length; j += 1) {
      if (qualifiedwarZoneMatchHistory[i].matchID === matchesQualifiedToBeScored[j]) {
        killsTracker[qualifiedwarZoneMatchHistory[i].matchID]
          += qualifiedwarZoneMatchHistory[i].playerStats.kills;
        teamPlacementTracker[qualifiedwarZoneMatchHistory[i].matchID] = qualifiedwarZoneMatchHistory[i].playerStats.teamPlacement;
        teamPlacementsPointsTracker[qualifiedwarZoneMatchHistory[i].matchID] = placementPointsConverter(
          qualifiedwarZoneMatchHistory[i].playerStats.teamPlacement);
      }
    }
  }

  console.log('Team Placement for each match = ', teamPlacementTracker);
  console.log('Team Placement Points for each match = ', teamPlacementsPointsTracker);
  console.log('Total Team Kills for each match = ', killsTracker);

  const finalScores = sumObjectsByKey(killsTracker, teamPlacementsPointsTracker);

  console.log('Final Tournament Scores for this team = ', finalScores);

  /* END Score all matches that qualify to be scored */

  /* BEGIN Build Scorecard to be OUTPUT */
  // Find MatchID for best game and write it to bestGame
  const finalScoresWorkingCopy = finalScores;
  const bestGame = Object.keys(finalScoresWorkingCopy).reduce(
    (a, b) => (finalScoresWorkingCopy[a] > finalScoresWorkingCopy[b] ? a : b));
  delete finalScoresWorkingCopy[bestGame];
  bestGameKills = killsTracker[bestGame];
  const bestGameTeamPlacement = teamPlacementTracker[bestGame];
  bestGamePP = teamPlacementsPointsTracker[bestGame];
  console.log("--------This team's best game is", bestGame, '--------');
  console.log('Their Total Kills for this game = ', bestGameKills);
  console.log('Their Team placement for this game is = ', bestGameTeamPlacement);
  console.log('Their Placement Points for this game is = ', bestGamePP);
  console.log('The Total Best Game Score is = ', bestGameKills + bestGamePP, '\n');

  // Find MatchID for second best game and write it to secondBestGame
  const secondBestGame = Object.keys(finalScoresWorkingCopy).reduce((a, b) => (finalScoresWorkingCopy[a] > finalScoresWorkingCopy[b] ? a : b));
  delete finalScoresWorkingCopy[secondBestGame];
  secondBestGameKills = killsTracker[secondBestGame];
  const secondBestGameTeamPlacement = teamPlacementTracker[secondBestGame];
  secondBestGamePP = teamPlacementsPointsTracker[secondBestGame];
  console.log("--------This team's seccond best game is", secondBestGame, '--------');
  console.log('Their Total Kills for this game = ', secondBestGameKills);
  console.log('Their Team placement for this game is = ', secondBestGameTeamPlacement);
  console.log('Their Placement Points for this game is = ', secondBestGamePP);
  console.log('The Total Second Best Game Score is = ', secondBestGameKills + secondBestGamePP, '\n');

  totalScore = bestGameKills + secondBestGameKills + bestGamePP + secondBestGamePP;

  console.log('Total Score =', totalScore, '\n');
  /* END Build Scorecard to be OUTPUT */

  /* BEGIN Write to Google Sheet */
  currentRow['Total Team KDR'] = totalTeamKDR;
  currentRow['Best Game Kills'] = bestGameKills;
  currentRow['Best Game PP'] = bestGamePP;
  currentRow['Second Best Game Kills'] = secondBestGameKills;
  currentRow['Second Best Game PP'] = secondBestGamePP;
  currentRow['Total Score'] = totalScore;
  await currentRow.save();
  /* END Write to Google Sheet */
};
