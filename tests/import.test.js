const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, setup, resetDatabase, extractCsrfToken, createAdminAgent } = require('./helpers');

describe('Import', () => {
  before(async () => {
    await setup();
  });

  beforeEach(() => {
    resetDatabase();
  });

  it('skips clan players that already belong to another clan', async () => {
    const agent = await createAdminAgent(app);

    const importRes = await agent.get('/import');
    const csrf = extractCsrfToken(importRes.text);

    const whitelistData = [
      'Admin=76561198000000001:Whitelist // [ClanA] PlayerOne',
      'Admin=76561198000000001:Whitelist // [ClanB] PlayerOne'
    ].join('\n');

    const res = await agent
      .post('/import')
      .send({
        whitelist_data: whitelistData,
        default_player_limit: 10,
        seeder_days: 7,
        _csrf: csrf
      });

    const db = require('../src/db');
    const player = db.getClanPlayerBySteamId('76561198000000001');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.searchPlayers('', '').length, 1);
    assert.strictEqual(player.clan_name, 'ClanA');
    assert.ok(db.getClanByName('ClanA'));
    assert.strictEqual(db.getClanByName('ClanB'), null);
    assert.ok(res.text.includes('Players added:</span> <strong>1</strong>'));
    assert.ok(res.text.includes('Skipped:</span> <strong>1</strong>'));
  });
});
