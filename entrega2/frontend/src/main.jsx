import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// --- INICIO DE LA CORRECCIÓN ---
// 1. Importar el AuthProvider
import { AuthProvider } from './context/AuthContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* 2. Envolver TODA la aplicación con el AuthProvider */}
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
// --- FIN DE LA CORRECCIÓN ---