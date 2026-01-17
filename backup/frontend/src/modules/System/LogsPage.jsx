import React, { useEffect, useState, useContext } from 'react';
import { ChevronDown, ChevronRight, Activity, RefreshCw, Zap, History } from 'lucide-react';
import { WebSocketContext } from '../../context/WebSocketContext';
import apiClient from '../../api/axiosConfig';

// --- Sub-Componente Reutilizable para una Fila de Log ---
const LogRow = ({ log, isNew }) => {
  const [expanded, setExpanded] = useState(false);
  const detalles = log.detalles || {};

  const getBadgeColor = (level) => {
    switch (level) {
      case 'ERROR': case 'CRITICAL': return 'bg-red-100 text-red-700 border-red-200';
      case 'WARNING': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'REALTIME': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-blue-50 text-blue-700 border-blue-100';
    }
  };

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} className={`cursor-pointer transition-colors border-b border-slate-100 ${expanded ? 'bg-slate-100' : 'hover:bg-slate-50'} ${isNew ? 'bg-blue-50/50 animate-pulse' : ''}`}>
        <td className="px-6 py-3 w-10 text-slate-400"><button>{expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button></td>
        <td className="px-6 py-3 text-xs font-mono text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</td>
        <td className="px-6 py-3"><span className={`px-2 py-1 rounded text-[10px] font-bold border ${getBadgeColor(log.nivel)}`}>{log.nivel}</span></td>
        <td className="px-6 py-3 text-sm font-medium text-slate-800">{detalles.method ? `${detalles.method} ${detalles.path}` : log.accion}</td>
        <td className="px-6 py-3 text-sm text-slate-500">{detalles.client_ip || log.usuario_responsable || 'Sistema'}</td>
        <td className="px-6 py-3 text-sm font-bold">{detalles.status_code || '--'}</td>
      </tr>
      {expanded && (
        <tr className="bg-slate-100 border-b border-slate-200">
          <td colSpan="6" className="p-0">
            <div className="bg-slate-800 text-white m-2 shadow-inner overflow-hidden">
              <div className="p-4 font-mono text-xs text-green-400 overflow-x-auto">
                <pre>{JSON.stringify(log.detalles, null, 2)}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

// --- Componente Principal de la Página de Logs ---
const LogsPage = () => {
  const { lastMessage, isConnected } = useContext(WebSocketContext);
  const [activeTab, setActiveTab] = useState('realtime'); // 'realtime' | 'history'
  
  const [realtimeLogs, setRealtimeLogs] = useState([]);
  const [historicalLogs, setHistoricalLogs] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Cargar historial solo cuando se cambia a la pestaña y está vacío
  useEffect(() => {
    if (activeTab === 'history' && historicalLogs.length === 0) {
      fetchHistoricalLogs();
    }
  }, [activeTab]);

  // Escuchar WebSocket para el stream en vivo
  useEffect(() => {
    if (lastMessage && lastMessage.type === 'NEW_SYSTEM_LOG') {
      // Agregar al inicio de la lista y mantener solo los últimos 50
      setRealtimeLogs(prev => [lastMessage.data, ...prev].slice(0, 50));
    }
  }, [lastMessage]);

  const fetchHistoricalLogs = () => {
    setLoadingHistory(true);
    apiClient.get('/system/logs?limit=200')
      .then(res => setHistoricalLogs(res.data))
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  };

  const TabButton = ({ tabName, label, icon: Icon }) => (
    <button onClick={() => setActiveTab(tabName)}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-all ${activeTab === tabName ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
      <Icon size={16}/> {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Activity/> Monitor del Sistema</h1>
        <p className="text-sm text-slate-500 mt-1">Visualiza eventos del sistema en vivo y consulta el historial de auditoría.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border flex flex-col h-[calc(100vh-250px)]">
        {/* Pestañas */}
        <div className="px-4 border-b border-slate-200 flex justify-between items-center">
            <div className="flex">
                <TabButton tabName="realtime" label="Stream en Vivo" icon={Zap} />
                <TabButton tabName="history" label="Historial (Base de Datos)" icon={History} />
            </div>
            {activeTab === 'realtime' && (
                <div className={`flex items-center gap-2 text-xs font-bold px-2 py-1 rounded-full ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                    {isConnected ? 'Conectado' : 'Desconectado'}
                </div>
            )}
             {activeTab === 'history' && (
                <button onClick={fetchHistoricalLogs} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                    <RefreshCw size={16} className={loadingHistory ? 'animate-spin' : ''}/>
                </button>
            )}
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 bg-slate-50 text-slate-500 uppercase font-bold text-xs tracking-wider border-b">
              <tr>
                <th className="px-6 py-3 w-10"></th>
                <th className="px-6 py-3">Hora</th>
                <th className="px-6 py-3">Nivel</th>
                <th className="px-6 py-3">Acción / Endpoint</th>
                <th className="px-6 py-3">IP / Origen</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {activeTab === 'realtime' && realtimeLogs.map((log, i) => <LogRow key={log.timestamp + i} log={log} isNew={i === 0} />)}
              {activeTab === 'history' && historicalLogs.map(log => <LogRow key={log.id} log={log} isNew={false} />)}
            </tbody>
          </table>
          {activeTab === 'realtime' && realtimeLogs.length === 0 && <div className="p-8 text-center text-slate-400">Esperando eventos en vivo...</div>}
          {activeTab === 'history' && historicalLogs.length === 0 && !loadingHistory && <div className="p-8 text-center text-slate-400">No hay registros en la base de datos.</div>}
          {loadingHistory && <div className="p-8 text-center text-slate-400">Cargando historial...</div>}
        </div>
      </div>
    </div>
  );
};

export default LogsPage;