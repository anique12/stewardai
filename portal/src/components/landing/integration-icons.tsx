// Inline brand marks (simple-icons-style single/multi-path SVGs) for the
// integrations the agent acts in. No network, no deps — these render as
// monochrome marks we tint per-brand on the dark theme. Third-party
// trademarks shown only to indicate integrations.

type IconProps = { className?: string };

export function GoogleCalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M19.5 22h-15A2.5 2.5 0 0 1 2 19.5v-15A2.5 2.5 0 0 1 4.5 2h15A2.5 2.5 0 0 1 22 4.5v15a2.5 2.5 0 0 1-2.5 2.5ZM5 6v13h14V6H5Z" />
      <path d="M8.7 15.9c-.9 0-1.6-.5-2-1.3l1-.4c.2.4.5.6 1 .6.5 0 .8-.3.8-.7 0-.4-.3-.7-.9-.7h-.4v-.9h.4c.5 0 .8-.2.8-.6 0-.3-.3-.6-.7-.6-.4 0-.7.2-.8.5l-1-.4c.3-.7 1-1.1 1.8-1.1 1 0 1.8.6 1.8 1.5 0 .5-.2.9-.6 1.1.5.2.8.6.8 1.2 0 .9-.8 1.5-1.8 1.5ZM13.7 11.4l-1 .7-.5-.8 1.7-1.2h.9v5.7h-1.1v-4.4Z" />
    </svg>
  );
}

export function GmailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M1.5 20.5h3v-9L12 16l7.5-4.5v9h3a1 1 0 0 0 1-1V5.6a1.6 1.6 0 0 0-2.5-1.3L12 10.2 3 4.3A1.6 1.6 0 0 0 .5 5.6v13.9a1 1 0 0 0 1 1Z" />
    </svg>
  );
}

export function NotionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M4.3 3.4 14.8 2.6c1.3-.1 1.6 0 2.4.6l3.3 2.3c.6.4.8.5.8 1v13.2c0 .9-.3 1.4-1.4 1.5l-12.2.7c-.8 0-1.2-.1-1.7-.6l-2.4-3.1c-.5-.7-.7-1.2-.7-1.8V5c0-.8.3-1.4 1.4-1.6Zm.7 1.9c-.3 0-.4.2-.1.4l1.9 1.4c.3.2.4.2.8.2l9.4-.6c.2 0 0-.2-.1-.3l-1.6-1.1c-.3-.2-.6-.4-1.2-.4L5 5.3Zm5.9 13.5V8.4c0-.3-.1-.4-.4-.4l-2 .1c-.3 0-.4.2-.2.4l.7.6c.2.2.2.3.2.6v8.2c0 .3-.1.4-.4.4l-.7-.1c-.2 0-.3.1-.1.4l.9.7c.2.2.4.2.8.2l2.3-.1c.3 0 .4-.2.2-.4l-.8-.6c-.2-.2-.4-.3-.4-.7Zm5.2-8.6 1.5-.1V18l-.7.1-3-9.4c-.1-.3-.2-.4-.5-.4l-1.7.1V8.5l.7.6c.2.2.2.3.2.6v6.6l-.7.1c-.2 0-.2.2 0 .4l1.9-.1c.2 0 .3-.2.1-.4l-.7-.6V10l3.1 9.6c.1.3.2.4.5.4l1.1-.1c.3 0 .4-.2.4-.5V8.2c0-.3.1-.4.4-.5l.6-.1c.2 0 .2-.2 0-.4l-1.7.1c-.3 0-.4.2-.2.4l.6.5c.2.2.3.3.3.6Z" />
    </svg>
  );
}

export function SlackIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M5.6 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1 0a2.1 2.1 0 0 1 4.2 0v5.3a2.1 2.1 0 0 1-4.2 0v-5.3ZM8.7 5.6a2.1 2.1 0 1 1 2.1-2.1v2.1H8.7Zm0 1a2.1 2.1 0 0 1 0 4.2H3.4a2.1 2.1 0 0 1 0-4.2h5.3ZM18.4 8.7a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.7Zm-1 0a2.1 2.1 0 0 1-4.2 0V3.4a2.1 2.1 0 0 1 4.2 0v5.3ZM15.3 18.4a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1a2.1 2.1 0 0 1 0-4.2h5.3a2.1 2.1 0 0 1 0 4.2h-5.3Z" />
    </svg>
  );
}
