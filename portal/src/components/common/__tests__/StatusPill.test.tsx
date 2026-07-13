/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { StatusPill } from "../StatusPill";

test("in_meeting shows Live with brand tone", () => {
  const { getByText } = render(
    <div className="steward-app">
      <StatusPill status="in_meeting" />
    </div>
  );
  expect(getByText(/live/i)).toBeInTheDocument();
});

test("done shows Completed", () => {
  const { getByText } = render(
    <div className="steward-app">
      <StatusPill status="done" />
    </div>
  );
  expect(getByText(/completed/i)).toBeInTheDocument();
});

test("failed shows Failed", () => {
  const { getByText } = render(
    <div className="steward-app">
      <StatusPill status="failed" />
    </div>
  );
  expect(getByText(/failed/i)).toBeInTheDocument();
});

test("scheduled shows Scheduled", () => {
  const { getByText } = render(
    <div className="steward-app">
      <StatusPill status="scheduled" />
    </div>
  );
  expect(getByText(/scheduled/i)).toBeInTheDocument();
});

test("pending shows Pending", () => {
  const { getByText } = render(
    <div className="steward-app">
      <StatusPill status="pending" />
    </div>
  );
  expect(getByText(/pending/i)).toBeInTheDocument();
});
