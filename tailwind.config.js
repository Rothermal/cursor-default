/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: Object.fromEntries([
        'canvas', 'surface', 'surface-muted', 'surface-elevated', 'content',
        'content-muted', 'content-subtle', 'line', 'line-strong', 'control',
        'control-hover', 'control-disabled', 'content-disabled', 'focus', 'overlay',
        'accent', 'accent-hover', 'accent-content', 'info', 'info-content', 'info-line',
        'success', 'success-content', 'success-line', 'warning', 'warning-content',
        'warning-line', 'danger', 'danger-content', 'danger-line', 'danger-action',
        'danger-action-content',
        'court-surface', 'court-line', 'court-hint', 'court-made', 'court-miss', 'court-tracked', 'court-opponent',
        'pitch-surface', 'pitch-line', 'pitch-tracked', 'pitch-opponent', 'pitch-ink', 'pitch-yellow-card', 'pitch-red-card',
        'rink-ice', 'rink-board', 'rink-red', 'rink-blue', 'rink-crease', 'rink-tracked', 'rink-opponent', 'rink-ink',
        'diamond-grass', 'diamond-dirt', 'diamond-line', 'diamond-ink', 'diamond-tracked', 'diamond-opponent',
        ...['amber', 'sky', 'emerald', 'violet', 'rose', 'slate', 'orange', 'red', 'blue', 'green', 'indigo', 'teal', 'cyan', 'pink']
          .flatMap(color => ['surface', 'active', 'content', 'badge', 'badge-content'].map(part => `stat-${color}-${part}`)),
      ].map(name => [name, `rgb(var(--${name}) / <alpha-value>)`])),
    },
  },
  plugins: [],
}
