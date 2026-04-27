const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, setup, resetDatabase, createAdminAgent, createManagerAgent } = require('./helpers');

describe('API & External Endpoints', () => {
  before(async () => {
    await setup();
  });

  beforeEach(() => {
    resetDatabase();
  });

  describe('Whitelist Output', () => {
    it('returns whitelist in Squad format', async () => {
      const agent = await createAdminAgent(app);

      const clanRes = await agent.get('/clans');
      const csrf = require('./helpers').extractCsrfToken(clanRes.text);
      await agent.post('/clans').send({ name: 'IL', player_limit: 10, _csrf: csrf });

      const db = require('../src/db');
      const clan = db.getClanByName('IL');

      let playersRes = await agent.get('/players');
      let pcsrf = require('./helpers').extractCsrfToken(playersRes.text);
      await agent.post('/players').send({ steam_id: '76561198000000001', player_name: 'Member', clan_id: clan.id, _csrf: pcsrf });

      playersRes = await agent.get('/players');
      pcsrf = require('./helpers').extractCsrfToken(playersRes.text);
      await agent.post('/players').send({ steam_id: '76561198000000002', player_name: 'Standalone', _csrf: pcsrf });

      const res = await request(app).get('/whitelist');
      assert.strictEqual(res.status, 200);
      assert.ok(res.text.includes('Group=Whitelist:reserve'));
      assert.ok(res.text.includes('Admin=76561198000000001:Whitelist // IL - Member'));
      assert.ok(res.text.includes('Admin=76561198000000002:Whitelist // Standalone - Standalone'));
    });

    it('protects whitelist with key', async () => {
      const db = require('../src/db');
      db.setConfigValue('whitelist_key', 'secretkey');

      const res = await request(app).get('/whitelist');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.text, 'Unauthorized');

      const okRes = await request(app).get('/whitelist/secretkey');
      assert.strictEqual(okRes.status, 200);
      assert.ok(okRes.text.includes('Group=Whitelist:reserve'));

      db.setConfigValue('whitelist_key', '');
    });
  });

  describe('Seeding Report', () => {
    it('rejects report with invalid api key', async () => {
      const res = await request(app)
        .post('/seeding/report/wrongkey')
        .send({ players: [{ steamId: '76561198000000001', name: 'Player' }] });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Unauthorized');
    });

    it('rejects report with invalid payload', async () => {
      const res = await request(app)
        .post('/seeding/report/testkey')
        .send({ notplayers: [] });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Invalid payload');
    });

    it('awards seeding points when player count is in range', async () => {
      const db = require('../src/db');
      db.setConfigValue('seeding_min_players', 1);

      const players = [{ steamId: '76561198000000001', name: 'Player' }];

      const res = await request(app)
        .post('/seeding/report/testkey')
        .send({ players });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.processed, 1);
      assert.strictEqual(res.body.rewardsCreated, 0);

      const points = db.getSeedingPointsForPlayer('76561198000000001');
      assert.strictEqual(points.points, 1);
      assert.strictEqual(points.lifetime_points, 1);

      db.setConfigValue('seeding_min_players', 2);
    });

    it('does not award points when seeding is disabled', async () => {
      const db = require('../src/db');
      db.setConfigValue('seeding_enabled', false);

      const players = [{ steamId: '76561198000000001', name: 'Player' }];

      const res = await request(app)
        .post('/seeding/report/testkey')
        .send({ players });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.seedingDisabled, true);

      db.setConfigValue('seeding_enabled', true);
    });

    it('skips seeding when player count is too low', async () => {
      const res = await request(app)
        .post('/seeding/report/testkey')
        .send({ players: [{ steamId: '76561198000000001', name: 'Player' }] });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.skipped);
    });

    it('tracks play time when player count is at max', async () => {
      const players = [];
      for (let i = 0; i < 50; i++) {
        players.push({ steamId: `765611980000000${String(i).padStart(2, '0')}`, name: `Player${i}` });
      }

      const res = await request(app)
        .post('/seeding/report/testkey')
        .send({ players });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.playTimeTracked, true);

      const db = require('../src/db');
      const points = db.getSeedingPointsForPlayer('76561198000000000');
      assert.strictEqual(points.play_minutes, 1);
    });

    it('creates reward when threshold is reached', async () => {
      const db = require('../src/db');
      db.setConfigValue('seeding_points_needed', 3);
      db.setConfigValue('seeding_reward_days', 7);
      db.setConfigValue('seeding_min_players', 1);

      const players = [
        { steamId: '76561198000000001', name: 'Seeder' }
      ];

      // 2 reports - not enough
      await request(app).post('/seeding/report/testkey').send({ players });
      await request(app).post('/seeding/report/testkey').send({ players });

      let pts = db.getSeedingPointsForPlayer('76561198000000001');
      assert.strictEqual(pts.points, 2);

      // 3rd report - reward created
      const res = await request(app).post('/seeding/report/testkey').send({ players });
      assert.strictEqual(res.body.rewardsCreated, 1);

      pts = db.getSeedingPointsForPlayer('76561198000000001');
      assert.strictEqual(pts.points, 0);

      const rewards = db.getActiveSeedingRewards();
      assert.strictEqual(rewards.length, 1);
      assert.strictEqual(rewards[0].steam_id, '76561198000000001');

      db.setConfigValue('seeding_points_needed', 60);
      db.setConfigValue('seeding_min_players', 2);
    });
  });

  describe('Seeding Progress', () => {
    it('rejects progress with invalid api key', async () => {
      const res = await request(app).get('/seeding/progress/wrongkey/76561198000000001');
      assert.strictEqual(res.status, 401);
    });

    it('returns progress for unknown player', async () => {
      const res = await request(app).get('/seeding/progress/testkey/76561198000000001');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.steam_id, '76561198000000001');
      assert.strictEqual(res.body.points, 0);
      assert.strictEqual(res.body.has_reward, false);
    });

    it('returns progress for active player', async () => {
      const db = require('../src/db');
      db.setConfigValue('seeding_min_players', 1);

      const players = [{ steamId: '76561198000000001', name: 'Player' }];
      await request(app).post('/seeding/report/testkey').send({ players });

      const res = await request(app).get('/seeding/progress/testkey/76561198000000001');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.points, 1);
      assert.strictEqual(res.body.lifetime_points, 1);
      assert.strictEqual(res.body.player_name, 'Player');

      db.setConfigValue('seeding_min_players', 2);
    });
  });

  describe('Public Leaderboard', () => {
    it('renders public leaderboard', async () => {
      const res = await request(app).get('/seeding');
      assert.strictEqual(res.status, 200);
      assert.ok(res.text.includes('Seeding Leaderboard'));
    });

    it('returns JSON leaderboard data', async () => {
      const res = await request(app).get('/api/seeding');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.players));
      assert.ok(Array.isArray(res.body.clan_leaderboard));
    });

    it('blocks JSON leaderboard when disabled', async () => {
      const db = require('../src/db');
      db.setConfigValue('seeding_leaderboard_api', false);

      const res = await request(app).get('/api/seeding');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Seeding leaderboard API is disabled.');

      db.setConfigValue('seeding_leaderboard_api', true);
    });
  });

  describe('Access Control', () => {
    it('blocks manager from admin-only routes', async () => {
      const { agent: manager } = await createManagerAgent(app);

      const routes = ['/clans', '/users', '/seeding/config', '/seeding/rewards', '/import', '/api'];
      for (const route of routes) {
        const res = await manager.get(route);
        assert.strictEqual(res.status, 403, `Expected 403 for ${route}`);
      }
    });

    it('allows admin to access admin routes', async () => {
      const agent = await createAdminAgent(app);

      const res = await agent.get('/clans');
      assert.strictEqual(res.status, 200);
    });
  });
});
