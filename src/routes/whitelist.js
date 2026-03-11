const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateWhitelist } = require('../utils');

// Whitelist output consumed by game servers via plain GET (RemoteAdminListHosts).
// Optionally protected with a path-based key: /whitelist/<key>
// Set via WHITELIST_KEY env var or whitelist_key config value.
// When no key is configured, /whitelist serves the output directly.
router.get('/:key?', (req, res) => {
  const key = db.getConfigValue('whitelist_key', '');
  if (key) {
    const submitted = req.params.key || '';
    if (!submitted || submitted.length !== key.length ||
        !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(submitted))) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }
  }
  const output = generateWhitelist();
  res.type('text/plain').send(output);
});

module.exports = router;
