/**
 * Issue #606 — the seen state of the „Warum stempeln?“ intro lives on the server in
 * `User.uiPreferences.whyClockIntroSeen`, written only as `true` through PUT /me/preferences.
 * A second device (a second sign-in of the same person) reads the same value.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "./setup";

describe("Issue #606 — whyClockIntroSeen in /me/preferences", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  const get = (token: string) =>
    app.inject({
      method: "GET",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${token}` },
    });
  const put = (token: string, payload: unknown) =>
    app.inject({
      method: "PUT",
      url: "/api/v1/me/preferences",
      headers: { authorization: `Bearer ${token}` },
      payload: payload as object,
    });

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "wci606");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("a fresh user reads false; PUT true stores it and answers true", async () => {
    expect(JSON.parse((await get(data.empToken)).body).whyClockIntroSeen).toBe(false);
    const res = await put(data.empToken, { whyClockIntroSeen: true });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).whyClockIntroSeen).toBe(true);
    expect(JSON.parse((await get(data.empToken)).body).whyClockIntroSeen).toBe(true);
    const stored = await app.prisma.user.findUniqueOrThrow({
      where: { id: data.empUser.id },
      select: { uiPreferences: true },
    });
    expect(stored.uiPreferences).toMatchObject({ whyClockIntroSeen: true });
  });

  it("PUT false is a 400 and changes nothing; the seen state has no way back", async () => {
    const res = await put(data.empToken, { whyClockIntroSeen: false });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse((await get(data.empToken)).body).whyClockIntroSeen).toBe(true);
    expect((await put(data.empToken, { whyClockIntroSeen: "yes" })).statusCode).toBe(400);
  });

  it("a PUT of theme or lists leaves the seen state true", async () => {
    await put(data.empToken, { theme: "petrol" });
    await put(data.empToken, { lists: { "ich.tag.verlauf": { pageSize: 10 } } });
    expect(JSON.parse((await get(data.empToken)).body).whyClockIntroSeen).toBe(true);
  });

  it("is per person: another user of the tenant still reads false", async () => {
    expect(JSON.parse((await get(data.adminToken)).body).whyClockIntroSeen).toBe(false);
  });

  it("a second device (a second sign-in with its own access token) reads true", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: data.empUser.email, password: "test1234" },
    });
    expect(login.statusCode).toBe(200);
    const secondToken = (JSON.parse(login.body) as { accessToken: string }).accessToken;
    expect(JSON.parse((await get(secondToken)).body).whyClockIntroSeen).toBe(true);
  });
});
