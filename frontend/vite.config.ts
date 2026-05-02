import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['mediabox'],
    host: true,
    proxy: {
      '/api': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/api': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/set_theme': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/set_site_title': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/settings': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/update_role': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/save_user': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/delete_user': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/unlink_plex': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/change_password': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/assign_plan': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/user_summary': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/admin/get_secret': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/login/email': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/login/plex': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/login/admin': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/logout': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
      '/signup': { target: 'http://plex-tier-manager:5000', changeOrigin: true },
    },
  },
})
