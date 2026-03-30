const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin, verifyCsrf, generateToken, validateUsername } = require('../auth');

function renderUsers(res, overrides = {}) {
  const data = {
    title: 'Users',
    users: db.getAllUsers(),
    clans: db.getAllClans(),
    invites: db.getPendingInvites(),
    error: null,
    success: null,
    ...overrides
  };
  res.render('users', data);
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  renderUsers(res);
});

router.post('/invite', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const { role, clan_id } = req.body;
  const validRole = role === 'admin' ? 'admin' : 'manager';
  if (validRole === 'manager' && !clan_id) {
    return renderUsers(res, { error: 'Please select a clan for manager invites.' });
  }
  if (clan_id) {
    const clan = db.getClan(parseInt(clan_id));
    if (!clan) {
      return renderUsers(res, { error: 'Clan not found.' });
    }
  }
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const assignedClan = validRole === 'manager' && clan_id ? parseInt(clan_id) : null;
  db.createInvite(token, validRole, assignedClan, expiresAt, req.user.id);
  const inviteUrl = `${req.protocol}://${req.get('host')}/invite/${token}`;
  renderUsers(res, { success: inviteUrl });
});

router.post('/invite/:id/revoke', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  db.deleteInvite(parseInt(req.params.id));
  res.redirect('/users');
});

router.post('/:id/edit', requireAuth, requireAdmin, verifyCsrf, async (req, res) => {
  const { password, role, clan_id } = req.body;
  const username = (req.body.username || '').toLowerCase();
  const targetUser = db.getUser(parseInt(req.params.id));
  if (!targetUser) return res.redirect('/users');

  // Prevent admins from demoting themselves
  if (parseInt(req.params.id) === req.user.id && role !== 'admin') {
    return res.redirect('/users');
  }

  const usernameError = validateUsername(username);
  if (usernameError) {
    return renderUsers(res, { error: usernameError });
  }

  const validRole = role === 'admin' ? 'admin' : 'manager';
  const assignedClan = validRole === 'manager' && clan_id ? parseInt(clan_id) : null;
  try {
    db.updateUser(username, validRole, assignedClan, parseInt(req.params.id));
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      db.updateUserPassword(hash, parseInt(req.params.id));
    }
    res.redirect('/users');
  } catch (err) {
    res.redirect('/users');
  }
});

router.post('/:id/delete', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const targetId = parseInt(req.params.id);
  // Prevent self-deletion and protect the original owner (ID 1, created during setup)
  if (targetId === req.user.id || targetId === 1) {
    return res.redirect('/users');
  }
  db.deleteUser(targetId);
  res.redirect('/users');
});

module.exports = router;
