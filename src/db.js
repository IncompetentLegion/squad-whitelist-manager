const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// DB lives in the project root by default.
// Override with DB_PATH env var for custom placement.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'whitelist.db');

let db = null;
let ready = false;

// Save database to disk periodically and on changes
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (db) {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    }
  }, 100);
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS clans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      player_limit INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager',
      clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id TEXT NOT NULL,
      player_name TEXT,
      clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
      expires_at TEXT,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(steam_id, clan_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS seeding_points (
      steam_id TEXT PRIMARY KEY,
      player_name TEXT,
      points INTEGER NOT NULL DEFAULT 0,
      lifetime_points INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);



  db.run(`
    CREATE TABLE IF NOT EXISTS seeding_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id TEXT NOT NULL UNIQUE,
      player_name TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'manager',
      clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Auto-generate seeding API key if not set
  const existingKey = get('SELECT value FROM config WHERE key = ?', ['seeding_api_key']);
  if (!existingKey) {
    const crypto = require('crypto');
    const key = crypto.randomBytes(3).toString('hex');
    db.run('INSERT INTO config (key, value) VALUES (?, ?)', ['seeding_api_key', JSON.stringify(key)]);
  }

  saveNow();
  ready = true;
}

// Helper: run a SELECT and return all rows as objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a SELECT and return first row as object, or null
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run INSERT/UPDATE/DELETE, return { changes }
function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  scheduleSave();
  return { changes };
}

// ---- Query functions ----

function getUser(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

function getUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

function getSessionByToken(token) {
  return get(`
    SELECT s.*, u.username, u.role, u.clan_id
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `, [token]);
}

function createSession(userId, token) {
  return run("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+30 days'))", [userId, token]);
}

function deleteSession(token) {
  return run('DELETE FROM sessions WHERE token = ?', [token]);
}

function deleteExpiredSessions() {
  return run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
}

function deleteUserSessions(userId, exceptToken) {
  if (exceptToken) {
    return run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [userId, exceptToken]);
  }
  return run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

function userCount() {
  return get('SELECT COUNT(*) as count FROM users');
}

function getAllUsers() {
  return all('SELECT u.*, c.name as clan_name FROM users u LEFT JOIN clans c ON u.clan_id = c.id ORDER BY u.role, u.username');
}

function createUser(username, passwordHash, role, clanId) {
  return run('INSERT INTO users (username, password_hash, role, clan_id) VALUES (?, ?, ?, ?)', [username, passwordHash, role, clanId]);
}

function updateUser(username, role, clanId, id) {
  return run('UPDATE users SET username = ?, role = ?, clan_id = ? WHERE id = ?', [username, role, clanId, id]);
}

function updateUserPassword(hash, id) {
  return run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
}

function deleteUser(id) {
  return run('DELETE FROM users WHERE id = ?', [id]);
}

function getAllClans() {
  return all('SELECT * FROM clans ORDER BY name');
}

function getClan(id) {
  return get('SELECT * FROM clans WHERE id = ?', [id]);
}

function getClanByName(name) {
  return get('SELECT * FROM clans WHERE name = ?', [name]);
}

function createClan(name, playerLimit) {
  return run('INSERT INTO clans (name, player_limit) VALUES (?, ?)', [name, playerLimit]);
}

function updateClan(name, playerLimit, id) {
  return run('UPDATE clans SET name = ?, player_limit = ? WHERE id = ?', [name, playerLimit, id]);
}

function deleteClan(id) {
  return run('DELETE FROM clans WHERE id = ?', [id]);
}

function getClanPlayerCount(clanId) {
  return get('SELECT COUNT(*) as count FROM players WHERE clan_id = ?', [clanId]);
}

function getPlayerCountByClan() {
  return all(`
    SELECT c.id, c.name, c.player_limit, COUNT(p.id) as player_count
    FROM clans c LEFT JOIN players p ON c.id = p.clan_id
    GROUP BY c.id ORDER BY c.name
  `);
}

function getManagersByClan() {
  return all("SELECT id, username, clan_id FROM users WHERE role = 'manager' AND clan_id IS NOT NULL");
}

function getAllPlayers() {
  return all(`
    SELECT p.*, c.name as clan_name    FROM players p LEFT JOIN clans c ON p.clan_id = c.id
    ORDER BY p.created_at DESC
  `);
}

function getPlayersByClan(clanId) {
  return all(`
    SELECT p.*, c.name as clan_name    FROM players p LEFT JOIN clans c ON p.clan_id = c.id
    WHERE p.clan_id = ?
    ORDER BY p.created_at DESC
  `, [clanId]);
}

function getPlayer(id) {
  return get('SELECT * FROM players WHERE id = ?', [id]);
}

function getStandalonePlayer(steamId) {
  return get('SELECT * FROM players WHERE steam_id = ? AND clan_id IS NULL', [steamId]);
}

function createPlayer(steamId, playerName, clanId, expiresAt, note, createdBy) {
  return run('INSERT INTO players (steam_id, player_name, clan_id, expires_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [steamId, playerName, clanId, expiresAt, note, createdBy]);
}

function updatePlayer(playerName, expiresAt, note, id) {
  return run('UPDATE players SET player_name = ?, expires_at = ?, note = ? WHERE id = ?', [playerName, expiresAt, note, id]);
}

function deletePlayer(id) {
  return run('DELETE FROM players WHERE id = ?', [id]);
}

function deleteExpiredPlayers() {
  return run("DELETE FROM players WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')");
}

function getActivePlayersForWhitelist() {
  return all(`
    SELECT p.steam_id, p.player_name, p.expires_at, c.name as clan_name
    FROM players p LEFT JOIN clans c ON p.clan_id = c.id
    WHERE p.expires_at IS NULL OR p.expires_at > datetime('now')
  `);
}

function getActivePlayersByClanName(clanName) {
  return all(`
    SELECT p.steam_id, p.player_name, p.expires_at    FROM players p JOIN clans c ON p.clan_id = c.id
    WHERE c.name = ? AND (p.expires_at IS NULL OR p.expires_at > datetime('now'))
  `, [clanName]);
}

function getActiveSeedingRewards() {
  return all("SELECT * FROM seeding_rewards WHERE expires_at > datetime('now')");
}

function getSeedingPoints() {
  return all(`SELECT sp.*, c.name as clan_name
    FROM seeding_points sp
    LEFT JOIN players p ON sp.steam_id = p.steam_id
    LEFT JOIN clans c ON p.clan_id = c.id
    ORDER BY sp.lifetime_points DESC LIMIT 50`);
}

function upsertSeedingPoints(steamId, playerName) {
  const existing = get('SELECT * FROM seeding_points WHERE steam_id = ?', [steamId]);
  if (existing) {
    run("UPDATE seeding_points SET player_name = ?, points = points + 1, lifetime_points = lifetime_points + 1, last_seen_at = datetime('now'), updated_at = datetime('now') WHERE steam_id = ?",
      [playerName, steamId]);
  } else {
    run("INSERT INTO seeding_points (steam_id, player_name, points, lifetime_points, last_seen_at, updated_at) VALUES (?, ?, 1, 1, datetime('now'), datetime('now'))",
      [steamId, playerName]);
  }
}

function getSeedingPointsForPlayer(steamId) {
  return get('SELECT * FROM seeding_points WHERE steam_id = ?', [steamId]);
}

function createSeedingReward(steamId, playerName, expiresAt) {
  // UPSERT: replace if exists
  const existing = get('SELECT * FROM seeding_rewards WHERE steam_id = ?', [steamId]);
  if (existing) {
    run('UPDATE seeding_rewards SET player_name = ?, expires_at = ? WHERE steam_id = ?', [playerName, expiresAt, steamId]);
  } else {
    run('INSERT INTO seeding_rewards (steam_id, player_name, expires_at) VALUES (?, ?, ?)', [steamId, playerName, expiresAt]);
  }
}

function resetSeedingPoints(steamId) {
  return run("UPDATE seeding_points SET points = 0, updated_at = datetime('now') WHERE steam_id = ?", [steamId]);
}

function getSeedingReward(id) {
  return get('SELECT * FROM seeding_rewards WHERE id = ?', [id]);
}

function deleteSeedingReward(id) {
  return run('DELETE FROM seeding_rewards WHERE id = ?', [id]);
}

function deleteExpiredSeedingRewards() {
  return run("DELETE FROM seeding_rewards WHERE expires_at <= datetime('now')");
}

function getClanSeedingLeaderboard() {
  return all(`
    SELECT c.id, c.name, COUNT(DISTINCT p.steam_id) AS seeder_count,
           COALESCE(SUM(sp.lifetime_points), 0) AS total_lifetime_minutes
    FROM players p
    JOIN clans c ON p.clan_id = c.id
    JOIN seeding_points sp ON p.steam_id = sp.steam_id
    GROUP BY c.id
    ORDER BY total_lifetime_minutes DESC
  `);
}

function getConfigValue(key, defaultValue = null) {
  const row = get('SELECT value FROM config WHERE key = ?', [key]);
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setConfigValue(key, value) {
  const existing = get('SELECT * FROM config WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE config SET value = ? WHERE key = ?', [JSON.stringify(value), key]);
  } else {
    run('INSERT INTO config (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
}

function searchPlayers(query, clanId) {
  let sql = `
    SELECT p.*, c.name as clan_name, COALESCE(sp.lifetime_points, 0) as lifetime_minutes
    FROM players p LEFT JOIN clans c ON p.clan_id = c.id
    LEFT JOIN seeding_points sp ON p.steam_id = sp.steam_id
    WHERE 1=1
  `;
  const params = [];

  if (query) {
    sql += ' AND (p.steam_id LIKE ? OR p.player_name LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }
  if (clanId === 'none') {
    sql += ' AND p.clan_id IS NULL';
  } else if (clanId) {
    sql += ' AND p.clan_id = ?';
    params.push(clanId);
  }

  sql += ' ORDER BY p.created_at DESC';
  return all(sql, params);
}

function searchSeedingPoints(query) {
  let sql = `SELECT sp.*, c.name as clan_name
    FROM seeding_points sp
    LEFT JOIN players p ON sp.steam_id = p.steam_id
    LEFT JOIN clans c ON p.clan_id = c.id
    WHERE 1=1`;
  const params = [];
  if (query) {
    sql += ' AND (sp.steam_id LIKE ? OR sp.player_name LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }
  sql += ' ORDER BY sp.lifetime_points DESC';
  return all(sql, params);
}

function getDashboardStats() {
  const totalPlayers = get('SELECT COUNT(*) as count FROM players').count;
  const totalClans = get('SELECT COUNT(*) as count FROM clans').count;
  const expiringSoon = get(`
    SELECT COUNT(*) as count FROM players
    WHERE expires_at IS NOT NULL AND expires_at > datetime('now') AND expires_at <= datetime('now', '+7 days')
  `).count;
  const recentPlayers = all(`
    SELECT p.*, c.name as clan_name, COALESCE(sp.lifetime_points, 0) as lifetime_minutes
    FROM players p LEFT JOIN clans c ON p.clan_id = c.id
    LEFT JOIN seeding_points sp ON p.steam_id = sp.steam_id
    ORDER BY p.created_at DESC LIMIT 10
  `);
  const activeSeedingRewards = get("SELECT COUNT(*) as count FROM seeding_rewards WHERE expires_at > datetime('now')").count;
  return { totalPlayers, totalClans, expiringSoon, activeSeedingRewards, recentPlayers };
}

function getClanDashboardStats(clanId) {
  const totalPlayers = get('SELECT COUNT(*) as count FROM players WHERE clan_id = ?', [clanId]).count;
  const clan = getClan(clanId);
  const recentPlayers = all(`
    SELECT p.*, c.name as clan_name, COALESCE(sp.lifetime_points, 0) as lifetime_minutes
    FROM players p LEFT JOIN clans c ON p.clan_id = c.id
    LEFT JOIN seeding_points sp ON p.steam_id = sp.steam_id
    WHERE p.clan_id = ?
    ORDER BY p.created_at DESC LIMIT 10
  `, [clanId]);
  return { totalPlayers, clan, recentPlayers };
}

function createInvite(token, role, clanId, expiresAt, createdBy) {
  return run('INSERT INTO invites (token, role, clan_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?)', [token, role, clanId, expiresAt, createdBy]);
}

function getInviteByToken(token) {
  return get(`
    SELECT i.*, c.name as clan_name
    FROM invites i LEFT JOIN clans c ON i.clan_id = c.id
    WHERE i.token = ? AND i.used_at IS NULL AND i.expires_at > datetime('now')
  `, [token]);
}

function markInviteUsed(token) {
  return run("UPDATE invites SET used_at = datetime('now') WHERE token = ?", [token]);
}

function getInvitesByClan(clanId) {
  return all('SELECT * FROM invites WHERE clan_id = ? ORDER BY created_at DESC', [clanId]);
}

function getPendingInvites() {
  return all(`
    SELECT i.*, c.name as clan_name, u.username as created_by_name
    FROM invites i
    LEFT JOIN clans c ON i.clan_id = c.id
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.used_at IS NULL AND i.expires_at > datetime('now')
    ORDER BY i.created_at DESC
  `);
}

function deleteInvite(id) {
  return run('DELETE FROM invites WHERE id = ?', [id]);
}

function getDb() { return db; }

// Save on process exit
process.on('exit', saveNow);
process.on('SIGINT', () => { saveNow(); process.exit(); });
process.on('SIGTERM', () => { saveNow(); process.exit(); });

module.exports = {
  init, getDb, saveNow,
  getUser, getUserByUsername, getSessionByToken, createSession, deleteSession, deleteExpiredSessions, deleteUserSessions,
  userCount, getAllUsers, createUser, updateUser, updateUserPassword, deleteUser,
  getAllClans, getClan, getClanByName, createClan, updateClan, deleteClan,
  getClanPlayerCount, getPlayerCountByClan, getManagersByClan,
  getAllPlayers, getPlayersByClan, getPlayer, getStandalonePlayer, createPlayer, updatePlayer, deletePlayer, deleteExpiredPlayers,
  getActivePlayersForWhitelist, getActivePlayersByClanName, getActiveSeedingRewards,
  getSeedingPoints, upsertSeedingPoints, getSeedingPointsForPlayer, createSeedingReward, resetSeedingPoints, getSeedingReward, deleteSeedingReward, deleteExpiredSeedingRewards,
  getConfigValue, setConfigValue,
  searchPlayers, searchSeedingPoints, getDashboardStats, getClanDashboardStats, getClanSeedingLeaderboard,
  createInvite, getInviteByToken, markInviteUsed, getInvitesByClan, getPendingInvites, deleteInvite
};
