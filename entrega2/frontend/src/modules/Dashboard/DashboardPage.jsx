import React, { useContext } from 'react';
import { WebSocketContext } from '../../context/WebSocketContext';
import StatsCards from './components/StatsCards';
import LiveMapPage from '../Map/LiveMapPage';
import OrderList from '../Orders/OrderList';
import { Wifi, WifiOff, Loader, AlertCircle } from 'lucide-react';

const DashboardPage = () => {
  // --- CORRECCIÓN CLAVE: Consumir el estado GLOBAL del contexto ---
  // No hay estados locales para los datos en tiempo real.
  const { isConnected, metrics, drivers, liveOrders } = useContext(WebSocketContext);

  // El componente se vuelve "tonto": solo muestra los datos que recibe del contexto.
  // Muestra un estado de carga si los datos iniciales del contexto aún no han llegado.
  if (!metrics || !drivers || !liveOrders) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader className="w-12 h-12 animate-spin text-slate-500" />
        <p className="ml-4 text-slate-500">Sincronizando datos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow-sm border">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Panel de Control</h1>
          <p className="text-sm text-slate-500">Visión general de operaciones en tiempo real</p>
        </div>
      </div>
      
      {/* StatsCards recibe las métricas globales y se actualiza correctamente */}
      <StatsCards metrics={metrics} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-[calc(100vh-280px)]">
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-0">
          <div className="p-4 border-b border-slate-200"><h2 className="font-semibold text-slate-700">Mapa de Flota</h2></div>
          <div className="flex-1 relative min-h-0">
            {/* LiveMapPage recibe los repartidores globales */}
            <LiveMapPage drivers={drivers}/>
          </div>
        </div>
        <div className="xl:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-0">
          <div className="p-4 border-b border-slate-200"><h2 className="font-semibold text-slate-700">Pedidos Activos</h2></div>
          <div className="flex-1 relative min-h-0">
             {/* OrderList recibe los pedidos globales y se actualizará en tiempo real */}
             <OrderList orders={liveOrders} activeDrivers={drivers} compact={true} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;