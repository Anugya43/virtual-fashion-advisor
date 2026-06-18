const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("./db");
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.json());

// Ensure a basic users table exists for auth storage
async function ensureUserTable() {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await db.query(createTableSql);
}

async function ensureSwipeTable() {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS swipes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      outfit_id TEXT NOT NULL,
      action TEXT NOT NULL,
      duration_ms INTEGER,
      source TEXT,
      swiped_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await db.query(createTableSql);
}

const PASSWORD_ITERATIONS = 310000;
const PASSWORD_KEYLEN = 64;
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const attempt = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, "sha256").toString("hex");
  return attempt === hash;
}

// Serve static files from the parent directory
app.use(express.static(path.join(__dirname, "..")));

const csvPath = path.join(__dirname, "..", "myntra", "fashion_dataset_processed.csv");

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function loadFashionData() {
  try {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const rows = parseCSV(csvText);
    if (rows.length <= 1) return [];

    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map((cols, index) => {
      const record = headers.reduce((acc, header, idx) => {
        acc[header] = cols[idx] ? cols[idx].trim() : "";
        return acc;
      }, {});

      return {
        id: record.p_id || `row${index + 1}`,
        img: record.img || "",
        colour: record.colour || "",
        occasion_clean: record.occasion_clean || "",
        description: record.description || "",
      };
    }).filter(item => item.img);
  } catch (err) {
    console.error("Failed to load CSV dataset:", err.message);
    return [];
  }
}

const fashionData = loadFashionData();
const fashionById = new Map();
fashionData.forEach(item => {
  if (item.id) fashionById.set(String(item.id), item);
  if (item.p_id) fashionById.set(String(item.p_id), item);
});

function getFashionItem(outfitId) {
  return fashionById.get(String(outfitId)) || null;
}

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Name, email and password are required.' });
  }
  if (!email.includes('@') || password.length < 6) {
    return res.status(400).json({ success: false, error: 'Invalid signup credentials.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { salt, hash } = hashPassword(password);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, password_salt) VALUES ($1, $2, $3, $4) RETURNING id, name, email`,
      [name.trim(), normalizedEmail, hash, salt]
    );
    const user = rows[0];
    return res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }
    console.error('Signup error:', err);
    return res.status(500).json({ success: false, error: 'Unable to create account.' });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  try {
    const { rows } = await db.query(
      `SELECT id, name, email, password_hash, password_salt FROM users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
    }
    return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Signin error:', err);
    return res.status(500).json({ success: false, error: 'Unable to sign in.' });
  }
});

app.post('/api/swipes', async (req, res) => {
  const { user_id, outfit_id, action, duration_ms, source } = req.body || {};
  const validActions = ['like', 'dislike', 'skip'];
  if (!user_id || !outfit_id || !validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'user_id, outfit_id and valid action are required.' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO swipes (user_id, outfit_id, action, duration_ms, source) VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id, outfit_id, action, duration_ms, source, swiped_at`,
      [user_id, outfit_id, action, duration_ms || null, source || 'swipe_app']
    );
    return res.status(201).json({ success: true, swipe: rows[0] });
  } catch (err) {
    console.error('Swipe save error:', err);
    return res.status(500).json({ success: false, error: 'Unable to save swipe.' });
  }
});

app.get('/api/users/:userId/swipe-stats', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, error: 'Invalid user id.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT action, COUNT(*) AS count FROM swipes WHERE user_id = $1 GROUP BY action ORDER BY action`,
      [userId]
    );
    const stats = rows.reduce((acc, row) => {
      acc[row.action] = Number(row.count);
      return acc;
    }, { like: 0, dislike: 0, skip: 0 });
    return res.json({ success: true, stats });
  } catch (err) {
    console.error('Swipe stats error:', err);
    return res.status(500).json({ success: false, error: 'Unable to load swipe stats.' });
  }
});

app.get('/api/analytics/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, error: 'Invalid user id.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT action, outfit_id, swiped_at FROM swipes WHERE user_id = $1 ORDER BY swiped_at ASC`,
      [userId]
    );

    const counts = { like: 0, dislike: 0, skip: 0 };
    const categoryMap = new Map();
    const colorMap = new Map();
    const occasionMap = new Map();
    const dailyMap = new Map();

    rows.forEach(row => {
      const action = row.action;
      counts[action] = (counts[action] || 0) + 1;

      const outfit = getFashionItem(row.outfit_id);
      const bucket = action === 'like' ? 'likes' : action === 'dislike' ? 'dislikes' : null;
      const dateKey = new Date(row.swiped_at).toISOString().slice(0, 10);

      if (bucket) {
        if (outfit) {
          const category = (outfit.occasion_clean || 'Other').trim() || 'Other';
          const categoryEntry = categoryMap.get(category) || { category, likes: 0, dislikes: 0 };
          categoryEntry[bucket] += 1;
          categoryMap.set(category, categoryEntry);

          const color = (outfit.colour || 'Neutral').trim() || 'Neutral';
          const colorEntry = colorMap.get(color) || { color_family: color, likes: 0, dislikes: 0 };
          colorEntry[bucket] += 1;
          colorMap.set(color, colorEntry);

          const occasion = (outfit.occasion_clean || 'Other').trim() || 'Other';
          const occasionEntry = occasionMap.get(occasion) || { occasion, likes: 0, dislikes: 0 };
          occasionEntry[bucket] += 1;
          occasionMap.set(occasion, occasionEntry);
        }
      }

      const dayEntry = dailyMap.get(dateKey) || { day: dateKey, swipes: 0, likes: 0, dislikes: 0 };
      dayEntry.swipes += 1;
      if (action === 'like') dayEntry.likes += 1;
      if (action === 'dislike') dayEntry.dislikes += 1;
      dailyMap.set(dateKey, dayEntry);
    });

    const totalSwipes = counts.like + counts.dislike + counts.skip;
    const firstSwipe = rows[0] ? new Date(rows[0].swiped_at) : null;
    const lastSwipe = rows[rows.length - 1] ? new Date(rows[rows.length - 1].swiped_at) : null;

    const buildAffinity = map => {
      return Array.from(map.values())
        .map(item => ({
          ...item,
          like_rate_pct: item.likes + item.dislikes > 0
            ? Math.round((item.likes / (item.likes + item.dislikes)) * 1000) / 10
            : 0
        }))
        .sort((a, b) => b.likes - a.likes || b.dislikes - a.dislikes)
        .slice(0, 8);
    };

    const activityTimeline = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      const key = day.toISOString().slice(0, 10);
      activityTimeline.push(dailyMap.get(key) || { day: key, swipes: 0, likes: 0, dislikes: 0 });
    }

    return res.json({
      success: true,
      data: {
        user_id: userId,
        swipe_stats: {
          total_swipes: totalSwipes,
          likes: counts.like,
          dislikes: counts.dislike,
          skips: counts.skip,
          like_rate_pct: totalSwipes ? Math.round((counts.like / totalSwipes) * 1000) / 10 : 0,
          active_days: Array.from(dailyMap.keys()).length,
          first_swipe: firstSwipe ? firstSwipe.toISOString() : null,
          last_swipe: lastSwipe ? lastSwipe.toISOString() : null,
        },
        top_categories: buildAffinity(categoryMap),
        color_preferences: buildAffinity(colorMap),
        occasion_affinity: buildAffinity(occasionMap),
        activity_timeline: activityTimeline,
      }
    });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ success: false, error: 'Unable to load analytics.' });
  }
});

app.get("/api/images", (req, res) => {
  res.json({ success: true, data: fashionData });
});

app.get("/api/news", async (req, res) => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'Missing NEWS_API_KEY in server environment.' });
  }

  const newsUrl = new URL('https://newsapi.org/v2/everything');
  newsUrl.searchParams.set('q', 'fashion OR style OR runway OR wardrobe OR couture OR designer OR beauty');
  newsUrl.searchParams.set('qInTitle', 'fashion OR style OR runway OR couture OR designer OR wardrobe OR beauty OR makeup OR trend');
  newsUrl.searchParams.set('domains', 'vogue.com,harpersbazaar.com,elle.com,gq.com,instyle.com,cosmopolitan.com,refinery29.com,marieclaire.com,wwd.com,fashionista.com,glamour.com,grazia.co.uk,graziausa.com');
  newsUrl.searchParams.set('language', 'en');
  newsUrl.searchParams.set('pageSize', '30');
  newsUrl.searchParams.set('sortBy', 'publishedAt');
  newsUrl.searchParams.set('apiKey', apiKey);

  try {
    const response = await fetch(newsUrl.toString());
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ success: false, error: `News API error: ${response.status}`, body });
    }
    const json = await response.json();
    const fashionTerms = /\b(fashion|style|runway|wardrobe|couture|designer|beauty|trend|haute couture|street style)\b/i;
    const allowedSources = [
      'vogue', 'harpersbazaar', 'harper', 'elle', 'gq', 'instyle', 'cosmopolitan', 'refinery29', 'marie claire', 'wwd', 'fashionista', 'glamour', 'grazia'
    ];
    const allowedDomains = [
      'vogue.com', 'harpersbazaar.com', 'elle.com', 'gq.com', 'instyle.com', 'cosmopolitan.com', 'refinery29.com', 'marieclaire.com', 'wwd.com', 'glamour.com', 'fashionista.com', 'grazia.co.uk', 'graziausa.com'
    ];
    const rawArticles = Array.isArray(json.articles) ? json.articles : [];
    const filteredArticles = rawArticles.filter(article => {
      const sourceName = (article.source?.name || '').toLowerCase();
      const url = (article.url || '').toLowerCase();
      const text = `${article.title || ''} ${article.description || article.content || ''}`.toLowerCase();
      const sourceMatch = allowedSources.some(source => sourceName.includes(source));
      const domainMatch = allowedDomains.some(domain => url.includes(domain));
      return (sourceMatch || domainMatch) && fashionTerms.test(text);
    });
    const articles = filteredArticles.map(article => ({
      title: article.title || 'Fashion update',
      description: article.description || article.content || 'Latest fashion news and trends.',
      url: article.url || '#',
      source: article.source?.name || 'NewsAPI',
      publishedAt: article.publishedAt,
      imageUrl: (article.urlToImage || article.imageUrl || '').startsWith('http') ? (article.urlToImage || article.imageUrl) : '',
      category: 'trends',
    })).slice(0, 10);
    return res.json({ success: true, articles });
  } catch (err) {
    console.error('News API fetch failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch fashion news.' });
  }
});

// Route for the main swipe UI
app.get("/swipe", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "swipe.html"));
});

// Route for the analytics dashboard
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard.html"));
});

app.get("/", (req, res) => {
  res.send("Server running");
});

console.log('Initializing database tables...');
Promise.all([ensureUserTable(), ensureSwipeTable()])
  .then(() => {
    console.log('Database tables initialized successfully');
    const server = app.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
    
    server.on('error', (err) => {
      console.error('Server error:', err);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });