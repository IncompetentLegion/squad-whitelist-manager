const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, redirectIfNoUsers } = require('../auth');

router.get('/', redirectIfNoUsers, requireAuth, (req, res) => {
  if (req.user.role === 'admin') {
    const stats = db.getDashboardStats();
    res.render('dashboard', { title: 'Dashboard', stats, isAdmin: true });
  } else {
    if (!req.user.clan_id) {
      return res.render('dashboard', { title: 'Dashboard', stats: { totalPlayers: 0, clan: null, recentPlayers: [] }, isAdmin: false });
    }
    const stats = db.getClanDashboardStats(req.user.clan_id);
    res.render('dashboard', { title: 'Dashboard', stats, isAdmin: false });
  }
});

module.exports = router;
