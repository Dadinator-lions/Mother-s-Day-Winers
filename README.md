# Mother's Day Winers 🍷

A tiny wine-ranking web app for an annual Mother's Day wine tasting. Each guest rates every wine 1–5 in three categories (Name, Label, Taste). Scores persist year over year so you can compare across events.

- **Password gate:** `boozin` (override with `APP_PASSWORD` env var)
- **Stack:** Node.js + Express + SQLite (`better-sqlite3`)
- **Hosting:** Railway (with a persistent volume for the SQLite file)

## Local dev

```bash
npm install
npm start
# open http://localhost:3000
```

The DB file is created at `./wines.db` by default. Override with `DB_PATH`.

## Pages

- `/login` — password entry
- `/` — rank wines (pick event + your name, tap stars)
- `/leaderboard.html` — live per-event leaderboard + all-time averages
- `/admin.html` — create events, add/remove participants

## Deploying to Railway

1. **Push to GitHub** (already pointed at `https://github.com/Dadinator-lions/Mother-s-Day-Winers.git`):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/Dadinator-lions/Mother-s-Day-Winers.git
   git push -u origin main
   ```
2. **Create a Railway project** from this repo (railway.com → New Project → Deploy from GitHub).
3. **Add a Volume** so SQLite data survives deploys:
   - Service → Settings → Volumes → New Volume
   - Mount path: `/data`
4. **Set environment variables** (Service → Variables):
   - `DB_PATH` = `/data/wines.db`
   - `APP_PASSWORD` = `boozin` (or whatever you want)
5. Railway will auto-deploy on every push to `main`. The first deploy seeds the wine list.

## Data model

- `wines` — pre-seeded with the 14 wines below
- `events` — one per year (unique `event_date`)
- `participants` — global list, reused across years
- `event_participants` — who attended which year
- `rankings` — `(event_id, participant_id, wine_id)` → 3 scores

Because participants and wines are global, you can query across all years.

### Seed wine list

**Whites / Rosés:** Mawby Sex, Brut Rose, La Belle Angele Pinot Gris, Belle Reserva Sauvignon Blanc, No Strings Attached Chardonnay, Mosketto, Delicate Sweet Pink, LYV Rose

**Reds:** Prophecy Pinot Noir, Thousand Lives Red Blend, Thievery Zinfandel, BeCalm Malbec, Martin's Pick Up Shiraz, 1000 Stories Cabernet Sauvignon

To add more wines later, just insert into the `wines` table directly (SQLite shell) — the app picks them up automatically.
