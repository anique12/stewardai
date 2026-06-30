// Official multi-color brand marks for the integrations the agent acts in.
// Inline SVG (multi-path, brand hex colors) — no network, no deps. These are
// meant to sit on small neutral/white rounded tiles so the multi-color marks
// read cleanly on the dark theme. Third-party trademarks shown only to
// indicate supported integrations (nominative fair use).

type IconProps = { className?: string };

// Google Calendar — official multi-color square with the "31" numeral.
export function GoogleCalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {/* white body */}
      <path fill="#fff" d="M18 5H6L5 6v12l1 1h12l1-1V6l-1-1z" />
      {/* colored edges */}
      <path fill="#EA4335" d="M5 5h9v5H5z" transform="translate(0 0)" />
      <path fill="#1967D2" d="M5 18h5v1H6a1 1 0 0 1-1-1z" />
      <path fill="#FBBC04" d="M5 14h5v4H5z" />
      <path fill="#34A853" d="M14 14h5v3a1 1 0 0 1-1 1h-4z" />
      <path fill="#4285F4" d="M19 14V6a1 1 0 0 0-1-1h-4v9z" />
      <path fill="#188038" d="M10 14h4v4h-4z" />
      <path fill="#1967D2" d="M5 5a1 1 0 0 1 1-1h8v6H5z" />
      {/* "31" numeral */}
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontSize="6.4"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        fill="#1A73E8"
      >
        31
      </text>
    </svg>
  );
}

// Gmail — official multi-color "M" envelope on a white body.
export function GmailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {/* white envelope body */}
      <path
        fill="#fff"
        d="M3.5 5h17A1.5 1.5 0 0 1 22 6.5v11A1.5 1.5 0 0 1 20.5 19h-17A1.5 1.5 0 0 1 2 17.5v-11A1.5 1.5 0 0 1 3.5 5z"
      />
      {/* left blue arm */}
      <path fill="#4285F4" d="M2 17.5A1.5 1.5 0 0 0 3.5 19H6V9.5L2 6.5v11z" />
      {/* right green arm */}
      <path fill="#34A853" d="M22 17.5A1.5 1.5 0 0 1 20.5 19H18V9.5l4-3v11z" />
      {/* red top + left peak */}
      <path
        fill="#EA4335"
        d="M2 6.5A1.5 1.5 0 0 1 3.5 5H4l8 6 8-6h.5A1.5 1.5 0 0 1 22 6.5L12 14 2 6.5z"
      />
      {/* yellow inner V (the M valleys) */}
      <path fill="#FBBC04" d="M6 9.5 12 14l6-4.5V19h-1V11l-5 3.7L7 11v8H6V9.5z" />
    </svg>
  );
}

// Notion — official mark, rendered in the light (white-glyph) variant so it
// reads on the dark theme.
export function NotionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#fff"
        d="M4.3 3.4 14.8 2.6c1.3-.1 1.6 0 2.4.6l3.3 2.3c.6.4.8.5.8 1v13.2c0 .9-.3 1.4-1.4 1.5l-12.2.7c-.8 0-1.2-.1-1.7-.6l-2.4-3.1c-.5-.7-.7-1.2-.7-1.8V5c0-.8.3-1.4 1.4-1.6Z"
      />
      <path
        fill="#000"
        d="M14.8 2.6 4.3 3.4C3.2 3.6 2.9 4.2 2.9 5v11.6c0 .6.2 1.1.7 1.8l2.4 3.1c.5.5.9.6 1.7.6l12.2-.7c1.1-.1 1.4-.6 1.4-1.5V6.5c0-.5-.2-.6-.8-1l-3.3-2.3c-.8-.6-1.1-.7-2.4-.6ZM7.6 7.5c-.4 0-.5.2-.2.4l1.9 1.4c.3.2.4.2.8.2l9.4-.6c.2 0 0-.2-.1-.3l-1.6-1.1c-.3-.2-.6-.4-1.2-.4L7.6 7.5Zm-.7-2.2c-.3 0-.4.2-.1.4l1.9 1.4c.3.2.4.2.8.2l9.4-.6c.2 0 0-.2-.1-.3l-1.6-1.1c-.3-.2-.6-.4-1.2-.4l-9.1.4Zm4.3 4.7v8.5c0 .4.2.5.4.7l.8.6c.2.2-.1.4-.2.4l-1.9.1c-.4 0-.6 0-.8-.2l-.9-.7c-.2-.3-.1-.4.1-.4l.7.1c.3 0 .4-.1.4-.4V12c0-.3 0-.4-.2-.6l-.7-.6c-.2-.2-.1-.4.2-.4l2-.1c.3 0 .4.1.4.4Z"
      />
      <path
        fill="#000"
        d="M16.6 9.8 18 9.7v8.4c-.4.2-.7.3-1 .3-.5 0-.6-.1-1-.6l-3-4.7v4.5l.8.2s0 .4-.3.4l-1.9.1c0-.4 0-.4.1-.6l.5-.1V12l-.7-.6c-.1-.3 0-.6.4-.6l2-.1 3 4.6v-4l-.8-.1c-.1-.3.1-.5.3-.5l1.5-.1.1.3-.4.1c-.3 0-.4.2-.4.5"
      />
    </svg>
  );
}

// Slack — official 4-color hash/clover mark.
export function SlackIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {/* green */}
      <path
        fill="#36C5F0"
        d="M9 3.1a2.1 2.1 0 1 0-2.1 2.1H9V3.1Z"
      />
      <path
        fill="#36C5F0"
        d="M9 6.3a2.1 2.1 0 0 0-2.1-2.1 2.1 2.1 0 0 0-2.1 2.1v5.2a2.1 2.1 0 0 0 4.2 0V6.3Z"
      />
      {/* blue */}
      <path
        fill="#2EB67D"
        d="M20.9 9a2.1 2.1 0 1 0-2.1-2.1V9h2.1Z"
      />
      <path
        fill="#2EB67D"
        d="M17.7 9a2.1 2.1 0 0 0 2.1-2.1 2.1 2.1 0 0 0-2.1-2.1h-5.2a2.1 2.1 0 0 0 0 4.2h5.2Z"
      />
      {/* red */}
      <path
        fill="#ECB22E"
        d="M15 20.9a2.1 2.1 0 1 0 2.1-2.1H15v2.1Z"
      />
      <path
        fill="#ECB22E"
        d="M15 17.7a2.1 2.1 0 0 0 2.1 2.1 2.1 2.1 0 0 0 2.1-2.1v-5.2a2.1 2.1 0 0 0-4.2 0v5.2Z"
      />
      {/* yellow */}
      <path
        fill="#E01E5A"
        d="M3.1 15a2.1 2.1 0 1 0 2.1 2.1V15H3.1Z"
      />
      <path
        fill="#E01E5A"
        d="M6.3 15a2.1 2.1 0 0 0-2.1 2.1 2.1 2.1 0 0 0 2.1 2.1h5.2a2.1 2.1 0 0 0 0-4.2H6.3Z"
      />
    </svg>
  );
}
