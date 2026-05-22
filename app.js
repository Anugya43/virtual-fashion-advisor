require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const routes              = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// ── Security ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin     : process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// ── Rate limiting ──────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs : 15 * 60 * 1000, // 15 minutes
  max      : 300,
  message  : { success: false, error: 'Too many requests. Please try again later.' },
}));

// ── Tighter limit on auth endpoints ───────────────────────────
app.use('/api/auth/', rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 20,
  message  : { success: false, error: 'Too many auth attempts.' },
}));

// ── Parsing ────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Static assets (dataset images served here) ────────────────
app.use('/images', express.static(path.resolve(process.env.IMAGES_BASE_PATH || './dataset/images')));

// ── Health check ───────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status : 'ok',
  version: '2.0.0',
  env    : process.env.NODE_ENV,
  time   : new Date().toISOString(),
}));

// ── API routes ────────────────────────────────────────────────
app.use('/api', routes);

// ── 404 + Error handlers (must be last) ───────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀  Fashion Advisor API running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV}`);
  console.log(`   Health      : http://localhost:${PORT}/health\n`);
});

module.exports = app;
