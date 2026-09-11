/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        card: 'var(--bg-card)',
        line: 'var(--border)',
        ink: 'var(--ink)',
        t1: 'var(--text-1)',
        t2: 'var(--text-2)',
        t3: 'var(--text-3)',
        tdis: 'var(--text-disabled)',
        info: { DEFAULT: 'var(--info-bg)', fg: 'var(--info-fg)' },
        danger: 'var(--danger)',
        ok: 'var(--ok)',
        run: 'var(--run)',
        warn: { DEFAULT: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
      },
      borderRadius: { btn: '10px', card: '12px' },
      fontFamily: { sans: 'var(--font-sans)' },
      boxShadow: {
        s1: 'var(--shadow-1)',
        s2: 'var(--shadow-2)',
        s3: 'var(--shadow-3)',
      },
    },
  },
  plugins: [],
};
