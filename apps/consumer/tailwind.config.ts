import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    // Include consumer-ui package components
    "../../packages/consumer-ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        border: "var(--border)",
        card: "var(--card)",
        accent: "var(--accent)",
        // Semantic
        warm: {
          50: "#fdf8f0",
          100: "#f9ecd8",
          200: "#f2d6af",
          300: "#e9b97d",
          400: "#df9548",
          500: "#d67a2a",
          600: "#c05e1f",
          700: "#9f461c",
          800: "#81391d",
          900: "#69311b",
        },
        sage: {
          50: "#f4f7f4",
          100: "#e0e8df",
          200: "#c2d1c0",
          300: "#9bb398",
          400: "#73916f",
          500: "#557553",
          600: "#415d40",
          700: "#354a34",
          800: "#2c3c2c",
          900: "#253225",
        },
        earth: {
          50: "#f9f6f3",
          100: "#f0e8df",
          200: "#e0cebc",
          300: "#ccaf93",
          400: "#ba9170",
          500: "#ad7c57",
          600: "#a06a4b",
          700: "#855440",
          800: "#6d4639",
          900: "#593b31",
        },
        sky: {
          50: "#f0f7fb",
          100: "#dcedf5",
          200: "#bfddeb",
          300: "#93c5dc",
          400: "#60a5c7",
          500: "#3d89af",
          600: "#336f94",
          700: "#2d5b78",
          800: "#2a4d64",
          900: "#274155",
        },
        "t-bg": "var(--t-bg)",
        "t-panel": "var(--t-panel)",
        "t-panel-2": "var(--t-panel-2)",
        "t-panel-3": "var(--t-panel-3)",
        "t-line": "var(--t-line)",
        "t-line-strong": "var(--t-line-strong)",
        "t-amber": "var(--t-amber)",
        "t-amber-bright": "var(--t-amber-bright)",
        "t-phos": "var(--t-phos)",
        "t-phos-dim": "var(--t-phos-dim)",
        "t-white": "var(--t-white)",
        "t-red": "var(--t-red)",
        "t-red-bright": "var(--t-red-bright)",
        "t-bone-dim": "var(--t-bone-dim)",
        "t-steel": "var(--t-steel)",
        "t-electric": "var(--t-electric)",
      },
      fontFamily: {
        display: ['"IBM Plex Sans Variable"', '"IBM Plex Sans"', '"Segoe UI"', "Arial", "sans-serif"],
        body: ['"IBM Plex Sans Variable"', '"IBM Plex Sans"', '"Segoe UI"', "Arial", "sans-serif"],
        term: [
          '"IBM Plex Mono"',
          '"Cascadia Mono"',
          "Consolas",
          '"Liberation Mono"',
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // 18px body minimum per design brief
        body: ["1.125rem", { lineHeight: "1.75rem" }],
        lg: ["1.25rem", { lineHeight: "1.875rem" }],
        xl: ["1.5rem", { lineHeight: "2rem" }],
        "2xl": ["1.875rem", { lineHeight: "2.375rem" }],
        "3xl": ["2.25rem", { lineHeight: "2.75rem" }],
      },
      spacing: {
        // 48x48dp minimum touch targets
        touch: "3rem",
      },
      maxWidth: {
        flow: "32rem", // One-question-per-screen max width
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.5s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
