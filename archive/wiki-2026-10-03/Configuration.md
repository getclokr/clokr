# Configuration

Clokr is configured entirely through environment variables. The API validates them at startup with a Zod schema (`apps/api/src/config.ts`) and **fails fast** with a clear error if a required value is missing or invalid — so a misconfigured deployment never boots into a half-working state.

Set variables in the `.env` file next to your `docker-compose.prod.yml` (see [[Deployment]]). Start from the shipped `.env.example` template.

> **Secrets must be at least 32 characters** and must **never** be committed to version control. Generate them with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## Core / runtime

| Variable      | Required | Default         | Description |
| ------------- | -------- | --------------- | ----------- |
| `NODE_ENV`    | –        | `development`   | `development` \| `production` \| `test`. Set to `production` in real deployments — this enables HSTS and the full security-header set. |
| `API_PORT`    | –        | `4000` (compose)| Port the Fastify API binds to. The schema default is `3000`; the production compose sets `4000` explicitly. |
| `API_HOST`    | –        | `0.0.0.0`       | Bind address for the API. |
| `DATABASE_URL`| ✓        | —               | PostgreSQL connection string, e.g. `postgresql://clokr:PASSWORD@postgres:5432/clokr`. |
| `REDIS_URL`   | –        | `redis://localhost:6379` | Redis connection string. Configured for future use; not required for core functionality. |
| `SEED_DEMO_DATA` | –     | `false`         | When `true`, seeds a demo tenant + accounts on first boot. Keep `false` in production. |
| `CLOKR_VERSION` | –      | `latest`        | Consumed by the compose file to pick the image tag. Pin an explicit release (e.g. `1.9.2`) in production. |

---

## Authentication & encryption

| Variable                 | Required | Default | Description |
| ------------------------ | -------- | ------- | ----------- |
| `JWT_SECRET`             | ✓        | —       | Signing secret for **access** tokens. **≥ 32 chars.** |
| `JWT_REFRESH_SECRET`     | ✓        | —       | Signing secret for **refresh** tokens. **≥ 32 chars.** Use a different value from `JWT_SECRET`. |
| `JWT_EXPIRES_IN`         | –        | `15m`   | Access-token lifetime. |
| `JWT_REFRESH_EXPIRES_IN` | –        | `7d`    | Refresh-token lifetime. |
| `ENCRYPTION_KEY`         | ✓        | —       | Key for field-level encryption of sensitive data at rest. **≥ 32 chars.** Losing this key makes encrypted fields unrecoverable — back it up securely. |
| `RATE_LIMIT_MAX`         | –        | `500`   | Max requests per IP per minute before rate limiting kicks in. |
| `CORS_ORIGIN`            | ✓        | `http://localhost:5173` | Exact origin of the web frontend (e.g. `https://clokr.example.com`). **Wildcard `*` is rejected** — you must set an explicit origin. |
| `APP_URL`                | ✓        | `http://localhost:5173` | Public base URL used in generated e-mail links (invitations, password reset). Must match your real HTTPS URL. |

---

## E-mail (SMTP) — optional

SMTP is optional. If `SMTP_HOST` is set, then `SMTP_PORT` and `SMTP_USER` become required (enforced at startup). SMTP can alternatively be configured **per tenant in the database**, which overrides these process-level defaults.

| Variable          | Required | Default | Description |
| ----------------- | -------- | ------- | ----------- |
| `SMTP_HOST`       | –        | —       | SMTP server hostname. Enables outbound e-mail when set. |
| `SMTP_PORT`       | cond.    | —       | Required when `SMTP_HOST` is set (e.g. `587`). |
| `SMTP_USER`       | cond.    | —       | Required when `SMTP_HOST` is set. |
| `SMTP_PASSWORD`   | –        | —       | SMTP password / app password. |
| `SMTP_FROM_EMAIL` | –        | —       | From-address for outbound mail. |
| `SMTP_FROM_NAME`  | –        | —       | Display name for outbound mail. |
| `SMTP_SECURE`     | –        | `false` | `true` to use implicit TLS. |

---

## Object storage (MinIO / S3)

File uploads (avatars, absence documents) are stored in an S3-compatible bucket. The production compose ships a MinIO service for this. Provide credentials via the `MINIO_*` variables referenced by your compose file.

| Variable              | Description |
| --------------------- | ----------- |
| `MINIO_ROOT_USER`     | MinIO / S3 access key. |
| `MINIO_ROOT_PASSWORD` | MinIO / S3 secret key. |

> Treat MinIO credentials as secrets. If you point Clokr at an external S3 provider instead of the bundled MinIO, supply the corresponding endpoint/credential variables your storage plugin expects.

---

## Logging

| Variable     | Required | Default | Description |
| ------------ | -------- | ------- | ----------- |
| `LOG_LEVEL`  | –        | `info`  | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`. |
| `LOG_FORMAT` | –        | `json`  | `json` (structured, production default), `ecs` (Elastic Common Schema), or `pretty` (human-readable, dev). |
| `LOG_FILE`   | –        | —       | Optional file path for log output with daily rotation. When unset, logs go to stdout. |

---

## Database connection pool

| Variable   | Required | Default | Description |
| ---------- | -------- | ------- | ----------- |
| `POOL_MIN` | –        | `2`     | Minimum Prisma/PG pool connections. |
| `POOL_MAX` | –        | `20`    | Maximum Prisma/PG pool connections. |

---

## Notes & gotchas

- **`CORS_ORIGIN` cannot be `*`.** Set the exact frontend origin. A wildcard fails validation and the API will not start.
- **Never commit `.env`.** Keep it out of version control and off shared drives.
- **`ENCRYPTION_KEY` is load-bearing.** Rotating or losing it invalidates all previously encrypted fields. Store it in your secret manager and in backups.
- There is a `test`-only bootstrap surface gated by an internal flag that defaults to `false`; leave it off in production. It is only enabled in CI/dev.

---

## Related pages

- [[Deployment]] — how to run the stack
- [[Database-Migrations]] — `DATABASE_URL` and the migration workflow
- [[Security & CVE Handling|Security-and-CVE-Handling]] — auth, encryption, hardening
