# Configuration

The API is configured through environment variables. It validates them at startup with the Zod schema in `apps/api/src/config.ts` and **refuses to start**, printing the offending keys, if a required value is missing or invalid. That file is the single source of truth: when this page and the schema disagree, the schema wins.

Application code never reads `process.env` directly. It imports the typed `config` object. The web container is the one exception, see [Web container](#web-container).

Set the variables in the `.env` file next to `docker-compose.prod.yml` (see [Deployment](../deployment.md)) and start from the shipped `.env.example`. Every value on this page is a stand-in. Never commit a real secret.

::: warning Secrets
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` and the optional `OPERATOR_JWT_SECRET` are at least 32 characters. Generate each one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and use a different value for each. `ENCRYPTION_KEY` protects data at rest: losing it makes the encrypted fields unrecoverable, so back it up separately.
:::

## Core and runtime

| Variable               | Required | Default                  | Purpose                                                                                                                                                                                    |
| ---------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`             | no       | `development`            | `development`, `production` or `test`. In production the MinIO values below are required and the full security-header set is on.                                                           |
| `API_PORT`             | no       | `3000`                   | Port the API binds to. The production compose file sets `4000`.                                                                                                                            |
| `API_HOST`             | no       | `0.0.0.0`                | Bind address.                                                                                                                                                                              |
| `DATABASE_URL`         | yes      | none                     | PostgreSQL connection URL, for example `postgresql://clokr:PASSWORD@postgres:5432/clokr`.                                                                                                  |
| `POOL_MIN`, `POOL_MAX` | no       | `2`, `20`                | Database connection pool size.                                                                                                                                                             |
| `REDIS_URL`            | no       | `redis://localhost:6379` | Accepted and validated, but no API code connects to Redis today.                                                                                                                           |
| `SEED_DEMO_DATA`       | no       | not part of the schema   | Read by the container start-up and the seed scripts, not by `config.ts`. It creates a demo company with demo accounts. Keep it off in production.                                          |
| `ALLOW_TEST_BOOTSTRAP` | no       | `false`                  | Switches on the `/api/v1/test/*` surface (tenant bootstrap, teardown, the `X-Test-Now` header). It must stay `false` on every stage with real data. CI and local compose set it to `true`. |

## Authentication and security

| Variable                 | Required | Default                 | Purpose                                                                                                                                                                                         |
| ------------------------ | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`             | yes      | none                    | Signs access tokens. At least 32 characters.                                                                                                                                                    |
| `JWT_REFRESH_SECRET`     | yes      | none                    | Signs refresh tokens. At least 32 characters, different from `JWT_SECRET`.                                                                                                                      |
| `JWT_EXPIRES_IN`         | no       | `15m`                   | Access token lifetime.                                                                                                                                                                          |
| `JWT_REFRESH_EXPIRES_IN` | no       | `7d`                    | Refresh token lifetime.                                                                                                                                                                         |
| `ENCRYPTION_KEY`         | yes      | none                    | Key for field-level encryption. At least 32 characters.                                                                                                                                         |
| `CORS_ORIGIN`            | no       | `http://localhost:5173` | The exact origin of the web app. A wildcard (`*`) is rejected at startup. Set it explicitly in production.                                                                                      |
| `APP_URL`                | no       | `http://localhost:5173` | Public base URL used in links inside e-mails. It must match the real HTTPS address.                                                                                                             |
| `RATE_LIMIT_MAX`         | no       | `500`                   | Requests per IP and minute before rate limiting applies.                                                                                                                                        |
| `OPERATOR_JWT_SECRET`    | no       | unset                   | Signs operator tokens. Unset or blank means the operator interface is not registered at all. At least 32 characters and different from `JWT_SECRET`, `JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`. |

## Web push

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are an all-or-none set. All three unset (or blank) switches push off: the push routes do not exist and nothing is offered in the web app. Setting only some of them, a malformed key, a public key that does not belong to the private key or an unusable subject stops the start.

| Variable            | Rule                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | Uncompressed P-256 key, base64url, 87 characters                  |
| `VAPID_PRIVATE_KEY` | P-256 private key, base64url, 43 characters                       |
| `VAPID_SUBJECT`     | `mailto:<address>` or an `https:` URL whose host is not localhost |

Generate a pair with `pnpm --filter @clokr/api exec tsx scripts/generate-vapid-keys.ts --subject mailto:<contact>`. One pair per stage. Rotating the pair invalidates every device registration. The operator guide is [Web push](../runbooks/web-push.md).

## E-mail (SMTP), optional

If `SMTP_HOST` is set, `SMTP_PORT` and `SMTP_USER` are required too. The mail server can instead be configured per company in the web app, which then applies for that company.

| Variable                            | Default | Purpose                                       |
| ----------------------------------- | ------- | --------------------------------------------- |
| `SMTP_HOST`                         | unset   | Mail server. Switches outbound e-mail on.     |
| `SMTP_PORT`                         | unset   | Required with `SMTP_HOST`, for example `587`. |
| `SMTP_USER`                         | unset   | Required with `SMTP_HOST`.                    |
| `SMTP_PASSWORD`                     | unset   | Password or app password.                     |
| `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | unset   | Sender address and display name.              |
| `SMTP_SECURE`                       | `false` | `true` for implicit TLS (port 465).           |

## Object storage (MinIO or S3)

Avatars and absence documents live in an S3-compatible bucket. Outside production the defaults below match the dev compose stack. **In production there is no default** for the endpoint and the two keys: a missing value stops the start and names the variable.

| Variable                               | Default                          | Purpose                                                                                                              |
| -------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MINIO_ENDPOINT`                       | `minio` (not in production)      | Host name of the object store.                                                                                       |
| `MINIO_PORT`                           | `9000`                           | Port.                                                                                                                |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | `minioadmin` (not in production) | Credentials. In `docker-compose.prod.yml` they come from `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` of your `.env`. |
| `MINIO_BUCKET`                         | `clokr`                          | Bucket name.                                                                                                         |
| `MINIO_USE_SSL`                        | `false`                          | `true` to connect over TLS.                                                                                          |

## Logging

| Variable     | Default | Purpose                                                          |
| ------------ | ------- | ---------------------------------------------------------------- |
| `LOG_LEVEL`  | `info`  | `trace`, `debug`, `info`, `warn`, `error` or `fatal`.            |
| `LOG_FORMAT` | `json`  | `json`, `ecs` (Elastic Common Schema) or `pretty` (development). |
| `LOG_FILE`   | unset   | Optional file path, rotated daily.                               |

## Compose-level variables

These are read by the compose files, not by `config.ts`:

| Variable                                                                                                                            | Purpose                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOKR_API_IMAGE`, `CLOKR_WEB_IMAGE`                                                                                                | Full image references for the `api` and `web` services. Required by `docker-compose.prod.yml`. Pin both to the same release tag, written without a leading `v` (for example `ghcr.io/getclokr/clokr-api:2.0.3`). |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                                                                                 | The database container and the connection URL it builds for the API.                                                                                                                                             |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`                                                                                            | The MinIO container and, for production, the credentials handed to the API.                                                                                                                                      |
| `API_PORT`, `WEB_PORT`                                                                                                              | Host ports (defaults `4000` and `3000`).                                                                                                                                                                         |
| `FRITZBOX_URL`, `FRITZBOX_USER`, `FRITZBOX_PASS`, `CLOKR_PRESENCE_KEY`, `POLL_INTERVAL_SECONDS`, `PAIRING_ENABLED`, `CLOKR_APP_URL` | The optional FRITZ!Box adapter, see its README in `apps/fritzbox-adapter` and the guide [WLAN pairing by QR code](../runbooks/wlan-qr-kopplung.md).                                                              |

## Web container

The web server is the only place that reads the environment directly (`apps/web/src/hooks.server.ts`):

| Variable    | Default                 | Purpose                                                                                          |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `API_URL`   | `http://localhost:4000` | Where `/api` requests are forwarded. The production compose file sets `http://api:4000`.         |
| `ORIGIN`    | unset                   | The public URL of the web app, required by the SvelteKit Node adapter. Compose passes `APP_URL`. |
| `PORT`      | `3000`                  | The port the web server listens on.                                                              |
| `LOG_LEVEL` | `info`                  | `debug`, `info`, `warn` or `error`.                                                              |
| `CSP_MODE`  | `enforce`               | `enforce`, `report-only` or `off` for the Content-Security-Policy header.                        |
