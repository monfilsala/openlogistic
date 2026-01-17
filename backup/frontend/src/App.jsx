import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';

// Importar todos los componentes
import MainLayout from './layouts/MainLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './modules/Dashboard/DashboardPage';
import AllOrdersPage from './modules/Orders/AllOrdersPage';
import HistoryPage from './modules/Orders/HistoryPage';
import ScheduledOrdersPage from './modules/Orders/ScheduledOrdersPage';
import DriversPage from './modules/Drivers/DriversPage';
import LiveMapPage from './modules/Map/LiveMapPage';
import SupportPage from './modules/Support/SupportPage';
import ReportsPage from './modules/Reports/ReportsPage';
import SettingsPage from './modules/Settings/SettingsPage';
import LogsPage from './modules/System/LogsPage';
import MerchantsPage from './modules/Merchants/MerchantsPage';
import AccessPage from './modules/Access/AccessPage';

// Componente para proteger las rutas del dashboard
const ProtectedLayout = () => {
    const { currentUser } = useAuth();
    if (!currentUser) {
        return <Navigate to="/login" replace />;
    }
    // Si hay usuario, renderiza el WebSocketProvider y el Layout principal
    return (
        <WebSocketProvider>
            <MainLayout />
        </WebSocketProvider>
    );
};

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    {/* Ruta pública */}
                    <Route path="/login" element={<LoginPage />} />

                    {/* Grupo de rutas protegidas */}
                    <Route element={<ProtectedLayout />}>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/pedidos" element={<AllOrdersPage />} />
                        <Route path="/pedidos/historial" element={<HistoryPage />} />
                        <Route path="/pedidos/programados" element={<ScheduledOrdersPage />} />
                        <Route path="/conductores" element={<DriversPage />} />
                        <Route path="/mapa" element={<LiveMapPage />} />
                        <Route path="/soporte" element={<SupportPage />} />
                        <Route path="/reportes" element={<ReportsPage />} />
                        <Route path="/configuracion" element={<SettingsPage />} />
                        <Route path="/logs" element={<LogsPage />} />
                        <Route path="/comercios" element={<MerchantsPage />} />
                        <Route path="/access" element={<AccessPage />} />
                        {/* Ruta 404 para cualquier otra cosa dentro del dashboard */}
                        <Route path="*" element={<h1>404 - Dashboard Page Not Found</h1>} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;