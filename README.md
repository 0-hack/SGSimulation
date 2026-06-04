# 🇸🇬 Singapore Nation Builder

A browser-based, mobile-first **society simulation** game. Start at independence
in **1965** and grow the little red dot into a thriving nation — build housing,
power, water and industry; pass laws and policies; weather historical crises; and
watch your society react in real time as the days, months and decades roll by.

Save your nation to a **centralised server** and share a link so other players can
**visit your Singapore** and watch how you built it.

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20vanilla%20JS-informational)

---

## ✨ Features

- **Play as the Prime Minister** from National Day, 9 Aug 1965.
- **Build a real city** on a pan/zoom tile map (touch + mouse): HDB flats, kampongs,
  condos, power & desalination/NEWater plants, reservoirs, factories, a container
  port, the CBD, schools, hospitals, the MRT, parks, Gardens by the Bay and more —
  each unlocking in its historical era.
- **A living society model.** Population grows from births and migration, constrained
  by housing, jobs, power and water. Approval responds to overcrowding, unemployment,
  utility shortages, pollution, health, education, safety, taxes and your policies.
- **Govern with laws & policies** — income tax, GST, CPF, National Service, the
  Bilingual Policy, meritocracy, immigration, family planning ("Stop at Two" →
  "Have Three"), healthcare, anti-corruption (CPIB), EDB investment incentives,
  press control, the car quota/ERP and water conservation — each with real trade-offs.
- **History happens.** Scripted events (British withdrawal, 1973 oil crisis, 1985
  recession, the MRT debate, AFC '97, SARS, GFC, COVID-19) plus random events
  (floods, dengue, haze, investment offers) — some demand a decision.
- **Time controls** — pause / play / fast / hyper. Watch finances, population and
  meters move every day.
- **Cloud save & share** to the central server, with a shareable link.
- **Visit other nations** — browse a public gallery or open a shared `/world/<id>`
  link to tour another player's Singapore read-only and even watch it run.
- **Auto-saves locally** on your device between sessions.

---

## 🚀 Running it

Requires **Node.js 18+**.

```bash
npm install
npm start
# open http://localhost:3000
```

Set a custom port with `PORT=8080 npm start`.

### Deploying as "your hosted server"

The whole game (client + API + database) is one Node process, so any host that runs
Node works (a VM, Render, Railway, Fly.io, a Raspberry Pi, etc.):

1. Copy the repo to the server and run `npm install --omit=dev`.
2. Start it with a process manager, e.g. `pm2 start server/server.js` or a systemd
   unit, behind a reverse proxy (nginx/Caddy) terminating HTTPS.
3. World saves persist in `data/worlds.db` (SQLite). Back up that file to keep player
   nations. Mount it on a persistent volume if your host has ephemeral disks.

No external services or API keys are needed.

---

## 🧪 Tests

```bash
npm test          # engine simulation (30 yrs) + REST API
npm run test:e2e  # headless-browser gameplay + cross-player "visit" flow
npm run test:all  # everything
```

The e2e suite uses Puppeteer; install a browser once with
`npx puppeteer browsers install chrome` if it isn't cached.

---

## 🏗️ Architecture

```
server/
  server.js        Express app: static client + REST API (+ SPA fallback)
  db.js            SQLite (better-sqlite3) persistence + public browse list
  test/            smoke (engine+API), browser (e2e), visit (multiplayer) tests
public/
  index.html       app shell (menu, HUD, canvas, sheets, modals)
  css/style.css    mobile-first responsive UI
  js/
    data.js        all game content: buildings, policies, events (tuning lives here)
    engine.js      the simulation — pure logic, day-by-day tick, unit-testable
    grid.js        canvas city renderer with pan/zoom & tap-to-build
    ui.js          renders the bottom-sheet panels (build/policy/stats/news)
    api.js         client for the world server
    main.js        controller: game loop, input, cloud save, visiting
```

### Save API

| Method & path           | Purpose                                            |
|-------------------------|----------------------------------------------------|
| `POST /api/worlds`      | Create a world → returns `{ id, token }`           |
| `PUT  /api/worlds/:id`  | Update a world (requires `x-world-token`)          |
| `GET  /api/worlds/:id`  | Load a full world (resume or visit)                |
| `GET  /api/worlds`      | Browse public worlds (summary metadata)            |
| `DELETE /api/worlds/:id`| Delete a world (requires token)                    |

Each saved world returns a secret edit **token** once, kept by the owner (in
`localStorage`); the token is never exposed to visitors, who get read-only access.

---

## 🎮 How to play

1. Name your nation and yourself, then **Start New Nation**.
2. Open **🏗️ Build** and place homes, then power and water — keep the green
   surplus bars in **📊 Stats**. Add factories/port/offices for **jobs**.
3. Add schools, hospitals, police and parks to lift education, health, safety and
   happiness; manage **pollution** with parks, the MRT and clean energy.
4. Tune **⚖️ Policy** to balance revenue, growth and approval.
5. Press **▶ / ▶▶ / ▶▶▶** and watch the decades unfold. Respond to events.
6. Open **☁️ Save**, save to the cloud, and share your link so friends can visit.

Good luck, Prime Minister. Majulah Singapura! 🦁
