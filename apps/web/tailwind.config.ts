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
        success: "#15803d", // 5.02:1 on white
        "success-surface": "#f0fdf4",
        "success-border": "#86efac"
      },
      /* Shadows are ink-tinted (blue-gray), never neutral gray: tinted depth
         reads as elevation, gray reads as dirt on a colored surface. */
      boxShadow: {
        card: "0 1px 2px -1px rgba(29,39,51,0.08), 0 1px 3px 0 rgba(29,39,51,0.05)",
        raised: "0 2px 4px -2px rgba(29,39,51,0.10), 0 6px 16px -6px rgba(29,39,51,0.14)",
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
