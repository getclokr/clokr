---
paths:
  - "apps/api/src/contexts/platform/**"
  - "apps/api/src/contexts/time-tracking/**"
  - "apps/api/src/composition/**"
  - "apps/api/src/**/plugins/**"
  - "apps/api/src/config.ts"
  - "apps/fritzbox-adapter/**"
  - "apps/web/src/service-worker.ts"
  - "apps/web/src/lib/dashboard/**"
  - "apps/web/src/routes/**"
  - "apps/api/src/__tests__/*push*"
  - "apps/api/src/__tests__/*reminder*"
  - "apps/api/src/__tests__/*pairing*"
  - "apps/api/scripts/**"
  - "docs/runbooks/web-push.md"
  - "docs/runbooks/wlan-qr-kopplung.md"
  - "packages/db/prisma/**"
---

Moved verbatim from CLAUDE.md (§ Web-Push on devices (Issue #608); § Calendar feed „Mein Dienstplan“ (Issue #597); § Shift reminders (Issue #609); § WLAN pairing by QR code (Issue #610)).

### Web-Push on devices (Issue #608)

A person can opt a phone or browser in to push notifications per device; ADR `docs/adr/0001-abweichungen.md` Eintrag AD,
operator runbook `docs/runbooks/web-push.md`. Rules, as built:

- **VAPID is an optional set, like `OPERATOR_JWT_SECRET`.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all
  set or all unset (`config.ts`, `superRefine`: the public key must belong to the private key, the subject is `mailto:` or an
  https URL whose host is not localhost; a part-set or mismatching set fails at boot). Unset = push is off: `GET /api/v1/me/push/config` answers
  `{ enabled: false, publicKey: null }`, the other four `/api/v1/me/push` routes do not exist (404), nothing is ever sent and
  the profile section is not rendered (`push-surface-off-608.test.ts`). Never a default, never derived from another secret;
  the e2e and CI stacks run without keys.
- **A subscription is a delivery address in the Unterbau.** `PushSubscription` (`tenantId` FK `Restrict`, `userId` FK `Cascade`,
  unique `endpoint`) is hard-deleted on revoke, on a 404/410 from the push service, on anonymization and by the int refresh
  (`pseudonymize-dump.ts`), and removed by test cleanup. Create, update and delete are audited (`CREATE`/`UPDATE`/`DELETE`,
  entity `PushSubscription`) without the endpoint or the keys; rows written by the system carry the stamp
  `actor: { type: "SYSTEM", tenantId }` with the tenant of the ROW. Several devices per person (at most 10). An endpoint that
  is registered again is updated for the same person; another person takes it over only with the same key pair (same keys prove
  the same browser, P-608-07) — the old row is deleted and audited, never two rows per endpoint.
- **Lock-screen text lives in ONE place.** `contexts/platform/notification-push-policy.ts` holds, per `notify()` type, one neutral
  German du-form text or `never` — fail-closed: a type without an entry is not pushed, and `notification-push-policy-608.test.ts`
  scans every emit site and pins the registry keys equal to the e-mail registry. An e-mail policy of `never` implies a push
  `never` (the four `SECTION9_*` types and `SUPPORT_ACCESS_STARTED`), with one named exception: the types listed in
  `PUSH_WITHOUT_EMAIL` of `notification-push-policy-608.test.ts`, each with a written reason (the three `REMINDER_*` types of
  Issue #609: neutral nudge, e-mail deliberately not used; #610 adds its own entry on merge). The payload is exactly `{ title, body, url }`: title
  „Clokr“, body from the registry, `url` the notification's own link after `safePushUrl()` (same-origin relative, else
  `/dashboard`). The in-app title and message are NEVER sent (name, minutes, saldo, health or § 9 content would reach the lock
  screen, Art. 5 Abs. 1 lit. c and Art. 9 DSGVO). Never add a second text source and never a per-call text.
- **One sender, one allow-list.** `push-sender.ts` is the only file that imports `web-push`; the VAPID details are passed per
  call and never set globally. An error object is never logged — only `{ statusCode, host }` (the endpoint path is a capability).
  `PUSH_SERVICE_HOST_SUFFIXES` (`push-endpoint-guard.ts`) is the one endpoint allow-list (SSRF: https only, host equal to or a
  subdomain of one of four push-service families; anything else answers 400 `PUSH_ENDPOINT_NOT_ALLOWED` before any write).
  Never add a second allow-list or a host without a reason in the ADR.
- **`notify()` dispatches fire-and-forget for EVERY call**, after the in-app row, with the tenant taken from the subscription
  row (several emit sites pass no `tenantId`); a deactivated tenant (`ACTIVE_TENANT_WHERE`) and an inactive user receive
  nothing. A push failure never fails `notify()`; `app.settlePushDispatch()` drains the in-flight sends (shutdown, tests).
- **The service worker (`apps/web/src/service-worker.ts`) is push-only.** It registers `push`, `notificationclick` and the
  lifecycle events; it has no network-request handler and no cache, so the app can never serve a stale bundle, and it ALWAYS
  shows a notification (an unreadable payload shows a fallback; silent pushes get a subscription revoked on iOS). A tap
  focuses an open Clokr window and posts it the target (`clokr:navigate`; the `(app)` layout validates it and calls `goto()`, so
  the unsaved-changes guard applies - the worker never navigates a window itself) or opens a new one, never an operator or
  signed-out auth window; a tap while signed out lands on its page after sign-in
  (`safeAppNext()`, `?next=`). The CSP names `worker-src 'self'`; the manifest declares only icon sizes that exist.
- **Explicit logout removes this device's registration first** (Sidebar and Topbar, deadline 3 s). The inactivity timeout and a
  forced 401 logout cannot (no valid token): the device stays registered until the next explicit logout or a manual removal.
- **Known limit (D-16).** Direct `notification.create` sites that bypass `notify()` never push (`bs-leave-correction.ts`,
  `vocational-school-generator.ts`). Moving them onto `notify()` is a deliberate follow-up, not a fix to slip into another change.
- A new notification type needs its push entry in the same commit (the scan fails otherwise); a new `notify()` call site needs
  none beyond that. Rotating the VAPID pair invalidates every subscription (each device enables push again).

### Calendar feed „Mein Dienstplan“ (Issue #597)

A person subscribes to their own shifts, effective leave and work-location holidays as ICS; ADR `docs/adr/0001-abweichungen.md`
Eintrag AK. The secret travels in the link (`/api/v1/calendar-feed/dienstplan.ics?token=…`, calendar apps send no header):
`CalendarFeedToken` (Unterbau) stores only the SHA-256, one row per user, rotate replaces it, revoke deletes it
(`/api/v1/me/calendar-feed`, audited without the token). `resolveCalendarFeedToken()` (`contexts/platform/calendar-feed-token.ts`)
is the ONE validity rule, on every poll: active user, active tenant, not anonymized, and the own-read permissions the feed shows
(`shift:read:EIGENE`, `leave-request:read:EIGENE`); every invalid state is one identical 404. The feed (`composition/calendar-feed.ts`)
is minimal: shifts as „Schicht“ with time and salon only, sick leave as „Abwesend“, no note, no label, no names. The token never
reaches a log line (`redactCalendarFeedPath`, route log level `warn`). Anonymization and the int refresh delete the tokens.

### Shift reminders (Issue #609)

A tenant can switch on three reminders for persons with a PLANNED shift; ADR `docs/adr/0001-abweichungen.md` Eintrag AF. They
ride on the Web-Push channel of #608 (above). Rules, as built:

- **Only a planned shift gives a reminder.** The three occasions — start (shift start + N, no valid entry), end (shift end + N,
  still clocked in) and day close (the tenant's evening time, a shift day without any recorded time) — are derived from `Shift`
  rows only. A person without a shift gets nothing and no start time is invented (the same reading as #587); a fixed
  schedule has hours, not start times.
- **One kernel, one job.** `contexts/time-tracking/shift-reminders.ts` is the ONLY place of the windows and decisions (pure: no
  Prisma, no clock): N is `reminderOffsetMinutes` clamped to 5–120 (default 15), the evening time `reminderDayCloseTime`
  (default 20:00, `HH:MM`, an invalid stored value falls back); START and END are due for 60 minutes after they open, DAY_CLOSE
  for 30, so a restart never floods; every instant is built in the tenant time zone with `fromZonedTime` (DST and overnight
  shifts follow the zone, never a 24 h step). `shift-reminder-job.ts` (`runShiftReminders(app, now)`) is the ONE job: cron
  `*/5 * * * *` under `ADVISORY_LOCK_KEYS.ATTENDANCE_SHIFT_REMINDER` (`1020n`), decorator `tryShiftReminders`, active tenants
  with at least one switch on (`ACTIVE_TENANT_WHERE` inside the first query), two stages (pure candidate selection first; the
  population, entry, leave, absence, holiday and notice reads only for candidates, so an idle tick reads nothing). It reads
  only through the Schichtplanung (`getShiftsInRange`, with the additive `conflictsWithLeave` select), Abwesenheiten
  (`getActiveLeaveOverlapping`, `getAbsencesOverlapping`), Zeiterfassung (`getRecordedWorkEntriesInRange`) and Unterbau
  (`holidaysForSalon`) facades and adds no caller of the #587 day-status primitives (`day-status-one-function-587`).
- **The never-list.** No reminder on a day of effective leave (any `EFFECTIVE_LEAVE_STATUSES` row incl. sick and half days, D-12;
  PENDING does not count), an imposed absence, a public holiday of the shift's OWN salon, or for a shift flagged
  `conflictsWithLeave`; never for exited, anonymised, login-deactivated or § 18-exempt persons, a person who switched that
  occasion off, or a deactivated tenant; never to a manager in their manager role — the recipient is always `employee.userId`
  of the shift's own person. The skip is silent: no text ever says why a reminder is missing (Art. 9 DSGVO, sick days). A
  person still clocked in gets no evening reminder (D-13), and a shift ending after the evening time gives none that day (D-15,
  stated in the admin hint).
- **Dedupe on ANY existing row, dismissed or not.** START and END: `(userId, type, relatedType "Shift", shift id)`, plus one
  notice per person, occasion and instant (two shifts at the identical start give one); DAY_CLOSE: `relatedType "EmployeeDay"`,
  `employeeId:day` (the #80 convention). The 10-hour `CLOCK_OUT_REMINDER` skips an open entry a `REMINDER_SHIFT_END` notice
  already covers: a notice created at or after the entry's CURRENT open period (the later of `startTime` and `updatedAt`, which
  a re-open bumps) AND about a shift of the entry's own day (`shiftEndNoticeCoversEntry`, WR-01; a re-opened, forgotten entry
  and a stale entry of an earlier day still get their 10-hour reminder); the 09:00 `MISSING_ENTRIES` job is unchanged.
- **"Clocked in" for a shift (WR-03/WR-04).** Only an OPEN entry of the shift's own day (overnight: its start or end day, or
  an early clock-in inside the 2 h look-back) silences START and triggers END; a forgotten open entry of an earlier day does
  neither. START is also silenced by a closed entry still running at the shift start (ended after `start - 5 min`), never by an
  earlier closed entry (a previous split shift). END stays silent when another worked shift of the person starts within 60
  minutes after this end (a flagged or silent following shift does not count). A successful clock-in soft-dismisses the
  person's open `REMINDER_SHIFT_START` notices, a clock-out the open `REMINDER_SHIFT_END` ones (web, NFC and WLAN paths,
  `shift-reminder-dismiss.ts`, reactive, never fails the clock; IN-03).
- **Channels.** The three types are e-mail `never` and push `send` with the neutral registry texts („Deine Schicht hat begonnen.
  Jetzt einstempeln?“, „Feierabend? Jetzt ausstempeln.“, „Heute fehlt noch deine Zeit.“, no time, salon or name) and the new
  `TTL_1H` class (a late „begonnen“ would be wrong); they are the entries of `PUSH_WITHOUT_EMAIL`. The in-app message may name
  the shift time (own data, never on a lock screen).
- **Settings.** Five `TenantConfig` columns (three switches default off, offset, evening time) are written through the existing
  `PUT /settings/work` (bounded by Zod, audited by the #285 diff audit); three `Employee` opt-out columns
  (`reminderShiftStartOff`, `reminderShiftEndOff`, `reminderDayCloseOff`) are written only by the own-data route
  `GET`/`PATCH /api/v1/employees/me/reminders` (`.strict()` body, own Employee row only, audited with the changed keys; a
  caller without an employee, e.g. an API key, gets 400, never 401). The opt-outs are a person's own choice: `employees.ts`
  `omit`s them on every read or update whose row reaches a response or an audit value and `employeeCreatedAuditValue()` leaves
  them out of the creation audit (D-16), so the employee list, the single view and the create/update audits never carry a
  colleague's opt-outs. The ONE place they appear is the own-data change itself: its audit row (`UPDATE Employee`, the changed
  keys with old and new value) is readable by holders of `audit-log:read` and, redacted by type, by an operator under an active
  support access (traceability beats hiding it, WR-02); `employee-reminder-columns-hidden-609` pins both halves.
- **A reminder never stamps (AC-4).** The start and end link is `/dashboard?clock=1`; the dashboard opens a `ConfirmDialog` that
  names the action and the current time from the LIVE clock state and calls the unchanged `handleClock()` only after the
  person confirms (`lib/dashboard/clock-reminder.ts`; the reminder code issues no request of its own, the param is stripped
  with `replaceState`). The day-close link is `/time-entries?view=list&date=<day>`. Never add a second reminder job, a second
  window rule or a per-call push text; a new occasion is a new kernel decision plus a registry row.
- **Unterbau-Erweiterung without a list to update.** The eight columns default to off/false, so no existing reader changes; no
  maintained list of `TenantConfig`/`Employee` columns exists in this file (the DSGVO anonymisation list names identifying data
  only, and an opt-out boolean is not one). The ADR entry carries „Auswirkung auf die Kontexte“.

### WLAN pairing by QR code (Issue #610)

A person couples their phone to WLAN presence by scanning a QR code in the salon; ADR `docs/adr/0001-abweichungen.md` Eintrag AE,
operator runbook `docs/runbooks/wlan-qr-kopplung.md`, adapter notes `apps/fritzbox-adapter/README.md`. The WLAN clock logic
(presence event → clock event) is unchanged and stays pinned by the existing WLAN tests. Rules, as built:

- **The MAC address comes only from the adapter's TCP peer, resolved through TR-064 - never from a request.** The adapter
  (`apps/fritzbox-adapter/src/pairing.ts`) reads `req.socket.remoteAddress`, asks the box (`X_AVM-DE_GetSpecificHostEntryByIP`;
  only the live answer counts, a stale host list is never consulted) and registers `{ mac, hostname }` at `POST /api/v1/presence/pairing-codes` (presence-source key, the
  one shared check `authenticatePresenceSource` of the webhook and the issuer). It ignores `X-Forwarded-For`, every query and
  every body, and refuses its own, loopback and link-local peers. No API route in the confirm flow accepts a MAC or an IP from
  the client (`pairing-no-client-mac-610.test.ts`). The consequence is a fixed property: a forwarded link can only couple the
  device that opened the QR page.
- **The code has one module.** `contexts/time-tracking/pairing-code.ts` is the ONLY place of the format (32 random bytes, 64
  lowercase hex), the 5-minute TTL (`expiresAt = now + TTL`, never longer) and the hash (SHA-256; only the hash is stored in
  `PresencePairingCode.codeHash`). Preview and confirm are `POST`s that take the code in the JSON body, never in an API URL
  (there is no `GET`; any query parameter answers 400 and the code stays usable); `presence-pairing-contract-610.test.ts` captures the request log (with a positive
  control) and proves no code or hash reaches a log line. Every invalid state (unknown, expired, consumed, foreign tenant,
  malformed) answers ONE identical 404 body (`PAIRING_CODE_INVALID_ERROR`) - no oracle.
- **The confirm is one transaction** (`confirmPairing()` in `presence-pairing.ts`): the owner lock `lockPresenceOwner()`
  (Employee + User, `FOR NO KEY UPDATE`, the FIRST statement of every presence-device writer), then the code row `FOR UPDATE`,
  unconsumed and unexpired, consumed, consent set (`wifiPresenceEnabled`, `wifiOptInAt = now`, audited old/new), the device
  attached with `pairedVia = QR`. A MAC mapped to ANOTHER person answers 409 `PRESENCE_DEVICE_TAKEN` and the code stays
  unconsumed; a `[tenantId, mac]` unique race rolls back and answers the same 409. An inactive person is refused. The caller's
  own MAC is refreshed (200), not duplicated.
- **Replace, not accumulate.** A QR confirm deletes the person's other `QR` devices (audited); `MANUAL` devices stay; an admin
  reassign through `POST /admin/presence-sources/:id/devices/:mac/assign` writes `pairedVia = MANUAL`. A concurrent second pairing
  has exactly one winner (`presence-pairing-race-610.test.ts`).
- **Withdrawal removes every device.** `PATCH /me/wifi { wifiPresenceEnabled: false }` deletes all of the person's
  `PresenceDevice` rows and clears `wifiMacs` under `lockPresenceOwner()`, each deletion audited with the reason „Einwilligung
  widerrufen“, and answers `devicesRemoved`. This changed existing behaviour (devices used to stay); persons who opted out
  before #610 keep inert leftover rows until they act - no retroactive cleanup.
- **`PresenceDevice.lastSeenAt` means "last presence event", not "last seen on the network".** The webhook writes
  `min(eventTime, now)` monotonically (a guarded `updateMany`, no extra audit); the adapter posts on transitions only.
- **The re-couple hint has one rule** (`wifi-device-not-seen.ts`, Feature 11 of the attendance checker, cron `20 9 * * *`,
  advisory key `ATTENDANCE_WIFI_DEVICE_NOT_SEEN`): a person with consent and a `QR` device gets ONE `WIFI_DEVICE_NOT_SEEN`
  notice (in-app plus a neutral push, e-mail `never`, only to the person themself) when the device showed no sign of life since
  the start of their third-newest shift day with a closed non-WIFI WORK entry (look-back 28 days). A tenant without any event
  signal in the window gets nothing (adapter-outage guard); a seen or re-coupled device dismisses the notice. The hint is the
  ONE named exception of the #608 parity rule (`PUSH_WITHOUT_EMAIL` in `notification-push-policy-608.test.ts`: e-mail `never`
  normally implies push `never`); a second exception needs its own entry and reason there.
- **The adapter listener is off by default** (`PAIRING_ENABLED=true`, `CLOKR_APP_URL` an https origin) and compose publishes its
  port on loopback unless `PAIRING_HOST_BIND` names the host's LAN address. The existing `/devices` endpoint, `getHostList()` and
  the poll are untouched. Docker can hide the phone's source address (userland proxy, Docker Desktop, rootless, `"iptables":
  false`): the runbook's network recipe and the adapter log's `peer=` line are the check on a real host.
- **Pairing codes are tokens, not records.** Ephemeral and not retention-relevant: FKs `tenantId` and `presenceSourceId` are
  `onDelete: Cascade`, `consumedByUserId` is a plain column without FK; rows older than a day are purged by the token cleanup
  and a person's rows go with the anonymization; the int refresh deletes them all (`pseudonymize-dump.ts`).
- The pinned WLAN tests (`presence-webhook`, `presence`, `me-wifi`, `auto-break-all-triggers-799`, `presence-resolver`, the
  adapter's `state.test.ts`) must stay unedited and green; `610-untouched.sh` of the phase proved it.
