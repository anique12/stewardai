import { gravatarUrl, initials, attendeesFromEvent } from "@/lib/meetings/attendees";

describe("gravatarUrl", () => {
  it("hashes a known email to the known Gravatar md5", () => {
    // md5("test@example.com") = 55502f40dc8b7c769880b10874abc9d0 (verified independently)
    expect(gravatarUrl("test@example.com")).toBe(
      "https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?d=404&s=96"
    );
  });

  it("trims and lowercases before hashing so equivalent addresses match", () => {
    expect(gravatarUrl("  Test@Example.com  ")).toBe(gravatarUrl("test@example.com"));
  });
});

describe("initials", () => {
  it("takes the first letter of up to two words in a name", () => {
    expect(initials("Maya Chen")).toBe("MC");
  });
  it("falls back to the email localpart when no name is given", () => {
    expect(initials("maya.chen@example.com")).toBe("MC");
  });
  it("handles a single word", () => {
    expect(initials("Maya")).toBe("M");
  });
});

describe("attendeesFromEvent", () => {
  it("maps Google Calendar attendees to our Attendee shape", () => {
    const event = {
      attendees: [
        { email: "maya@example.com", displayName: "Maya Chen", responseStatus: "accepted", organizer: true },
        { email: "dana@example.com", responseStatus: "needsAction" },
      ],
    };
    const out = attendeesFromEvent(event as never);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ email: "maya@example.com", name: "Maya Chen", organizer: true });
    expect(out[0].photoUrl).toBe(gravatarUrl("maya@example.com"));
    // no displayName -> falls back to the email localpart
    expect(out[1].name).toBe("dana");
  });

  it("skips conference-room resources", () => {
    const event = {
      attendees: [
        { email: "room@resource.calendar.google.com", resource: true },
        { email: "person@example.com", displayName: "Real Person" },
      ],
    };
    const out = attendeesFromEvent(event as never);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("person@example.com");
  });

  it("returns [] when there are no attendees", () => {
    expect(attendeesFromEvent({} as never)).toEqual([]);
    expect(attendeesFromEvent({ attendees: undefined } as never)).toEqual([]);
  });
});
