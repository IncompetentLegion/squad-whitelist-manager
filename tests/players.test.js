const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, setup, resetDatabase, extractCsrfToken, createAdminAgent, createManagerAgent } = require('./helpers');

describe('Players', () => {
  before(async () => {
    await setup();
  });

  beforeEach(() => {
    resetDatabase();
  });

  it('admin can add a standalone player', async () => {
    const agent = await createAdminAgent(app);

    const playersRes = await agent.get('/players');
    const csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post('/players')
      .send({ steam_id: '76561198000000001', player_name: 'PlayerOne', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/players');

    const listRes = await agent.get('/players');
    assert.ok(listRes.text.includes('PlayerOne'));
    assert.ok(listRes.text.includes('76561198000000001'));
  });

  it('admin can add a player to a clan', async () => {
    const agent = await createAdminAgent(app);

    const clanRes = await agent.get('/clans');
    const clanCsrf = extractCsrfToken(clanRes.text);
    await agent.post('/clans').send({ name: 'TestClan', player_limit: 10, _csrf: clanCsrf });

    const db = require('../src/db');
    const clan = db.getClanByName('TestClan');

    const playersRes = await agent.get('/players');
    const csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post('/players')
      .send({ steam_id: '76561198000000001', player_name: 'ClanPlayer', clan_id: clan.id, _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/players');

    const listRes = await agent.get('/players');
    assert.ok(listRes.text.includes('ClanPlayer'));
    assert.ok(listRes.text.includes('TestClan'));
  });

  it('rejects invalid steam id', async () => {
    const agent = await createAdminAgent(app);
    const playersRes = await agent.get('/players');
    const csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post('/players')
      .send({ steam_id: 'not-valid', player_name: 'Bad', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('error='));
    assert.ok(res.headers.location.includes('Steam'));
  });

  it('rejects impossible expiry date', async () => {
    const agent = await createAdminAgent(app);
    const playersRes = await agent.get('/players');
    const csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post('/players')
      .send({ steam_id: '76561198000000001', player_name: 'Test', expires_at: '2024-99-99', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('error='));
    assert.ok(res.headers.location.includes('expiry'));
  });

  it('accepts valid expiry date and appends 23:59:59', async () => {
    const agent = await createAdminAgent(app);
    const playersRes = await agent.get('/players');
    const csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post('/players')
      .send({ steam_id: '76561198000000001', player_name: 'Test', expires_at: '2025-12-31', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/players');

    const db = require('../src/db');
    const player = db.getStandalonePlayer('76561198000000001');
    assert.strictEqual(player.expires_at, '2025-12-31 23:59:59');
  });

  it('blocks duplicate standalone player', async () => {
    const agent = await createAdminAgent(app);

    let playersRes = await agent.get('/players');
    let csrf = extractCsrfToken(playersRes.text);
    await agent.post('/players').send({ steam_id: '76561198000000001', player_name: 'First', _csrf: csrf });

    playersRes = await agent.get('/players');
    csrf = extractCsrfToken(playersRes.text);
    const res = await agent.post('/players').send({ steam_id: '76561198000000001', player_name: 'Second', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('error='));
    const decoded = decodeURIComponent(res.headers.location);
    assert.ok(decoded.includes('already exists'));
  });

  it('enforces clan player limit', async () => {
    const agent = await createAdminAgent(app);

    const clanRes = await agent.get('/clans');
    const clanCsrf = extractCsrfToken(clanRes.text);
    await agent.post('/clans').send({ name: 'TinyClan', player_limit: 1, _csrf: clanCsrf });

    const db = require('../src/db');
    const clan = db.getClanByName('TinyClan');

    let playersRes = await agent.get('/players');
    let csrf = extractCsrfToken(playersRes.text);
    await agent.post('/players').send({ steam_id: '76561198000000001', player_name: 'P1', clan_id: clan.id, _csrf: csrf });

    playersRes = await agent.get('/players');
    csrf = extractCsrfToken(playersRes.text);
    const res = await agent.post('/players').send({ steam_id: '76561198000000002', player_name: 'P2', clan_id: clan.id, _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('error='));
    const decodedLimit = decodeURIComponent(res.headers.location);
    assert.ok(decodedLimit.includes('limit'));
  });

  it('manager without clan cannot create players', async () => {
    const bcrypt = require('bcryptjs');
    const db = require('../src/db');
    const hash = await bcrypt.hash('pass123', 10);
    db.createUser('orphan', hash, 'manager', null);

    const agent = request.agent(app);
    const getRes = await agent.get('/login');
    const loginCsrf = require('./helpers').extractCsrfCookie(getRes);
    await agent.post('/login').send({ username: 'orphan', password: 'pass123', _csrf: loginCsrf });

    const playersRes = await agent.get('/players');
    const csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post('/players')
      .send({ steam_id: '76561198000000001', player_name: 'Test', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('error='));
    const decodedClan = decodeURIComponent(res.headers.location);
    assert.ok(decodedClan.includes('clan'));
  });

  it('manager can only see own clan players', async () => {
    const admin = await createAdminAgent(app);

    let clanRes = await admin.get('/clans');
    let csrf = extractCsrfToken(clanRes.text);
    await admin.post('/clans').send({ name: 'ClanA', player_limit: 10, _csrf: csrf });

    clanRes = await admin.get('/clans');
    csrf = extractCsrfToken(clanRes.text);
    await admin.post('/clans').send({ name: 'ClanB', player_limit: 10, _csrf: csrf });

    const db = require('../src/db');
    const clanA = db.getClanByName('ClanA');
    const clanB = db.getClanByName('ClanB');

    let playersRes = await admin.get('/players');
    let pcsrf = extractCsrfToken(playersRes.text);
    await admin.post('/players').send({ steam_id: '76561198000000001', player_name: 'PlayerA', clan_id: clanA.id, _csrf: pcsrf });

    playersRes = await admin.get('/players');
    pcsrf = extractCsrfToken(playersRes.text);
    await admin.post('/players').send({ steam_id: '76561198000000002', player_name: 'PlayerB', clan_id: clanB.id, _csrf: pcsrf });

    const { agent: manager } = await createManagerAgent(app, 'ClanA', 'managerA');

    const res = await manager.get('/players');
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('PlayerA'));
    assert.ok(!res.text.includes('PlayerB'));
  });

  it('manager cannot edit players from other clans', async () => {
    const admin = await createAdminAgent(app);

    const clanRes = await admin.get('/clans');
    const csrf = extractCsrfToken(clanRes.text);
    await admin.post('/clans').send({ name: 'ClanA', player_limit: 10, _csrf: csrf });

    const db = require('../src/db');
    const clanA = db.getClanByName('ClanA');

    let playersRes = await admin.get('/players');
    let pcsrf = extractCsrfToken(playersRes.text);
    await admin.post('/players').send({ steam_id: '76561198000000001', player_name: 'PlayerA', clan_id: clanA.id, _csrf: pcsrf });

    const player = db.searchPlayers('', clanA.id)[0];

    const { agent: managerB } = await createManagerAgent(app, 'ClanB', 'managerB');
    const managerPlayersRes = await managerB.get('/players');
    const managerCsrf = extractCsrfToken(managerPlayersRes.text);

    const res = await managerB.post(`/players/${player.id}/edit`).send({ player_name: 'Hacked', _csrf: managerCsrf });
    assert.strictEqual(res.status, 403);

    const unchanged = db.getPlayer(player.id);
    assert.strictEqual(unchanged.player_name, 'PlayerA');
  });

  it('manager cannot delete players from other clans', async () => {
    const admin = await createAdminAgent(app);

    const clanRes = await admin.get('/clans');
    const csrf = extractCsrfToken(clanRes.text);
    await admin.post('/clans').send({ name: 'ClanA', player_limit: 10, _csrf: csrf });

    const db = require('../src/db');
    const clanA = db.getClanByName('ClanA');

    let playersRes = await admin.get('/players');
    let pcsrf = extractCsrfToken(playersRes.text);
    await admin.post('/players').send({ steam_id: '76561198000000001', player_name: 'PlayerA', clan_id: clanA.id, _csrf: pcsrf });

    const player = db.searchPlayers('', clanA.id)[0];

    const { agent: managerB } = await createManagerAgent(app, 'ClanB', 'managerB');
    const managerPlayersRes = await managerB.get('/players');
    const managerCsrf = extractCsrfToken(managerPlayersRes.text);

    const res = await managerB.post(`/players/${player.id}/delete`).send({ _csrf: managerCsrf });
    assert.strictEqual(res.status, 403);

    assert.ok(db.getPlayer(player.id));
  });

  it('admin can edit a player', async () => {
    const agent = await createAdminAgent(app);

    let playersRes = await agent.get('/players');
    let csrf = extractCsrfToken(playersRes.text);
    await agent.post('/players').send({ steam_id: '76561198000000001', player_name: 'Original', _csrf: csrf });

    const db = require('../src/db');
    const player = db.getStandalonePlayer('76561198000000001');

    playersRes = await agent.get('/players');
    csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post(`/players/${player.id}/edit`)
      .send({ player_name: 'Updated', expires_at: '2025-06-15', note: 'Test note', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/players');

    const updated = db.getPlayer(player.id);
    assert.strictEqual(updated.player_name, 'Updated');
    assert.strictEqual(updated.expires_at, '2025-06-15 23:59:59');
    assert.strictEqual(updated.note, 'Test note');
  });

  it('admin can delete a player', async () => {
    const agent = await createAdminAgent(app);

    let playersRes = await agent.get('/players');
    let csrf = extractCsrfToken(playersRes.text);
    await agent.post('/players').send({ steam_id: '76561198000000001', player_name: 'ToDelete', _csrf: csrf });

    const db = require('../src/db');
    const player = db.getStandalonePlayer('76561198000000001');

    playersRes = await agent.get('/players');
    csrf = extractCsrfToken(playersRes.text);

    const res = await agent
      .post(`/players/${player.id}/delete`)
      .send({ _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/players');

    const listRes = await agent.get('/players');
    assert.ok(!listRes.text.includes('ToDelete'));
  });
});
