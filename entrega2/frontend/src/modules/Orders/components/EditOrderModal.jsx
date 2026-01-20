import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { X, Save, AlertTriangle, Info, ToggleRight, History, Clock, MapPin, Store, ExternalLink, User, DollarSign, Share2, Zap } from 'lucide-react'; // <-- Añadido Share2 y Zap

// --- Sub-Componentes para Organización (Sin cambios) ---
const InfoField = ({ label, value, isLink = false }) => (
  <div>
    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</label>
    {isLink && value ? (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all flex items-center gap-1.5 mt-1">
        Ver en Mapa <ExternalLink size={14} />
      </a>
    ) : (
      <p className="text-sm text-slate-700 font-medium pt-1">{value || '--'}</p>
    )}
  </div>
);

const EditableField = ({ label, name, value, onChange, type = "text", as = "input", step = "any" }) => (
    <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
        {as === 'textarea' ? (
            <textarea name={name} value={value} onChange={onChange} rows="2" className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
        ) : (
            <input type={type} name={name} value={value} onChange={onChange} step={step} className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
        )}
    </div>
);


const EditOrderModal = ({ order, isOpen, onClose, onOrderUpdated, drivers = [] }) => {
  const [activeTab, setActiveTab] = useState('info');
  
  const initialFormState = {
    pedido: '', telefono_contacto: '', telefono_comercio: '',
    costo_servicio: 0, detalles: '', repartidor_id: '',
    latitud_retiro: '', longitud_retiro: '',
    latitud_entrega: '', longitud_entrega: '',
  };
  const [formData, setFormData] = useState(initialFormState);

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && order) {
      setActiveTab('info');
      setFormData({
        pedido: order.pedido || '',
        telefono_contacto: order.telefono_contacto || '',
        telefono_comercio: order.telefono_comercio || '',
        costo_servicio: order.costo_servicio || 0,
        detalles: order.detalles || '',
        repartidor_id: order.repartidor_id || '',
        latitud_retiro: order.latitud_retiro || '',
        longitud_retiro: order.longitud_retiro || '',
        latitud_entrega: order.latitud_entrega || '',
        longitud_entrega: order.longitud_entrega || '',
      });
      setLogs([]);
      setError('');
    }
  }, [order, isOpen]);

  useEffect(() => {
    if (isOpen && order && activeTab === 'history' && logs.length === 0) {
      setLoading(true);
      apiClient.get(`/pedidos/${order.id}/logs`)
        .then(res => setLogs(res.data))
        .catch(() => setError("No se pudieron cargar los logs."))
        .finally(() => setLoading(false));
    }
  }, [activeTab, isOpen, order, logs.length]);

  const generateMapsLink = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  
  const handleUpdate = async (updateData, isStatusChange = false) => {
    if (!order || !order.id) {
      setError("Error: No se ha seleccionado un pedido válido.");
      return;
    }

    setLoading(true);
    setError('');
    try {
      let endpoint, method, payload;

      if (isStatusChange) {
        endpoint = `/pedidos/${order.id}/estado`;
        method = 'patch';
        payload = { estado: updateData.estado, repartidor_id: order.repartidor_id || null };
      } else {
        endpoint = `/pedidos/${order.id}`;
        method = 'put';
        payload = updateData;
      }
      
      const res = await apiClient[method](endpoint, payload);
      onOrderUpdated(res.data);
      alert("Pedido actualizado correctamente");
      
      if (isStatusChange) onClose();

    } catch (err) {
      const errorMessage = err.response?.data?.detail || err.message;
      setError(errorMessage);
      alert("Error al actualizar: " + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e) => { e.preventDefault(); handleUpdate(formData, false); };
  
  if (!isOpen) return null;

  const TabButton = ({ tabName, label, icon: Icon }) => (
    <button type="button" onClick={() => setActiveTab(tabName)} className={`flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-lg border-b-2 ${activeTab === tabName ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl border border-slate-200">
        
        {/* --- INICIO DE LA CORRECCIÓN --- */}
        <div className="px-6 py-4 border-b flex justify-between items-start bg-slate-50 rounded-t-xl">
          <div>
            <h3 className="font-bold text-lg text-slate-800">Centro de Control: Pedido #{order?.id}</h3>
            <p className="text-xs text-slate-500 mb-2">{order?.nombre_comercio}</p>
            
            {/* Lógica condicional para mostrar el origen del pedido */}
            {order?.id_externo ? (
                <div className="flex items-center gap-1.5 text-xs font-semibold bg-purple-100 text-purple-800 px-2 py-1 rounded-full w-fit">
                    <Share2 size={12} />
                    <span>ID Externo: {order.id_externo}</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full w-fit">
                    <Zap size={12} />
                    <span>Servicio Interno</span>
                </div>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 transition-colors"><X size={20}/></button>
        </div>
        {/* --- FIN DE LA CORRECCIÓN --- */}
        
        <div className="px-6 border-b flex">
          <TabButton tabName="info" label="Información General" icon={Info} />
          <TabButton tabName="status" label="Gestión de Estado" icon={ToggleRight} />
          <TabButton tabName="history" label="Historial de Eventos" icon={History} />
        </div>
        
        <div className="flex-1 overflow-y-auto bg-slate-50/50">
          {activeTab === 'info' && order && (
            <form id="editForm" onSubmit={handleFormSubmit} className="p-6 space-y-6">
              <div className="bg-white p-5 rounded-xl border grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2"><User size={18} className="text-green-500"/> Asignación</h3>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Repartidor Asignado</label>
                        <select name="repartidor_id" value={formData.repartidor_id} onChange={e => setFormData({...formData, repartidor_id: e.target.value})} className="w-full p-2 border rounded-lg text-sm bg-white">
                            <option value="">-- Sin Asignar --</option>
                            {drivers.map(d => (<option key={d.id_usuario} value={d.id_usuario}>{d.nombre_display || d.id_usuario}</option>))}
                        </select>
                    </div>
                </div>
                <div className="space-y-4">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2"><DollarSign size={18} className="text-emerald-500"/> Tarifa</h3>
                    <EditableField label="Costo del Servicio ($)" name="costo_servicio" value={formData.costo_servicio} onChange={e => setFormData({...formData, costo_servicio: e.target.value})} type="number"/>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-5 rounded-xl border space-y-4">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2"><Store size={18} className="text-orange-500"/> Punto de Retiro</h3>
                  <InfoField label="Comercio" value={order.nombre_comercio} />
                  <EditableField label="Teléfono Comercio" name="telefono_comercio" value={formData.telefono_comercio} onChange={e => setFormData({...formData, telefono_comercio: e.target.value})}/>
                  <div className="grid grid-cols-2 gap-4">
                    <EditableField label="Latitud Retiro" name="latitud_retiro" value={formData.latitud_retiro} onChange={e => setFormData({...formData, latitud_retiro: e.target.value})} type="number"/>
                    <EditableField label="Longitud Retiro" name="longitud_retiro" value={formData.longitud_retiro} onChange={e => setFormData({...formData, longitud_retiro: e.target.value})} type="number"/>
                  </div>
                  <InfoField label="Link Google Maps" value={generateMapsLink(order.latitud_retiro, order.longitud_retiro)} isLink={true} />
                </div>
                <div className="bg-white p-5 rounded-xl border space-y-4">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2"><MapPin size={18} className="text-blue-500"/> Punto de Entrega</h3>
                  <EditableField label="Teléfono Cliente" name="telefono_contacto" value={formData.telefono_contacto} onChange={e => setFormData({...formData, telefono_contacto: e.target.value})}/>
                   <div className="grid grid-cols-2 gap-4">
                    <EditableField label="Latitud Entrega" name="latitud_entrega" value={formData.latitud_entrega} onChange={e => setFormData({...formData, latitud_entrega: e.target.value})} type="number"/>
                    <EditableField label="Longitud Entrega" name="longitud_entrega" value={formData.longitud_entrega} onChange={e => setFormData({...formData, longitud_entrega: e.target.value})} type="number"/>
                  </div>
                  <InfoField label="Link Google Maps" value={order.link_maps || generateMapsLink(order.latitud_entrega, order.longitud_entrega)} isLink={true} />
                </div>
              </div>
              <div className="flex justify-end pt-4"><button type="submit" disabled={loading} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 shadow-md hover:bg-blue-700 disabled:bg-slate-400"><Save size={16}/> {loading ? 'Guardando...' : 'Guardar Cambios'}</button></div>
            </form>
          )}
          {activeTab === 'status' && order && (
            <div className="p-6 space-y-4">
              <h4 className="font-bold text-lg">Cambiar Estado del Pedido</h4>
              <p className="text-sm text-slate-500">El estado actual es: <span className="font-bold p-1 bg-slate-100 rounded">{order.estado}</span></p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {['pendiente', 'aceptado', 'retirando', 'llevando', 'entregado', 'cancelado'].map(status => (
                  <button key={status} onClick={() => handleUpdate({ estado: status }, true)} disabled={order.estado === status || loading} className={`p-4 rounded-lg font-bold capitalize text-center transition-all border-2 disabled:opacity-50 disabled:cursor-not-allowed ${order.estado === status ? 'bg-slate-800 text-white border-slate-800' : 'bg-white hover:border-slate-800 hover:text-slate-800'}`}>{status.replace('_', ' ')}</button>
                ))}
              </div>
              <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded-lg flex gap-3 mt-4 items-start"><AlertTriangle size={20} className="shrink-0"/> <div><span className="font-bold">Aviso:</span> Cambiar a 'Pendiente' desasignará al repartidor actual del pedido.</div></div>
            </div>
          )}
          {activeTab === 'history' && order && (
            <div className="p-6">
              <h4 className="font-bold text-lg mb-4">Historial de Eventos del Pedido</h4>
              <div className="border rounded-lg overflow-hidden bg-white">
                {loading ? <p className="p-4 text-center">Cargando...</p> : 
                 logs.length === 0 ? <p className="p-4 text-center text-slate-500">No hay logs para este pedido.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {logs.map(log => (
                      <li key={log.log_id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                           <div className="bg-slate-100 p-2 rounded-full"><Clock size={16} className="text-slate-500"/></div>
                           <div>
                              <p className="font-medium capitalize text-slate-800">{log.estado_registrado.replace(/_/g, ' ')}</p>
                              <p className="text-xs text-slate-400">Repartidor: {log.repartidor_id || 'N/A'}</p>
                           </div>
                        </div>
                        <span className="text-xs font-mono text-slate-500">{new Date(log.timestamp_log).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EditOrderModal;