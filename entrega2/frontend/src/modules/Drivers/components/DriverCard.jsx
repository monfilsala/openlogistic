import React from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { Battery, Clock, Store, User, Zap, ZapOff } from 'lucide-react';
import L from 'leaflet';

// Icono pequeño para el mini mapa
const smallIcon = new L.DivIcon({
  className: 'custom-icon',
  html: `<div style="background-color: #3b82f6; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5]
});

const DriverCard = ({ driver, onClick }) => {
  const lastUpdate = driver.ultima_actualizacion_loc ? new Date(driver.ultima_actualizacion_loc) : null;
  const minutesSinceUpdate = lastUpdate ? (new Date() - lastUpdate) / (1000 * 60) : Infinity;
  const isActive = minutesSinceUpdate < 10;

  const batteryLevel = driver.ultima_bateria_porcentaje || 0;
  
  let batColor = 'text-green-500';
  if (batteryLevel < 50) batColor = 'text-yellow-500';
  if (batteryLevel < 20) batColor = 'text-red-500';

  return (
    <button 
      onClick={onClick} 
      className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-lg hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all flex flex-col h-full text-left"
    >
      
      <div className="p-4 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm ${isActive ? 'bg-blue-600' : 'bg-slate-400'}`}>
            {driver.nombre_display ? driver.nombre_display.substring(0, 2).toUpperCase() : <User size={18}/>}
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-sm">{driver.nombre_display || driver.id_usuario}</h3>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {isActive ? <Zap size={12} className="text-green-500"/> : <ZapOff size={12} className="text-slate-400"/>}
              <span className={isActive ? 'text-green-600' : 'text-slate-500'}>{isActive ? 'Activo' : 'Inactivo'}</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-end">
          <div className={`flex items-center gap-1 text-xs font-bold ${batColor}`}>
            {batteryLevel}% <Battery size={14} className={batteryLevel < 20 ? 'animate-pulse' : ''}/>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
            <Clock size={10}/> 
            {lastUpdate ? lastUpdate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'N/A'}
          </div>
        </div>
      </div>

      <div className="h-32 w-full bg-slate-100 relative z-0">
        {driver.ultima_latitud ? (
          <MapContainer 
            center={[driver.ultima_latitud, driver.ultima_longitud]} 
            zoom={13} 
            zoomControl={false} 
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[driver.ultima_latitud, driver.ultima_longitud]} icon={smallIcon} />
          </MapContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            Sin ubicación
          </div>
        )}
        <div className="absolute bottom-1 right-1 bg-white/80 backdrop-blur px-2 py-0.5 rounded text-[10px] text-slate-600 font-mono z-[400]">
          {driver.ultima_latitud?.toFixed(4)}, {driver.ultima_longitud?.toFixed(4)}
        </div>
      </div>

      <div className="p-4 bg-white flex-1">
        <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Última Entrega</h4>
        {driver.ultimo_pedido ? (
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <div className="flex justify-between items-start mb-1">
              <span className="font-bold text-blue-800 text-xs">#{driver.ultimo_pedido.id}</span>
              <span className="text-[10px] text-blue-600">{new Date(driver.ultimo_pedido.fecha).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-blue-700 mb-1">
              <Store size={12}/> {driver.ultimo_pedido.comercio}
            </div>
            <div className="text-right text-xs font-bold text-blue-900">
              ${driver.ultimo_pedido.monto?.toFixed(2)}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-2 text-center border border-dashed border-slate-200 rounded">
            Sin historial reciente
          </div>
        )}
      </div>
    </button>
  );
};

export default DriverCard;