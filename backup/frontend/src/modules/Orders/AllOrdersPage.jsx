import React, { useEffect, useState, useContext } from 'react';
import { RefreshCw, AlertCircle, Database } from 'lucide-react';
import apiClient from '../../api/axiosConfig'; // <-- CAMBIO IMPORTANTE
import OrdersTable from './components/OrdersTable';
import EditOrderModal from './components/EditOrderModal';
import { WebSocketContext } from '../../context/WebSocketContext';

const AllOrdersPage = () => {
  const { lastMessage } = useContext(WebSocketContext);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [drivers, setDrivers] = useState([]);

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = '/pedidos?limit=50';
      if (filterStatus === 'active') url += '&estado=pendiente,aceptado,retirando,llevando,con_novedad';
      const res = await apiClient.get(url);
      if (Array.isArray(res.data)) setOrders(res.data);
      else throw new Error("Formato inválido");
    } catch (e) { setError(e.message); } 
    finally { setLoading(false); }
  };
  
  // Cargar drivers una vez
  useEffect(() => {
    apiClient.get('/drivers/detailed').then(res => setDrivers(res.data));
  }, []);

  useEffect(() => { fetchOrders(); }, [filterStatus]);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'NEW_ORDER') {
      setOrders(prev => [lastMessage.data, ...prev]);
    } else if (lastMessage.type === 'ORDER_STATUS_UPDATE' || lastMessage.type === 'ORDER_ASSIGNED') {
      setOrders(prev => prev.map(o => o.id === lastMessage.id ? { ...o, ...lastMessage.data } : o));
    }
  }, [lastMessage]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border">
        <div><h1 className="text-xl font-bold flex items-center gap-2"><Database size={24}/> Todos los Pedidos</h1></div>
        <div className="flex gap-3">
          <select className="border p-2 rounded-lg text-sm bg-white" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Historial Reciente</option>
            <option value="active">Solo Activos</option>
          </select>
          <button onClick={fetchOrders} className="p-2.5 border rounded-lg hover:bg-slate-50"><RefreshCw size={20} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      {error && (<div className="bg-red-50 p-4 rounded-lg flex items-center gap-2"><AlertCircle size={20}/> {error}</div>)}

      <OrdersTable orders={orders} onAction={(order, type) => { if (type === 'edit') { setSelectedOrder(order); setIsEditModalOpen(true); } }} />

      <EditOrderModal isOpen={isEditModalOpen} order={selectedOrder} onClose={() => setIsEditModalOpen(false)} onOrderUpdated={(upd) => setOrders(prev => prev.map(o => o.id === upd.id ? upd : o))} drivers={drivers} />
    </div>
  );
};

export default AllOrdersPage;