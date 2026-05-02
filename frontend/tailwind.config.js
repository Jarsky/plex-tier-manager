module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        netflix: {
          orange: '#ff6a00',
          dark: '#141414',
          light: '#e50914',
          gray: '#232323',
        },
        primary: '#ff6a00',
        background: '#141414',
        accent: '#e50914',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
