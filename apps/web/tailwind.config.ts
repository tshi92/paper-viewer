import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#d8dee8",
        surface: "#f7f8fb",
        ink: "#1d2733",
        muted: "#657386",
        accent: "#256f8f"
      }
    }
  },
  plugins: []
};

export default config;
