import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono-plex)", "var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        ui: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
      },
      maxWidth: {
        container: "1200px",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        paper: "var(--paper)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)", 3: "var(--surface-3)" },
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)", 4: "var(--ink-4)" },
        line: { DEFAULT: "var(--line)", 2: "var(--line-2)", strong: "var(--line-strong)" },
        brand: { DEFAULT: "var(--brand)", 2: "var(--brand-2)", ink: "var(--brand-ink)",
                 weak: "var(--brand-weak)", "weak-2": "var(--brand-weak-2)", on: "var(--on-brand)" },
        attention: { DEFAULT: "var(--attention)", strong: "var(--attention-strong)",
                     weak: "var(--attention-weak)", on: "var(--on-attention)" },
        danger: { DEFAULT: "var(--danger)", strong: "var(--danger-strong)",
                  weak: "var(--danger-weak)", on: "var(--on-danger)" },
        "on-brand": "var(--on-brand)",
        "on-attention": "var(--on-attention)",
        "on-danger": "var(--on-danger)",
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "9px",
        lg: "13px",
        xl: "18px",
        pill: "999px",
      },
      boxShadow: { "sh-1": "var(--sh-1)", "sh-2": "var(--sh-2)", "sh-pop": "var(--sh-pop)" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
