// entrega2/frontend/src/modules/Map/LiveMapPage.jsx

import React, { useEffect, useState, useContext, useMemo } from 'react';
import apiClient from '../../api/axiosConfig';
import L from 'leaflet';
import { MapContainer, TileLayer } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.Default.css';
import { WebSocketContext } from '../../context/WebSocketContext';
import { Menu, X, Users, Battery, Clock } from 'lucide-react';
import MemoizedDriverMarker from './components/MemoizedDriverMarker';
import MapSkeleton from './components/MapSkeleton'; // Un skeleton para la carga inicial

const createClusterIcon = (cluster) => {
  return new L.DivIcon({
    html: `<div class="flex items-center justify-center w-10 h-10 bg-slate-800 text-white rounded-full font-bold border-4 border-slate-500/50 shadow-lg">${cluster.getChildCount()}</div>`,
    className: 'custom-cluster-icon',
    iconSize: [40, 40]
  });
};

const DriverMarkersLayer = ({ drivers }) => {
  if (drivers.length === 0) return null;
  return (
    <MarkerClusterGroup
      chunkedLoading
      iconCreateFunction={createClusterIcon}
      maxClusterRadius={80}
      spiderfyOnMaxZoom={true}
      disableClusteringAtZoom={16}
    >
      {drivers.map(driver => (
        <MemoizedDriverMarker key={driver.id_usuario} driver={driver} />
      ))}
    </MarkerClusterGroup>
  );
};

const LiveMapPage = () => {
  const { lastMessage } = useContext(WebSocketContext);
  const [drivers, setDrivers] = useState([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [loading, setLoading] = useState(true);

  // --- INICIO DE LA LÓGICA DE TIEMPO REAL ---
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    // Este temporizador fuerza al componente a re-evaluar el estado de los conductores
    const intervalId = setInterval(() => setNow(new Date()), 15000); // Cada 15 segundos
    return () => clearInterval(intervalId);
  }, []);
  // --- FIN DE LA LÓGICA DE TIEMPO REAL ---

  useEffect(() => {
    apiClient.get('/drivers/detailed')
      .then(res => setDrivers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'DRIVER_LOCATION_UPDATE') return;
    
    const updatedDriverData = lastMessage.data;
    
    setDrivers(prevDrivers => {
      const driverIndex = prevDrivers.findIndex(d => d.id_usuario === updatedDriverData.id_usuario);
      if (driverIndex > -1) {
        const newDrivers = [...prevDrivers];
        newDrivers[driverIndex] = { ...newDrivers[driverIndex], ultima_latitud: updatedDriverData.latitud, ultima_longitud: updatedDriverData.longitud, estado_actual: updatedDriverData.estado, ultima_bateria_porcentaje: updatedDriverData.bateria_porcentaje, ultima_actualizacion_loc: new Date().toISOString() };
        return newDrivers;
      } else {
        return [...prevDrivers, { id_usuario: updatedDriverData.id_usuario, nombre_display: updatedDriverData.id_usuario, ultima_latitud: updatedDriverData.latitud, ultima_longitud: updatedDriverData.longitud, estado_actual: updatedDriverData.estado, ultima_bateria_porcentaje: updatedDriverData.bateria_porcentaje, ultima_actualizacion_loc: new Date().toISOString() }];
      }
    });
  }, [lastMessage]);

  // Usamos useMemo para filtrar los conductores que se mostrarán.
  // Se recalcula solo si la lista de 'drivers' cambia o si 'now' se actualiza.
  const activeDrivers = useMemo(() => {
    return drivers.filter(d => {
      if (!d.ultima_latitud || !d.ultima_longitud || !d.ultima_actualizacion_loc) {
        return false;
      }
      // La condición clave: la última actualización debe ser de hace menos de 10 minutos.
      const minutesDiff = (now - new Date(d.ultima_actualizacion_loc)) / 60000;
      return minutesDiff < 10;
    });
  }, [drivers, now]);

  if (loading) {
    return <MapSkeleton />;
  }

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden">
      <button 
        onClick={() => setShowSidebar(!showSidebar)}
        className="absolute top-4 right-4 z-[1001] bg-white p-2 rounded-lg shadow-md hover:bg-slate-100 text-slate-700 transition-colors"
        title="Mostrar/Ocultar Lista"
      >
        {showSidebar ? <X size={20}/> : <Menu size={20}/>}
      </button>

      <MapContainer 
        center={[10.4806, -66.9036]}
        zoom={12} 
        style={{ height: '100%', width: '100%', zIndex: 1 }}
        key="live-map-page"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <DriverMarkersLayer drivers={activeDrivers} />
      </MapContainer>

      {showSidebar && (
        <div className="absolute top-0 right-0 h-full w-80 bg-white/95 backdrop-blur-sm shadow-2xl z-[1000] border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
          <div className="p-4 border-b bg-white">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Users size={18} className="text-blue-600"/> En Línea ({activeDrivers.length})
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {activeDrivers.sort((a, b) => new Date(b.ultima_actualizacion_loc) - new Date(a.ultima_actualizacion_loc)).map(driver => {
                const minutesAgo = Math.floor((now - new Date(driver.ultima_actualizacion_loc)) / 60000);
                return (
                    <div key={driver.id_usuario} className="p-3 bg-white rounded-lg border border-slate-100 shadow-sm hover:border-blue-300 transition-colors cursor-pointer group">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-sm text-slate-700 truncate">{driver.nombre_display || driver.id_usuario}</span>
                            <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={12}/> {minutesAgo < 1 ? 'Ahora' : `hace ${minutesAgo}m`}</span>
                        </div>
                        <div className="flex justify-between mt-2 text-xs text-slate-500">
                            <span className="font-medium">{driver.estado_actual}</span>
                            <span className={`font-bold flex items-center gap-1 ${driver.ultima_bateria_porcentaje < 20 ? "text-red-500" : "text-slate-400"}`}>
                                <Battery size={12}/> {driver.ultima_bateria_porcentaje}%
                            </span>
                        </div>
                    </div>
                );
            })}
             {activeDrivers.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-400">
                    No hay conductores activos.
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveMapPage;