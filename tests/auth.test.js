const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, setup, resetDatabase, extractCsrfCookie, extractCsrfToken, createAdminAgent } = require('./helpers');

describe('Auth', () => {
  before(async () => {
    await setup();
  });

  beforeEach(() => {
    resetDatabase();
  });

  it('redirects to setup when no users exist', async () => {
    const res = await request(app).get('/login');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/setup');
  });

  it('redirects unauthenticated users to setup when no users exist', async () => {
    const res = await request(app).get('/');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/setup');
  });

  it('creates admin via setup and logs in automatically', async () => {
    const agent = request.agent(app);
    const getRes = await agent.get('/setup');
    assert.strictEqual(getRes.status, 200);

    const csrf = extractCsrfCookie(getRes);
    const res = await agent
      .post('/setup')
      .send({ username: 'admin', password: 'secret123', password_confirm: 'secret123', _csrf: csrf });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');

    const dash = await agent.get('/');
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.text.includes('Dashboard'));
  });

  it('rejects setup with mismatched passwords', async () => {
    const agent = request.agent(app);
    const getRes = await agent.get('/setup');
    const csrf = extractCsrfCookie(getRes);

    const res = await agent
      .post('/setup')
      .send({ username: 'admin', password: 'secret123', password_confirm: 'different', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Passwords do not match'));
  });

  it('rejects setup with short password', async () => {
    const agent = request.agent(app);
    const getRes = await agent.get('/setup');
    const csrf = extractCsrfCookie(getRes);

    const res = await agent
      .post('/setup')
      .send({ username: 'admin', password: 'short', password_confirm: 'short', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('at least 6 characters'));
  });

  it('blocks setup when users already exist', async () => {
    await createAdminAgent(app);
    const res = await request(app).get('/setup');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/login');
  });

  it('blocks setup POST when users already exist', async () => {
    await createAdminAgent(app);
    const agent = request.agent(app);
    const res = await agent.get('/setup');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/login');
  });

  it('rejects invalid login credentials', async () => {
    await createAdminAgent(app, 'admin', 'correctpass');
    const agent = request.agent(app);
    const getRes = await agent.get('/login');
    const csrf = extractCsrfCookie(getRes);

    const res = await agent
      .post('/login')
      .send({ username: 'admin', password: 'wrongpass', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Invalid username or password'));
  });

  it('rejects login for non-existent user', async () => {
    await createAdminAgent(app);
    const agent = request.agent(app);
    const getRes = await agent.get('/login');
    const csrf = extractCsrfCookie(getRes);

    const res = await agent
      .post('/login')
      .send({ username: 'nobody', password: 'wrongpass', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Invalid username or password'));
  });

  it('logs out successfully', async () => {
    const agent = await createAdminAgent(app);
    const res = await agent.get('/logout');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/login');

    const dash = await agent.get('/');
    assert.strictEqual(dash.status, 302);
    assert.strictEqual(dash.headers.location, '/login');
  });

  it('allows password change', async () => {
    const agent = await createAdminAgent(app, 'admin', 'oldpass123');

    const pwRes = await agent.get('/password');
    const csrf = extractCsrfToken(pwRes.text);

    const res = await agent
      .post('/password')
      .send({ current_password: 'oldpass123', new_password: 'newpass456', confirm_password: 'newpass456', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Password updated successfully'));
  });

  it('rejects password change with wrong current password', async () => {
    const agent = await createAdminAgent(app, 'admin', 'oldpass123');

    const pwRes = await agent.get('/password');
    const csrf = extractCsrfToken(pwRes.text);

    const res = await agent
      .post('/password')
      .send({ current_password: 'wrongpass', new_password: 'newpass456', confirm_password: 'newpass456', _csrf: csrf });

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes('Current password is incorrect'));
  });
});
