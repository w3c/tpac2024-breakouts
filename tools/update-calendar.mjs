import puppeteer from 'puppeteer';
import { getEnvKey } from './lib/envkeys.mjs';
import { fetchProject } from './lib/project.mjs';
import { convertSessionToCalendarEntry } from './lib/calendar.mjs';
import { validateSession } from './lib/validate.mjs';

async function main(sessionNumber, status) {
  console.log(`Retrieve environment variables...`);
  const PROJECT_OWNER = await getEnvKey('PROJECT_OWNER');
  console.log(`- PROJECT_OWNER: ${PROJECT_OWNER}`);
  const PROJECT_NUMBER = await getEnvKey('PROJECT_NUMBER');
  console.log(`- PROJECT_NUMBER: ${PROJECT_NUMBER}`);
  const CALENDAR_SERVER = await getEnvKey('CALENDAR_SERVER', 'www.w3.org');
  console.log(`- CALENDAR_SERVER: ${CALENDAR_SERVER}`);
  const W3C_LOGIN = await getEnvKey('W3C_LOGIN');
  console.log(`- W3C_LOGIN: ${W3C_LOGIN}`);
  const W3C_PASSWORD = await getEnvKey('W3C_PASSWORD');
  console.log(`- W3C_PASSWORD: ***`);
  const ROOM_ZOOM = await getEnvKey('ROOM_ZOOM', {}, true);
  const CHAIR_W3CID = await getEnvKey('CHAIR_W3CID', {}, true);
  console.log(`Retrieve environment variables... done`);

  console.log();
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER} and session(s)...`);
  const project = await fetchProject(PROJECT_OWNER, PROJECT_NUMBER);
  if (!project) {
    throw new Error(`Project ${PROJECT_OWNER}/${PROJECT_NUMBER} could not be retrieved`);
  }
  project.chairsToW3CID = CHAIR_W3CID;
  let sessions = sessionNumber ?
    project.sessions.filter(s => s.number === sessionNumber) :
    project.sessions.filter(s => s.slot);
  sessions.sort((s1, s2) => s1.number - s2.number);
  if (sessionNumber) {
    if (sessions.length === 0) {
      throw new Error(`Session ${sessionNumber} not found in project ${PROJECT_OWNER}/${PROJECT_NUMBER}`);
    }
    else if (!sessions[0].slot) {
      throw new Error(`Session ${sessionNumber} not assigned to a slot in project ${PROJECT_OWNER}/${PROJECT_NUMBER}`);
    }
  }
  else {
    console.log(`- found ${sessions.length} sessions assigned to slots: ${sessions.map(s => s.number).join(', ')}`);
  }
  sessions = await Promise.all(sessions.map(async session => {
    const sessionErrors = (await validateSession(session.number, project))
      .filter(error => error.severity === 'error');
    if (sessionErrors.length > 0) {
      return null;
    }
    return session;
  }));
  sessions = sessions.filter(s => !!s);
  if (sessionNumber) {
    if (sessions.length === 0) {
      throw new Error(`Session ${sessionNumber} contains errors that need fixing`);
    }
  }
  else {
    console.log(`- found ${sessions.length} valid sessions among them: ${sessions.map(s => s.number).join(', ')}`);
  }
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER} and session(s)... done`);

  console.log();
  console.log('Launch Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  console.log('Launch Puppeteer... done');

  try {
    for (const session of sessions) {
      console.log();
      console.log(`Convert session ${session.number} to calendar entry...`);
      const room = project.rooms.find(r => r.name === session.room);
      const zoom = ROOM_ZOOM[room?.label] ? ROOM_ZOOM[room.label] : undefined;
      await convertSessionToCalendarEntry({
        browser, session, project, status, zoom,
        calendarServer: CALENDAR_SERVER,
        login: W3C_LOGIN,
        password: W3C_PASSWORD
      });
      console.log(`Convert session ${session.number} to calendar entry... done`);
    }
  }
  finally {
    await browser.close();
  }
}


// Read session number from command-line
const allSessions = process.argv[2];
if (!allSessions || !allSessions.match(/^\d+$|^all$/)) {
  console.log('Command needs to receive a session number, or "all", as first parameter');
  process.exit(1);
}
const sessionNumber = allSessions === 'all' ? undefined : parseInt(allSessions, 10);

const status = process.argv[3] ?? 'draft';
if (!['draft', 'tentative', 'confirmed'].includes(status)) {
  console.log('Command needs to receive a valid entry status "draft", "tentative" or "confirmed" as second parameter');
  process.exit(1);
}

main(sessionNumber, status)
  .catch(err => {
    console.log(`Something went wrong: ${err.message}`);
    throw err;
  });