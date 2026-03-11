const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const ejsLayouts = require('express-ejs-layouts');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 36419;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(ejsLayouts);
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const clanRoutes = require('./src/routes/clans');
const playerRoutes = require('./src/routes/players');
const userRoutes = require('./src/routes/users');
const seedingRoutes = require('./src/routes/seeding');
const whitelistRoutes = require('./src/routes/whitelist');
const importRoutes = require('./src/routes/import');
const apiRoutes = require('./src/routes/api');

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/clans', clanRoutes);
app.use('/players', playerRoutes);
app.use('/users', userRoutes);
app.use('/seeding', seedingRoutes);
app.use('/whitelist', whitelistRoutes);
app.use('/import', importRoutes);
app.use('/api', apiRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { layout: false, title: '404', message: 'Page not found.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { layout: false, title: '500', message: 'Internal server error.' });
});

// Initialize database then start server
const { runCleanup } = require('./src/utils');

db.init().then(() => {
  // Periodic cleanup - every 60 seconds
  setInterval(runCleanup, 60000);

  app.listen(PORT, () => {
    console.log(`Squad Whitelist Manager running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
