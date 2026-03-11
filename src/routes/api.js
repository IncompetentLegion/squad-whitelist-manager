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
      baseUrl,
      error: 'Seeding API key is required.',
      success: null
    });
  }

  db.setConfigValue('whitelist_key', whitelistKey);
  db.setConfigValue('seeding_api_key', seedingKey);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.render('api', {
    title: 'API',
    whitelistKey: db.getConfigValue('whitelist_key', ''),
    seedingKey: db.getConfigValue('seeding_api_key', ''),
    baseUrl,
    error: null,
    success: 'API keys saved.'
  });
});

module.exports = router;
