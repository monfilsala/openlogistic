import React, { useState } from 'react';
import { Search } from 'lucide-react';
import OrdersTable from './components/OrdersTable';
import EditOrderModal from './components/EditOrderModal';
import apiClient from '../../api/axiosConfig';

const HistoryPage = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState({ start: '', end: '' });
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const searchHistory = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100, estado: 'entregado,cancelado' });
      if (dates.start) params.append('fecha_inicio', dates.start);
      if (dates.end) params.append('fecha_fin', dates.end);
      const res = await apiClient.get(`/pedidos?${params.toString()}`);
      setOrders(res.data);
    } catch (err) { alert("Error buscando historial"); } 
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 ">
      <div className='p-4 bg-white rounded-xl shadow-sm border'><h1 className="text-2xl font-bold text-slate-800">Historial</h1></div>
      
      
      <div className="bg-white p-4 rounded-xl border shadow-sm">
        <form onSubmit={searchHistory} className="flex gap-4 items-end">
          <div><label className="block text-xs font-bold text-slate-500 mb-1">Desde</label><input type="date" className="border p-2 rounded text-sm" value={dates.start} onChange={e=>setDates({...dates, start:e.target.value})}/></div>
          <div><label className="block text-xs font-bold text-slate-500 mb-1">Hasta</label><input type="date" className="border p-2 rounded text-sm" value={dates.end} onChange={e=>setDates({...dates, end:e.target.value})}/></div>
          <button type="submit" disabled={loading} className="bg-slate-800 text-white px-4 py-2 rounded text-sm flex gap-2"><Search size={16}/> Buscar</button>
        </form>
      </div>

      <OrdersTable 
        orders={orders} 
        onAction={(order, type) => {
           if (type === 'edit') { setSelectedOrder(order); setIsEditModalOpen(true); }
        }} 
      />

      <EditOrderModal 
        isOpen={isEditModalOpen} 
        order={selectedOrder} 
        onClose={() => setIsEditModalOpen(false)}
        onOrderUpdated={(updated) => setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))}
      />
    </div>
  );
};

export default HistoryPage;