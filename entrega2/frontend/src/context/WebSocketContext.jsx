import React, { createContext, useEffect, useState, useRef, useContext } from 'react';
import apiClient from '../api/axiosConfig';

export const WebSocketContext = createContext(null);
export const useWebSocket = () => useContext(WebSocketContext);

// Función HELPER para calcular repartidores activos
// Mantenemos el umbral de 10 minutos
const TEN_MINUTES_IN_MS = 10 * 60 * 1000;
const calculateActiveDrivers = (drivers) => {
  const now = new Date();
  if (!Array.isArray(drivers)) return 0;
  return drivers.filter(driver => {
    if (!driver.ultima_actualizacion_loc) return false;
    const lastUpdate = new Date(driver.ultima_actualizacion_loc);
    return (now - lastUpdate) < TEN_MINUTES_IN_MS;
  }).length;
};

export const WebSocketProvider = ({ children }) => {
  const [lastMessage, setLastMessage] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [liveOrders, setLiveOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [alertConfig, setAlertConfig] = useState(null);
  const ws = useRef(null);

  // useEffect para cargar configuración y datos iniciales (sin cambios)
  useEffect(() => {
    apiClient.get('/config/alert_thresholds_minutes')
      .then(res => setAlertConfig(res.data))
      .catch(() => console.error("CONFIGURACIÓN DE ALERTAS NO ENCONTRADA."));
      
    const fetchInitialData = async () => {
      try {
        const [resMetrics, resDrivers, resOrders] = await Promise.all([
          apiClient.get('/dashboard/summary'),
          apiClient.get('/drivers/detailed'),
          apiClient.get('/pedidos?limit=50&estado=pendiente,aceptado,retirando,llevando,con_novedad')
        ]);
        setMetrics(resMetrics.data);
        setDrivers(resDrivers.data);
        setLiveOrders(resOrders.data);
      } catch (e) {
        console.error("No se pudieron cargar los datos iniciales para el contexto.", e);
      }
    };
    fetchInitialData();
  }, []);

  // --- INICIO DE LA CORRECCIÓN CLAVE: TEMPORIZADOR DE RE-CÁLCULO ---
  useEffect(() => {
    // Este intervalo asegura que el contador de activos se actualice
    // y descuente a los repartidores que quedan inactivos por el paso del tiempo.
    const recalculateInterval = setInterval(() => {
        if (drivers.length > 0) {
            setMetrics(prevMetrics => {
                const activeCount = calculateActiveDrivers(drivers);
                // Prevenir re-renderizados innecesarios si el número no ha cambiado
                if (prevMetrics && prevMetrics.drivers_activos === activeCount) {
                    return prevMetrics;
                }
                return { ...prevMetrics, drivers_activos: activeCount };
            });
        }
    }, 15000); // Se ejecuta cada 15 segundos para una buena capacidad de respuesta

    return () => clearInterval(recalculateInterval); // Limpiar al desmontar
  }, [drivers]); // El efecto depende de la lista 'drivers'. Se reinicia si cambia.
  // --- FIN DE LA CORRECCIÓN CLAVE ---


  useEffect(() => {
    function connect() {
      const wsUrl = `/ws/dashboard`;
      const fullWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${wsUrl}`;
      ws.current = new WebSocket(fullWsUrl);

      ws.current.onopen = () => setIsConnected(true);
      ws.current.onclose = () => {
        setIsConnected(false);
        setTimeout(connect, 5000);
      };

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);

          switch (message.type) {
            case 'DRIVER_LOCATION_UPDATE': {
              const updatedDriver = message.data;
              let newDriversList;
              
              setDrivers(prev => {
                const idx = prev.findIndex(d => d.id_usuario === updatedDriver.id_usuario);
                if (idx > -1) {
                  const newDrivers = [...prev];
                  newDrivers[idx] = { ...newDrivers[idx], ultima_latitud: updatedDriver.latitud, ultima_longitud: updatedDriver.longitud, estado_actual: updatedDriver.estado, ultima_bateria_porcentaje: updatedDriver.bateria_porcentaje, ultima_actualizacion_loc: new Date().toISOString() };
                  newDriversList = newDrivers;
                  return newDrivers;
                }
                const newDriverEntry = { id_usuario: updatedDriver.id_usuario, nombre_display: updatedDriver.id_usuario, ultima_latitud: updatedDriver.latitud, ultima_longitud: updatedDriver.longitud, estado_actual: updatedDriver.estado, ultima_bateria_porcentaje: updatedDriver.bateria_porcentaje, ultima_actualizacion_loc: new Date().toISOString() };
                newDriversList = [...prev, newDriverEntry];
                return newDriversList;
              });

              // Esta actualización inmediata es buena para cuando un nuevo repartidor se conecta
              setMetrics(prevMetrics => {
                  if (!newDriversList) return prevMetrics;
                  const activeCount = calculateActiveDrivers(newDriversList);
                  return { ...prevMetrics, drivers_activos: activeCount };
              });
              break;
            }
            case 'NEW_ORDER': {
              setLiveOrders(prev => [message.data, ...prev]);
              setMetrics(prev => ({ ...prev, pedidos_hoy: (prev?.pedidos_hoy || 0) + 1 }));
              break;
            }
            case 'ORDER_STATUS_UPDATE':
            case 'ORDER_ASSIGNED': {
              setLiveOrders(prev => {
                let orderExists = false;
                const updatedList = prev.map(o => {
                  if (o.id === message.id) { orderExists = true; return message.data; }
                  return o;
                });
                return orderExists ? updatedList : [message.data, ...updatedList];
              });
              break;
            }
            case 'NEW_TICKET': {
              setMetrics(prev => ({ ...prev, tickets_abiertos: (prev?.tickets_abiertos || 0) + 1 }));
              break;
            }
            default: break;
          }
        } catch (e) {
          console.error("Error parseando mensaje WS", e);
        }
      };

      ws.current.onerror = (err) => console.error('❌ Error de WebSocket.', err);
    }
    connect();
    return () => {
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, []);

  const value = { lastMessage, isConnected, liveOrders, drivers, metrics, alertConfig };

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
};