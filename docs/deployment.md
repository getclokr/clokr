# Deployment

## Voraussetzungen

- Ein Linux-Host mit **Docker** und dem **Docker-Compose-Plugin**
- Ein Reverse Proxy vor dem Host für TLS (nginx, Caddy, Traefik, HAProxy)
- Als Richtwert genügen 2 vCPU und 2 GB RAM für ein kleines Team

Für den Betrieb ist kein Quellcode-Checkout nötig: Die Compose-Datei lädt fertige Images (`ghcr.io/getclokr/clokr-api` und `ghcr.io/getclokr/clokr-web`).

## Docker Compose (Empfohlen)

```bash
docker compose -f docker-compose.prod.yml up -d
```

Gestartet werden: PostgreSQL, Redis, MinIO, API, Web und ein `backup`-Dienst (siehe Backup). Der `fritzbox-adapter` ist ein optionaler Dienst für die WLAN-Anwesenheit. Redis ist im Stack enthalten, die API nutzt es derzeit nicht.

### Ports

| Dienst     | Port        | Beschreibung                           |
| ---------- | ----------- | -------------------------------------- |
| `web`      | `3000`      | SvelteKit-Oberfläche                   |
| `api`      | `4000`      | Fastify-Backend, Swagger unter `/docs` |
| `postgres` | `5432`      | PostgreSQL 18                          |
| `redis`    | `6379`      | Redis 7                                |
| `minio`    | `9000/9001` | MinIO S3-API und Konsole               |

In einem gehärteten Betrieb sollte nur `web` (3000) erreichbar sein, meist nur für den Reverse Proxy. Datenbank, Redis und Objektspeicher gehören ins interne Docker-Netz.

### Health-Checks

Die API beantwortet `GET /health` auf Port 4000, der Web-Dienst die Startseite auf Port 3000. Die Compose-Datei definiert Health-Checks für alle Dienste und startet die API erst, wenn die Datenbank bereit ist.

## Umgebungsvariablen

| Variable                                        | Pflicht | Beschreibung                                                                                                                                                                                           |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD`                             | ✓       | Passwort des Datenbank-Benutzers; Compose baut daraus `DATABASE_URL` der API                                                                                                                           |
| `JWT_SECRET`                                    | ✓       | Zufälliger String, min. 32 Zeichen                                                                                                                                                                     |
| `JWT_REFRESH_SECRET`                            | ✓       | Zufälliger String, min. 32 Zeichen                                                                                                                                                                     |
| `ENCRYPTION_KEY`                                | ✓       | Zufälliger String, min. 32 Zeichen                                                                                                                                                                     |
| `OPERATOR_JWT_SECRET`                           | –       | Optional: eigenes Signiergeheimnis der Betreiber-Oberfläche, min. 32 Zeichen, verschieden von den drei Geheimnissen oben; ohne Wert bleibt die Betreiber-Oberfläche aus                                |
| `VAPID_PUBLIC_KEY`                              | –       | Optional: öffentlicher VAPID-Schlüssel für Web-Push (87 Zeichen, base64url); alle drei VAPID-Werte oder keiner; ohne Werte kein Push und kein Angebot im Profil, siehe [Runbook](runbooks/web-push.md) |
| `VAPID_PRIVATE_KEY`                             | –       | Optional: privater VAPID-Schlüssel (43 Zeichen, base64url), geheim, nie committen; erzeugt mit `scripts/generate-vapid-keys.ts`                                                                        |
| `VAPID_SUBJECT`                                 | –       | Optional: Kontakt für die Push-Dienste, `mailto:` oder `https:`, nie `localhost`                                                                                                                       |
| `DATABASE_URL`                                  | ✓       | PostgreSQL Connection String                                                                                                                                                                           |
| `CORS_ORIGIN`                                   | ✓       | URL des Web-Frontends (kein Wildcard)                                                                                                                                                                  |
| `APP_URL`                                       | ✓       | Öffentliche URL (für E-Mail-Links)                                                                                                                                                                     |
| `CLOKR_API_IMAGE`                               | ✓       | Vollständige Image-Referenz der API, z. B. `ghcr.io/getclokr/clokr-api:1.12.0` (Tag ohne führendes `v`)                                                                                                |
| `CLOKR_WEB_IMAGE`                               | ✓       | Vollständige Image-Referenz des Web-Frontends, z. B. `ghcr.io/getclokr/clokr-web:1.12.0` (Tag ohne führendes `v`)                                                                                      |
| `SMTP_HOST`                                     | –       | SMTP-Server für E-Mail-Versand                                                                                                                                                                         |
| `SMTP_PORT`                                     | –       | SMTP-Port (z.B. 587)                                                                                                                                                                                   |
| `SMTP_USER`                                     | –       | SMTP-Benutzername                                                                                                                                                                                      |
| `SMTP_PASSWORD`                                 | –       | SMTP-Passwort                                                                                                                                                                                          |
| `MINIO_ROOT_USER`                               | ✓       | Zugangsdaten des MinIO-Speichers (Dokumente, Avatare); die API erhält dieselben Werte                                                                                                                  |
| `MINIO_ROOT_PASSWORD`                           | ✓       | Zugangsdaten des MinIO-Speichers (Dokumente, Avatare); die API erhält dieselben Werte                                                                                                                  |
| `MINIO_ENDPOINT`                                | ✓ (API) | Host des Objektspeichers aus Sicht der API (im Compose-Netz `minio`); in Produktion Pflicht (sonst startet die API nicht)                                                                              |
| `MINIO_ACCESS_KEY`                              | ✓ (API) | Zugangsschlüssel für die API; im Compose aus `MINIO_ROOT_USER`                                                                                                                                         |
| `MINIO_SECRET_KEY`                              | ✓ (API) | Geheimer Schlüssel für die API; im Compose aus `MINIO_ROOT_PASSWORD`                                                                                                                                   |
| `MINIO_PORT` / `MINIO_BUCKET` / `MINIO_USE_SSL` | –       | Standard `9000` / `clokr` / `false`                                                                                                                                                                    |
| `LOG_LEVEL`                                     | –       | `debug` / `info` / `warn` / `error`                                                                                                                                                                    |
| `LOG_FORMAT`                                    | –       | `json` / `ecs` / `pretty`                                                                                                                                                                              |
| `SEED_DEMO_DATA`                                | –       | Demo-Daten beim Start anlegen (`true`)                                                                                                                                                                 |

### Objektspeicher: Verhalten bei Fehlern (Issue #184)

- **Fehlt `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY` oder `MINIO_SECRET_KEY` in Produktion, startet die API nicht.** Die Konfigurationsprüfung (`apps/api/src/config.ts`) bricht mit der üblichen Fail-fast-Ausgabe ab und nennt die fehlenden Variablen; es gibt keinen geratenen Host und keinen Degraded-Modus (Issue #184). Außerhalb von Produktion gelten die Compose-/CI-Werte (`minio`, `minioadmin`). **Deploy-Schritt:** Jede Stage muss die drei Variablen tragen, bevor sie dieses Release bekommt; demo läuft noch mit der alten Compose-Datei ohne `MINIO_ENDPOINT` und braucht beim Deploy die `docker-compose.prod.yml` von main (setzt `MINIO_ENDPOINT: "minio"`).
- **Kubernetes (Helm-Chart `charts/clokr-app`):** `minio.enabled=true` startet einen MinIO-StatefulSet mit Service `minio` und eigenem PVC (`helm.sh/resource-policy: keep`). Die Zugangsdaten liegen in einem von Hand angelegten Secret (Standardname `clokr-minio`, Schlüssel `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ENDPOINT=minio`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`); `api.extraSecretName=clokr-minio` gibt sie der API. Das vom Chart erzeugte `clokr-secrets` bleibt unverändert, ArgoCD entfernt also keine Schlüssel.
- Ist der Speicher beim Start oder später nicht erreichbar, läuft die API weiter (Zeiterfassung darf nicht daran hängen), loggt es als Fehler und beantwortet Uploads (Avatare, AU-Bescheinigungen) mit **503** und dem Code `STORAGE_UNAVAILABLE`.
- `GET /health` (Liveness für Docker/k8s/Proxy) entscheidet weiterhin nur über die Datenbank, damit ein Speicherausfall keinen Neustart auslöst. Der Speicher steht zusätzlich im Antworttext: `"storage": "ok"` oder `"unavailable"` (zuletzt bekannter Zustand, wird bei jedem Aufruf im Hintergrund neu geprüft). Für Smoke-Tests nach dem Deploy und Überwachung auf `storage` prüfen.

## Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name clokr.deine-domain.de;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Clokr terminiert TLS nicht selbst. Der Reverse Proxy übernimmt Zertifikate und leitet an den `web`-Dienst auf Port 3000 weiter. HSTS und die weiteren Security-Header setzt Clokr selbst, sobald `NODE_ENV=production`. `CORS_ORIGIN` und `APP_URL` müssen zur öffentlichen HTTPS-Adresse passen, sonst scheitern API-Aufrufe und die Links in E-Mails.

## Backup

Die wichtigsten Daten liegen in PostgreSQL, hochgeladene Dateien in MinIO. Sichere beides. Tägliches Backup der Datenbank:

```bash
docker exec clokr-db pg_dump -U clokr clokr > backup-$(date +%F).sql
```

Die mitgelieferte Compose-Datei enthält außerdem einen `backup`-Dienst. Er legt täglich einen `pg_dump` in `./backups` ab und löscht Dumps, die älter als 7 Tage sind. Bewahre mindestens eine Kopie außerhalb des Hosts auf.

MinIO-Daten (Dokumente, Avatare) separat sichern:

```bash
docker exec clokr-minio-1 mc mirror /data /backup/minio
```

## Updates

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Datenbankmigrationen laufen automatisch beim Start (`prisma migrate deploy` im Entrypoint der API, siehe [Migrationen](./migrations.md)). Nimm vor jedem Update ein Datenbank-Backup.

### Wiederherstellen

Stoppe den Stack, spiele den PostgreSQL-Dump in eine leere Datenbank `clokr` ein, stelle das MinIO-Volume wieder her und starte den Stack. Stammt der Dump aus einer älteren Version, bringt `migrate deploy` beim Start das Schema auf den aktuellen Stand.

## Version pinnen

```bash
# .env
CLOKR_API_IMAGE=ghcr.io/getclokr/clokr-api:1.12.0
CLOKR_WEB_IMAGE=ghcr.io/getclokr/clokr-web:1.12.0
```

Tags werden ohne führendes `v` geschrieben; beide Variablen sind Pflicht, `docker compose`
bricht mit einer Fehlermeldung ab, wenn eine fehlt.

## Checkliste für den Betrieb

- `NODE_ENV=production` setzen (HSTS und die vollständigen Security-Header).
- Die Ports von `postgres`, `redis` und `minio` nicht ins Internet veröffentlichen. Nur `web` ist erreichbar, hinter einem Reverse Proxy mit TLS.
- Starke, jeweils eigene Werte für `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` sowie für die Datenbank- und MinIO-Passwörter verwenden (mindestens 32 Zeichen bei den Geheimnissen).
- Keine Demo-Daten und keine Demo-Konten in Produktion.
- Regelmäßige Backups von PostgreSQL **und** MinIO, mindestens eine Kopie außerhalb des Hosts.
- Beide Images auf einen festen Release-Tag pinnen und vor einem Update die Release-Notes lesen (`docs/release-notes`).
- Schwachstellen in Abhängigkeiten behandelt der Prozess in [CVE-Handling](./cve-handling.md).
