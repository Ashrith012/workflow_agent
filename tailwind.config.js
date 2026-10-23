/** @type {import('tailwindcss').Config} */

// Theme-aware colours are RGB triplets in CSS variables (see src/index.css),
// so opacity modifiers like `bg-panel/80` keep working in both themes.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx}'],
  // `dark:` variants follow the toggle (data-theme on <html>), not the OS.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: token('page'),
        panel: token('panel'),
        line: token('line'),
        'line-strong': token('line-strong'),
        fg: token('fg'),
        'fg-soft': token('fg-soft'),
        muted: token('muted'),
        subtle: token('subtle'),
        faint: token('faint'),
        hover: 'rgb(var(--hover) / var(--hover-alpha))',
      },
    },
  },
  plugins: [],
};
