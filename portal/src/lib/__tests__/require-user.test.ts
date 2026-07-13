import type { User } from "@supabase/supabase-js";

const getUserMock = jest.fn();
// requireUserPage now reads the session LOCALLY via getSession (perf: no auth
// network round-trip per navigation); requireUserRoute still uses getUser for
// strict verification on mutation routes.
const getSessionMock = jest.fn();
const redirectMock = jest.fn((path: string): never => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock, getSession: getSessionMock } }),
}));

import { requireUserPage, requireUserRoute } from "@/lib/auth-helpers";

const fakeUser = { id: "user-a" } as unknown as User;

beforeEach(() => {
  getUserMock.mockReset();
  getSessionMock.mockReset();
  redirectMock.mockClear();
});

describe("requireUserPage", () => {
  it("returns the user when authenticated", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: fakeUser } } });
    await expect(requireUserPage()).resolves.toEqual(fakeUser);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /?login=1 when unauthenticated", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await expect(requireUserPage()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/?login=1");
  });
});

describe("requireUserRoute", () => {
  it("returns { user } when authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: fakeUser } });
    const result = await requireUserRoute();
    expect(result.user).toEqual(fakeUser);
  });

  it("returns a 401 response when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const result = await requireUserRoute();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
  });
});
