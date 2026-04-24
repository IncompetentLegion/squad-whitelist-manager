const crypto = require('crypto');
const db = require('./db');

// CSRF secret — regenerated each server start (invalidates old tokens, which is fine)
const CSRF_SECRET = crypto.randomBytes(32).toString('hex');

// Login rate limiting — per IP, 5 attempts per 60 seconds
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 5;

let _rateLimitInterval = null;

function startRateLimitCleanup() {
  if (_rateLimitInterval) return;
  _rateLimitInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts) {
      if (now - data.start > RATE_LIMIT_WINDOW) loginAttempts.delete(ip);
    }
  }, 300000);
}

function stopRateLimitCleanup() {
  if (_rateLimitInterval) {
    clearInterval(_rateLimitInterval);
    _rateLimitInterval = null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.redirect('/login');
  }
  const session = db.getSessionByToken(token);
  if (!session) {
    res.clearCookie('session');
    return res.redirect('/login');
  }
  req.user = {
    id: session.user_id,
    username: session.username,
    role: session.role,
    clan_id: session.clan_id
  };
  res.locals.user = req.user;
  // Set CSRF token derived from session for authenticated users
  res.locals.csrfToken = crypto.createHmac('sha256', CSRF_SECRET).update(token).digest('hex');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', { layout: false, title: 'Access Denied', message: 'Admin access required.' });
  }
  next();
}

function redirectIfNoUsers(req, res, next) {
  const count = db.userCount().count;
  if (count === 0) {
    return res.redirect('/setup');
  }
  next();
}

function requireNoUsers(req, res, next) {
  const count = db.userCount().count;
  if (count > 0) {
    return res.redirect('/login');
  }
  next();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}

// CSRF validation for authenticated POST requests
function verifyCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return res.status(403).send('Forbidden');
  const expected = crypto.createHmac('sha256', CSRF_SECRET).update(sessionToken).digest('hex');
  const submitted = req.body?._csrf;
  if (!submitted || Buffer.byteLength(expected) !== Buffer.byteLength(submitted) ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) {
    return res.status(403).render('error', { layout: false, title: '403', message: 'Invalid or missing CSRF token.' });
  }
  next();
}

// CSRF for unauthenticated forms (login/setup) — double-submit cookie pattern
function csrfCookie(req, res, next) {
  let token = req.cookies?._csrf;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie('_csrf', token, { httpOnly: true, sameSite: 'strict', maxAge: 600000 });
  }
  res.locals.csrfToken = token;
  next();
}

function verifyCsrfCookie(req, res, next) {
  const cookieToken = req.cookies?._csrf;
  const submitted = req.body?._csrf;
  if (!cookieToken || !submitted || Buffer.byteLength(cookieToken) !== Buffer.byteLength(submitted) ||
      !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(submitted))) {
    return res.status(403).render('error', { layout: false, title: '403', message: 'Invalid or missing CSRF token.' });
  }
  // Generate a fresh token for re-renders (e.g., validation errors)
  const freshToken = crypto.randomBytes(32).toString('hex');
  res.cookie('_csrf', freshToken, { httpOnly: true, sameSite: 'strict', maxAge: 600000 });
  res.locals.csrfToken = freshToken;
  next();
}

function validateUsername(username) {
  if (!username) return 'Username is required.';
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (username.length > 32) return 'Username must be 32 characters or fewer.';
  if (!/^[a-z0-9._-]+$/.test(username)) return 'Username can only contain letters, numbers, dots, hyphens, and underscores.';
  return null;
}

function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.start > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { start: now, count: 1 });
    return next();
  }
  record.count++;
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).render('error', { layout: false, title: 'Too Many Requests', message: 'Too many login attempts. Please try again in a minute.' });
  }
  next();
}

function resetLoginAttempts() {
  loginAttempts.clear();
}

module.exports = { requireAuth, requireAdmin, redirectIfNoUsers, requireNoUsers, generateToken, sessionCookieOptions, verifyCsrf, csrfCookie, verifyCsrfCookie, loginRateLimit, validateUsername, validateDate, resetLoginAttempts, startRateLimitCleanup, stopRateLimitCleanup };
