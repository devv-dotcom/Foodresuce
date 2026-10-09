# Food Rescue

```
Food Rescue/
├── frontend/   # Static HTML, CSS, JavaScript, images, and browser assets
├── backend/    # Express API, MVC source, uploads, and module SQL scripts
└── database/   # Master database setup entry point
```

## Run locally

1. Run the master database script from the project root: `mysql -u root -p < database/foodbridge.sql`.
2. Configure `backend/.env`.
3. Start the API with `cd backend` then `pnpm start`.
4. Serve the `frontend/` directory through a static server. The browser client is configured for `http://localhost:5000` by default.

## Email sign-in codes

Donor and NGO sign-ins require a one-time email code after the password is accepted. Codes expire after 10 minutes by default (`LOGIN_OTP_TTL_MS=600000`) and are single-use. Admin sign-in accepts only the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD`, is rate-limited, and does not use OTP. Configure these values in the deployment environment; the admin seed synchronizes that account on startup. Configure email delivery using the provider settings in `.env.example`.

<!-- Last pushed: 2026-08-20 12:15:15 -->
