import React, { useEffect, useState, useContext } from 'react';
import apiClient from '../../api/axiosConfig';
import DriverCard from './components/DriverCard';
import { Users, RefreshCw, Plus } from 'lucide-react';
import { WebSocketContext } from '../../context/WebSocketContext';
import DriverAdminModal from './components/DriverAdminModal';

const DriversPage = () => {
  const { lastMessage } = useContext(WebSocketContext);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupedDrivers, setGroupedDrivers] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setDrivers(prevDrivers => [...prevDrivers]);
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  
  const groupDrivers = (dataList) => {
    const groups = { 'Activos Hoy': [], 'Inactivos Hoy': [], 'Ayer': [], 'Anteriores': [] };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sortedData = [...dataList].sort((a, b) => new Date(b.ultima_actualizacion_loc || 0) - new Date(a.ultima_actualizacion_loc || 0));

    sortedData.forEach(d => {
      if (!d.ultima_actualizacion_loc) {
        groups['Anteriores'].push(d);
        return;
      }
      const updateDate = new Date(d.ultima_actualizacion_loc);
      const updateDay = new Date(updateDate.getFullYear(), updateDate.getMonth(), updateDate.getDate());
      const minutesSinceUpdate = (now - updateDate) / (1000 * 60);

      if (updateDay.getTime() === today.getTime()) {
        if (minutesSinceUpdate < 10) {
          groups['Activos Hoy'].push(d);
        } else {
          groups['Inactivos Hoy'].push(d);
        }
      } else if (updateDay.getTime() === yesterday.getTime()) {
        groups['Ayer'].push(d);
      } else {
        groups['Anteriores'].push(d);
      }
    });
    setGroupedDrivers(groups);
  };

  const fetchDrivers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/drivers/detailed');
      setDrivers(res.data);
      groupDrivers(res.data);
    } catch (e) { console.error(e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDrivers(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'DRIVER_LOCATION_UPDATE') {
      const u = lastMessage.data;
      
      setDrivers(prevDrivers => {
        const index = prevDrivers.findIndex(d => d.id_usuario === u.id_usuario);
        let newDrivers;
        const driverData = {
            ultima_latitud: u.latitud,
            ultima_longitud: u.longitud,
            estado_actual: u.estado,
            ultima_bateria_porcentaje: u.bateria_porcentaje,
            ultima_actualizacion_loc: u.timestamp
        };

        if (index > -1) {
          newDrivers = [...prevDrivers];
          newDrivers[index] = { ...newDrivers[index], ...driverData };
        } else {
          newDrivers = [{ id_usuario: u.id_usuario, nombre_display: u.id_usuario, ...driverData }, ...prevDrivers];
        }
        
        groupDrivers(newDrivers);
        return newDrivers;
      });
    }
  }, [lastMessage]);

  const handleOpenModal = (driver = null) => {
    setSelectedDriver(driver);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedDriver(null);
  };

  const handleDriverUpdate = () => {
    fetchDrivers();
    handleCloseModal();
  };

  return (
    <div className="space-y-8 ">
      <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow-sm border">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Gestión de Flota</h1>
          <p className="text-sm text-slate-500">Administra y monitorea a tus repartidores.</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => handleOpenModal(null)} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-medium">
              <Plus size={20} /> Crear Repartidor
          </button>
          <button onClick={fetchDrivers} className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''}/>
          </button>
        </div>
      </div>

      {Object.entries(groupedDrivers).map(([groupName, groupDriversList]) => (
        groupDriversList.length > 0 && (
          <div key={groupName} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2 px-1">
              {groupName} 
              <span className="text-xs font-normal text-slate-400 ml-2 bg-slate-100 px-2 py-0.5 rounded-full">{groupDriversList.length}</span>
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {groupDriversList.map(driver => (
                <DriverCard 
                  key={driver.id_usuario} 
                  driver={driver} 
                  onClick={() => handleOpenModal(driver)} 
                />
              ))}
            </div>
          </div>
        )
      ))}
       {loading && <p>Cargando repartidores...</p>}
      {!loading && drivers.length === 0 && <p>No se encontraron repartidores.</p>}

      {isModalOpen && (
        <DriverAdminModal 
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onSave={handleDriverUpdate}
          driver={selectedDriver}
        />
      )}
    </div>
  );
};

export default DriversPage;