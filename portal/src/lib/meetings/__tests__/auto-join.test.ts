import { defaultOptedIn } from "../auto-join";

describe("defaultOptedIn", () => {
  it("never opts in without a Meet url, regardless of policy", () => {
    expect(defaultOptedIn("all", { isOrganizer: true, hasMeetUrl: false })).toBe(false);
    expect(defaultOptedIn("all", { isOrganizer: false, hasMeetUrl: false })).toBe(false);
    expect(defaultOptedIn("organizer", { isOrganizer: true, hasMeetUrl: false })).toBe(false);
    expect(defaultOptedIn("organizer", { isOrganizer: false, hasMeetUrl: false })).toBe(false);
    expect(defaultOptedIn("none", { isOrganizer: true, hasMeetUrl: false })).toBe(false);
    expect(defaultOptedIn("none", { isOrganizer: false, hasMeetUrl: false })).toBe(false);
  });

  describe("policy=all", () => {
    it("opts in whether or not the user organizes, as long as there's a Meet url", () => {
      expect(defaultOptedIn("all", { isOrganizer: true, hasMeetUrl: true })).toBe(true);
      expect(defaultOptedIn("all", { isOrganizer: false, hasMeetUrl: true })).toBe(true);
    });
  });

  describe("policy=organizer", () => {
    it("opts in only when the user organizes and there's a Meet url", () => {
      expect(defaultOptedIn("organizer", { isOrganizer: true, hasMeetUrl: true })).toBe(true);
      expect(defaultOptedIn("organizer", { isOrganizer: false, hasMeetUrl: true })).toBe(false);
    });
  });

  describe("policy=none", () => {
    it("never opts in, regardless of organizer or Meet url", () => {
      expect(defaultOptedIn("none", { isOrganizer: true, hasMeetUrl: true })).toBe(false);
      expect(defaultOptedIn("none", { isOrganizer: false, hasMeetUrl: true })).toBe(false);
    });
  });
});
