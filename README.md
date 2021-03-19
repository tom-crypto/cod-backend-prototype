# cod-backend-prototype
This repo is for a Call of Duty War Zone score card solution.

## Client's Logic requirements for handler.js

Enforce tournament rules:
For a match to be scored, all team-members MUST be present in each match
For a match to be scored, all team-members MUST play the correct gameType
For a match to be scored, the match MUST begin on or after tournamentStart and before tournamentStop


Calculate the following outputs:
-An individual team's Total Team Kill Death Ratio, totalTeamKDR:
-An individual team's Best Game Kills, bestGameKills
-An individual team's Best Game Placement Points, bestGamePP
-An individual team's Second Best Game Kills, secondBestGameKills
-An individual team's Second Best Game Placement Points, secondBestGamePP
-An individual team's Total Score, totalScore


## Timing
Lambda will run every 1min begining Saturday UTC and ending Sunday UTC.

During the testing phase, the longest duration of the handler.run function was 40 seconds. The Lambda timeout has been set to 59 seconds for 2 reasons: 1) Allowing a 19 second buffer for possibly longer Lambda run times (when we have more fidelity about the Lambda duration we will adjust for effenciency). 2) The cron job is set execute every 60 second and this point the client has no need to run parallel lambda functions

## Eventual Production Diagram
![alt text](https://github.com/tom-crypto/cod-backend-prototype/blob/main/eventualProductionDiagram.png)

## Deprecated Notes
The first match begins every Friday at 12AM EST, and the last match begins at 1145PM EST every Saturday. Converting to UTC, the first match begins every Saturday at 4AM UTC, and the last match begins every Sunday at 345AM UTC.

A tournament window is 2hr5min.

The API query delay is 45min. (After the tournament window is complete, wait 45min to pull scores in case the end user began his last match at the 2hr4min59sec mark and, it took approx. 45 min~ for the match to complete)

So, Lambda will activate at every Saturday 4AM UTC + 2hr5min + 45min, which will be: Every Saturday at 650AM UTC. And, Lambda will deactivate at 345AM UTC + 2hr5min + 45 min, which will be: Every Sunday at 635AM UTC. 

Lambda will run continously between the times of Saturday 650AM - Sunday at 635AM UTC /or/ Saturday 250AM - Sunday 235AM EST.
