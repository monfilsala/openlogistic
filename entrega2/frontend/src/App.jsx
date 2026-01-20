import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';

// Importa todos tus componentes de página
import LoginPage from './pages/LoginPage';
import MainLayout from './layouts/MainLayout';
import DashboardPage from './modules/Dashboard/DashboardPage';
import AllOrdersPage from './modules/Orders/AllOrdersPage';
import ScheduledOrdersPage from './modules/Orders/ScheduledOrdersPage';
import HistoryPage from './modules/Orders/HistoryPage';
import DriversPage from './modules/Drivers/DriversPage';
import MerchantsPage from './modules/Merchants/MerchantsPage';
import LiveMapPage from './modules/Map/LiveMapPage';
import SupportPage from './modules/Support/SupportPage';
import ReportsPage from './modules/Reports/ReportsPage';
import AnalyticsPage from './modules/Analytics/AnalyticsPage';
import AccessPage from './modules/Access/AccessPage';
import IntegrationsPage from './modules/Integrations/IntegrationsPage';
import SettingsPage from './modules/Settings/SettingsPage';
import LogsPage from './modules/System/LogsPage';
import ZonesPage from './modules/Zones/ZonesPage';

const ProtectedRoute = ({ requiredPermission }) => {
    const { currentUser, hasPermission, loading } = useAuth();
    if (loading) return <div>Cargando...</div>;
    if (!currentUser) return <Navigate to="/login" replace />;
    if (requiredPermission && !hasPermission(requiredPermission)) return <Navigate to="/" replace />;
    return <Outlet />;
};

const ProtectedLayout = () => (
    <WebSocketProvider>
        <MainLayout />
    </WebSocketProvider>
);

function App() {
  // --- INICIO DE LA CORRECCIÓN ---
  // Se elimina el <AuthProvider> de aquí, ya que ahora está en main.jsx
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route element={<ProtectedRoute requiredPermission="dashboard:view" />}>
            <Route path="/" element={<DashboardPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="orders:view" />}>
            <Route path="/pedidos" element={<AllOrdersPage />} />
            <Route path="/pedidos/programados" element={<ScheduledOrdersPage />} />
            <Route path="/pedidos/historial" element={<HistoryPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="drivers:view" />}>
            <Route path="/conductores" element={<DriversPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="merchants:view" />}>
            <Route path="/comercios" element={<MerchantsPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="map:view" />}>
            <Route path="/mapa" element={<LiveMapPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="support:view" />}>
            <Route path="/soporte" element={<SupportPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="reports:view" />}>
            <Route path="/reportes" element={<ReportsPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="analytics:view" />}>
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="access:view" />}>
            <Route path="/access" element={<AccessPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="integrations:view" />}>
            <Route path="/integrations" element={<IntegrationsPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="zones:view" />}>
            <Route path="/zonas" element={<ZonesPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredPermission="settings:view" />}>
            <Route path="/configuracion" element={<SettingsPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
  // --- FIN DE LA CORRECCIÓN ---
}

export default App;