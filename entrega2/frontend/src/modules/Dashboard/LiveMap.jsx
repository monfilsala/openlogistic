import React, { useContext, useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { WebSocketContext } from '../../context/WebSocketContext';
import 'leaflet/dist/leaflet.css';

const LiveMap = () => {
  const { lastMessage } = useContext(WebSocketContext);
  const [drivers, setDrivers] = useState({});

  useEffect(() => {
    if (lastMessage && lastMessage.type === 'DRIVER_LOCATION_UPDATE') {
      const { id_usuario, latitud, longitud } = lastMessage.data;
      setDrivers(prev => ({
        ...prev,
        [id_usuario]: { lat: latitud, lng: longitud, id: id_usuario }
      }));
    }
  }, [lastMessage]);

  return (
    <div className="h-[500px] w-full border rounded-lg overflow-hidden shadow-lg">
      <MapContainer center={[10.246128, -67.598838]} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        {Object.values(drivers).map(driver => (
          <Marker key={driver.id} position={[driver.lat, driver.lng]}>
            <Popup>Repartidor: {driver.id}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default LiveMap;