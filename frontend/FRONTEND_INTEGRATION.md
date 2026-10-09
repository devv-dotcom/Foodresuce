# Frontend and API integration

The root Express server serves this directory and the API from one origin. The canonical browser entry point is `js/app.js`, which initializes authentication, dashboard modules, donations, profiles, notifications, contact forms, and shared UI features.

## Page routes

- Public: `index.html`, `about.html`, `how-it-works.html`, `faq.html`, `contact.html`, `freshness.html`.
- Account: `login.html`, `register.html`, `forgot-password.html`, `admin/login.html`.
- Workspaces: `business/dashboard.html`, `ngo/dashboard.html`, `admin/dashboard.html`.
- Donation: `donate.html`.

Use the Express server for local work (`npm start` from the repository root). Opening pages from `file://` bypasses the API and is unsupported.

## Authentication

The normal sign-in form accepts donor and NGO roles. Donor and NGO sign-ins require an email code. The separate admin page uses the configured admin email/password and does not use OTP. NGO registration creates a pending application and does not establish a session until an administrator approves it. OAuth providers are not implemented.

The browser stores the access token and user payload in local storage. `api.js` adds the bearer token and normalizes JSON errors. Sensitive API operations must continue to enforce authorization in Express routes and controllers; frontend route guards are only a navigation aid.

## Main API workflows

- Auth and recovery: `/api/auth/*`, `/api/ngo/register`, `/api/admin/login`.
- Donor profile and donations: `/api/business/*`, `/api/donations/*`.
- NGO profile, available donations, history, and acceptance: `/api/ngo/*`.
- Admin moderation and platform operations: `/api/admin/*`.
- Contact form: `POST /api/contact`.
- Notifications and impact: `/api/notifications`, `/api/analytics/public`.
- Partner, assignment, pickup, and volunteer APIs are mounted separately and require authenticated, role-authorized access. Live pickup tracking is private to an involved account.

## UI behavior

Dashboard scripts render API errors through `notifyError`; forms use loading feedback and toasts. Food-handling fields are donor declarations. The timing estimate indicates only the entered deadline and pickup urgency and cannot certify safety. Contact form submission requires the API and database.
