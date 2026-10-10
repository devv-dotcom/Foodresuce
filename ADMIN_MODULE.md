# Food Rescue Module 8: Admin Panel & System Management

## 1. Folder Structure

```
backend/
  controllers/adminController.js, dashboardController.js, categoryController.js,
              reportController.js, analyticsController.js, notificationController.js
  database/admin_module.sql
  middleware/adminAuth.js
  models/Admin.js, Category.js, Report.js, Analytics.js, Notification.js, ActivityLog.js
  routes/adminRoutes.js, categoryRoutes.js
```

## 2. SQL Tables

Run `database/admin_module.sql` after Modules 1–7. It creates `admins`, `reports`, `analytics`, `notifications`, `contact_messages`, `reviews`, `activity_logs`, and `website_settings`. It also adds account states, donation soft deletion, and active-category support required by administration.

Create a normal `users` row with `role = 'admin'`, then link it with `INSERT INTO admins (user_id) VALUES (<user id>)`. Passwords must use bcrypt, just like all existing Food Rescue accounts.

## 3. Models

`Admin` handles login lookup, dashboard aggregates, account lists, and approval status. `Category`, `Report`, `Analytics`, `Notification`, and `ActivityLog` isolate their SQL behind parameterized `mysql2` queries.

## 4. Controllers

Controllers cover administrator login/dashboard, business/NGO/volunteer moderation, donation filtering/status/soft delete/restore, categories, generated reports, analytics, notifications, contacts, reviews, settings, and activity logs.

## 5. Routes

`/api/admin/login` is public. Every other `/api/admin/*` endpoint requires a JWT for a user with the `admin` role and an active `admins` row. `/api/categories` supports public active-category reads; mutations require an admin.

## 6. Middleware

Existing JWT authentication and role authorization are retained. `middleware/adminAuth.js` verifies the linked admin account is active. Suspended/rejected businesses, NGOs, and volunteers are blocked from protected product routes by `requireActiveAccount`.

## 7. Validation

Admin login, category create/edit, notification creation, donation status, contact replies, and website settings use `express-validator`. All SQL uses placeholders, and file/database credentials remain environment based.

## 8. REST APIs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/admin/login` | Admin login |
| GET | `/api/admin/dashboard` | Dashboard cards/activity series |
| GET | `/api/admin/pickups` | Filter and paginate recorded pickup workflow rows and status counts |
| GET | `/api/admin/businesses` | Businesses; supports `q`, `category`, `limit`, `offset` |
| PUT | `/api/admin/business/approve/:id` | Approve business |
| PUT | `/api/admin/business/reject/:id` | Reject business |
| DELETE | `/api/admin/business/:id` | Delete business |
| GET | `/api/admin/ngos` | NGOs |
| PUT | `/api/admin/ngo/approve/:id` | Approve NGO |
| DELETE | `/api/admin/ngo/:id` | Delete NGO |
| GET | `/api/admin/volunteers` | Volunteers and ratings/history totals |
| PUT | `/api/admin/volunteer/approve/:id` | Approve volunteer |
| DELETE | `/api/admin/volunteer/:id` | Delete volunteer |
| GET | `/api/admin/donations` | Filter/search donations |
| PUT | `/api/admin/donation/status/:id` | Update donation status |
| DELETE | `/api/admin/donation/:id` | Soft-delete donation |
| GET/POST/PUT/DELETE | `/api/categories` | Read/manage categories |
| GET | `/api/admin/reports?type=weekly` | Generate or list reports |
| GET | `/api/admin/analytics` | Operational analytics |
| GET/POST/DELETE | `/api/admin/notifications` | Manage/broadcast notifications |

Additional admin endpoints support suspend/activate, restore donation, contacts, reviews, settings, notification reads, and activity logs.

## 13. Account Management

The admin dashboard includes a database-backed account directory for administrator, donor, and NGO accounts. Donor account records use the existing business-type role values. The account APIs are protected by the same administrator authentication middleware:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/admin/accounts` | Search, filter, and paginate accounts; includes aggregate counts |
| GET | `/api/admin/accounts/:id` | View profile, donation history, warnings, and account audit history |
| PUT | `/api/admin/accounts/:id` | Update validated profile fields without changing role or permissions |
| PUT | `/api/admin/accounts/:id/status` | Suspend or restore an account and revoke existing sessions |
| POST | `/api/admin/accounts/:id/warnings` | Issue a reviewed warning and create an in-app notification |
| DELETE | `/api/admin/accounts/:id` | Confirm and anonymize a donor or NGO while retaining transaction history |

The startup migration adds `users.account_status` and creates `account_warnings`. Account deletion is an anonymization operation: it removes profile contact details, marks the account deleted, revokes sessions, and keeps donation and warning records available for audit and retention. Administrator accounts cannot be deleted through this endpoint; self-suspension and suspension of the last active administrator are blocked. NGO name or registration changes return the NGO to pending review.

Donor roles remain represented by the application's existing business-type role values (restaurant, hotel, bakery, supermarket, catering, and marriage hall); the account interface groups them under Donor and does not expose a volunteer account directory.

## 9. JSON Responses

```json
{ "success": true, "message": "Business Approved Successfully" }
```

Validation failures return HTTP 422 with field errors; unauthenticated requests return 401 and non-admin or inactive accounts receive 403.

## 10. Postman Testing

1. Run `admin_module.sql` after the prior migrations and seed an active admin account.
2. `POST /api/admin/login` with the admin email/password; copy the returned token.
3. Set `Authorization: Bearer <token>` for protected requests.
4. Check dashboard, approve a test business/NGO/volunteer, create a category and broadcast notification.
5. Test donation deletion followed by `PUT /api/admin/donation/restore/:id`.
6. Verify an account suspended by an administrator receives 403 from its protected product endpoints.

## 11. Folder Explanation

Routes only map HTTP requests. Controllers coordinate use cases and responses. Models own SQL. Middleware centralizes authorization and validation. The migration is the one source of schema changes for Module 8.

## 12. Best Practices

Use a long random `JWT_SECRET`, HTTPS, a restrictive production CORS origin, and least-privilege MySQL credentials. Store audit data without secrets, back up before deleting accounts, preserve admin logs, rate-limit admin login, and add automated integration tests before deployment.
