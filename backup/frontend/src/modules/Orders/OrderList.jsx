import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../../api/axiosConfig';
import { Package, Clock, User, Bike, XCircle, Settings, X, Battery } from 'lucide-react';

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

const OrderList = ({ orders = [], activeDrivers = [], compact = false }) => {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(intervalId);
  }, []);

  const availableDrivers = useMemo(() => {
    const busyDriverIds = new Set(
      orders
        .filter(order => order.repartidor_id && order.estado !== 'entregado' && order.estado !== 'cancelado')
        .map(order => order.repartidor_id)
    );

    return activeDrivers.filter(driver => {
      const isAvailableState = driver.estado_actual?.toLowerCase() === 'disponible';
      let isActiveTime = false;
      if (driver.ultima_actualizacion_loc) {
        const minutesDiff = (now - new Date(driver.ultima_actualizacion_loc)) / 60000;
        isActiveTime = minutesDiff < 10;
      }
      const isNotBusy = !busyDriverIds.has(driver.id_usuario);
      return isAvailableState && isActiveTime && isNotBusy;
    });
  }, [activeDrivers, orders, now]);

  const handleAction = (order, type) => {
    setSelectedOrder(order);
    setModalType(type);
  };

  const submitAssign = async (driverId) => {
    if (!selectedOrder) return;
    try {
      await apiClient.post(`/pedidos/${selectedOrder.id}/asignar`, { repartidor_id: driverId });
      setModalType(null);
    } catch (e) {
      alert("Error: " + (e.response?.data?.detail || e.message));
    }
  };

  const submitStatusChange = async (newStatus) => {
    if (!selectedOrder) return;
    try {
      await apiClient.patch(`/pedidos/${selectedOrder.id}/estado`, {
        estado: newStatus,
        repartidor_id: selectedOrder.repartidor_id
      });
      setModalType(null);
    } catch (e) {
      alert("Error: " + (e.response?.data?.detail || e.message));
    }
  };

  const getStatusBadgeClasses = (status) => {
    switch(status) {
      case 'pendiente': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'aceptado': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'entregado': return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelado': return 'bg-red-100 text-red-800 border-red-200';
      case 'con_novedad': return 'bg-purple-100 text-purple-800 border-purple-200 animate-pulse';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className={compact ? "h-full flex flex-col" : "p-6"}>
      <div className={compact ? "flex-1 overflow-y-auto" : ""}>
        <div className="divide-y divide-slate-100">
          {orders.length > 0 ? orders.map(order => {
            const driver = activeDrivers.find(d => d.id_usuario === order.repartidor_id);
            return (
              <div key={order.id} className="p-4 hover:bg-slate-50/50 flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-slate-500">#{order.id}</span>
                    <p className="font-bold text-sm truncate text-slate-800">{order.nombre_comercio}</p>
                    <p className="text-xs text-slate-600 line-clamp-2">{order.pedido}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${getStatusBadgeClasses(order.estado)}`}>
                    {order.estado.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><Clock size={12}/>{new Date(order.fecha_creacion).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    {order.repartidor_id && (
                       <span className="flex items-center gap-1 font-medium text-slate-600">
                         <User size={12}/> {driver?.nombre_display || order.repartidor_id}
                       </span>
                    )}
                    {driver && driver.ultima_bateria_porcentaje != null && (
                      <span className={`flex items-center gap-1 font-medium ${driver.ultima_bateria_porcentaje < 20 ? 'text-red-500' : 'text-slate-500'}`}>
                        <Battery size={12}/> {driver.ultima_bateria_porcentaje}%
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {order.estado === 'pendiente' ? (
                      <>
                        <button onClick={() => handleAction(order, 'assign')} className="bg-slate-800 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 hover:bg-slate-700"><Bike size={12}/> Asignar</button>
                        <button onClick={() => { setSelectedOrder(order); submitStatusChange('cancelado'); }} className="px-2 text-red-500 hover:bg-red-50 rounded-md"><XCircle size={16}/></button>
                      </>
                    ) : (
                      <button onClick={() => handleAction(order, 'status')} className="bg-white border text-slate-600 text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 hover:bg-slate-50"><Settings size={12}/> Gestionar</button>
                    )}
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="p-8 text-center text-slate-400 text-sm">No hay pedidos activos.</div>
          )}
        </div>
      </div>

      <Modal isOpen={modalType === 'assign'} onClose={() => setModalType(null)} title={`Asignar Pedido #${selectedOrder?.id}`}>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {availableDrivers.length === 0 ? (
            <div className="text-center text-slate-400 py-4">No hay conductores disponibles.</div>
          ) : (
            availableDrivers.map(d => (
              <button key={d.id_usuario} onClick={() => submitAssign(d.id_usuario)} className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-blue-50 hover:border-blue-300 transition-colors duration-150">
                <div>
                  <div className="font-bold text-sm text-slate-800">{d.nombre_display || d.id_usuario}</div>
                  <div className="text-xs text-green-600 font-semibold">● {d.estado_actual}</div>
                </div>
                <div className="text-xs text-slate-500">{d.ultima_bateria_porcentaje}% Bat</div>
              </button>
            ))
          )}
        </div>
      </Modal>

      <Modal isOpen={modalType === 'status'} onClose={() => setModalType(null)} title="Actualizar Estado">
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => submitStatusChange('pendiente')} className="p-3 border bg-yellow-50 text-yellow-700 rounded-lg col-span-2 hover:bg-yellow-100">Volver a Pendiente</button>
          {['retirando', 'llevando', 'entregado', 'cancelado'].map(status => (
            <button key={status} onClick={() => submitStatusChange(status)} className={`p-3 border rounded-lg transition-colors duration-150 ${status === 'entregado' ? 'bg-green-50 hover:bg-green-100' : status === 'cancelado' ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>{status}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default OrderList;