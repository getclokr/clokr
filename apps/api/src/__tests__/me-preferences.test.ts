// Issue #392 (quick task 260928-uli): regression test for the lost-update race in
// PUT /api/v1/me/preferences.
//
// Verified root cause: on /admin/themes, selectModern() sets skin, mode and theme stores in
// sequence; each store's subscriber fires its own partial savePreferences({key}) once
// prefsHydrated is true, so three (or more, elsewhere on the page) partial PUTs arrive within
// milliseconds of each other (observed API log: 19:59:19.850 and .852, then 19:59:20.885). The
// old handler does findUnique -> JS merge {...current, ...body} -> update with the WHOLE merged
// object, so a concurrent PUT that read the stale row writes an old key back over a newer one —
// a classic read-merge-write lost update. The race case below reproduces this with 6 concurrent
// single-key PUTs per round (each of the 3 keys twice), over 10 rounds, and MUST fail on the
// unfixed handler.
// #842 D-842-18: skin and density are retired, three keys remain; theme ids are mapped by
// normalizeUiTheme().
// #976: the answer additionally carries `themeChoice` (the own choice, null = none) and
// `tenantDefaultTheme`; `theme` is the resolved value. The exact-key expectations below were updated
// to that contract on purpose, not loosened. #975: mode is light|dark|system, an absent mode reads "system".
// #1028: the answer additionally carries `lists` (the stored page size and filter per list, `{}` by default),
// so every exact-shape expectation gained `lists: {}` - a contract update on purpose, not a loosening.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Prisma } from "@clokr/db";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "./setup";
import type { JwtPayload } from "../middleware/auth";

// #842 D-842-18: the response carries exactly theme, mode, language - and since #602 (Phase 851) the
// list of e-mail groups the person switched off. #606 adds `whyClockIntroSeen` (false by default): an
// intended additive contract change, so every exact-shape expectation gained that key.
const DEFAULTS = {
  theme: "pflaume",
  themeChoice: null,
  tenantDefaultTheme: "pflaume",
  mode: "system",
  language: "de",
  emailOptOut: [],
  lists: {},
  whyClockIntroSeen: false,
};

const SET_A = { theme: "petrol", mode: "dark", language: "en" };
const SET_B = { theme: "salz", mode: "light", language: "de" };

describe("PUT /api/v1/me/preferences (Issue #392, lost-update race)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "mprf");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it(
    "6 concurrent PUTs (each of the 3 keys twice) persist all 3 keys, in every one of 10 alternating rounds " +
      "(fails on the pre-fix findUnique -> JS merge -> full-object update handler)",
    async () => {
      const rounds = 10;
      for (let round = 0; round < rounds; round++) {
        const target = round % 2 === 0 ? SET_A : SET_B;

        // #842: three keys only, so each is sent twice to keep six concurrent requests per round.
        const keys = [...Object.keys(target), ...Object.keys(target)] as (keyof typeof target)[];
        const results = await Promise.all(
          keys.map((key) =>
            app.inject({
              method: "PUT",
              url: "/api/v1/me/preferences",
              headers: { authorization: `Bearer ${data.empToken}` },
              payload: { [key]: target[key] },
            }),
          ),
        );

        for (const res of results) {
          expect(res.statusCode).toBe(200);
        }

        const getRes = await app.inject({
          method: "GET",
          url: "/api/v1/me/preferences",
          headers: { authorization: `Bearer ${data.empToken}` },
        });
        expect(getRes.statusCode).toBe(200);
        const body = JSON.parse(getRes.body);
        // #602: the answer also names the (unchanged, empty) e-mail opt-out list.
        expect(body, `round ${round} (target set ${round % 2 === 0 ? "A" : "B"})`).toEqual({
          ...target,
          themeChoice: target.theme,
          tenantDefaultTheme: "pflaume",
          emailOptOut: [],
          lists: {},
          whyClockIntroSeen: false,
        });
      }
    },
  );

  it("a single partial PUT on a fresh state returns 200 with exactly the 8 default-merged keys", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.adminToken}` },
      // #842 D-842-18: the legacy id "wald" is stored and returned as "petrol".
      payload: { theme: "wald" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Object.keys(body).sort()).toEqual([
      "emailOptOut",
      "language",
      "lists",
      "mode",
      "tenantDefaultTheme",
      "theme",
      "themeChoice",
      "whyClockIntroSeen",
    ]);
    expect(body).toEqual({ ...DEFAULTS, theme: "petrol", themeChoice: "petrol" });
  });

  // #842 D-842-18: the three current ids and the legacy mapping, on the wire and in storage.
  it.each([
    ["pflaume", "pflaume"],
    ["salz", "salz"],
    ["petrol", "petrol"],
    ["nacht", "salz"],
    ["schiefer", "salz"],
    ["wald", "petrol"],
  ])("PUT theme %s is stored and returned as %s", async (sent, stored) => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { theme: sent },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).theme).toBe(stored);
    const row = await app.prisma.user.findUnique({
      where: { id: data.empUser.id },
      select: { uiPreferences: true },
    });
    expect((row?.uiPreferences as Record<string, unknown>).theme).toBe(stored);
  });

  it("the retired skin and density keys answer 200 and are not stored (stale tab)", async () => {
    await app.prisma.user.update({
      where: { id: data.adminUser.id },
      data: { uiPreferences: { theme: "salz" } },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: { skin: "modern", density: "compact" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ...DEFAULTS, theme: "salz", themeChoice: "salz" });
    const row = await app.prisma.user.findUnique({
      where: { id: data.adminUser.id },
      select: { uiPreferences: true },
    });
    expect(row?.uiPreferences).toEqual({ theme: "salz" });
  });

  it("GET normalises a stored legacy row and never returns skin or density", async () => {
    await app.prisma.user.update({
      where: { id: data.empUser.id },
      data: { uiPreferences: { theme: "wald", skin: "modern", density: "compact", mode: "dark" } },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Object.keys(body).sort()).toEqual([
      "emailOptOut",
      "language",
      "lists",
      "mode",
      "tenantDefaultTheme",
      "theme",
      "themeChoice",
      "whyClockIntroSeen",
    ]);
    expect(body).toEqual({
      theme: "petrol",
      themeChoice: "petrol",
      tenantDefaultTheme: "pflaume",
      mode: "dark",
      language: "de",
      emailOptOut: [],
      lists: {},
      whyClockIntroSeen: false,
    });
  });

  // #975: "system" (follow the device) is a stored value, and an absent mode reads "system".
  it("PUT mode system is stored and returned; light and dark stay as they are; an absent mode reads system", async () => {
    await app.prisma.user.update({
      where: { id: data.adminUser.id },
      data: { uiPreferences: Prisma.DbNull },
    });
    const absent = await app.inject({
      method: "GET",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(JSON.parse(absent.body).mode).toBe("system");

    for (const value of ["dark", "light", "system"]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/me/preferences",
        headers: { authorization: `Bearer ${data.adminToken}` },
        payload: { mode: value },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).mode).toBe(value);
      const read = await app.inject({
        method: "GET",
        url: "/api/v1/me/preferences",
        headers: { authorization: `Bearer ${data.adminToken}` },
      });
      expect(JSON.parse(read.body).mode).toBe(value);
      const row = await app.prisma.user.findUnique({
        where: { id: data.adminUser.id },
        select: { uiPreferences: true },
      });
      expect((row?.uiPreferences as Record<string, unknown>).mode).toBe(value);
    }
  });

  it("PUT mode auto is a 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { mode: "auto" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("an unknown theme id (lila) still returns 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { theme: "lila" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("a stored uiPreferences of DB NULL is merged onto an empty object", async () => {
    await app.prisma.user.update({
      where: { id: data.empUser.id },
      data: { uiPreferences: Prisma.DbNull },
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { theme: "wald" },
    });
    expect(res.statusCode).toBe(200);
    // #842 D-842-18: "wald" is stored as "petrol".
    expect(JSON.parse(res.body)).toEqual({ ...DEFAULTS, theme: "petrol", themeChoice: "petrol" });

    const stored = await app.prisma.user.findUnique({
      where: { id: data.empUser.id },
      select: { uiPreferences: true },
    });
    expect(stored?.uiPreferences).toEqual({ theme: "petrol" });
  });

  it("a stored uiPreferences that is a JSON array is merged onto an empty object", async () => {
    await app.prisma.user.update({
      where: { id: data.empUser.id },
      data: { uiPreferences: ["garbage"] },
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { theme: "wald" },
    });
    expect(res.statusCode).toBe(200);
    // #842 D-842-18: "wald" is stored as "petrol".
    expect(JSON.parse(res.body)).toEqual({ ...DEFAULTS, theme: "petrol", themeChoice: "petrol" });

    const stored = await app.prisma.user.findUnique({
      where: { id: data.empUser.id },
      select: { uiPreferences: true },
    });
    expect(stored?.uiPreferences).toEqual({ theme: "petrol" });
  });

  it("#602: the e-mail opt-out is stored as a whole list of known groups, unknown groups are 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { emailOptOut: ["emailOnMissingEntries", "emailOnLeaveDecision"] },
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body).emailOptOut).toEqual([
      "emailOnMissingEntries",
      "emailOnLeaveDecision",
    ]);

    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { emailOptOut: ["ACCOUNT_LOCKED"] },
    });
    expect(bad.statusCode).toBe(400);

    const cleared = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${data.empToken}` },
      payload: { emailOptOut: [] },
    });
    expect(JSON.parse(cleared.body).emailOptOut).toEqual([]);
  });

  it("an unknown user id (valid JWT, nonexistent user) returns 404", async () => {
    const payload: JwtPayload = {
      sub: randomUUID(),
      tenantId: data.tenant.id,
      employeeId: undefined,
    };
    const bearer = `Bearer ${app.jwt.sign(payload)}`;

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: bearer },
      payload: { theme: "wald" },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("Benutzer nicht gefunden");
  });
});

// Issue #1028: the stored page size and filter per list (`lists`). The register of list ids is
// packages/types/list-preferences.json; the API validates every PUT against it and drops invalid stored
// data on read. Two lists never overwrite each other (one-level merge inside the single atomic UPDATE).
describe("PUT /api/v1/me/preferences - lists (Issue #1028)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "mprl");
  });

  beforeEach(async () => {
    // Every case starts from a person who stored nothing.
    for (const id of [data.empUser.id, data.adminUser.id]) {
      await app.prisma.user.update({ where: { id }, data: { uiPreferences: Prisma.DbNull } });
    }
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  const put = (token: string, payload: unknown) =>
    app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });

  const get = (token: string) =>
    app.inject({
      method: "GET",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${token}` },
    });

  it("an entry is stored and answered, a second list keeps the first (one-level merge)", async () => {
    const first = await put(data.empToken, {
      lists: { "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" } },
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).lists).toEqual({
      "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" },
    });

    const second = await put(data.empToken, { lists: { "ich.tag.fuer-dich": { pageSize: 20 } } });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).lists).toEqual({
      "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" },
      "ich.tag.fuer-dich": { pageSize: 20 },
    });

    const read = await get(data.empToken);
    expect(JSON.parse(read.body).lists).toEqual({
      "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" },
      "ich.tag.fuer-dich": { pageSize: 20 },
    });
  });

  it("an entry is replaced as a whole, the filter can go back to null", async () => {
    await put(data.adminToken, {
      lists: { "team.heute.aufgaben": { pageSize: 20, filter: "nachtrag" } },
    });
    const res = await put(data.adminToken, {
      lists: { "team.heute.aufgaben": { pageSize: 5, filter: null } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lists["team.heute.aufgaben"]).toEqual({
      pageSize: 5,
      filter: null,
    });
  });

  it("a lists PUT leaves theme, mode, language and the e-mail opt-out unchanged", async () => {
    await put(data.adminToken, {
      theme: "salz",
      mode: "dark",
      language: "en",
      emailOptOut: ["emailOnLeaveDecision"],
    });
    const res = await put(data.adminToken, { lists: { "ich.tag.verlauf": { pageSize: 10 } } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      theme: "salz",
      themeChoice: "salz",
      mode: "dark",
      language: "en",
      emailOptOut: ["emailOnLeaveDecision"],
      lists: { "ich.tag.verlauf": { pageSize: 10 } },
    });
  });

  it("a theme PUT leaves the stored lists unchanged", async () => {
    await put(data.adminToken, { lists: { "ich.tag.letzte-tage": { pageSize: 20 } } });
    const res = await put(data.adminToken, { theme: "petrol" });
    expect(JSON.parse(res.body).lists["ich.tag.letzte-tage"]).toEqual({ pageSize: 20 });
  });

  it.each([
    ["an unknown list id", { "no.such.list": { pageSize: 5 } }],
    ["a page size outside the sizes of a widget (7)", { "team.heute.aufgaben": { pageSize: 7 } }],
    ["a table size on a widget (25)", { "team.heute.aufgaben": { pageSize: 25 } }],
    ["a widget size on a table (5)", { "team.heute.team-woche": { pageSize: 5 } }],
    ["a page size that is a string", { "team.heute.aufgaben": { pageSize: "10" } }],
    ["a filter outside the allow-list", { "team.heute.aufgaben": { filter: "bogus" } }],
    ["a filter that is a number", { "team.heute.aufgaben": { filter: 42 } }],
    ["a filter on a list that has none", { "ich.tag.fuer-dich": { filter: "alle" } }],
    ["a code filter that breaks the pattern", { "team.heute.demnaechst": { filter: "a b" } }],
    ["a code filter that is too long", { "team.heute.demnaechst": { filter: "x".repeat(41) } }],
    ["an entry that is not an object", { "team.heute.aufgaben": 10 }],
  ])("%s is a 400", async (_label, lists) => {
    const res = await put(data.empToken, { lists });
    expect(res.statusCode).toBe(400);
  });

  it("lists that is not an object is a 400", async () => {
    expect((await put(data.empToken, { lists: [] })).statusCode).toBe(400);
    expect((await put(data.empToken, { lists: "x" })).statusCode).toBe(400);
  });

  it("more than 16 entries in one PUT is a 400", async () => {
    const lists: Record<string, unknown> = {};
    for (let i = 0; i < 17; i++) lists[`team.heute.aufgaben${i}`] = { pageSize: 5 };
    const res = await put(data.empToken, { lists });
    expect(res.statusCode).toBe(400);
  });

  it("a code filter of a list without an allow-list (Demnächst abwesend) is stored", async () => {
    const res = await put(data.empToken, {
      lists: { "team.heute.demnaechst": { pageSize: 10, filter: "VACATION" } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lists["team.heute.demnaechst"]).toEqual({
      pageSize: 10,
      filter: "VACATION",
    });
  });

  it("an empty entry is accepted and answered as no entry (the defaults apply)", async () => {
    const res = await put(data.adminToken, { lists: { "team.heute.fehlende-zeiten": {} } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lists).toEqual({});
  });

  it("six concurrent PUTs for three different lists keep all three, in every one of 10 rounds", async () => {
    const ids = ["team.heute.jetzt", "team.heute.fehlende-zeiten", "ich.tag.verlauf"] as const;
    for (let round = 0; round < 10; round++) {
      const size = round % 2 === 0 ? 10 : 20;
      const results = await Promise.all(
        [...ids, ...ids].map((id) => put(data.empToken, { lists: { [id]: { pageSize: size } } })),
      );
      for (const res of results) expect(res.statusCode).toBe(200);
      const body = JSON.parse((await get(data.empToken)).body);
      expect(body.lists, `round ${round}`).toEqual({
        "team.heute.jetzt": { pageSize: size },
        "team.heute.fehlende-zeiten": { pageSize: size },
        "ich.tag.verlauf": { pageSize: size },
      });
    }
  });

  it("stored junk is dropped on read, valid siblings stay", async () => {
    await app.prisma.user.update({
      where: { id: data.adminUser.id },
      data: {
        uiPreferences: {
          lists: {
            "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" },
            "no.such.list": { pageSize: 5 },
            "ich.tag.fuer-dich": { pageSize: "abc" },
            "ich.tag.letzte-tage": { pageSize: 20, filter: 42 },
            "team.heute.team-woche": { pageSize: 5 },
            "ich.tag.verlauf": 7,
          },
        },
      },
    });
    const body = JSON.parse((await get(data.adminToken)).body);
    expect(body.lists).toEqual({
      "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" },
      "ich.tag.letzte-tage": { pageSize: 20 },
    });
  });

  it("a stored lists value that is not an object reads as empty and a PUT repairs it", async () => {
    await app.prisma.user.update({
      where: { id: data.adminUser.id },
      data: { uiPreferences: { lists: ["x"], theme: "salz" } },
    });
    expect(JSON.parse((await get(data.adminToken)).body).lists).toEqual({});
    const res = await put(data.adminToken, { lists: { "ich.tag.verlauf": { pageSize: 5 } } });
    expect(res.statusCode).toBe(200);
    const row = await app.prisma.user.findUnique({
      where: { id: data.adminUser.id },
      select: { uiPreferences: true },
    });
    expect(row?.uiPreferences).toEqual({
      theme: "salz",
      lists: { "ich.tag.verlauf": { pageSize: 5 } },
    });
  });
});
