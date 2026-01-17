import React, { useEffect, useState } from 'react';
import apiClient from '../../api/axiosConfig'; // <-- CAMBIO IMPORTANTE
import { Settings, Save, AlertTriangle, List, Code } from 'lucide-react';

const SettingsPage = () => {
  const [configKeys, setConfigKeys] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [jsonContent, setJsonContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Cargar lista de claves al montar
  useEffect(() => {
    apiClient.get('/config')
      .then(res => setConfigKeys(res.data))
      .catch(() => setError("No se pudieron cargar las configuraciones."));
  }, []);

  // Cargar contenido JSON al seleccionar una clave
  useEffect(() => {
    if (activeKey) {
      setLoading(true);
      setError('');
      apiClient.get(`/config/${activeKey.clave}`)
        .then(res => {
          // Formatear JSON para que se vea bonito en el editor
          setJsonContent(JSON.stringify(res.data, null, 2));
        })
        .catch(() => setError(`No se pudo cargar la configuración para "${activeKey.clave}".`))
        .finally(() => setLoading(false));
    } else {
      setJsonContent('');
    }
  }, [activeKey]);

  const handleSave = async () => {
    let parsedJson;
    try {
      // Validar que el JSON sea correcto antes de enviar
      parsedJson = JSON.parse(jsonContent);
      setError('');
    } catch (e) {
      setError("Error de sintaxis: El JSON no es válido.");
      return;
    }

    setLoading(true);
    try {
      await apiClient.put(`/config/${activeKey.clave}`, parsedJson);
      alert(`Configuración "${activeKey.clave}" guardada exitosamente.`);
    } catch (e) {
      setError("Error guardando la configuración.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Settings/> Configuración General</h1>
        <p className="text-sm text-slate-500 mt-1">Edita parámetros críticos del sistema como tarifas, roles y más.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-250px)]">
        
        {/* Columna Izquierda: Lista de Claves */}
        <div className="md:col-span-1 bg-white rounded-xl border shadow-sm flex flex-col">
          <div className="p-4 border-b font-bold text-slate-700 flex items-center gap-2"><List size={18}/> Parámetros</div>
          <div className="overflow-y-auto">
            {configKeys.map(key => (
              <button 
                key={key.clave}
                onClick={() => setActiveKey(key)}
                className={`w-full text-left p-4 text-sm font-medium border-l-4 transition-colors ${
                  activeKey?.clave === key.clave 
                    ? 'bg-blue-50 border-blue-500 text-blue-700' 
                    : 'border-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                {key.clave.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                <p className="text-xs font-normal text-slate-400">
                  Última mod: {new Date(key.updated_at).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Columna Derecha: Editor JSON */}
        <div className="md:col-span-3 bg-white rounded-xl border shadow-sm flex flex-col">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-bold text-slate-700 flex items-center gap-2"><Code size={18}/> Editor JSON</h3>
            {activeKey && (
              <button onClick={handleSave} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50">
                <Save size={16}/> {loading ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            )}
          </div>
          
          <div className="flex-1 p-4 relative">
            {error && (
              <div className="absolute top-6 left-6 right-6 z-10 bg-red-50 text-red-700 p-3 rounded-lg border border-red-200 text-sm flex items-center gap-2">
                <AlertTriangle size={18}/> {error}
              </div>
            )}
            {activeKey ? (
              <textarea
                value={jsonContent}
                onChange={(e) => setJsonContent(e.target.value)}
                className="w-full h-full p-4 rounded-lg bg-slate-900 text-green-400 font-mono text-sm border-none outline-none resize-none"
                placeholder="Cargando configuración..."
                spellCheck="false"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                Selecciona un parámetro de la izquierda para editar.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default SettingsPage;