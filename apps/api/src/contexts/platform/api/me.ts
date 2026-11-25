import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../../middleware/auth";
import { API_KEY_SUBJECT_PREFIX, accessContextFromRequest } from "../access-context";
import { contextSalonIds, ownRoleNames } from "../facade/role-assignments";
import { isMultiSalonTenant, listSalons } from "../facade/salons";
import { packagesForDisplay } from "../tenant-packages";
import { PERSONAL_EMAIL_OPT_OUT_FIELDS } from "../notification-email-policy";
import {
  listPreferencesInput,
  storedListPreferences,
  type StoredListPreference,
} from "../list-preferences";
import {
  LEGACY_UI_THEME_IDS,
  UI_THEME_IDS,
  normalizeUiTheme,
  ownUiThemeChoice,
  resolveUiTheme,
  uiThemeFromDb,
  type UiThemeId,
} from "../ui-theme";

// ── Schemas ──────────────────────────────────────────────────────────────────

// Issue #842 (D-842-18): the theme input accepts the three current ids and the retired ones
// (a stale tab may still send them); the transform stores the mapped id. The retired skin and
// density keys are gone from the schema: z.object strips unknown keys, so a stale tab's
// skin/density PUT is an empty merge, never a 400.
const themeInput = z.enum([...UI_THEME_IDS, ...LEGACY_UI_THEME_IDS]).transform(normalizeUiTheme);
// Issue #975: "system" = follow the device's light/dark setting. An absent stored value means the
// same (a person who never chose), so the answer never turns a never-chosen mode into "light".
const modeEnum = z.enum(["light", "dark", "system"]);
const languageEnum = z.enum(["de", "en"]);

// Issue #602 (Phase 851): the e-mail groups the person switched off (the tenant toggle fields of the
// "toggle" policies; never an "always" type). The whole list is replaced on every write.
const emailOptOutInput = z
  .array(z.enum(PERSONAL_EMAIL_OPT_OUT_FIELDS))
  .max(PERSONAL_EMAIL_OPT_OUT_FIELDS.length);

const updatePreferencesSchema = z.object({
  // Issue #976: null goes back to the tenant default (stored as JSON null, i.e. no own choice).
  theme: themeInput.nullable().optional(),
  mode: modeEnum.optional(),
  language: languageEnum.optional(),
  emailOptOut: emailOptOutInput.optional(),
  // Issue #1028: the stored page size and filter per list, validated against the register
  // `packages/types/list-preferences.json`. Merged one level deep (per list id) on write.
  lists: listPreferencesInput.optional(),
});

// Phase 110 (D-10/AK-10): the version string is echoed back to the client and stored, so it is
// bounded to a semver triple rather than accepted as free text.
const updateReleaseNotesSeenSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Ungültige Versionsangabe"),
});

// ── Types ────────────────────────────────────────────────────────────────────

interface UiPreferences {
  // Issue #976: the RESOLVED Farbwelt (own choice, else tenant default, else Pflaume), decided only
  // by resolveUiTheme(); `themeChoice` is the own choice (null = none), `tenantDefaultTheme` the
  // tenant default. The web applies `theme` and derives nothing.
  theme: UiThemeId;
  themeChoice: UiThemeId | null;
  tenantDefaultTheme: UiThemeId;
  mode: z.infer<typeof modeEnum>;
  language: z.infer<typeof languageEnum>;
  emailOptOut: z.infer<typeof emailOptOutInput>;
  // Issue #1028: `{ [listId]: { pageSize?, filter? } }`, only entries that are valid for the register.
  lists: Record<string, StoredListPreference>;
}

const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "pflaume",
  themeChoice: null,
  tenantDefaultTheme: "pflaume",
  mode: "system",
  language: "de",
  emailOptOut: [],
  lists: {},
};

/**
 * Merge stored preferences over defaults. Ignores unknown keys and falls back to
 * defaults when a stored value is invalid (e.g. after a config rollback).
 */
function mergePreferences(stored: unknown, tenantDefault: UiThemeId): UiPreferences {
  const partial: Record<string, unknown> =
    stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const themeChoice = ownUiThemeChoice(partial.theme);
  return {
    theme: resolveUiTheme(themeChoice, tenantDefault),
    themeChoice,
    tenantDefaultTheme: tenantDefault,
    mode: modeEnum.safeParse(partial.mode).success
      ? (partial.mode as UiPreferences["mode"])
      : DEFAULT_PREFERENCES.mode,
    language: languageEnum.safeParse(partial.language).success
      ? (partial.language as UiPreferences["language"])
      : DEFAULT_PREFERENCES.language,
    emailOptOut: Array.isArray(partial.emailOptOut)
      ? [...new Set(partial.emailOptOut)].filter((v): v is UiPreferences["emailOptOut"][number] =>
          (PERSONAL_EMAIL_OPT_OUT_FIELDS as readonly unknown[]).includes(v),
        )
      : [],
    lists: storedListPreferences(partial.lists),
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function meRoutes(app: FastifyInstance) {
  // Issue #976: the caller's tenant default Farbwelt, read once per request with the tenant of the
  // token only (a missing config row reads Pflaume).
  async function tenantDefaultTheme(tenantId: string): Promise<UiThemeId> {
    const row = await app.prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { defaultUiTheme: true },
    });
    return uiThemeFromDb(row?.defaultUiTheme);
  }

  // GET /api/v1/me/preferences
  app.get("/preferences", {
    preHandler: requireAuth,
    schema: {
      tags: ["Mein Bereich"],
      description:
        "Get the current user's UI preferences merged with defaults. `theme` is the resolved Farbwelt (own choice, else the tenant default, else pflaume), `themeChoice` the own choice (null = none) and `tenantDefaultTheme` the tenant default. `lists` holds the stored page size and filter per list id (only entries that are valid for the list register)",
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.user.sub;
      // API keys (clk_ prefix) are not real users; reject early.
      if (userId.startsWith("apikey:")) {
        return reply.code(400).send({ error: "API-Keys haben keine Benutzerpräferenzen" });
      }
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { uiPreferences: true },
      });
      if (!user) {
        return reply.code(404).send({ error: "Benutzer nicht gefunden" });
      }
      return mergePreferences(user.uiPreferences, await tenantDefaultTheme(req.user.tenantId));
    },
  });

  // PUT /api/v1/me/preferences
  app.put("/preferences", {
    preHandler: requireAuth,
    schema: {
      tags: ["Mein Bereich"],
      description:
        "Update the current user's UI preferences (partial update, merge semantics). `theme: null` removes the own choice so the tenant default applies. `lists` is merged one level deep: an entry for one list id replaces that list's stored entry and never touches another list's. The answer has the same shape as GET",
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.user.sub;
      if (userId.startsWith("apikey:")) {
        return reply.code(400).send({ error: "API-Keys haben keine Benutzerpräferenzen" });
      }
      const body = updatePreferencesSchema.parse(req.body);

      // Issue #392: a single atomic jsonb merge instead of findUnique -> JS merge -> update.
      // The old sequence read the row, merged the patch in JS, then wrote the WHOLE merged
      // object back — so when several partial PUTs from different tabs
      // land within milliseconds of each other, a later write that read the
      // pre-earlier-write row overwrites an already-persisted key with its stale value (lost
      // update). A single UPDATE ... SET "uiPreferences" = ... || patch takes the row lock and,
      // under READ COMMITTED, re-evaluates against the latest committed row, so concurrent
      // partial PUTs serialize and none can revert another's key.
      // jsonb_typeof(...) = 'object' guards the CASE so a non-object stored value (SQL NULL,
      // JSON null, array, scalar) falls back to '{}'::jsonb before the merge, rather than making
      // the `||` operator build an array or throw.
      //
      // Issue #1028: `lists` is merged one level deep inside the SAME statement. A plain top-level
      // `||` would replace the whole stored `lists` object, so a PUT for one list would drop every
      // other list's entry; here the stored `lists` (an object, else '{}') is merged with the patch's
      // `lists` and written back under `lists`, while every other key keeps the top-level merge. An
      // entry for one list id is replaced as a whole (the web always sends the complete entry).
      const { lists, ...topLevel } = body;
      const rows = await app.prisma.$queryRaw<{ uiPreferences: unknown }[]>`
        UPDATE "User"
        SET "uiPreferences" = (
              (
                CASE
                  WHEN jsonb_typeof("uiPreferences") = 'object' THEN "uiPreferences"
                  ELSE '{}'::jsonb
                END
              ) || ${JSON.stringify(topLevel)}::jsonb
            ) || (
              CASE
                WHEN ${lists !== undefined}::boolean THEN jsonb_build_object(
                  'lists',
                  (
                    CASE
                      WHEN jsonb_typeof("uiPreferences") = 'object'
                        AND jsonb_typeof("uiPreferences" -> 'lists') = 'object'
                      THEN "uiPreferences" -> 'lists'
                      ELSE '{}'::jsonb
                    END
                  ) || ${JSON.stringify(lists ?? {})}::jsonb
                )
                ELSE '{}'::jsonb
              END
            ),
            "updatedAt" = now()
        WHERE "id" = ${userId}
        RETURNING "uiPreferences"
      `;

      if (rows.length === 0) {
        return reply.code(404).send({ error: "Benutzer nicht gefunden" });
      }

      return mergePreferences(rows[0].uiPreferences, await tenantDefaultTheme(req.user.tenantId));
    },
  });

  // ── Release notes seen state (Phase 110) ────────────────────────────────────

  // GET /api/v1/me/release-notes-seen
  app.get("/release-notes-seen", {
    preHandler: requireAuth, // no role gate — D-08/AK-08: every role sees the What's-New dialog
    schema: {
      tags: ["Mein Bereich"],
      description: "Get the release-notes version this user last acknowledged",
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.user.sub;
      if (userId.startsWith("apikey:")) {
        return reply.code(400).send({ error: "API-Keys haben keinen Gesehen-Status" });
      }
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { lastSeenReleaseVersion: true },
      });
      if (!user) return reply.code(404).send({ error: "Benutzer nicht gefunden" });
      return { lastSeenVersion: user.lastSeenReleaseVersion };
    },
  });

  // PUT /api/v1/me/release-notes-seen
  app.put("/release-notes-seen", {
    preHandler: requireAuth, // no role gate — D-08/AK-08: every role sees the What's-New dialog
    schema: {
      tags: ["Mein Bereich"],
      description: "Set the release-notes version this user last acknowledged",
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.user.sub;
      if (userId.startsWith("apikey:")) {
        return reply.code(400).send({ error: "API-Keys haben keinen Gesehen-Status" });
      }
      const body = updateReleaseNotesSeenSchema.parse(req.body);

      const user = await app.prisma.user.update({
        where: { id: userId },
        data: { lastSeenReleaseVersion: body.version },
        select: { lastSeenReleaseVersion: true },
      });

      // Phase 110 (N-09): deliberately no audit-log write here. CLAUDE.md scopes the audit
      // obligation to "data relevant to working time, leave, and payroll" — a user dismissing an
      // informational What's-New dialog carries no legal consequence, cannot alter a saldo, a
      // leave day, or a payroll figure, and is not something anyone could later need to
      // reconstruct for an audit. The in-repo precedent for exactly this category is
      // PUT /api/v1/me/preferences above, which stores comparable per-user UI state and also
      // writes no audit row.
      return { lastSeenVersion: user.lastSeenReleaseVersion };
    },
  });

  // ── Salon context (Phase 82, Issue #82) ─────────────────────────────────────

  // GET /api/v1/me/context
  app.get("/context", {
    preHandler: requireAuth, // own data — no permission row (docs/permissions.md convention)
    schema: {
      tags: ["Mein Bereich"],
      description:
        "Get the caller's tenant, the active salons it can reach and the tenant's booked packages (module names and effective salon limit) and the names of the caller's own roles. A presentation context only — every endpoint decides access itself.",
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      if (req.user.sub.startsWith(API_KEY_SUBJECT_PREFIX)) {
        return reply.code(400).send({ error: "API-Keys haben keinen Benutzerkontext" });
      }
      const user = await app.prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { id: true },
      });
      if (!user) return reply.code(404).send({ error: "Benutzer nicht gefunden" });
      const tenant = await app.prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { id: true, name: true },
      });
      if (!tenant) return reply.code(404).send({ error: "Unternehmen nicht gefunden" });

      // D-05: nothing reads this context back — a later view passes at most a `salonId`
      // parameter that the target endpoint validates itself.
      const reach = await contextSalonIds(app.prisma, accessContextFromRequest(req), new Date());
      const reachable = new Set(reach.salonIds);
      const salons = (await listSalons(app.prisma, tenant.id, { includeInactive: false }))
        .filter((salon) => reachable.has(salon.id))
        // D-02: ids and names only (Art. 5 Abs. 1 lit. c DSGVO).
        .map((salon) => ({ id: salon.id, name: salon.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "de") || (a.id < b.id ? -1 : 1));

      return {
        tenant: { id: tenant.id, name: tenant.name },
        isMultiSalon: await isMultiSalonTenant(app.prisma, tenant.id),
        homeSalonId: reach.homeSalonId,
        salons,
        // Phase 566 (D-12): display only — module names and the effective salon limit, no quota and
        // no counts. The server re-checks every write against the same decider, so this value is
        // never an access boundary. Own-tenant data, hence no new permission.
        packages: await packagesForDisplay(app.prisma, tenant.id),
        // Issue #538: names of the caller's own roles, a display label only (Topbar, Sidebar,
        // profile). Own data, no new permission; decides nothing.
        roles: await ownRoleNames(app.prisma, tenant.id, user.id),
      };
    },
  });
}
