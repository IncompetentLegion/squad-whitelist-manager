const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin, verifyCsrf } = require('../auth');
const { invalidateCache, updateLastSeedingReport } = require('../utils');

// Public leaderboard
router.get('/', (req, res) => {
  const enabled = db.getConfigValue('seeding_enabled', false);
  const pointsNeeded = db.getConfigValue('seeding_points_needed', 60);
  const rewardDays = db.getConfigValue('seeding_reward_days', 7);
  const search = req.query.search || '';

  let points = db.getSeedingPoints();
  if (search) {
    const q = search.toLowerCase();
    points = points.filter(p =>
      (p.player_name && p.player_name.toLowerCase().includes(q)) ||
      p.steam_id.includes(q)
    );
  }

  const rewardedIds = new Set(db.getActiveSeedingRewards().map(r => r.steam_id));
  const clanLeaderboard = enabled ? db.getClanSeedingLeaderboard() : [];

  res.render('seeding', {
    layout: false,
    title: 'Seeding Leaderboard',
    points, enabled, pointsNeeded, rewardDays, search, rewardedIds, clanLeaderboard
  });
});

// Admin config page
router.get('/config', requireAuth, requireAdmin, (req, res) => {
  res.render('seeding-config', {
    title: 'Seeding Configuration',
    enabled: db.getConfigValue('seeding_enabled', false),
    pointsNeeded: db.getConfigValue('seeding_points_needed', 60),
    rewardDays: db.getConfigValue('seeding_reward_days', 7),
    minPlayers: db.getConfigValue('seeding_min_players', 2),
    maxPlayers: db.getConfigValue('seeding_max_players', 50),
    error: null, success: null
  });
});

router.post('/config', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const { enabled, points_needed, reward_days, min_players, max_players } = req.body;

  db.setConfigValue('seeding_enabled', enabled === 'on');
  db.setConfigValue('seeding_points_needed', parseInt(points_needed) || 60);
  db.setConfigValue('seeding_reward_days', parseInt(reward_days) || 7);
  db.setConfigValue('seeding_min_players', parseInt(min_players) || 2);
  db.setConfigValue('seeding_max_players', parseInt(max_players) || 50);

  res.render('seeding-config', {
    title: 'Seeding Configuration',
    enabled: db.getConfigValue('seeding_enabled', false),
    pointsNeeded: db.getConfigValue('seeding_points_needed', 60),
    rewardDays: db.getConfigValue('seeding_reward_days', 7),
    minPlayers: db.getConfigValue('seeding_min_players', 2),
    maxPlayers: db.getConfigValue('seeding_max_players', 50),
    error: null, success: 'Configuration saved.'
  });
});

// API endpoint for SquadJS plugin
router.post('/report/:apiKey', (req, res) => {
  const crypto = require('crypto');
  const apiKey = db.getConfigValue('seeding_api_key', '');
  const provided = req.params.apiKey;

  if (!apiKey || !provided || provided.length !== apiKey.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const enabled = db.getConfigValue('seeding_enabled', false);
  if (!enabled) {
    return res.status(400).json({ error: 'Seeding is disabled' });
  }

  const { players } = req.body;
  if (!Array.isArray(players)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  updateLastSeedingReport();

  const minPlayers = db.getConfigValue('seeding_min_players', 2);
  const maxPlayers = db.getConfigValue('seeding_max_players', 50);
  const playerCount = players.length;

  if (playerCount < minPlayers || playerCount > maxPlayers) {
    return res.json({ ok: true, processed: 0, rewardsCreated: 0, skipped: 'player count outside seeding window' });
  }

  const pointsNeeded = db.getConfigValue('seeding_points_needed', 60);
  const rewardDays = db.getConfigValue('seeding_reward_days', 7);
  let rewardsCreated = 0;

  for (const p of players) {
    if (!p.steamId) continue;
    try {
      db.upsertSeedingPoints(p.steamId, p.name || null);

      const current = db.getSeedingPointsForPlayer(p.steamId);
      if (current && current.points >= pointsNeeded) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + rewardDays);
        const expiryStr = expiryDate.toISOString().replace('T', ' ').split('.')[0];
        db.createSeedingReward(p.steamId, p.name || null, expiryStr);
        db.resetSeedingPoints(p.steamId);
        rewardsCreated++;
      }
    } catch (err) {
      continue;
    }
  }

  if (rewardsCreated > 0) {
    invalidateCache();
  }

  res.json({ ok: true, processed: players.length, rewardsCreated });
});

// API endpoint: get player seeding progress
router.get('/progress/:apiKey/:steamId', (req, res) => {
  const crypto = require('crypto');
  const apiKey = db.getConfigValue('seeding_api_key', '');
  const provided = req.params.apiKey;

  if (!apiKey || !provided || provided.length !== apiKey.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const steamId = req.params.steamId;
  const pointsNeeded = db.getConfigValue('seeding_points_needed', 60);
  const current = db.getSeedingPointsForPlayer(steamId);

  if (!current) {
    return res.json({ steam_id: steamId, points: 0, points_needed: pointsNeeded, lifetime_points: 0, has_reward: false });
  }

  const reward = db.getActiveSeedingRewards().find(r => r.steam_id === steamId);

  res.json({
    steam_id: steamId,
    player_name: current.player_name || null,
    points: current.points,
    points_needed: pointsNeeded,
    lifetime_points: current.lifetime_points,
    last_seen_at: current.last_seen_at || null,
    has_reward: !!reward,
    reward_expires_at: reward ? reward.expires_at : null
  });
});

// Admin rewards page
router.get('/rewards', requireAuth, requireAdmin, (req, res) => {
  const rewards = db.getActiveSeedingRewards();
  res.render('seeding-rewards', {
    title: 'Seeding Whitelist',
    rewards
  });
});

router.post('/rewards/:id/delete', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const reward = db.getSeedingReward(parseInt(req.params.id));
  if (reward) {
    db.deleteSeedingReward(parseInt(req.params.id));
    invalidateCache();
  }
  res.redirect('/seeding/rewards');
});

module.exports = router;
