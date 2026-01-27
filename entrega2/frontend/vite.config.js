import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// URL pública de tu Codespace para el puerto 3000
const CODESPACE_URL = 'fuzzy-dollop-vr9pwqx9rw4cx66-3000.app.github.dev';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Configuración del servidor de desarrollo
  server: {
    // Configuración para el Hot Module Replacement (HMR) en Codespaces
    hmr: {
      protocol: 'wss', // Usar WebSocket Seguro
      host: CODESPACE_URL,
      clientPort: 443 // El puerto estándar para HTTPS
    },
    
    // Configuración general del servidor
    host: true, // Escuchar en 0.0.0.0, crucial para Docker
    port: 3000, // Forzar el puerto 3000
    strictPort: true, // Fallar si el puerto 3000 ya está en uso

    // Configuración del proxy para redirigir las llamadas al backend
    proxy: {
      // Redirige peticiones como /api/pedidos a http://backend:8000/pedidos
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Redirige las conexiones WebSocket
      '/ws': {
        target: 'ws://backend:8000',
        ws: true,
      },
      // Redirige las peticiones de archivos estáticos (imágenes de tickets)
      '/uploads': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
});