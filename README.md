# Vigil — KSP Crime Intelligence Prototype

A crime intelligence platform built for Karnataka State Police, addressing the brief's core
challenge: **data silos, manual processes, and reactive (rather than proactive) policing**.

Vigil is a fully static, client-side web app (no backend, no database) deployed on **Zoho
Catalyst Web Client Hosting**, with the dashboard gated behind **Catalyst Native Authentication**.
Everything — mapping, link analysis, prediction, search, and data import — runs entirely in the
browser.

---

## 1. Features

### Map & Hotspots
Every FIR plotted geographically, with marker clustering and a density-heatmap toggle.
Filterable by district, crime head, case status, and a date range slider.

### Link Analysis
A graph of every case (green) and every accused person (grey = single appearance, red = appears
in multiple FIRs). **Click any node, or any thick red connection**, to see the entire connected
cluster — every accused and every FIR reachable through shared cases, not just the nearest one.
This is the direct answer to the brief's "data silos" problem: the same person sitting in
unlinked records at different stations, surfaced automatically.

### Predictive Risk
A transparent, explainable near-repeat risk score per police station catchment (next 7 days),
based on recency-weighted local case density — not a black-box model. Every row shows a
relative **priority tier** (High / Moderate / Lower, scaled against the other stations shown,
not an absolute claim), and a **"Show calculation"** toggle that reveals the actual math in
plain language (which cases contributed, how recent each was, and how much "influence" it had).

### Search Records
Three ways to find a case:
- **By accused name** — every FIR against a matching person
- **By FIR / crime number** — exact match opens that FIR directly (a crime number is unique to
  one FIR in reality, so this never returns more than one real match); a short partial entry
  matches by tail digits
- **By date & district** — every FIR filed on a specific date, optionally narrowed to one
  district

Clicking any result opens the **FIR Detail page** — a full, same-window view (not a popup) of
that case: accused, victims, complainants, sections invoked, brief facts, and any other FIRs
linked to the same accused identity, listed separately and clearly.

### Data Import — the data-silo story, live
An "Import station records" panel (collapsed by default to keep the sidebar tidy) lets you
upload real station exports — **CSV or Excel, and more than one file at once**. Each upload
becomes a removable batch (with an × to undo it). The identity-matching logic runs across
whatever's currently loaded, so uploading two independently-exported files that happen to
mention the same person visibly links them — the "linked identities" counter ticks up in real
time. Five ready-made sample files (`sample-uploads/`) demonstrate this.

### Methodology & Bias Audit
- A **live-computed statistic** (not an assertion) showing what percentage of currently-loaded
  cases show a genuine near-repeat pattern — the empirical evidence behind the prediction model.
- An explicit, documented note that **CasteID and ReligionID — present in the official KSP
  schema — are deliberately never generated, stored, displayed, or used anywhere** in this
  prototype, including the risk model. This is a design decision against predictive-policing
  feedback-loop bias, not an omission.

### Authentication & Access Control
- **`index.html`** — public landing page. No login, no case data, only a description of the
  platform. Investigative tools like this shouldn't be public — only the marketing page is.
- **`login.html`** — Catalyst's own embedded sign-in form.
- **`dashboard.html`** — the actual product. On load, it calls
  `catalyst.auth.isUserAuthenticated()`; if that fails, it redirects to `login.html` before any
  case data loads or renders.
- **No public signup.** Accounts are provisioned by an administrator in the Catalyst console
  (Authentication → User Management) — nobody can register their own account. This matters
  specifically because the dashboard holds case-level investigative data (accused names, victim
  details, active status), which is categorically different from a public crime-statistics
  dashboard and should never be openly accessible.
- A **"logged in as [email] / Log out"** chip sits in the dashboard's top bar at all times.

---

## 2. Project structure

```
├── index.html              Public landing page
├── login.html               Login page (Catalyst embedded sign-in)
├── dashboard.html            The actual dashboard (gated)
├── style.css                 All styling (shared across all three pages)
├── app.js                    All dashboard logic (map, network, predictions, search, import)
├── data/
│   └── data.json             Synthetic base dataset (~1,500 FIRs)
├── generate_data.py           Regenerates data/data.json
├── sample-uploads/            5 demo files for the Import feature (station_a..e)
├── css/
│   └── embeddediframe.css     Custom styling for Catalyst's login iframe
└── libs/                      Vendored dependencies — no CDN, works offline once deployed
    ├── leaflet/                Map rendering, clustering, heatmap
    ├── vis-network/            Link Analysis graph
    ├── papaparse/               CSV parsing (Import feature)
    ├── xlsx/                    Excel parsing (Import feature, SheetJS)
    ├── md5/                     Entity-fingerprint hashing (cross-source identity matching)
    └── fonts/                   Oswald, IBM Plex Sans, IBM Plex Mono — self-hosted
```

---

## 3. Setup & execution — running it locally

Browsers block `fetch()` on `file://` pages, so don't just double-click `index.html`. From
inside this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

**Important — what will and won't work locally:** `login.html`'s sign-in form and the auth
redirect on `dashboard.html` both depend on `/__catalyst/sdk/init.js`, a path Catalyst's Web
Client Hosting serves automatically only once actually deployed. Locally, you'll see a harmless
`catalyst is not defined` console error and the login form/redirect simply won't activate — this
is expected, not a bug. Everything else (map, network, predictions, search, import) works fully
locally.

To regenerate the synthetic dataset: `python3 generate_data.py`.

---

## 4. Setup & execution — deploying to Zoho Catalyst

### Step 1 — One-time console setup (browser, not terminal)

1. Go to **catalyst.zoho.com** → sign in → **Create a New Project**
2. On the project's home screen, click the **Cloud Scale** tile → **Start Exploring** (first
   time only)
3. In the left sidebar: **Security & Identity → Authentication → Set Up** under
   **Native Catalyst Authentication**
4. Choose **Embedded and hosted Authentication** → Next
5. **Keep "Public Signup" ON** — this is what keeps the dashboard restricted to authorized
   personnel only but currently everyone should be able to login.
6. Finish, then open the **User Management** tab (still under Authentication) → **Add User** for
   each person who should have access(this will be an added step when public sign in will be off and only specific officer needs to sign in).

### Step 2 — Connect this project to Catalyst (terminal)

```bash
npm install -g zcatalyst-cli
catalyst login
catalyst init
```
When prompted: select your project → **Web Client Hosting** → **Basic web app**.

This creates a `client/` folder. Delete its placeholder `index.html`, then copy every file and
folder from this project into that `client/` folder (`index.html`, `login.html`,
`dashboard.html`, `style.css`, `app.js`, `data/`, `css/`, `libs/`, `sample-uploads/`).

### Step 3 — Deploy

```bash
catalyst deploy
```

This deploys to your **Development** environment and prints a live URL. Test it: open the URL,
confirm the landing page loads, click Login, sign in with an account added in Step 1.6, and
confirm it lands on the actual dashboard.

### Step 4 — Before final submission

`catalyst deploy` only updates **Development**. Go into the Catalyst console and explicitly
**promote/deploy to Production** — that Production URL is what should be submitted, not the
Development one.

### Verifying a deploy actually landed (useful after any future update)

Open `<your-url>/app.js` directly in a browser and search (Ctrl+F) for a function name you
expect to be there (e.g. `setupSearch` or `showFIRDetailPage`). If it's not found, the file
didn't actually update — recheck the copy step before deploying again.

---

## 5. Design decisions worth knowing for a pitch or review

- **Landing page is deliberately generic** — no real or synthetic case data, accused names, or
  predictions are shown publicly. Only the dashboard, behind login, contains investigative data.
- **CasteID / ReligionID are excluded everywhere** — not in the dataset, not in any view, not in
  the risk model. Documented explicitly in the Methodology tab.
- **The prediction is a transparent formula, not a black box** — near-repeat victimization
  theory, with every score's calculation shown in plain language on request.
- **Deployment is Catalyst Web Client Hosting + Native Authentication only** — no third-party
  host (Netlify/Vercel/GitHub Pages) and no separate backend/database service, per the
  hackathon's platform rules. Catalyst Data Store and Functions were considered for a
  server-side version of the same architecture but intentionally scoped out of this prototype
  (documented as future work, not fabricated as already built).
