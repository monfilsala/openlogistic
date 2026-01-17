import React, { useEffect, useState, useContext } from 'react';
import apiClient from '../../api/axiosConfig';
import { WebSocketContext } from '../../context/WebSocketContext';
import { Calendar, Plus, X, MapPin, Store, Truck, Clock, Save, Edit, Trash2 } from 'lucide-react';

// Componente InputGroup definido FUERA para evitar bugs de re-renderización
const InputGroup = ({ label, name, type = "text", required = false, placeholder = "", className = "", step = "any", value, onChange }) => (
  <div className={className}>
    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
    <input
      type={type}
      name={name}
      step={step}
      className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      value={value}
      onChange={onChange}
      required={required}
      placeholder={placeholder}
    />
  </div>
);

const ScheduledOrdersPage = () => {
  const [orders, setOrders] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [merchants, setMerchants] = useState([]);
  const [editingOrder, setEditingOrder] = useState(null);
  const { lastMessage } = useContext(WebSocketContext);

  const initialFormData = {
    fecha: '', hora: '',
    id_comercio: '', nombre_comercio: '', telefono_comercio: '', latitud_retiro: '', longitud_retiro: '',
    pedido: '', direccion_entrega: '', telefono_contacto: '', link_maps_entrega: '', detalles: '', tipo_vehiculo: 'moto',
    latitud_entrega: '', longitud_entrega: ''
  };
  const [formData, setFormData] = useState(initialFormData);
  const [pickupType, setPickupType] = useState('merchant');

  const fetchOrders = () => { apiClient.get('/pedidos/programados').then(res => setOrders(res.data)).catch(console.error); };
  const fetchMerchants = () => { apiClient.get('/comercios').then(res => setMerchants(res.data)).catch(console.error); };

  useEffect(() => {
    fetchOrders();
    fetchMerchants();
  }, []);

  useEffect(() => {
    if (lastMessage && lastMessage.type === 'SCHEDULED_ORDER_PROCESSED') {
      const { id, status } = lastMessage.data;
      if (status === 'procesado') {
        setOrders(prevOrders => prevOrders.filter(o => o.id !== id));
      } else {
        setOrders(prevOrders => prevOrders.map(o => o.id === id ? { ...o, estado: 'error' } : o));
      }
    }
  }, [lastMessage]);

  const handleOpenModal = (orderToEdit = null) => {
    setEditingOrder(orderToEdit);
    if (orderToEdit) {
      const releaseDate = new Date(orderToEdit.fecha_liberacion);
      const payload = orderToEdit.payload_pedido;
      setFormData({
        fecha: releaseDate.toISOString().split('T')[0],
        hora: releaseDate.toTimeString().substring(0, 5),
        id_comercio: payload.id_comercio || '',
        nombre_comercio: payload.nombre_comercio || '',
        telefono_comercio: payload.telefono_comercio || '',
        latitud_retiro: payload.latitud_retiro || '',
        longitud_retiro: payload.longitud_retiro || '',
        pedido: payload.pedido || '',
        direccion_entrega: payload.direccion_entrega || '',
        telefono_contacto: payload.telefono_contacto || '',
        link_maps_entrega: payload.link_maps || '',
        detalles: payload.detalles || '',
        tipo_vehiculo: payload.tipo_vehiculo || 'moto',
        latitud_entrega: payload.latitud_entrega || '',
        longitud_entrega: payload.longitud_entrega || ''
      });
      setPickupType(payload.id_comercio?.startsWith('custom_') ? 'custom' : 'merchant');
    } else {
      setFormData(initialFormData);
      setPickupType('merchant');
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingOrder(null);
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // --- INICIO DE LA CORRECCIÓN DEFINITIVA ---
  // Esta es la función correcta. Es 'async' y llama a la API para obtener los detalles completos.
  const handleMerchantChange = async (e) => {
    const selectedId = e.target.value;
    if (!selectedId) {
      setFormData(prev => ({ ...prev, id_comercio: '', nombre_comercio: '', latitud_retiro: '', longitud_retiro: '', telefono_comercio: '' }));
      return;
    }
    try {
      const res = await apiClient.get(`/comercios/${selectedId}`);
      const merchant = res.data;
      
      setFormData(prev => ({
        ...prev,
        id_comercio: merchant.id_comercio,
        nombre_comercio: merchant.nombre,
        telefono_comercio: merchant.numero_contacto || '',
        latitud_retiro: merchant.latitud || '', // <-- Se autocompletará correctamente
        longitud_retiro: merchant.longitud || '', // <-- Se autocompletará correctamente
      }));
    } catch (error) {
      console.error("No se pudieron cargar los detalles del comercio", error);
      const simpleMerchant = merchants.find(m => m.id_comercio === selectedId);
      if (simpleMerchant) {
        setFormData(prev => ({ ...prev, id_comercio: simpleMerchant.id_comercio, nombre_comercio: simpleMerchant.nombre }));
      }
    }
  };
  // --- FIN DE LA CORRECCIÓN DEFINITIVA ---

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fechaISO = `${formData.fecha}T${formData.hora}:00`;
    const payload = {
      id_comercio: pickupType === 'merchant' ? formData.id_comercio : (editingOrder?.payload_pedido?.id_comercio || `custom_${Date.now()}`),
      nombre_comercio: pickupType === 'merchant' ? formData.nombre_comercio : formData.nombre_comercio || 'Retiro Personalizado',
      telefono_comercio: formData.telefono_comercio,
      latitud_retiro: parseFloat(formData.latitud_retiro) || 0,
      longitud_retiro: parseFloat(formData.longitud_retiro) || 0,
      pedido: formData.pedido,
      direccion_entrega: formData.direccion_entrega,
      telefono_contacto: formData.telefono_contacto,
      link_maps: formData.link_maps_entrega,
      latitud_entrega: parseFloat(formData.latitud_entrega) || 0,
      longitud_entrega: parseFloat(formData.longitud_entrega) || 0,
      detalles: formData.detalles,
      tipo_vehiculo: formData.tipo_vehiculo,
      creado_por_usuario_id: 'sistema_programado'
    };

    try {
      if (editingOrder) {
        await apiClient.put(`/pedidos/programados/${editingOrder.id}`, { payload_pedido: payload, fecha_liberacion: fechaISO });
        alert("Pedido programado modificado con éxito");
      } else {
        await apiClient.post('/pedidos/programados', { payload: payload, fecha_liberacion: fechaISO });
        alert("Pedido programado creado con éxito");
      }
      handleCloseModal();
      fetchOrders();
    } catch (err) {
      alert("Error: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleDelete = async (orderId) => {
    if (window.confirm(`¿Estás seguro de que quieres eliminar el pedido programado #${orderId}? Esta acción no se puede deshacer.`)) {
      try {
        await apiClient.delete(`/pedidos/programados/${orderId}`);
        setOrders(prevOrders => prevOrders.filter(o => o.id !== orderId));
        alert("Pedido programado eliminado.");
      } catch (err) {
        alert("Error al eliminar: " + (err.response?.data?.detail || err.message));
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Calendar size={24} className="text-blue-600" /> Pedidos Programados</h1>
          <p className="text-sm text-slate-500">Planifica envíos futuros para su liberación automática</p>
        </div>
        <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-medium transition-colors shadow-sm">
          <Plus size={20} /> Nuevo Programado
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
            <tr>
              <th className="px-6 py-4">ID</th>
              <th className="px-6 py-4">Liberación</th>
              <th className="px-6 py-4">Comercio</th>
              <th className="px-6 py-4">Entrega</th>
              <th className="px-6 py-4">Estado</th>
              <th className="px-6 py-4 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.length === 0 ? (
              <tr><td colSpan="6" className="text-center py-10 text-slate-400">No hay pedidos programados pendientes.</td></tr>
            ) : orders.map(order => (
              <tr key={order.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-mono text-slate-500">#{order.id}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-blue-700 bg-blue-50 px-3 py-1 rounded-full w-fit font-medium text-xs border border-blue-100">
                    <Clock size={12} /> {new Date(order.fecha_liberacion).toLocaleString()}
                  </div>
                </td>
                <td className="px-6 py-4 font-medium text-slate-700">{order.payload_pedido?.nombre_comercio || 'N/A'}</td>
                <td className="px-6 py-4">
                  <div className="text-slate-800 font-medium truncate max-w-xs">{order.payload_pedido?.pedido || ''}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin size={12} />{order.payload_pedido?.direccion_entrega || ''}</div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold uppercase border ${order.estado === 'error' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-purple-100 text-purple-800 border-purple-200'}`}>{order.estado}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => handleOpenModal(order)} title="Modificar" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Edit size={16} /></button>
                    <button onClick={() => handleDelete(order.id)} title="Eliminar" className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Clock size={20} className="text-blue-600" /> {editingOrder ? `Modificar Pedido #${editingOrder.id}` : 'Programar Nuevo Pedido'}</h3>
                <p className="text-xs text-slate-500">El pedido se enviará automáticamente a la hora indicada</p>
              </div>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-full transition-colors"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              <form id="programForm" onSubmit={handleSubmit} className="space-y-6">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1 w-full"><InputGroup label="Fecha de Liberación" name="fecha" type="date" required={true} value={formData.fecha} onChange={handleFormChange} /></div>
                  <div className="flex-1 w-full"><InputGroup label="Hora de Liberación" name="hora" type="time" required={true} value={formData.hora} onChange={handleFormChange} /></div>
                  <div className="text-xs text-blue-600 font-medium pb-2 md:w-1/3"><Clock size={14} className="inline mr-1" /> Se usará zona horaria Caracas</div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                    <h4 className="font-bold text-slate-700 flex items-center gap-2 border-b pb-2"><Store size={18} className="text-orange-500" /> Punto de Retiro</h4>
                    <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
                      <button type="button" onClick={() => setPickupType('merchant')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${pickupType === 'merchant' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Comercio</button>
                      <button type="button" onClick={() => { setPickupType('custom'); setFormData(p => ({ ...p, id_comercio: '', nombre_comercio: '', latitud_retiro: '', longitud_retiro: '' })); }} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${pickupType === 'custom' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Otro</button>
                    </div>
                    {pickupType === 'merchant' ? (
                      <>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Seleccionar Comercio</label>
                          <select className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white" onChange={handleMerchantChange} value={formData.id_comercio} required><option value="">-- Buscar --</option>{merchants.map(m => (<option key={m.id_comercio} value={m.id_comercio}>{m.nombre}</option>))}</select>
                        </div>
                        <div className="text-xs text-slate-400 bg-slate-50 p-2 rounded border border-slate-100 mt-2"><p><b>Tel:</b> {formData.telefono_comercio || '--'}</p><p><b>Coords:</b> {formData.latitud_retiro ? `${formData.latitud_retiro}, ${formData.longitud_retiro}` : '--'}</p></div>
                      </>
                    ) : (
                      <>
                        <InputGroup label="Nombre Lugar" name="nombre_comercio" required={true} placeholder="Ej: Casa particular" value={formData.nombre_comercio} onChange={handleFormChange} />
                        <InputGroup label="Teléfono" name="telefono_comercio" value={formData.telefono_comercio} onChange={handleFormChange} />
                        <div className="grid grid-cols-2 gap-4">
                          <InputGroup label="Latitud Retiro" name="latitud_retiro" type="number" required={true} value={formData.latitud_retiro} onChange={handleFormChange} />
                          <InputGroup label="Longitud Retiro" name="longitud_retiro" type="number" required={true} value={formData.longitud_retiro} onChange={handleFormChange} />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                    <h4 className="font-bold text-slate-700 flex items-center gap-2 border-b pb-2"><Truck size={18} className="text-indigo-500" /> Qué Enviamos</h4>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descripción</label>
                      <textarea name="pedido" className="w-full border border-slate-300 rounded-lg p-2 text-sm h-24 resize-none" value={formData.pedido} onChange={handleFormChange} required placeholder="Detalle de items..." />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vehículo</label>
                      <select name="tipo_vehiculo" className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white" value={formData.tipo_vehiculo} onChange={handleFormChange}><option value="moto">Moto</option><option value="carro">Carro</option><option value="van">Van</option></select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notas Internas</label>
                      <textarea name="detalles" className="w-full border border-slate-300 rounded-lg p-2 text-sm h-16 resize-none" value={formData.detalles} onChange={handleFormChange} />
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                    <h4 className="font-bold text-slate-700 flex items-center gap-2 border-b pb-2"><MapPin size={18} className="text-red-500" /> Punto de Entrega</h4>
                    <InputGroup label="Dirección Exacta" name="direccion_entrega" required={true} placeholder="Calle, Edif..." value={formData.direccion_entrega} onChange={handleFormChange} />
                    <InputGroup label="Teléfono Cliente" name="telefono_contacto" required={true} value={formData.telefono_contacto} onChange={handleFormChange} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputGroup label="Latitud Entrega" name="latitud_entrega" type="number" required={true} value={formData.latitud_entrega} onChange={handleFormChange} />
                      <InputGroup label="Longitud Entrega" name="longitud_entrega" type="number" required={true} value={formData.longitud_entrega} onChange={handleFormChange} />
                    </div>
                    <InputGroup label="Link Maps Entrega (Opcional)" name="link_maps_entrega" placeholder="https://maps..." value={formData.link_maps_entrega} onChange={handleFormChange} />
                  </div>
                </div>
              </form>
            </div>
            <div className="px-6 py-4 border-t bg-white flex justify-end gap-3">
              <button type="button" onClick={handleCloseModal} className="px-6 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Cancelar</button>
              <button type="submit" form="programForm" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-lg shadow-blue-200 transition-all flex items-center gap-2">
                <Save size={18} /> {editingOrder ? 'Guardar Cambios' : 'Guardar Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledOrdersPage;