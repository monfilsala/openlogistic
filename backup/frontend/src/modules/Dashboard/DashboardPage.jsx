import React, { useEffect, useState, useContext } from 'react';
import apiClient from '../../api/axiosConfig';
import { WebSocketContext } from '../../context/WebSocketContext';
import StatsCards from './components/StatsCards';
import LiveMapPage from '../Map/LiveMapPage';
import OrderList from '../Orders/OrderList';
import { Wifi, WifiOff, Loader, AlertCircle } from 'lucide-react';

const calculateActiveDrivers = (drivers) => {
  const now = new Date();
  const TEN_MINUTES_IN_MS = 10 * 60 * 1000;
  if (!Array.isArray(drivers)) return 0;
  return drivers.filter(driver => {
    if (!driver.ultima_actualizacion_loc) return false;
    const lastUpdate = new Date(driver.ultima_actualizacion_loc);
    return (now - lastUpdate) < TEN_MINUTES_IN_MS;
  }).length;
};

const DashboardPage = () => {
  const { lastMessage, isConnected } = useContext(WebSocketContext);
  
  const [dashboardState, setDashboardState] = useState({
    metrics: null,
    drivers: [],
    liveOrders: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const fetchMetrics = () => {
      apiClient.get('/dashboard/summary')
        .then(res => {
          setDashboardState(prevState => ({
            ...prevState,
            metrics: { ...prevState.metrics, ...res.data }
          }));
        })
        .catch(err => console.error("Error actualizando métricas:", err));
    };

    const fetchInitialData = async () => {
      try {
        const [resMetrics, resDrivers, resOrders] = await Promise.all([
          apiClient.get('/dashboard/summary'),
          apiClient.get('/drivers/detailed'),
          apiClient.get('/pedidos?limit=30&estado=pendiente,aceptado,retirando,llevando,con_novedad')
        ]);
        setDashboardState({
          metrics: resMetrics.data,
          drivers: resDrivers.data,
          liveOrders: resOrders.data,
          loading: false,
          error: null,
        });
      } catch (e) {
        setDashboardState(prevState => ({
            ...prevState,
            error: "No se pudieron cargar los datos del dashboard.",
            loading: false,
        }));
        console.error("Error en fetchInitialData:", e);
      }
    };

    fetchInitialData();
    const intervalId = setInterval(fetchMetrics, 30000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'DRIVER_LOCATION_UPDATE': {
        const updatedDriver = lastMessage.data;
        setDashboardState(prevState => {
            const idx = prevState.drivers.findIndex(d => d.id_usuario === updatedDriver.id_usuario);
            let newDriversList;
            if (idx > -1) {
                const newDrivers = [...prevState.drivers];
                newDrivers[idx] = { ...newDrivers[idx], ultima_latitud: updatedDriver.latitud, ultima_longitud: updatedDriver.longitud, estado_actual: updatedDriver.estado, ultima_bateria_porcentaje: updatedDriver.bateria_porcentaje, ultima_actualizacion_loc: new Date().toISOString() };
                newDriversList = newDrivers;
            } else {
                const newDriverEntry = { id_usuario: updatedDriver.id_usuario, nombre_display: updatedDriver.id_usuario, ultima_latitud: updatedDriver.latitud, ultima_longitud: updatedDriver.longitud, estado_actual: updatedDriver.estado, ultima_bateria_porcentaje: updatedDriver.bateria_porcentaje, ultima_actualizacion_loc: new Date().toISOString() };
                newDriversList = [...prevState.drivers, newDriverEntry];
            }
            const activeCount = calculateActiveDrivers(newDriversList);
            return {
                ...prevState,
                drivers: newDriversList,
                metrics: { ...prevState.metrics, drivers_activos: activeCount }
            };
        });
        break;
      }
      case 'NEW_ORDER': {
        setDashboardState(prevState => ({
            ...prevState,
            liveOrders: [lastMessage.data, ...prevState.liveOrders],
            metrics: { ...prevState.metrics, pedidos_hoy: (prevState.metrics?.pedidos_hoy || 0) + 1 }
        }));
        break;
      }
      case 'ORDER_STATUS_UPDATE':
      case 'ORDER_ASSIGNED': {
        setDashboardState(prevState => {
            let orderExists = false;
            let newMetrics = { ...prevState.metrics };
            const updatedList = prevState.liveOrders.map(o => {
                if (o.id === lastMessage.id) {
                    orderExists = true;
                    const wasEntregado = o.estado === 'entregado';
                    const isEntregado = lastMessage.data?.estado === 'entregado';
                    if (!wasEntregado && isEntregado) newMetrics.pedidos_completados_hoy = (newMetrics.pedidos_completados_hoy || 0) + 1;
                    else if (wasEntregado && !isEntregado) newMetrics.pedidos_completados_hoy = Math.max(0, (newMetrics.pedidos_completados_hoy || 0) - 1);
                    return lastMessage.data;
                }
                return o;
            });
            return {
                ...prevState,
                liveOrders: orderExists ? updatedList : [lastMessage.data, ...updatedList],
                metrics: newMetrics,
            };
        });
        break;
      }
      default: break;
    }
  }, [lastMessage]);
  
  const { metrics, drivers, liveOrders, loading, error } = dashboardState;

  if (loading) return <div className="flex items-center justify-center h-full"><Loader className="w-12 h-12 animate-spin text-slate-500" /></div>;
  if (error) return <div className="p-6 bg-red-50 text-red-700 rounded-lg flex items-center gap-4"><AlertCircle className="w-6 h-6"/><div><p className="font-bold">Error de Conexión</p><p>{error}</p></div></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Panel de Control</h1>
          <p className="text-sm text-slate-500">Visión general de operaciones en tiempo real</p>
        </div>

      </div>
      
      {metrics && <StatsCards metrics={metrics} />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-[calc(100vh-280px)]">
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200"><h2 className="font-semibold text-slate-700">Mapa de Flota</h2></div>
          <div className="flex-1 relative min-h-0"><LiveMapPage drivers={drivers} /></div>
        </div>
        <div className="xl:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200"><h2 className="font-semibold text-slate-700">Pedidos Activos</h2></div>
          
          {/* --- INICIO DE LA CORRECCIÓN CLAVE --- */}
          {/* Añadimos 'min-h-0' para evitar que este contenedor flex crezca con su contenido */}
          <div className="flex-1 relative min-h-0">
             <OrderList orders={liveOrders} activeDrivers={drivers} compact={true} />
          </div>
          {/* --- FIN DE LA CORRECCIÓN CLAVE --- */}

        </div>
      </div>
    </div>
  );
};

export default DashboardPage;