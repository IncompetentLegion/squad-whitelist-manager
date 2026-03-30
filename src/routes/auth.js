const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireNoUsers, generateToken, verifyCsrf, csrfCookie, verifyCsrfCookie, loginRateLimit, sessionCookieOptions, validateUsername } = require('../auth');

// GET /setup
router.get('/setup', requireNoUsers, csrfCookie, (req, res) => {
  res.render('setup', { layout: false, title: 'Initial Setup', error: null });
});

// POST /setup
router.post('/setup', requireNoUsers, verifyCsrfCookie, async (req, res) => {
  const { password, password_confirm } = req.body;
  const username = (req.body.username || '').toLowerCase();
  const usernameError = validateUsername(username);
  if (usernameError) {
    return res.render('setup', { layout: false, title: 'Initial Setup', error: usernameError });
  }
  if (!password) {
    return res.render('setup', { layout: false, title: 'Initial Setup', error: 'Password is required.' });
  }
  if (password !== password_confirm) {
    return res.render('setup', { layout: false, title: 'Initial Setup', error: 'Passwords do not match.' });
  }
  if (password.length < 6) {
    return res.render('setup', { layout: false, title: 'Initial Setup', error: 'Password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    db.createUser(username, hash, 'admin', null);
    const user = db.getUserByUsername(username);
    const token = generateToken();
    db.createSession(user.id, token);
    res.cookie('session', token, sessionCookieOptions());
    res.redirect('/');
  } catch (err) {
    res.render('setup', { layout: false, title: 'Initial Setup', error: 'Username already taken.' });
  }
});

// GET /login
router.get('/login', csrfCookie, (req, res) => {
  const count = db.userCount().count;
  if (count === 0) return res.redirect('/setup');
  res.render('login', { layout: false, title: 'Login', error: null });
});

// POST /login
router.post('/login', loginRateLimit, verifyCsrfCookie, async (req, res) => {
  const { password } = req.body;
  const username = (req.body.username || '').toLowerCase();
  const user = db.getUserByUsername(username);
  if (!user) {
    return res.render('login', { layout: false, title: 'Login', error: 'Invalid username or password.' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.render('login', { layout: false, title: 'Login', error: 'Invalid username or password.' });
  }
  const token = generateToken();
  db.createSession(user.id, token);
  res.cookie('session', token, sessionCookieOptions());
  res.redirect('/');
});

// GET /logout
router.get('/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    db.deleteSession(token);
    res.clearCookie('session');
  }
  res.redirect('/login');
});

// GET /password
router.get('/password', requireAuth, (req, res) => {
  res.render('password', { title: 'Change Password', error: null, success: null });
});

// POST /password
router.post('/password', requireAuth, verifyCsrf, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.getUser(req.user.id);
  const match = await bcrypt.compare(current_password, user.password_hash);
  if (!match) {
    return res.render('password', { title: 'Change Password', error: 'Current password is incorrect.', success: null });
  }
  if (new_password !== confirm_password) {
    return res.render('password', { title: 'Change Password', error: 'New passwords do not match.', success: null });
  }
  if (new_password.length < 6) {
    return res.render('password', { title: 'Change Password', error: 'Password must be at least 6 characters.', success: null });
  }
  const hash = await bcrypt.hash(new_password, 10);
  db.updateUserPassword(hash, req.user.id);
  db.deleteUserSessions(req.user.id, req.cookies?.session);
  res.render('password', { title: 'Change Password', error: null, success: 'Password updated successfully.' });
});

// GET /invite/:token
router.get('/invite/:token', csrfCookie, (req, res) => {
  const invite = db.getInviteByToken(req.params.token);
  if (!invite) {
    return res.render('invite', { layout: false, title: 'Invalid Invite', invite: null, error: 'This invite link is invalid, expired, or has already been used.' });
  }
  res.render('invite', { layout: false, title: 'Accept Invite', invite, error: null });
});

// POST /invite/:token
router.post('/invite/:token', verifyCsrfCookie, async (req, res) => {
  const invite = db.getInviteByToken(req.params.token);
  if (!invite) {
    return res.render('invite', { layout: false, title: 'Invalid Invite', invite: null, error: 'This invite link is invalid, expired, or has already been used.' });
  }
  const { password, password_confirm } = req.body;
  const username = (req.body.username || '').toLowerCase();
  const usernameError = validateUsername(username);
  if (usernameError) {
    return res.render('invite', { layout: false, title: 'Accept Invite', invite, error: usernameError });
  }
  if (!password) {
    return res.render('invite', { layout: false, title: 'Accept Invite', invite, error: 'Password is required.' });
  }
  if (password.length < 6) {
    return res.render('invite', { layout: false, title: 'Accept Invite', invite, error: 'Password must be at least 6 characters.' });
  }
  if (password !== password_confirm) {
    return res.render('invite', { layout: false, title: 'Accept Invite', invite, error: 'Passwords do not match.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    db.createUser(username, hash, invite.role, invite.clan_id);
    db.markInviteUsed(req.params.token);
    const user = db.getUserByUsername(username);
    const token = generateToken();
    db.createSession(user.id, token);
    res.cookie('session', token, sessionCookieOptions());
    res.redirect('/');
  } catch (err) {
    return res.render('invite', { layout: false, title: 'Accept Invite', invite, error: 'Username already taken.' });
  }
});

module.exports = router;
