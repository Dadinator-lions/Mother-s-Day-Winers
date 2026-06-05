const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || 'boozin';
const AUTH_COOKIE = 'mdw_auth';
// On Railway, mount a volume at /data and the DB persists across deploys.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wines.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS wines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_date TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS event_wines (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, wine_id)
  );
  CREATE TABLE IF NOT EXISTS event_participants (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, participant_id)
  );
  CREATE TABLE IF NOT EXISTS rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    name_score INTEGER NOT NULL CHECK(name_score BETWEEN 1 AND 5),
    label_score INTEGER NOT NULL CHECK(label_score BETWEEN 1 AND 5),
    taste_score INTEGER NOT NULL CHECK(taste_score BETWEEN 1 AND 5),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(event_id, participant_id, wine_id)
  );
`);

const SEED_WINES = [
  ['Mawby Sex', 'white_rose'],
  ['Brut Rose', 'white_rose'],
  ['La Belle Angele Pinot Gris', 'white_rose'],
  ['Belle Reserva Sauvignon Blanc', 'white_rose'],
  ['No Strings Attached Chardonnay', 'white_rose'],
  ['Mosketto', 'white_rose'],
  ['Delicate Sweet Pink', 'white_rose'],
  ['LYV Rose', 'white_rose'],
  ['Prophecy Pinot Noir', 'red'],
  ['Thousand Lives Red Blend', 'red'],
  ['Thievery Zinfandel', 'red'],
  ['BeCalm Malbec', 'red'],
  ["Martin's Pick Up Shiraz", 'red'],
  ['1000 Stories Cabernet Sauvignon', 'red'],
];
const insertWine = db.prepare('INSERT OR IGNORE INTO wines (name, category) VALUES (?, ?)');
const seedTx = db.transaction(() => { for (const [n, c] of SEED_WINES) insertWine.run(n, c); });
seedTx();

const app = express();
app.use(express.json());
app.use(cookieParser());

function requireAuth(req, res, next) {
  if (req.cookies[AUTH_COOKIE] === PASSWORD) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login');
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== PASSWORD) return res.status(401).json({ error: 'wrong password' });
  res.cookie(AUTH_COOKIE, PASSWORD, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie(AUTH_COOKIE); res.json({ ok: true }); });

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// --- API ---

app.get('/api/wines', (_req, res) => {
  res.json(db.prepare('SELECT id, name, category FROM wines ORDER BY category, name').all());
});

app.post('/api/wines', (req, res) => {
  const { name, category } = req.body || {};
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'name required' });
  if (category !== 'white_rose' && category !== 'red') {
    return res.status(400).json({ error: 'category must be white_rose or red' });
  }
  try {
    const info = db.prepare('INSERT INTO wines (name, category) VALUES (?, ?)').run(trimmed, category);
    res.json({ id: info.lastInsertRowid, name: trimmed, category });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      const row = db.prepare('SELECT id, name, category FROM wines WHERE name = ?').get(trimmed);
      return res.json(row);
    }
    res.status(500).json({ error: String(e) });
  }
});

app.patch('/api/wines/:id', (req, res) => {
  const { name, category } = req.body || {};
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'name required' });
  if (category && category !== 'white_rose' && category !== 'red') {
    return res.status(400).json({ error: 'invalid category' });
  }
  try {
    if (category) {
      db.prepare('UPDATE wines SET name = ?, category = ? WHERE id = ?').run(trimmed, category, req.params.id);
    } else {
      db.prepare('UPDATE wines SET name = ? WHERE id = ?').run(trimmed, req.params.id);
    }
    res.json({ id: +req.params.id, name: trimmed, category });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'name already exists' });
    res.status(500).json({ error: String(e) });
  }
});

// Seed event_wines with all wines if empty (covers new events + legacy events).
function ensureEventWines(eventId) {
  const has = db.prepare('SELECT 1 FROM event_wines WHERE event_id = ? LIMIT 1').get(eventId);
  if (has) return;
  const wines = db.prepare('SELECT id FROM wines').all();
  const ins = db.prepare('INSERT OR IGNORE INTO event_wines (event_id, wine_id) VALUES (?, ?)');
  db.transaction(() => { for (const w of wines) ins.run(eventId, w.id); })();
}

app.get('/api/events/:id/wines', (req, res) => {
  ensureEventWines(req.params.id);
  res.json(db.prepare(`
    SELECT w.id, w.name, w.category
    FROM event_wines ew
    JOIN wines w ON w.id = ew.wine_id
    WHERE ew.event_id = ?
    ORDER BY w.category, w.name
  `).all(req.params.id));
});

// Returns all wines plus an `included` flag for this event — used by admin.
app.get('/api/events/:id/wines/all', (req, res) => {
  ensureEventWines(req.params.id);
  res.json(db.prepare(`
    SELECT w.id, w.name, w.category,
      CASE WHEN ew.wine_id IS NULL THEN 0 ELSE 1 END AS included
    FROM wines w
    LEFT JOIN event_wines ew ON ew.wine_id = w.id AND ew.event_id = ?
    ORDER BY w.category, w.name
  `).all(req.params.id));
});

app.post('/api/events/:id/wines/:wineId', (req, res) => {
  db.prepare('INSERT OR IGNORE INTO event_wines (event_id, wine_id) VALUES (?, ?)').run(req.params.id, req.params.wineId);
  res.json({ ok: true });
});

app.delete('/api/events/:id/wines/:wineId', (req, res) => {
  db.prepare('DELETE FROM event_wines WHERE event_id = ? AND wine_id = ?').run(req.params.id, req.params.wineId);
  res.json({ ok: true });
});

app.get('/api/events', (_req, res) => {
  res.json(db.prepare('SELECT id, event_date FROM events ORDER BY event_date DESC').all());
});

app.post('/api/events', (req, res) => {
  const { event_date } = req.body || {};
  if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return res.status(400).json({ error: 'event_date must be YYYY-MM-DD' });
  }
  try {
    const info = db.prepare('INSERT INTO events (event_date) VALUES (?)').run(event_date);
    ensureEventWines(info.lastInsertRowid);
    res.json({ id: info.lastInsertRowid, event_date });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      const row = db.prepare('SELECT id, event_date FROM events WHERE event_date = ?').get(event_date);
      return res.json(row);
    }
    res.status(500).json({ error: String(e) });
  }
});

app.patch('/api/events/:id', (req, res) => {
  const { event_date } = req.body || {};
  if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return res.status(400).json({ error: 'event_date must be YYYY-MM-DD' });
  }
  try {
    db.prepare('UPDATE events SET event_date = ? WHERE id = ?').run(event_date, req.params.id);
    res.json({ id: +req.params.id, event_date });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'event date already exists' });
    res.status(500).json({ error: String(e) });
  }
});

app.delete('/api/events/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/participants', (_req, res) => {
  res.json(db.prepare('SELECT id, name FROM participants ORDER BY name').all());
});

app.get('/api/events/:id/participants/all', (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.name,
      CASE WHEN ep.participant_id IS NULL THEN 0 ELSE 1 END AS included
    FROM participants p
    LEFT JOIN event_participants ep ON ep.participant_id = p.id AND ep.event_id = ?
    ORDER BY p.name
  `).all(req.params.id));
});

app.post('/api/events/:id/participants/:participantId', (req, res) => {
  db.prepare('INSERT OR IGNORE INTO event_participants (event_id, participant_id) VALUES (?, ?)')
    .run(req.params.id, req.params.participantId);
  res.json({ ok: true });
});

app.get('/api/events/:id/participants', (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.name
    FROM participants p
    JOIN event_participants ep ON ep.participant_id = p.id
    WHERE ep.event_id = ?
    ORDER BY p.name
  `).all(req.params.id));
});

app.post('/api/events/:id/participants', (req, res) => {
  const { name } = req.body || {};
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'name required' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'event not found' });
  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO participants (name) VALUES (?)').run(trimmed);
    const p = db.prepare('SELECT id, name FROM participants WHERE name = ?').get(trimmed);
    db.prepare('INSERT OR IGNORE INTO event_participants (event_id, participant_id) VALUES (?, ?)').run(req.params.id, p.id);
    return p;
  });
  res.json(tx());
});

app.delete('/api/participants/:id', (req, res) => {
  db.prepare('DELETE FROM participants WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/participants/:id', (req, res) => {
  const { name } = req.body || {};
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'name required' });
  try {
    db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(trimmed, req.params.id);
    res.json({ id: +req.params.id, name: trimmed });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'name already exists' });
    res.status(500).json({ error: String(e) });
  }
});

app.delete('/api/events/:eventId/participants/:participantId', (req, res) => {
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND participant_id = ?')
    .run(req.params.eventId, req.params.participantId);
  res.json({ ok: true });
});

app.get('/api/events/:id/rankings', (req, res) => {
  const rows = db.prepare(`
    SELECT r.wine_id, r.participant_id, r.name_score, r.label_score, r.taste_score
    FROM rankings r WHERE r.event_id = ?
  `).all(req.params.id);
  res.json(rows);
});

app.get('/api/events/:id/rankings/:participantId', (req, res) => {
  const rows = db.prepare(`
    SELECT wine_id, name_score, label_score, taste_score
    FROM rankings WHERE event_id = ? AND participant_id = ?
  `).all(req.params.id, req.params.participantId);
  res.json(rows);
});

app.post('/api/events/:id/rankings/:participantId', (req, res) => {
  const { wine_id, name_score, label_score, taste_score } = req.body || {};
  const scores = [name_score, label_score, taste_score];
  if (!wine_id || scores.some(s => !Number.isInteger(s) || s < 1 || s > 5)) {
    return res.status(400).json({ error: 'wine_id + 3 integer scores 1-5 required' });
  }
  db.prepare(`
    INSERT INTO rankings (event_id, participant_id, wine_id, name_score, label_score, taste_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(event_id, participant_id, wine_id) DO UPDATE SET
      name_score = excluded.name_score,
      label_score = excluded.label_score,
      taste_score = excluded.taste_score,
      updated_at = datetime('now')
  `).run(req.params.id, req.params.participantId, wine_id, ...scores);
  res.json({ ok: true });
});

app.get('/api/events/:id/leaderboard', (req, res) => {
  ensureEventWines(req.params.id);
  const rows = db.prepare(`
    SELECT w.id, w.name, w.category,
      COUNT(r.id) AS votes,
      ROUND(AVG(r.name_score), 2) AS avg_name,
      ROUND(AVG(r.label_score), 2) AS avg_label,
      ROUND(AVG(r.taste_score), 2) AS avg_taste,
      ROUND(AVG(r.name_score + r.label_score + r.taste_score), 2) AS avg_total
    FROM event_wines ew
    JOIN wines w ON w.id = ew.wine_id
    LEFT JOIN rankings r ON r.wine_id = w.id AND r.event_id = ew.event_id
    WHERE ew.event_id = ?
    GROUP BY w.id
    ORDER BY avg_total DESC NULLS LAST, w.name
  `).all(req.params.id);
  res.json(rows);
});

// Historical: averages across all events per wine
app.get('/api/history/wines', (_req, res) => {
  const rows = db.prepare(`
    SELECT w.id, w.name, w.category,
      COUNT(r.id) AS votes,
      COUNT(DISTINCT r.event_id) AS events_count,
      ROUND(AVG(r.name_score), 2) AS avg_name,
      ROUND(AVG(r.label_score), 2) AS avg_label,
      ROUND(AVG(r.taste_score), 2) AS avg_taste,
      ROUND(AVG(r.name_score + r.label_score + r.taste_score), 2) AS avg_total
    FROM wines w
    LEFT JOIN rankings r ON r.wine_id = w.id
    GROUP BY w.id
    ORDER BY avg_total DESC NULLS LAST, w.name
  `).all();
  res.json(rows);
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/leaderboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'leaderboard.html')));

app.listen(PORT, () => console.log(`Mother's Day Winers listening on ${PORT} (db: ${DB_PATH})`));
