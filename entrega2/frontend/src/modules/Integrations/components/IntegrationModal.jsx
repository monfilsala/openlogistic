import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { X, Save, AlertTriangle, Key, Copy, Check, Power, RefreshCw } from 'lucide-react';

const IntegrationModal = ({ isOpen, onClose, onSuccess, onFormSubmitSuccess, integration }) => {
    const isEditMode = !!integration;
    
    const initialFormData = {
        name: '',
        id_externo_prefix: '',
        is_active: true,
        webhooks: {
            ORDER_STATUS_UPDATE: { url: '', payload_template: '{\n  "id": "{{id_externo}}",\n  "estado": "{{estado}}",\n  "repartidorId": "{{repartidor_id}}",\n  "timestamp": "{{timestamp}}"\n}' },
            DRIVER_LOCATION_UPDATE: { url: '', payload_template: '{\n  "pedidoId": "{{id_externo}}",\n  "repartidorId": "{{repartidor_id}}",\n  "lat": "{{latitud}}",\n  "lng": "{{longitud}}"\n}' }
        }
    };

    const [formData, setFormData] = useState(initialFormData);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [newlyGeneratedKey, setNewlyGeneratedKey] = useState(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setError('');
        setNewlyGeneratedKey(null);
        if (isEditMode && integration) {
            setFormData({
                name: integration.name || '',
                id_externo_prefix: integration.id_externo_prefix || '',
                is_active: integration.is_active,
                webhooks: {
                    ORDER_STATUS_UPDATE: {
                        url: integration.webhooks?.ORDER_STATUS_UPDATE?.url || '',
                        payload_template: JSON.stringify(integration.webhooks?.ORDER_STATUS_UPDATE?.payload_template || {}, null, 2)
                    },
                    DRIVER_LOCATION_UPDATE: {
                        url: integration.webhooks?.DRIVER_LOCATION_UPDATE?.url || '',
                        payload_template: JSON.stringify(integration.webhooks?.DRIVER_LOCATION_UPDATE?.payload_template || {}, null, 2)
                    }
                }
            });
        } else {
            setFormData(initialFormData);
        }
    }, [integration, isEditMode, isOpen]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleWebhookChange = (eventType, field, value) => {
        setFormData(prev => ({
            ...prev, webhooks: { ...prev.webhooks, [eventType]: { ...prev.webhooks[eventType], [field]: value } }
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const parsedWebhooks = {};
            for (const eventType in formData.webhooks) {
                const webhook = formData.webhooks[eventType];
                if (webhook.url && webhook.url.trim() !== '') {
                    parsedWebhooks[eventType] = { url: webhook.url, payload_template: JSON.parse(webhook.payload_template) };
                }
            }
            const payload = { name: formData.name, id_externo_prefix: formData.id_externo_prefix, is_active: formData.is_active, webhooks: parsedWebhooks };
            if (isEditMode) {
                await apiClient.put(`/integrations/${integration.id}`, payload);
            } else {
                await apiClient.post('/integrations', payload);
            }
            // Al guardar el formulario principal, sí cerramos y refrescamos.
            onFormSubmitSuccess();
        } catch (err) {
            if (err instanceof SyntaxError) {
                setError("Error de sintaxis en un Payload JSON. Revise que sea válido.");
            } else {
                setError(err.response?.data?.detail || err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateKey = async () => {
        if (!window.confirm("Esto generará una nueva API Key y revocará cualquier clave anterior para esta integración. ¿Continuar?")) return;
        setLoading(true);
        setError('');
        try {
            const res = await apiClient.post('/api-keys', { client_name: formData.name });
            setNewlyGeneratedKey(res.data.full_key);
            // --- CORRECCIÓN CLAVE: Solo refrescamos los datos, no cerramos el modal ---
            onSuccess();
        } catch (err) { setError(err.response?.data?.detail || err.message); } 
        finally { setLoading(false); }
    };

    const handleRevokeKey = async () => {
        if (!integration?.api_key || !window.confirm("¿Seguro que quieres revocar esta API Key? Dejará de funcionar inmediatamente.")) return;
        setLoading(true);
        setError('');
        try {
            await apiClient.put(`/api-keys/${integration.api_key.prefix}/revoke`);
            setNewlyGeneratedKey(null);
            // --- CORRECCIÓN CLAVE: Solo refrescamos los datos, no cerramos el modal ---
            onSuccess();
        } catch (err) { setError(err.response?.data?.detail || err.message); } 
        finally { setLoading(false); }
    };

    const copyToClipboard = () => {
        if (newlyGeneratedKey) {
            navigator.clipboard.writeText(newlyGeneratedKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b flex justify-between items-center">
                    <h3 className="font-bold text-lg">{isEditMode ? `Modificar Integración: ${integration.name}` : 'Crear Nueva Integración'}</h3>
                    <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
                </div>
                <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                    {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg border text-sm flex items-center gap-2"><AlertTriangle size={18}/>{error}</div>}
                    
                    <div className="space-y-4">
                        <h4 className="font-semibold text-base">Configuración General</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input name="name" value={formData.name} onChange={handleChange} placeholder="Nombre (ej: PideFacil)" required disabled={isEditMode} className="border p-2 rounded-lg text-sm w-full disabled:bg-slate-100"/>
                            <input name="id_externo_prefix" value={formData.id_externo_prefix} onChange={handleChange} placeholder="Prefijo de ID de Comercio (ej: pd_)" required className="border p-2 rounded-lg text-sm w-full"/>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 rounded"/>Integración Activa</label>
                    </div>

                    {isEditMode && (
                        <div className="border-t pt-4 space-y-3">
                            <h4 className="font-semibold text-base flex items-center gap-2"><Key/>Gestión de API Key</h4>
                            
                            {newlyGeneratedKey ? (
                                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg">
                                    <p className="font-bold text-amber-800">¡Nueva API Key Generada!</p>
                                    <p className="text-xs text-amber-700 mt-1 mb-2">Cópiala y guárdala en un lugar seguro. No podrás verla de nuevo.</p>
                                    <div className="flex items-center gap-2 bg-slate-900 text-white p-2 rounded-md font-mono text-sm">
                                        <span className="flex-1 truncate">{newlyGeneratedKey}</span>
                                        <button type="button" onClick={copyToClipboard} className="p-1 text-slate-400 hover:text-white">{copied ? <Check size={16}/> : <Copy size={16}/>}</button>
                                    </div>
                                </div>
                            ) : integration.api_key ? (
                                <div className="bg-slate-50 p-3 rounded-lg border">
                                    <p className="font-semibold text-sm">Hay una clave activa para esta integración.</p>
                                    <p className="text-xs text-slate-500 mt-1">Prefijo: <code className="font-mono">{integration.api_key.prefix}</code></p>
                                    <p className="text-xs text-slate-500">Último uso: {integration.api_key.last_used_at ? new Date(integration.api_key.last_used_at).toLocaleString() : 'Nunca'}</p>
                                    <div className="flex gap-2 mt-3">
                                        <button type="button" onClick={handleGenerateKey} disabled={loading} className="w-full justify-center px-4 py-2 text-sm font-medium border rounded-lg flex items-center gap-2 hover:bg-slate-100">
                                            <RefreshCw size={14}/> Regenerar Clave
                                        </button>
                                        <button type="button" onClick={handleRevokeKey} disabled={loading} className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-100 rounded-md flex items-center gap-1 hover:bg-red-200">
                                            <Power size={14}/> Revocar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-slate-50 p-4 rounded-lg border text-center">
                                    <p className="text-sm text-slate-500 mb-2">No hay una API Key activa para esta integración.</p>
                                    <button type="button" onClick={handleGenerateKey} disabled={loading} className="px-4 py-2 text-sm font-medium border rounded-lg flex items-center gap-2 hover:bg-slate-100">
                                        <Key size={14}/> Generar API Key
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    
                    <div className="border-t pt-4 space-y-2">
                        <h4 className="font-semibold">Webhook: Actualización de Estado de Pedido</h4>
                        <input value={formData.webhooks.ORDER_STATUS_UPDATE.url} onChange={e => handleWebhookChange('ORDER_STATUS_UPDATE', 'url', e.target.value)} placeholder="URL del Endpoint (Opcional)" className="w-full border p-2 rounded-lg text-sm"/>
                        <textarea value={formData.webhooks.ORDER_STATUS_UPDATE.payload_template} onChange={e => handleWebhookChange('ORDER_STATUS_UPDATE', 'payload_template', e.target.value)} rows="5" placeholder="Template del Payload JSON" className="w-full border p-2 rounded-lg font-mono text-xs bg-slate-50"/>
                        <p className="text-xs text-slate-500">Variables: <code className="bg-slate-100 p-1 rounded">{'{{id_externo}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{pedido_id}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{estado}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{repartidor_id}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{timestamp}}'}</code></p>
                    </div>

                    <div className="border-t pt-4 space-y-2">
                        <h4 className="font-semibold">Webhook: Ubicación del Repartidor</h4>
                        <input value={formData.webhooks.DRIVER_LOCATION_UPDATE.url} onChange={e => handleWebhookChange('DRIVER_LOCATION_UPDATE', 'url', e.target.value)} placeholder="URL del Endpoint (Opcional)" className="w-full border p-2 rounded-lg text-sm"/>
                        <textarea value={formData.webhooks.DRIVER_LOCATION_UPDATE.payload_template} onChange={e => handleWebhookChange('DRIVER_LOCATION_UPDATE', 'payload_template', e.target.value)} rows="5" placeholder="Template del Payload JSON" className="w-full border p-2 rounded-lg font-mono text-xs bg-slate-50"/>
                        <p className="text-xs text-slate-500">Variables: <code className="bg-slate-100 p-1 rounded">{'{{id_externo}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{repartidor_id}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{latitud}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{longitud}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{bateria_porcentaje}}'}</code></p>
                    </div>
                </div>
                <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-400">
                        <Save size={16} /> {loading ? 'Guardando...' : 'Guardar Configuración'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default IntegrationModal;