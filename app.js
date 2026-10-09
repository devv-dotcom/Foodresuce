const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');

// The public application is started from this directory, while the local
// development credentials are kept with the backend source. Prefer a root
// .env when one exists, then fall back to backend/.env for the documented
// project layout.
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, 'backend', '.env') });

const pool = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const businessRoutes = require('./routes/businessRoutes');
const donationRoutes = require('./routes/donationRoutes');
const ngoRoutes = require('./routes/ngoRoutes');
const adminRoutes = require('./routes/adminRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const contactRoutes = require('./routes/contactRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const profileRoutes = require('./routes/profileRoutes');
const impactRoutes = require('./routes/impactRoutes');
const commonRoutes = require('./routes/commonRoutes');
const chatRoutes = require('./routes/chatRoutes');
const partnerRoutes = require('./routes/partnerRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const { runAutoMigration } = require('./database/autoMigrate');

const app = express();
const port = Number(process.env.PORT || 5000);
// CORS_ORIGINS is the preferred comma-separated allow-list. CLIENT_ORIGIN is
// retained as a backwards-compatible single-origin setting for deployments
// that already use it.
const corsOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
const corsMiddleware = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});
app.use((req, res, next) => {
  const origin = req.get('origin');
  let isSameOrigin = false;
  let isLocalDevelopmentOrigin = false;
  try {
    const parsedOrigin = new URL(origin);
    isSameOrigin = Boolean(origin) && parsedOrigin.host === req.get('host');
    isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production'
      && ['localhost', '127.0.0.1', '::1'].includes(parsedOrigin.hostname);
  } catch (_) { isSameOrigin = false; }
  // Same-origin and non-browser requests are safe. Other browser origins need
  // an explicit CORS_ORIGINS allow-list entry in deployment configuration.
  // Local static servers are supported only outside production.
  if (origin && !isSameOrigin && !isLocalDevelopmentOrigin && !corsOrigins.includes(origin)) {
    return res.status(403).json({ success: false, message: 'Origin is not allowed.' });
  }
  return corsMiddleware(req, res, next);
});
app.use(express.json({ limit: '1mb' }));
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, message: 'Food Rescue authentication API is healthy.' });
  } catch (error) { next(error); }
});

app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/ngo', ngoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/impact', impactRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/partner', partnerRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api', commonRoutes);
// Explicit HTML page routes – ensures every dashboard is served correctly
// even if express.static has path-matching issues on some systems
const sendPage = (...parts) => (_req, res) => res.sendFile(path.join(__dirname, 'frontend', ...parts));
// The former generic dashboard mixed receiver and NGO functionality.  Keep
// old bookmarks safe, but route them through real sign-in and role routing.
app.get('/dashboard.html',           (_req, res) => res.redirect(302, '/login.html'));
app.get('/partner/dashboard.html',  (_req, res) => res.redirect(302, '/ngo/dashboard.html'));
app.get('/business/dashboard.html', sendPage('business', 'dashboard.html'));
app.get('/ngo/dashboard.html',      sendPage('ngo',       'dashboard.html'));
app.get('/volunteer/dashboard.html', (_req, res) => res.redirect(302, '/login.html'));
app.get('/admin/dashboard.html',    sendPage('admin',     'dashboard.html'));
app.get('/donate.html',             sendPage('donate.html'));
app.get('/donation-details.html',   sendPage('donation-details.html'));
app.get('/login.html',              sendPage('login.html'));
app.get('/register.html',           sendPage('register.html'));
app.get('/freshness.html',          sendPage('freshness.html'));
app.get('/404.html',                sendPage('404.html'));

// Serve remaining public assets only after canonical dashboard aliases.
app.use(express.static(path.join(__dirname, 'frontend')));

// JSON 404 for unmatched API routes
app.use('/api', (_req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));

// HTML 404 for everything else — serve the branded not-found page
app.get('*', (_req, res) => res.status(404).sendFile(path.join(__dirname, 'frontend', '404.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  const databaseUnavailable = new Set([
    'EACCES',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR'
  ]);
  if (databaseUnavailable.has(error.code)) {
    return res.status(503).json({ success: false, message: 'The Food Rescue database is unavailable. Verify MySQL environment variables (MYSQL_URL, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) on Render.' });
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    const maxSize = _req.uploadImageMaxSize || '5MB';
    return res.status(400).json({ success: false, message: `Image size must not exceed ${maxSize}.` });
  }
  if (error.message?.includes('Only PNG')) return res.status(400).json({ success: false, message: error.message });
  if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' });
});

const { seedAdminAccount } = require('./services/adminSeed');

const startServer = async () => {
  // Apply additive schema updates before accepting traffic so handlers never
  // race startup migrations on the first request after a deploy.
  await runAutoMigration();
  try {
    await seedAdminAccount();
  } catch (error) {
    // Keep health/API routes online so the database failure is reported as a
    // 503 to clients instead of silently converting it to an auth failure.
    console.error('[Admin Seed] Provisioning failed; administrator sign-in may be unavailable.', error.code || 'ADMIN_SEED_FAILED');
  }
  app.listen(port, () => console.log(`Food Rescue API listening on port ${port}`));
};

startServer().catch(error => {
  console.error('Food Rescue startup failed:', error.code || 'STARTUP_ERROR', error.message);
  process.exitCode = 1;
});
