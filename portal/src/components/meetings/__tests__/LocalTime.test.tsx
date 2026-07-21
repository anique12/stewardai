/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { LocalTime, MeetingMetaLine } from "../LocalTime";

const START = "2026-07-21T06:45:00Z";
const END = "2026-07-21T07:00:00Z"; // +15 min

test("MeetingMetaLine includes date, a time, duration and platform, in order", () => {
  const { container } = render(
    <MeetingMetaLine startTime={START} endTime={END} meetUrl="https://meet.google.com/abc-defg-hij" />
  );
  const text = container.textContent ?? "";
  // A weekday/date, a HH:MM time, the computed duration and the platform label.
  expect(text).toMatch(/\d{1,2}:\d{2}/); // a time is rendered
  expect(text).toContain("15 min");
  expect(text).toContain("Google Meet");
  expect(text.indexOf("15 min")).toBeLessThan(text.indexOf("Google Meet"));
});

test("MeetingMetaLine maps Zoom and Teams URLs", () => {
  const zoom = render(
    <MeetingMetaLine startTime={START} endTime={END} meetUrl="https://us02web.zoom.us/j/123" />
  );
  expect(zoom.container.textContent).toContain("Zoom");

  const teams = render(
    <MeetingMetaLine startTime={START} endTime={END} meetUrl="https://teams.microsoft.com/l/meetup/x" />
  );
  expect(teams.container.textContent).toContain("Teams");
});

test("MeetingMetaLine omits duration and platform when unknown", () => {
  const { container } = render(
    <MeetingMetaLine startTime={START} endTime={null} meetUrl={null} />
  );
  const text = container.textContent ?? "";
  expect(text).not.toContain("min");
  expect(text).not.toContain("Google Meet");
});

test("LocalTime renders a HH:MM time for the given instant", () => {
  const { container } = render(<LocalTime iso={START} />);
  expect(container.textContent ?? "").toMatch(/\d{1,2}:\d{2}/);
});
