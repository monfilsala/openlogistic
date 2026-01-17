// entrega2/frontend/src/modules/Map/components/MemoizedDriverMarker.jsx

import React, { useMemo } from 'react'; // Importamos useMemo
import { Marker, Tooltip, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Battery, Zap, Store, Clock } from 'lucide-react';

// --- HELPER 1: Lógica de Estilos (más legible) ---
const getDriverStatusStyle = (status) => {
  const lowerCaseStatus = status?.toLowerCase() || 'desconocido';
  let color = '#6b7280'; // Gris (slate-500) por defecto
  let pulse = false;

  if (lowerCaseStatus.includes('disponible')) { color = '#22c55e'; pulse = true; } // Verde (green-500)
  else if (lowerCaseStatus.includes('aceptado')) { color = '#3b82f6'; } // Azul (blue-500)
  else if (lowerCaseStatus.includes('retirando')) { color = '#eab308'; } // Amarillo (amber-500)
  else if (lowerCaseStatus.includes('llevando')) { color = '#f97316'; } // Naranja (orange-500)
  else if (lowerCaseStatus.includes('novedad')) { color = '#a855f7'; } // Púrpura (purple-500)

  return { color, pulse };
};

// --- HELPER 2: Lógica de Iniciales (más legible) ---
const getShortId = (driver) => {
  if (driver.nombre_display) {
    const parts = driver.nombre_display.trim().split(' ');
    if (parts.length > 1) {
      return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    }
    return (parts[0] || '').substring(0, 2).toUpperCase();
  }
  if (driver.id_usuario?.includes('_')) {
    return (driver.id_usuario.split('_')[1] || '??').toUpperCase();
  }
  if (driver.id_usuario) {
    return driver.id_usuario.substring(0, 3).toUpperCase();
  }
  return '??';
};


const DriverMarker = ({ driver }) => {
  // No renderizar si no hay coordenadas
  if (!driver.ultima_latitud || !driver.ultima_longitud) {
    return null;
  }

  // --- OPTIMIZACIÓN CLAVE CON useMemo ---
  // El ícono solo se recalculará si el estado o el nombre del conductor cambian.
  // No se recalculará por cada cambio de latitud/longitud.
  const icon = useMemo(() => {
    const { color, pulse } = getDriverStatusStyle(driver.estado_actual);
    const shortId = getShortId(driver);
    
    return new L.DivIcon({
      className: 'custom-driver-icon',
      html: `<div style="background-color:${color};width:32px;height:32px;border-radius:50%;border:3px solid white;box-shadow:0 4px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;${pulse ? 'animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;' : ''}">${shortId}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }, [driver.estado_actual, driver.nombre_display, driver.id_usuario]);


  return (
    <Marker
      position={[driver.ultima_latitud, driver.ultima_longitud]}
      icon={icon}
    >
      {/* MEJORA UX: El Tooltip ahora aparece al pasar el mouse, no es permanente. Esto evita saturar el mapa. */}
      <Tooltip direction="bottom" offset={[0, 0]} className="driver-label-tooltip">
        {driver.nombre_display || driver.id_usuario}
      </Tooltip>
      <Popup className="custom-popup">
        <div className="p-1 min-w-[220px]">
          <h3 className="font-bold text-slate-800 text-sm mb-2 pb-2 border-b">{driver.nombre_display}</h3>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
                <Zap size={14} className="text-slate-400"/>
                <span>Estado: <b className="text-slate-800">{driver.estado_actual || 'N/A'}</b></span>
            </div>
            <div className="flex items-center gap-2">
                <Battery size={14} className="text-slate-400"/>
                <span>Batería: <b className="text-slate-800">{driver.ultima_bateria_porcentaje}%</b></span>
            </div>
            <div className="flex items-center gap-2">
                <Clock size={14} className="text-slate-400"/>
                <span>Última señal: <b className="text-slate-800">{new Date(driver.ultima_actualizacion_loc).toLocaleTimeString()}</b></span>
            </div>
            {driver.ultimo_pedido && (
              <div className="bg-slate-50 p-2 rounded border mt-2">
                <p className="font-bold flex items-center gap-1 text-slate-700"><Store size={14}/> Última Entrega:</p>
                <p>#{driver.ultimo_pedido.id} - {driver.ultimo_pedido.comercio}</p>
              </div>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
};

// React.memo sigue siendo importante. Evita la re-renderización si las props no cambian en absoluto.
// Funciona en conjunto con useMemo:
// 1. React.memo: ¿Cambió el objeto 'driver'? Si no, no hagas nada.
// 2. Si sí cambió -> Renderiza -> useMemo: ¿Cambiaron 'estado' o 'nombre'? Si no, usa el ícono viejo.
const MemoizedDriverMarker = React.memo(DriverMarker);

export default MemoizedDriverMarker;