"use client";

// Dedicated OAuth-completion landing page for the Composio connect popup.
// Composio redirects the popup HERE (callbackUrl) after the user approves,
// instead of onto the full app — so the popup can (1) signal the opener that
// the connection finished, then (2) close itself. Same-origin BroadcastChannel
// + a localStorage fallback reach the opener even though the popup is opened
// with `noopener` (no window.opener handle), because both are same-origin.

import { useEffect, useState } from "react";

export default function OAuthComplete() {
  const [app, setApp] = useState("");

  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("app") || "";
    setApp(a);
    const payload = { type: "composio-connected", app: a, t: Date.now() };
    try {
      const bc = new BroadcastChannel("composio-oauth");
      bc.postMessage(payload);
      bc.close();
    } catch {
      // BroadcastChannel unsupported — fall through to the storage signal.
    }
    try {
      // `storage` events fire in other same-origin tabs/windows.
      localStorage.setItem("composio-oauth", JSON.stringify(payload));
    } catch {
      // ignore
    }
    // Give the signal a tick to flush, then close the popup.
    const t = setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore — some browsers block programmatic close; the message below stays.
      }
    }, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 40,
        textAlign: "center",
        color: "#1e4a3d",
      }}
    >
      <div>
        <p style={{ fontSize: 15, fontWeight: 600 }}>
          {app ? `${app} connected.` : "Connected."}
        </p>
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
          You can close this window and return to MeetBase.
        </p>
      </div>
    </div>
  );
}
