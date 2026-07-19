# Vigil — KSP Crime Intelligence Prototype

A static, client-side web app, deployed via Zoho Catalyst Web Client Hosting, with the
dashboard gated behind Catalyst Authentication.

## Page structure

- `index.html` — **public landing page**. No login required, no case data. Marketing copy
  describing the platform, with a "Login" call to action.
- `login.html` — **login page**. Embeds Catalyst's own sign-in iFrame (Embedded Authentication).
  No public signup — accounts must be provisioned by an admin in the Catalyst console
  (Authentication → User Management).
- `dashboard.html` — **the actual product** (map, link analysis, predictive risk, methodology).
  Gated: on load it calls `catalyst.auth.isUserAuthenticated()`; if that fails, it redirects to
  `login.html` before any data loads.
- `style.css`, `app.js` — shared logic/styling for the dashboard. `app.js` is unchanged from the
  original prototype (see the "Methodology" note below for what it does NOT do).
- `data/data.json` — synthetic dataset. `generate_data.py` regenerates it.
- `libs/` — vendored Leaflet, vis-network, and fonts (no CDN dependency).

## Important: the auth guard only works once deployed on Catalyst

`login.html` and the auth-check in `dashboard.html` both depend on `/__catalyst/sdk/init.js` —
a path that Catalyst's Web Client Hosting serves automatically once your project is deployed.
It does **not** exist when you run this locally with `python3 -m http.server`, so:
- Locally: `index.html` and `dashboard.html` will work, but `login.html`'s sign-in form and the
  auth redirect on `dashboard.html` will show a harmless "catalyst is not defined" console error
  and simply not do anything — this is expected, not a bug.
- Once deployed on Catalyst: both work for real, because that reserved path exists there.

## Deploying (see chat for the full step-by-step)

1. Create a project at catalyst.zoho.com
2. Enable Authentication → Native Catalyst Authentication → Embedded Authentication
   → **leave Public Signup OFF** → add authorized users manually under User Management
3. `npm install -g zcatalyst-cli`
4. `catalyst login`
5. `catalyst init` → Web Client Hosting → Basic web app
6. Copy all files from this folder into the `client/` folder Catalyst creates
7. `catalyst deploy` (Development)
8. Promote to Production in the console before final submission

