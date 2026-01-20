import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
import apiClient from '../../api/axiosConfig';
import ZoneModal from './components/ZoneModal';
import { Map, AlertOctagon } from 'lucide-react';

// --- INICIO DE LA CORRECCIÓN CLAVE ---
// Importar los estilos necesarios
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

// Importar las imágenes de los marcadores usando la sintaxis de Módulos ES (import)
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';

// Arreglar las rutas de los íconos por defecto de Leaflet de una manera compatible con Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconUrl: icon,
    iconRetinaUrl: iconRetina,
    shadowUrl: iconShadow,
});
// --- FIN DE LA CORRECCIÓN CLAVE ---


const ZonesPage = () => {
    const [zones, setZones] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentZone, setCurrentZone] = useState(null);
    const featureGroupRef = useRef();

    const fetchZones = () => {
        apiClient.get('/zones').then(res => {
            setZones(res.data);
        }).catch(err => console.error("Error al cargar zonas:", err));
    };

    useEffect(() => {
        fetchZones();
    }, []);

    const handleCreated = (e) => {
        const { layer } = e;
        const coords = layer.getLatLngs()[0].map(latlng => [latlng.lng, latlng.lat]);
        setCurrentZone({ polygon_coords: coords });
        setIsModalOpen(true);
    };

    const handleEdited = (e) => {
        e.layers.eachLayer(layer => {
            const newCoords = layer.getLatLngs()[0].map(latlng => [latlng.lng, latlng.lat]);
            const zoneId = layer.db_id;
            const originalZone = zones.find(z => z.id === zoneId);
            if (originalZone) {
                setCurrentZone({ ...originalZone, polygon_coords: newCoords });
                setIsModalOpen(true);
            }
        });
    };

    const handleDeleted = (e) => {
        if (!window.confirm("¿Estás seguro de que quieres eliminar las zonas seleccionadas?")) return;
        
        const promises = [];
        e.layers.eachLayer(layer => {
            const zoneId = layer.db_id;
            if (zoneId) {
                promises.push(apiClient.delete(`/zones/${zoneId}`));
            }
        });
        Promise.all(promises).then(() => {
            fetchZones();
            alert("Zonas eliminadas.");
        }).catch(err => alert("Error al eliminar: " + (err.response?.data?.detail || err.message)));
    };

    const handleSaveZone = async (zoneData) => {
        try {
            if (zoneData.id) {
                await apiClient.put(`/zones/${zoneData.id}`, zoneData);
            } else {
                await apiClient.post('/zones', zoneData);
            }
            setIsModalOpen(false);
            setCurrentZone(null);
            fetchZones();
            alert("Zona guardada exitosamente.");
        } catch (error) {
            alert("Error al guardar la zona: " + (error.response?.data?.detail || error.message));
        }
    };
    
    // Asigna el ID de la base de datos a la capa del mapa después de cargar los datos
    useEffect(() => {
        if (featureGroupRef.current) {
            const map = featureGroupRef.current._map;
            if (map) {
                featureGroupRef.current.clearLayers(); // Limpiar capas viejas
                zones.forEach(zone => {
                    const leafletCoords = zone.polygon_coords.map(p => [p[1], p[0]]);
                    const polygon = new L.Polygon(leafletCoords, { color: zone.is_active ? '#e53e3e' : '#a0aec0', weight: 2 });
                    polygon.db_id = zone.id; // Asignar el ID de la BD
                    featureGroupRef.current.addLayer(polygon);
                });
            }
        }
    }, [zones]);

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className='p-4 rounded-xl shadow-sm border bg-white'>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Gestión de Zonas Restringidas</h1>
                <p className="text-sm text-slate-500">Dibuja polígonos en el mapa para definir áreas donde no se permitirán entregas.</p>
            </div>
            
            <div className="flex-1 rounded-xl overflow-hidden border shadow-sm">
                <MapContainer center={[10.246128, -67.598838]} zoom={12} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors'/>
                    
                    <FeatureGroup ref={featureGroupRef}>
                        <EditControl
                            position="topright"
                            onCreated={handleCreated}
                            onEdited={handleEdited}
                            onDeleted={handleDeleted}
                            draw={{
                                rectangle: true,
                                polygon: true,
                                circle: false,
                                circlemarker: false,
                                marker: false,
                                polyline: false,
                            }}
                        />
                    </FeatureGroup>
                </MapContainer>
            </div>

            <ZoneModal 
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setCurrentZone(null); fetchZones(); }}
                onSave={handleSaveZone}
                zoneData={currentZone}
            />
        </div>
    );
};

export default ZonesPage;