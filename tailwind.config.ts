/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        accel: {
          lightest: '#E8F5C9',
          light: '#A8E67D',
          secondary: '#6FD433',
          hover: '#3DB800',
          primary: '#279300',
          active: '#1F7A00',
          text: '#145200',
          dark: '#0D3800',
        },
      },
      fontFamily: {
        sans: ['"Yu Gothic"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.8' }],
        sm: ['14px', { lineHeight: '1.8' }],
        base: ['16px', { lineHeight: '1.8' }],
        lg: ['18px', { lineHeight: '1.8' }],
        xl: ['22px', { lineHeight: '1.8' }],
        '2xl': ['32px', { lineHeight: '1.8' }],
      },
      lineHeight: {
        relaxed: '1.8',
      },
    },
  },
  plugins: [],
}