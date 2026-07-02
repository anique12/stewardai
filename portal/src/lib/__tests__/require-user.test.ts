import type { User } from "@supabase/supabase-js";

const getUserMock = jest.fn();
const redirectMock = jest.fn((..._args: unknown[]) => {
  throw new Error("REDIRECT");
});

jest.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}));

import { requireUserPage, requireUserRoute } from "@/lib/auth-helpers";

const fakeUser = { id: "user-a" } as unknown as User;

beforeEach(() => {
  getUserMock.mockReset();
  redirectMock.mockClear();
});

describe("requireUserPage", () => {
  it("returns the user when authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: fakeUser } });
    await expect(requireUserPage()).resolves.toEqual(fakeUser);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /?login=1 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
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
