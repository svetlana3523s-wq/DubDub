/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Space Grotesk'", "system-ui", "sans-serif"],
      },
      colors: {
        tg: {
          bg: "var(--tg-theme-bg-color, #0f0f0f)",
          secondary: "var(--tg-theme-secondary-bg-color, #1a1a1a)",
          text: "var(--tg-theme-text-color, #ffffff)",
          hint: "var(--tg-theme-hint-color, #8e8e8e)",
          link: "var(--tg-theme-link-color, #64b5f6)",
          button: "var(--tg-theme-button-color, #3390ec)",
          buttonText: "var(--tg-theme-button-text-color, #ffffff)",
        },
        accent: {
          primary: "#ff4d6d",
          secondary: "#845ef7",
        },
      },
      animation: {
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "slide-up": "slideUp 0.4s ease-out",
        "fade-in": "fadeIn 0.3s ease-out",
        recording: "recording 1.5s ease-in-out infinite",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        recording: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.1)", opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};

