import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Corregir iconos por defecto de Leaflet en React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Iconos personalizados (puedes usar SVGs o imágenes reales)
const createCustomIcon = (color) => new L.DivIcon({
  className: 'custom-icon',
  html: `<div style="background-color: ${color}; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
  iconSize: [15, 15],
  iconAnchor: [7, 7]
});

const getStatusColor = (status) => {
  switch (status?.toLowerCase()) {
    case 'disponible': return '#22c55e'; // Green
    case 'llevando pedido': return '#3b82f6'; // Blue
    case 'ocupado': return '#eab308'; // Yellow
    case 'desconectado': return '#9ca3af'; // Gray
    default: return '#6366f1'; // Indigo
  }
};

const DriverMap = ({ drivers }) => {
  // Centro aproximado (ej: Caracas), idealmente dinámico
  const center = [10.245664, -67.598563]; 

  return (
    <div className="h-[500px] w-full rounded-xl overflow-hidden shadow-lg border border-gray-200 z-0">
      <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
        {/* Capa de OpenStreetMap (Gratis) */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {drivers.map((driver) => (
          <Marker 
            key={driver.id} 
            position={[driver.lat, driver.lng]}
            icon={createCustomIcon(getStatusColor(driver.estado))}
          >
            <Popup>
              <div className="p-1">
                <h3 className="font-bold text-gray-800">{driver.nombre || driver.id}</h3>
                <p className="text-sm m-0">Estado: <span style={{color: getStatusColor(driver.estado)}}>{driver.estado}</span></p>
                <p className="text-xs text-gray-500 m-0">Bat: {driver.bateria}%</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default DriverMap;