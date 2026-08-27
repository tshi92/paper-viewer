import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        /* Used for one thing: proper nouns set against the interface sans, so
           they read as a name rather than a label. Georgia-first and
           system-only — a webfont for a single word is not worth the request,
           and every platform resolves something serif. */
        serif: ['Georgia', '"Iowan Old Style"', '"Times New Roman"', 'serif']
      },
      colors: {
        /* Structural separators only (dividers, card outlines) — decorative,
           exempt from WCAG 1.4.11. Form controls use `control` instead.
           Deliberately faint: cards are separated from the page by tone
           (white on `canvas`) plus a soft shadow, and a darker outline on top
           of that reads as a second, competing separator. */
        border: "#e4e9f1",
        /* Form-control borders: 3.02:1 on white, the 1.4.11 bar. */
        control: "#8a95a4",
        /* The page ground. Darker than `surface` so a white card lifts off it
           without needing an outline. */
        canvas: "#f1f4f9",
        /* Inset areas *inside* a white card: chips, code blocks, table heads. */
        surface: "#f7f8fb",
        /* Loading placeholders. Darker than `border`, which is too faint to
           read as a block of pending content on either ground. */
        shimmer: "#dbe2ec",
        ink: "#1d2733",
        muted: "#657386",
        accent: "#256f8f",
        /* Semantic colors, AA-checked on the grounds they sit on. */
        danger: "#dc2626", // 4.83:1 on white
        "danger-deep": "#b91c1c", // 5.91:1 on danger-surface
        "danger-surface": "#fef2f2",
        "danger-border": "#fca5a5",
        success: "#15803d", // 5.02:1 on white
        "success-surface": "#f0fdf4",
        "success-border": "#86efac"
      },
      /* One radius scale for the whole app. `DEFAULT` is what ~150 call sites
         already write as plain `rounded`, so it sets the app's overall
         softness; `sm`/`md` exist for controls that would look inflated at
         12px, `lg`/`xl` for chat bubbles and dialogs. */
      borderRadius: {
        sm: "0.375rem", // 6px
        DEFAULT: "0.75rem", // 12px — cards, panels, buttons, inputs
        md: "0.5rem", // 8px
        lg: "1rem", // 16px
        xl: "1.25rem" // 20px
      },
      /* Shadows are ink-tinted (blue-gray), never neutral gray: tinted depth
         reads as elevation, gray reads as dirt on a colored surface. They are
         wide and faint rather than tight and dark — a card should look like it
         rests on the page, not like it is outlined in gray. */
      boxShadow: {
        card: "0 1px 2px 0 rgba(29,39,51,0.04), 0 4px 12px -4px rgba(29,39,51,0.07)",
        raised: "0 2px 6px -2px rgba(29,39,51,0.08), 0 12px 28px -10px rgba(29,39,51,0.14)",
        overlay: "0 4px 8px -4px rgba(29,39,51,0.16), 0 12px 32px -8px rgba(29,39,51,0.22)"
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "none" }
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" }
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
          to: { opacity: "1", transform: "none" }
        }
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        shimmer: "shimmer 1.8s linear infinite",
        "toast-in": "toast-in 200ms ease-out"
      }
    }
  },
  plugins: []
};

export default config;
