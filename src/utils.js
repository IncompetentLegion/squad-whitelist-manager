const db = require('./db');

let cachedOutput = null;
let lastSeedingReport = null;

function getLastSeedingReport() {
  return lastSeedingReport;
}

function updateLastSeedingReport() {
  lastSeedingReport = Date.now();
}
let cacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

function invalidateCache() {
  cachedOutput = null;
  cacheTime = 0;
}

function generateWhitelist() {
  const now = Date.now();
  if (cachedOutput && (now - cacheTime) < CACHE_TTL) {
    return cachedOutput;
  }

  let lines = ['Group=Whitelist:reserve'];

  function sanitize(str) {
    return str.replace(/[\r\n]/g, ' ');
  }

  const players = db.getActivePlayersForWhitelist();
  for (const p of players) {
    let comment = p.clan_name || 'Standalone';
    if (p.player_name) comment += ` - ${sanitize(p.player_name)}`;
    if (p.expires_at) comment += ` - Expires: ${p.expires_at.split(' ')[0]}`;
    lines.push(`Admin=${p.steam_id}:Whitelist // ${comment}`);
  }

  const playerSteamIds = new Set(players.filter(p => p.clan_name).map(p => p.steam_id));
  const rewards = db.getActiveSeedingRewards();
  for (const r of rewards) {
    if (playerSteamIds.has(r.steam_id)) continue;
    const expiry = r.expires_at.split(' ')[0];
    const name = r.player_name ? ' - ' + sanitize(r.player_name) : '';
    lines.push(`Admin=${r.steam_id}:Whitelist // Seeder${name} - Expires: ${expiry}`);
  }

  cachedOutput = lines.join('\n') + '\n';
  cacheTime = now;

  return cachedOutput;
}

function runCleanup() {
  const deletedPlayers = db.deleteExpiredPlayers();
  const deletedRewards = db.deleteExpiredSeedingRewards();
  db.deleteExpiredSessions();

  if (deletedPlayers.changes > 0 || deletedRewards.changes > 0) {
    invalidateCache();
  }
}

module.exports = { generateWhitelist, invalidateCache, runCleanup, getLastSeedingReport, updateLastSeedingReport };
