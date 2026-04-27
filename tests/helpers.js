const path = require('path');
const request = require('supertest');

const dbPath = path.join(__dirname, 'test.db');
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';

const { app, startPromise } = require('../server');
const db = require('../src/db');
const { resetLoginAttempts } = require('../src/auth');
const { invalidateCache } = require('../src/utils');

async function setup() {
  await startPromise;
  resetDatabase();
}

function resetDatabase() {
  db.resetAllTables();
  invalidateCache();

  // Seed defaults
  db.setConfigValue('seeding_api_key', 'testkey');
  db.setConfigValue('seeding_enabled', true);
  db.setConfigValue('seeding_points_needed', 60);
  db.setConfigValue('seeding_reward_days', 7);
  db.setConfigValue('seeding_min_players', 2);
  db.setConfigValue('seeding_max_players', 50);
  db.setConfigValue('whitelist_key', '');
  db.setConfigValue('seeding_leaderboard_api', true);

  resetLoginAttempts();
}

function extractCsrfCookie(res) {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const arr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of arr) {
    if (c.startsWith('_csrf=')) {
      return c.split(';')[0].split('=')[1];
    }
  }
  return null;
}

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

async function createAdminAgent(app, username = 'admin', password = 'password123') {
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 10);
  db.createUser(username, hash, 'admin', null);

  const agent = request.agent(app);
  const getRes = await agent.get('/login');
  const csrf = extractCsrfCookie(getRes);

  const loginRes = await agent
    .post('/login')
    .send({ username, password, _csrf: csrf });

  if (loginRes.status !== 302) {
    throw new Error('Failed to login as admin');
  }

  return agent;
}

async function createManagerAgent(app, clanName = 'TestClan', username = 'manager', password = 'password123') {
  const bcrypt = require('bcryptjs');

  let clan = db.getClanByName(clanName);
  if (!clan) {
    db.createClan(clanName, 10);
    clan = db.getClanByName(clanName);
  }

  const hash = await bcrypt.hash(password, 10);
  db.createUser(username.toLowerCase(), hash, 'manager', clan.id);

  const agent = request.agent(app);
  const getRes = await agent.get('/login');
  const csrf = extractCsrfCookie(getRes);

  const loginRes = await agent
    .post('/login')
    .send({ username, password, _csrf: csrf });

  if (loginRes.status !== 302) {
    throw new Error('Failed to login as manager');
  }

  return { agent, clan };
}

module.exports = {
  app,
  startPromise,
  db,
  setup,
  resetDatabase,
  extractCsrfCookie,
  extractCsrfToken,
  createAdminAgent,
  createManagerAgent
};