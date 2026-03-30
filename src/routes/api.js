const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin, verifyCsrf } = require('../auth');

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.render('api', {
    title: 'API',
    whitelistKey: db.getConfigValue('whitelist_key', ''),
    seedingKey: db.getConfigValue('seeding_api_key', ''),
    seedingLeaderboardApi: db.getConfigValue('seeding_leaderboard_api', true),
    baseUrl,
    error: null,
    success: null
  });
});

router.post('/', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const whitelistKey = (req.body.whitelist_key || '').trim();
  const seedingKey = (req.body.seeding_key || '').trim();

  if (!seedingKey) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.render('api', {
      title: 'API',
      whitelistKey: db.getConfigValue('whitelist_key', ''),
      seedingKey: db.getConfigValue('seeding_api_key', ''),
      seedingLeaderboardApi: db.getConfigValue('seeding_leaderboard_api', true),
      baseUrl,
      error: 'Seeding API key is required.',
      success: null
    });
  }

  db.setConfigValue('whitelist_key', whitelistKey);
  db.setConfigValue('seeding_api_key', seedingKey);
  db.setConfigValue('seeding_leaderboard_api', req.body.seeding_leaderboard_api === 'on');

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.render('api', {
    title: 'API',
    whitelistKey: db.getConfigValue('whitelist_key', ''),
    seedingKey: db.getConfigValue('seeding_api_key', ''),
    seedingLeaderboardApi: db.getConfigValue('seeding_leaderboard_api', true),
    baseUrl,
    error: null,
    success: 'Settings saved.'
  });
});

// Public seeding leaderboard
router.get('/seeding', (req, res) => {
  if (!db.getConfigValue('seeding_leaderboard_api', true)) {
    return res.status(404).json({ error: 'Seeding leaderboard API is disabled.' });
  }

  const enabled = db.getConfigValue('seeding_enabled', false);
  const pointsNeeded = db.getConfigValue('seeding_points_needed', 60);
  const rewardDays = db.getConfigValue('seeding_reward_days', 7);
  const points = db.getSeedingPoints();
  const rewardedIds = new Set(db.getActiveSeedingRewards().map(r => r.steam_id));
  const clanLeaderboard = enabled ? db.getClanSeedingLeaderboard() : [];

  res.json({
    enabled,
    points_needed: pointsNeeded,
    reward_days: rewardDays,
    players: points.map(p => ({
      steam_id: p.steam_id,
      player_name: p.player_name || null,
      points: p.points,
      lifetime_points: p.lifetime_points,
      clan_name: p.clan_name || null,
      last_seen_at: p.last_seen_at || null,
      has_reward: rewardedIds.has(p.steam_id)
    })),
    clan_leaderboard: clanLeaderboard.map(c => ({
      clan_id: c.id,
      clan_name: c.name,
      seeder_count: c.seeder_count,
      total_lifetime_minutes: c.total_lifetime_minutes
    }))
  });
});

module.exports = router;
