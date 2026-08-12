import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Structural separators only (dividers, card outlines) — decorative,
           exempt from WCAG 1.4.11. Form controls use `control` instead. */
        border: "#d8dee8",
        /* Form-control borders: 3.02:1 on white, the 1.4.11 bar. */
        control: "#8a95a4",
        surface: "#f7f8fb",
        ink: "#1d2733",
        muted: "#657386",
        accent: "#256f8f",
        /* Semantic colors, AA-checked on the grounds they sit on. */
        danger: "#dc2626", // 4.83:1 on white
        "danger-deep": "#b91c1c", // 5.91:1 on danger-surface
        "danger-surface": "#fef2f2",
        "danger-border": "#fca5a5",
        success: "#15803d" // 5.02:1 on white
      }
    }
  },
  plugins: []
};

export default config;
