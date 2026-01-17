import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Cargar variables de entorno del sistema (como las de Codespaces)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0', // Esencial para que el servidor sea accesible desde fuera del contenedor
      port: 3000,
      strictPort: true,
      
      // --- CONFIGURACIÓN HMR ESPECÍFICA Y RECOMENDADA PARA CODESPACES ---
      hmr: {
        // El cliente del navegador (tu PC) se conectará a través del proxy HTTPS de Codespaces
        protocol: 'wss',
        // Codespaces provee esta variable de entorno con el host público correcto
        // Si no estás en Codespaces, esto será undefined y Vite usará un fallback
        host: env.CODESPACE_NAME ? `${env.CODESPACE_NAME}-3000.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : 'localhost',
        clientPort: 443
      },
      // --- FIN DE LA CONFIGURACIÓN HMR ---

      proxy: {
        // Proxy para peticiones a tu API (ej: /api/pedidos -> http://backend:8000/pedidos)
        '/api': {
          target: 'http://backend:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          secure: false,
        },
        // Proxy para la conexión WebSocket de tu aplicación (ej: /ws/dashboard -> ws://backend:8000/ws/dashboard)
        '/ws': {
          target: 'ws://backend:8000',
          ws: true,
          changeOrigin: true,
          secure: false,
        }
      }
    }
  }
});