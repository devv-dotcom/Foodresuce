# Free hobby deployment

This repository can run as one Render Node web service with a TiDB Cloud Starter database. Render's free service sleeps after inactivity, so the first page load after a quiet period can take about a minute. TiDB Cloud Starter has a free monthly quota; keep usage within its quota to avoid usage charges.

## 1. Create the database

Create a free TiDB Cloud Starter cluster and database named `foodbridge`. Save its host, username, and password. Use the cluster's TLS connection settings; the app uses port `4000` and TLS when `DB_SSL=true`.

Initialize the database using `database/foodbridge.sql` from the repository root. It sources the core schema modules and the ordered OTP/workflow patches. The patches are idempotent; the status expansion preserves existing review decisions.

The master SQL file uses MySQL-client `SOURCE` commands for the core modules, so run it from the repository root with a MySQL client rather than pasting it into a web SQL editor.

## 2. Configure free email delivery

Create a Brevo account and verify a sender address. Set `BREVO_API_KEY` and `MAIL_FROM` to that verified sender in Render. The app sends OTP mail through Brevo's HTTPS API, which works on Render's free web service. Resend is also available by setting `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a sender on a verified Resend domain.

## 3. Deploy the web service

In Render, choose **New → Blueprint**, connect this GitHub repository, and select the `render.yaml` Blueprint. Enter the TiDB host, username, password, and database name, plus the Brevo API key and verified sender in the prompted environment variables. The Blueprint generates a JWT secret and deploys the app with `npm ci` / `npm start`.

After deployment, open the service URL and confirm `/health` returns a healthy response. The health check includes a database query, so it will not pass until the TiDB schema and connection variables are ready.

## Free-tier limits

- Render's free web service sleeps after 15 minutes without traffic and has an ephemeral filesystem. Uploaded images do not persist across restarts or deploys.
- Render free services can be restarted and have monthly usage limits.
- TiDB Cloud Starter is free only within its published quota. Monitor usage in TiDB Cloud.
- Brevo requires a verified sender. Email delivery is limited by the account's free-plan limits.
