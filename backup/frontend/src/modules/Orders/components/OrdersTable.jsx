import React from 'react';
import { Eye, Edit, MapPin, Clock, Bike } from 'lucide-react';

const OrdersTable = ({ orders, onAction }) => {
  const getStatusBadge = (status) => {
    const styles = {
      pendiente: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      aceptado: 'bg-blue-100 text-blue-800 border-blue-200',
      llevando: 'bg-indigo-100 text-indigo-800 border-indigo-200',
      entregado: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      cancelado: 'bg-red-100 text-red-800 border-red-200',
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${styles[status] || 'bg-gray-100'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
            <tr>
              <th className="px-6 py-4">ID / Hora</th>
              <th className="px-6 py-4">Comercio</th>
              <th className="px-6 py-4">Detalles</th>
              <th className="px-6 py-4">Estado</th>
              <th className="px-6 py-4">Repartidor</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.length === 0 ? (
              <tr>
                {/* CORRECCIÓN AQUÍ: colSpan */}
                <td colSpan="6" className="px-6 py-8 text-center text-slate-400">
                  No se encontraron pedidos.
                </td>
              </tr>
            ) : orders.map((order) => (
              <tr key={order.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4">
                  <div className="font-mono font-bold text-slate-700">#{order.id}</div>
                  <div className="flex items-center gap-1 text-slate-400 text-xs mt-1">
                    <Clock size={12} />
                    {new Date(order.fecha_creacion).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-medium text-slate-800">{order.nombre_comercio}</div>
                </td>
                <td className="px-6 py-4 max-w-xs">
                  <div className="truncate font-medium text-slate-700">{order.pedido}</div>
                </td>
                <td className="px-6 py-4">
                  {getStatusBadge(order.estado)}
                </td>
                <td className="px-6 py-4">
                  {order.repartidor_id ? (
                    <div className="flex items-center gap-2 text-slate-700">
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs">
                        <Bike size={14} />
                      </div>
                      <span className="text-xs font-medium">{order.repartidor_id}</span>
                    </div>
                  ) : (
                    <span className="text-slate-400 text-xs italic">-- Sin asignar --</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => onAction(order, 'edit')}
                      className="p-2 bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 rounded transition-colors"
                      title="Editar Todo"
                    >
                      <Edit size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrdersTable;