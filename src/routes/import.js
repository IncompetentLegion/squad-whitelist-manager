const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin, verifyCsrf } = require('../auth');
const { invalidateCache } = require('../utils');

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const rewardDays = db.getConfigValue('seeding_reward_days', 7);
  res.render('import', {
    title: 'Import Whitelist',
    rewardDays,
    results: null
  });
});

router.post('/', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const { whitelist_data, seeder_days, default_player_limit } = req.body;
  const rewardDays = parseInt(seeder_days) || 7;
  const playerLimit = parseInt(default_player_limit) || 0;

  const stats = { clansCreated: 0, playersAdded: 0, seedersAdded: 0, skipped: 0 };
  const lineRegex = /^Admin=(\d{17}):Whitelist\s*\/\/\s*\[([^\]]+)\]\s*(.+)$/;

  const lines = (whitelist_data || '').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(lineRegex);
    if (!match) {
      stats.skipped++;
      continue;
    }

    const steamId = match[1];
    const tag = match[2].trim();
    let playerName = match[3].trim().replace(/@\S*$/, '').trim();

    if (tag.toLowerCase() === 'seeder') {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + rewardDays);
      const expiryStr = expiryDate.toISOString().replace('T', ' ').split('.')[0];
      db.createSeedingReward(steamId, playerName, expiryStr);
      stats.seedersAdded++;
    } else {
      let clan = db.getClanByName(tag);
      if (!clan) {
        db.createClan(tag, playerLimit);
        clan = db.getClanByName(tag);
        stats.clansCreated++;
      }
      try {
        db.createPlayer(steamId, playerName, clan.id, null, null, null);
        stats.playersAdded++;
      } catch (e) {
        // UNIQUE constraint violation — duplicate steam_id+clan_id
        stats.skipped++;
      }
    }
  }

  if (stats.playersAdded > 0 || stats.seedersAdded > 0) {
    invalidateCache();
  }

  res.render('import', {
    title: 'Import Whitelist',
    rewardDays: parseInt(seeder_days) || db.getConfigValue('seeding_reward_days', 7),
    results: stats
  });
});

module.exports = router;
