# Deployment

This page covers self-hosting Clokr in production with Docker Compose. Clokr ships as two published container images plus a small set of supporting services (PostgreSQL, Redis, MinIO). Everything runs behind your own reverse proxy.

> Current stable version: **1.9.2**
> Images: `ghcr.io/sebastianzabel/clokr-api` and `ghcr.io/sebastianzabel/clokr-web` (public — no `docker login` required)

See also: [[Configuration]] for the full environment-variable reference and [[Database-Migrations]] for the schema-migration workflow.

---

## Prerequisites

- A Linux host with **Docker** and the **Docker Compose plugin**
- A reverse proxy in front of the host for TLS termination (nginx, Caddy, Traefik, HAProxy — your choice)
- Roughly 2 vCPU / 2 GB RAM is comfortable for a small team

No source checkout is required for a production deployment — the compose file pulls pre-built images.

---

## Quick start (production)

```bash
# 1. Download the production compose file and the env template
curl -fsSLO https://raw.githubusercontent.com/sebastianzabel/clokr/main/docker-compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/sebastianzabel/clokr/main/.env.example
cp .env.example .env

# 2. Generate secrets (run three times, one per secret)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or, without Node:
openssl rand -hex 32
# Paste the outputs into JWT_SECRET, JWT_REFRESH_SECRET and ENCRYPTION_KEY in .env

# 3. Start the stack
docker compose -f docker-compose.prod.yml up -d
```

The web UI is served on port **3000**. Point your reverse proxy at it and open the app in a browser.

At minimum, set these in `.env` before first start (see [[Configuration]] for details):

- `POSTGRES_PASSWORD`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (each ≥ 32 chars)
- `CORS_ORIGIN` and `APP_URL` (your public URL, e.g. `https://clokr.example.com`)

---

## Ports

| Service      | Port        | Description             |
| ------------ | ----------- | ----------------------- |
| **web**      | `3000`      | SvelteKit frontend      |
| **api**      | `4000`      | Fastify backend + `/docs` (Swagger) |
| **postgres** | `5432`      | PostgreSQL 18           |
| **redis**    | `6379`      | Redis 7                 |
| **minio**    | `9000/9001` | MinIO S3 API / console  |

In a hardened production deployment you typically only expose **web** (3000) — and often just to the reverse proxy on `localhost`. The database, cache and object storage should stay on the internal Docker network and not be published to the host at all.

---

## Pinning a version

By default the images resolve to `:latest`. For reproducible deployments, pin an explicit release tag in `.env`:

```bash
# .env
CLOKR_VERSION=1.9.2
```

The compose file substitutes `${CLOKR_VERSION:-latest}` into both image references. Pinning is strongly recommended in production so an unattended `pull` never moves you across a breaking change unexpectedly. Available tags are listed on the [Releases page](https://github.com/sebastianzabel/clokr/releases).

---

## Updating

```bash
# Optionally bump CLOKR_VERSION in .env first
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The API container runs `prisma migrate deploy` automatically on startup, so pending database migrations are applied for you during the restart. No manual migration step is required in the normal update flow. See [[Database-Migrations]] for what happens under the hood and how to reason about failures.

**Recommendation:** take a database backup (below) before every update.

---

## TLS termination

Clokr does **not** terminate TLS itself. Run it behind a reverse proxy that handles certificates and forwards plain HTTP to the `web` container on port 3000.

Minimal nginx example:

```nginx
server {
    listen 443 ssl;
    server_name clokr.example.com;

    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

When `NODE_ENV=production`, Clokr automatically sends HSTS and the rest of its security headers (via Helmet). Make sure `CORS_ORIGIN` and `APP_URL` match the public HTTPS URL your users hit, otherwise API calls and e-mail links will point at the wrong host.

---

## Backups

The authoritative data lives in **PostgreSQL**. Uploaded files (avatars, absence documents) live in **MinIO**. Back up both.

### PostgreSQL

```bash
docker exec clokr-db pg_dump -U clokr clokr > backup-$(date +%F).sql
```

> The container name depends on your compose project name; adjust `clokr-db` to match `docker compose ps`. A custom `--format=custom` (`-Fc`) dump restores faster for large databases.

The provided production compose can also run a bundled `backup` service that performs a daily `pg_dump` into a `./backups` volume and prunes dumps older than 7 days. Keep at least one off-host copy of these dumps.

### MinIO

```bash
docker exec clokr-minio mc mirror /data /backup/minio
```

Mirror the MinIO data volume to a separate location on a regular schedule. Adjust the container name to match your environment.

### Restore

Stop the stack, restore the PostgreSQL dump into a fresh `clokr` database, restore the MinIO data volume, then start the stack. Because the API runs `migrate deploy` on boot, restoring a dump from an older version and starting a newer image will bring the schema forward automatically.

---

## Health checks

- API health endpoint: `GET /health` on port 4000
- Web serves the app root on port 3000

The production compose defines Docker health checks for postgres, redis, minio, api and web, and orders startup with `depends_on: condition: service_healthy` so the API only boots once the database is ready.

---

## Related pages

- [[Configuration]] — every environment variable, grouped by concern
- [[Database-Migrations]] — how schema changes are applied
- [[Security & CVE Handling|Security-and-CVE-Handling]] — auth, encryption, CVE process
- [[Architecture]] — how the pieces fit together
