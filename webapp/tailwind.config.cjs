/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        ink: {
          0: '#FAFAF7',
          1: '#E5E4DF',
          2: '#9A9A93',
          3: '#5C5C57',
          4: '#2A2A28',
        },
        accent: {
          DEFAULT: '#38BDF8',
          soft: 'rgba(56,189,248,0.12)',
        },
        surface: '#0A0A0A',
      },
      borderColor: {
        hairline: '#2A2A28',
      },
      borderRadius: {
        chip: '2px',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(56,189,248,0.25)' },
          '50%': { boxShadow: '0 0 16px rgba(56,189,248,0.55)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
