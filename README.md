# Food Rescue

Food Rescue is a Node.js/Express web application with a static HTML/CSS/JavaScript frontend and a MySQL-compatible database. The root `app.js` serves the frontend and API on the same origin.

## Run locally

Requirements: Node.js 20 or newer and MySQL 8 / TiDB-compatible database.

1. Create the database from the repository root:

   ```powershell
   mysql -u root -p < database/foodbridge.sql
   ```

2. Copy `.env.example` to `.env` and enter the database, JWT, email, and admin settings. Never commit `.env`.
3. Install dependencies and start the app from the repository root:

   ```powershell
   npm ci
   npm start
   ```

4. Open [http://localhost:5000](http://localhost:5000). The server applies idempotent, additive schema migrations before it begins listening.

For development auto-restart, run `npm run dev`.

## Main pages and workflows

- Home page: `/` or `/index.html` with mission and workflow overview.
- Information pages: `/about.html`, `/how-it-works.html`, `/faq.html`, `/contact.html`.
- Sign in and registration: `/login.html`, `/register.html`.
- Password recovery: `/forgot-password.html`.
- Donor workspace and donation form: `/business/dashboard.html`, `/donate.html`.
- NGO workspace: `/ngo/dashboard.html`.
- Administrator sign-in and workspace: `/admin/login.html`, `/admin/dashboard.html`.

Donors can create, edit, and cancel unclaimed listings. Cancellation is retained in donation history. NGOs can browse and accept available donations, then confirm completion. Listings store pickup details, donor-reported storage conditions, and food-handling declarations. Timing estimates only show deadlines and urgency; they do not establish food safety.

## Environment variables

See `.env.example` for the complete list. Required settings include:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (or the supported database URL variables).
- `JWT_SECRET`, a long random value.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the single administrator account. The server provisions/synchronizes that account on startup; administrator sign-in does not use OTP.
- `RESEND_API_KEY` and `MAIL_FROM` for Resend email delivery. `MAIL_FROM` must use a verified sender domain. Brevo is retained as an optional fallback.
- Sign-in OTP is temporarily paused by default; set `LOGIN_OTP_ENABLED=true` to require emailed codes again after sender delivery is working. Password recovery codes remain enabled.

Donor and NGO sign-ins use a one-time email code only when `LOGIN_OTP_ENABLED=true`. With the default paused setting, users sign in with email and password. Password recovery codes remain enabled.

## Checks

```powershell
npm run check
npm test
```

`npm run check` parses the server code and browser modules. `npm test` runs focused tests for donation timing eligibility and donor safety declarations. Full registration, database workflows, mail delivery, and visual browser checks require a configured database/provider and have not been simulated with production data.

## Known limitations

- Google, Microsoft, Apple, and Facebook OAuth are not implemented or configured; there are no provider sign-in buttons that claim success.
- Transactional email requires account/provider activation and an authenticated sender domain.
- Assignment/volunteer modules exist in the repository but are not part of the primary donor/NGO sign-in workflow.

## Deployment

The Render Blueprint uses the repository root, `npm ci`, and `npm start`, with `/health` as its health check. Set all secrets in the Render web service environment and choose **Save and deploy** when applying changes. Database schema updates are additive so existing records remain in place.
