const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, verifyCsrf, validateDate } = require('../auth');
const { invalidateCache } = require('../utils');

router.get('/', requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const search = req.query.search || '';
  const clanFilter = req.query.clan || '';
  const error = req.query.error || null;
  const success = req.query.success || null;

  let players;
  if (isAdmin) {
    players = db.searchPlayers(search, clanFilter);
  } else {
    if (!req.user.clan_id) {
      return res.render('players', {
        title: 'Players', players: [], clans: [], isAdmin: false,
        search, clanFilter, userClan: null, clanPlayerCount: 0, error: 'No clan assigned.', success: null
      });
    }
    players = db.searchPlayers(search, req.user.clan_id);
  }

  const clans = isAdmin ? db.getAllClans() : [];
  const userClan = req.user.clan_id ? db.getClan(req.user.clan_id) : null;
  const clanPlayerCount = req.user.clan_id ? db.getClanPlayerCount(req.user.clan_id).count : 0;

  res.render('players', {
    title: 'Players', players, clans, isAdmin, search, clanFilter,
    userClan, clanPlayerCount, error, success
  });
});

router.post('/', requireAuth, verifyCsrf, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  let { steam_id, player_name, clan_id, expires_at, note } = req.body;
  steam_id = (steam_id || '').trim();
  player_name = (player_name || '').trim() || null;
  expires_at = (expires_at || '').trim() || null;
  note = (note || '').trim() || null;

  if (!steam_id) {
    return res.redirect('/players?error=Steam ID is required');
  }

  if (!/^\d{17}$/.test(steam_id)) {
    return res.redirect('/players?error=Invalid Steam ID format');
  }

  if (!isAdmin) {
    clan_id = req.user.clan_id;
    if (!clan_id) {
      return res.redirect('/players?error=No clan assigned');
    }
  } else {
    clan_id = clan_id ? parseInt(clan_id) : null;
  }

  if (expires_at) {
    if (!validateDate(expires_at)) {
      return res.redirect('/players?error=Invalid expiry date format');
    }
    expires_at += ' 23:59:59';
  }

  if (clan_id) {
    const clan = db.getClan(clan_id);
    if (clan && clan.player_limit > 0) {
      const count = db.getClanPlayerCount(clan_id).count;
      if (count >= clan.player_limit) {
        return res.redirect('/players?error=Clan player limit reached');
      }
    }
  }

  if (!clan_id) {
    const existing = db.getStandalonePlayer(steam_id);
    if (existing) {
      return res.redirect('/players?error=Standalone player with this Steam ID already exists');
    }
  }

  try {
    db.createPlayer(steam_id, player_name, clan_id, expires_at, note, req.user.id);
    invalidateCache();
    res.redirect('/players');
  } catch (err) {
    res.redirect('/players?error=Player already exists in this clan');
  }
});

router.post('/:id/edit', requireAuth, verifyCsrf, (req, res) => {
  const player = db.getPlayer(parseInt(req.params.id));
  if (!player) return res.redirect('/players');

  if (req.user.role !== 'admin' && (!req.user.clan_id || player.clan_id !== req.user.clan_id)) {
    return res.status(403).render('error', { layout: false, title: 'Access Denied', message: 'Cannot edit this player.' });
  }

  let { player_name, expires_at, note } = req.body;
  player_name = (player_name || '').trim() || null;
  expires_at = (expires_at || '').trim() || null;
  note = (note || '').trim() || null;

  if (expires_at) {
    if (!validateDate(expires_at)) {
      return res.redirect('/players');
    }
    expires_at += ' 23:59:59';
  }

  db.updatePlayer(player_name, expires_at, note, parseInt(req.params.id));
  invalidateCache();
  res.redirect('/players');
});

router.post('/:id/delete', requireAuth, verifyCsrf, (req, res) => {
  const player = db.getPlayer(parseInt(req.params.id));
  if (!player) return res.redirect('/players');

  if (req.user.role !== 'admin' && (!req.user.clan_id || player.clan_id !== req.user.clan_id)) {
    return res.status(403).render('error', { layout: false, title: 'Access Denied', message: 'Cannot delete this player.' });
  }

  db.deletePlayer(parseInt(req.params.id));
  invalidateCache();
  res.redirect('/players');
});

module.exports = router;
