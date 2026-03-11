const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin, verifyCsrf } = require('../auth');
const { invalidateCache } = require('../utils');

function buildManagerMap() {
  const managers = db.getManagersByClan();
  const map = {};
  for (const m of managers) {
    if (!map[m.clan_id]) map[m.clan_id] = [];
    map[m.clan_id].push(m.username);
  }
  return map;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const clans = db.getPlayerCountByClan();
  const managerMap = buildManagerMap();
  res.render('clans', { title: 'Clans', clans, managerMap, error: null, success: null });
});

router.post('/', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const { name, player_limit } = req.body;
  if (!name) {
    const clans = db.getPlayerCountByClan();
    return res.render('clans', { title: 'Clans', clans, managerMap: buildManagerMap(), error: 'Name is required.', success: null });
  }
  const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanName) {
    const clans = db.getPlayerCountByClan();
    return res.render('clans', { title: 'Clans', clans, managerMap: buildManagerMap(), error: 'Name must contain valid URL characters (letters, numbers, - _).', success: null });
  }
  try {
    db.createClan(cleanName, parseInt(player_limit) || 0);
    invalidateCache();
    res.redirect('/clans');
  } catch (err) {
    const clans = db.getPlayerCountByClan();
    res.render('clans', { title: 'Clans', clans, managerMap: buildManagerMap(), error: 'Clan name already exists.', success: null });
  }
});

router.post('/:id/edit', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const { name, player_limit } = req.body;
  const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanName) {
    return res.redirect('/clans');
  }
  try {
    db.updateClan(cleanName, parseInt(player_limit) || 0, parseInt(req.params.id));
    invalidateCache();
  } catch (err) {
    // ignore duplicate name errors
  }
  res.redirect('/clans');
});

router.post('/:id/delete', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  db.deleteClan(parseInt(req.params.id));
  invalidateCache();
  res.redirect('/clans');
});

module.exports = router;
