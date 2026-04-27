const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, setup, resetDatabase, extractCsrfToken, createAdminAgent } = require('./helpers');

describe('Users', () => {
  before(async () => {
    await setup();
  });

  beforeEach(() => {
    resetDatabase();
  });

  it('admin can edit a user username', async () => {
    const agent = await createAdminAgent(app);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    const db = require('../src/db');
    const user = db.getUserByUsername('admin');

    const res = await agent
      .post(`/users/${user.id}/edit`)
      .send({ username: 'admin2', role: 'admin', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');

    const updated = db.getUser(user.id);
    assert.strictEqual(updated.username, 'admin2');
  });

  it('rejects short password on user edit', async () => {
    const agent = await createAdminAgent(app);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    const db = require('../src/db');
    const user = db.getUserByUsername('admin');

    const res = await agent
      .post(`/users/${user.id}/edit`)
      .send({ username: 'admin', role: 'admin', password: 'short', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Password must be at least 6 characters'));
  });

  it('allows valid password on user edit', async () => {
    const agent = await createAdminAgent(app, 'admin', 'oldpass123');

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    const db = require('../src/db');
    const user = db.getUserByUsername('admin');

    const res = await agent
      .post(`/users/${user.id}/edit`)
      .send({ username: 'admin', role: 'admin', password: 'newpass456', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');
  });

  it('shows error for duplicate username on edit', async () => {
    const agent = await createAdminAgent(app);
    const db = require('../src/db');
    const bcrypt = require('bcryptjs');

    // Create a second user
    db.createClan('TestClan', 10);
    const clan = db.getClanByName('TestClan');
    const hash = await bcrypt.hash('pass123', 10);
    db.createUser('seconduser', hash, 'manager', clan.id);

    // Create a third user
    db.createUser('thirduser', hash, 'manager', clan.id);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    // Try to rename thirduser to seconduser (duplicate)
    const thirdUser = db.getUserByUsername('thirduser');

    const res = await agent
      .post(`/users/${thirdUser.id}/edit`)
      .send({ username: 'seconduser', role: 'manager', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Failed to update user'));
  });

  it('admin can change another user role to manager', async () => {
    const agent = await createAdminAgent(app);
    const db = require('../src/db');
    const bcrypt = require('bcryptjs');

    db.createClan('MyClan', 10);
    const clan = db.getClanByName('MyClan');
    const hash = await bcrypt.hash('pass123', 10);
    db.createUser('targetuser', hash, 'admin', null);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);
    const targetUser = db.getUserByUsername('targetuser');

    const res = await agent
      .post(`/users/${targetUser.id}/edit`)
      .send({ username: 'targetuser', role: 'manager', clan_id: clan.id, _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');

    const updated = db.getUser(targetUser.id);
    assert.strictEqual(updated.role, 'manager');
    assert.strictEqual(updated.clan_id, clan.id);
  });

  it('admin cannot demote themselves', async () => {
    const agent = await createAdminAgent(app);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    const db = require('../src/db');
    const user = db.getUserByUsername('admin');

    const res = await agent
      .post(`/users/${user.id}/edit`)
      .send({ username: 'admin', role: 'manager', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');

    const updated = db.getUser(user.id);
    assert.strictEqual(updated.role, 'admin');
  });

  it('admin can delete another user', async () => {
    const agent = await createAdminAgent(app);
    const db = require('../src/db');
    const bcrypt = require('bcryptjs');

    const hash = await bcrypt.hash('pass123', 10);
    db.createUser('targetuser', hash, 'admin', null);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);
    const targetUser = db.getUserByUsername('targetuser');

    const res = await agent
      .post(`/users/${targetUser.id}/delete`)
      .send({ _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');
    assert.strictEqual(db.getUserByUsername('targetuser'), null);
  });

  it('admin cannot delete themselves', async () => {
    const agent = await createAdminAgent(app);
    const db = require('../src/db');
    const user = db.getUserByUsername('admin');

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    const res = await agent
      .post(`/users/${user.id}/delete`)
      .send({ _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');
    assert.ok(db.getUser(user.id) !== null);
  });

  it('admin cannot delete user ID 1', async () => {
    const agent = await createAdminAgent(app);
    const db = require('../src/db');

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    // User created by createAdminAgent is always ID 1 after reset
    assert.strictEqual(db.getUserByUsername('admin').id, 1);

    const res = await agent
      .post('/users/1/delete')
      .send({ _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/users');
    assert.ok(db.getUser(1) !== null);
  });

  it('admin can generate invite links', async () => {
    const agent = await createAdminAgent(app);

    const usersRes = await agent.get('/users');
    const csrf = extractCsrfToken(usersRes.text);

    const res = await agent
      .post('/users/invite')
      .send({ role: 'admin', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('/invite/'));
  });
});