import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { X, Save, AlertTriangle } from 'lucide-react';

const IntegrationModal = ({ isOpen, onClose, onSave, integration }) => {
    const isEditMode = !!integration;
    const [formData, setFormData] = useState({
        name: '',
        id_externo_prefix: '',
        is_active: true,
        webhooks: {
            ORDER_STATUS_UPDATE: { url: '', payload_template: '{}' },
            DRIVER_LOCATION_UPDATE: { url: '', payload_template: '{}' },
        }
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
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
            // --- INICIO DE LA CORRECCIÓN ---
            // Las plantillas por defecto ahora son JSON válidos, con todas las variables como strings.
            setFormData({
                name: '',
                id_externo_prefix: '',
                is_active: true,
                webhooks: {
                    ORDER_STATUS_UPDATE: { url: '', payload_template: '{\n  "id": "{{id_externo}}",\n  "estado": "{{estado}}",\n  "timestamp": "{{timestamp}}"\n}' },
                    DRIVER_LOCATION_UPDATE: { url: '', payload_template: '{\n  "pedidoId": "{{id_externo}}",\n  "repartidorId": "{{repartidor_id}}",\n  "lat": "{{latitud}}",\n  "lng": "{{longitud}}"\n}' }
                }
            });
            // --- FIN DE LA CORRECCIÓN ---
        }
    }, [integration, isEditMode]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleWebhookChange = (eventType, field, value) => {
        setFormData(prev => ({
            ...prev,
            webhooks: {
                ...prev.webhooks,
                [eventType]: { ...prev.webhooks[eventType], [field]: value }
            }
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
                    parsedWebhooks[eventType] = {
                        url: webhook.url,
                        payload_template: JSON.parse(webhook.payload_template)
                    };
                }
            }

            const payload = { 
                name: formData.name,
                id_externo_prefix: formData.id_externo_prefix,
                is_active: formData.is_active,
                webhooks: parsedWebhooks 
            };

            if (isEditMode) {
                await apiClient.put(`/integrations/${integration.id}`, payload);
            } else {
                await apiClient.post('/integrations', payload);
            }
            onSave();
        } catch (err) {
            if (err instanceof SyntaxError) {
                setError("Error de sintaxis en uno de los templates de Payload JSON. Asegúrate de que es un JSON válido.");
            } else {
                setError(err.response?.data?.detail || err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b flex justify-between items-center">
                    <h3 className="font-bold text-lg">{isEditMode ? 'Modificar Integración' : 'Crear Nueva Integración'}</h3>
                    <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
                </div>
                <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                    {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg border border-red-200 text-sm flex items-center gap-2"><AlertTriangle size={18}/>{error}</div>}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input name="name" value={formData.name} onChange={handleChange} placeholder="Nombre (ej: PideFacil)" required className="border p-2 rounded-lg text-sm w-full"/>
                        <input name="id_externo_prefix" value={formData.id_externo_prefix} onChange={handleChange} placeholder="Prefijo de ID de Comercio (ej: pd_)" required className="border p-2 rounded-lg text-sm w-full"/>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 rounded"/> 
                        Integración Activa
                    </label>

                    <div className="border-t pt-4 space-y-2">
                        <h4 className="font-semibold">Webhook: Actualización de Estado de Pedido</h4>
                        <input value={formData.webhooks.ORDER_STATUS_UPDATE.url} onChange={e => handleWebhookChange('ORDER_STATUS_UPDATE', 'url', e.target.value)} placeholder="URL del Endpoint (Opcional)" className="w-full border p-2 rounded-lg text-sm"/>
                        <textarea value={formData.webhooks.ORDER_STATUS_UPDATE.payload_template} onChange={e => handleWebhookChange('ORDER_STATUS_UPDATE', 'payload_template', e.target.value)} rows="5" placeholder="Template del Payload JSON" className="w-full border p-2 rounded-lg font-mono text-xs bg-slate-50"/>
                        <p className="text-xs text-slate-500">Variables disponibles: <code className="bg-slate-100 p-1 rounded">{'{{id_externo}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{pedido_id}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{estado}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{timestamp}}'}</code></p>
                    </div>

                    <div className="border-t pt-4 space-y-2">
                        <h4 className="font-semibold">Webhook: Ubicación del Repartidor</h4>
                        <input value={formData.webhooks.DRIVER_LOCATION_UPDATE.url} onChange={e => handleWebhookChange('DRIVER_LOCATION_UPDATE', 'url', e.target.value)} placeholder="URL del Endpoint (Opcional)" className="w-full border p-2 rounded-lg text-sm"/>
                        <textarea value={formData.webhooks.DRIVER_LOCATION_UPDATE.payload_template} onChange={e => handleWebhookChange('DRIVER_LOCATION_UPDATE', 'payload_template', e.target.value)} rows="5" placeholder="Template del Payload JSON" className="w-full border p-2 rounded-lg font-mono text-xs bg-slate-50"/>
                        <p className="text-xs text-slate-500">Variables disponibles: <code className="bg-slate-100 p-1 rounded">{'{{id_externo}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{repartidor_id}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{latitud}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{longitud}}'}</code> <code className="bg-slate-100 p-1 rounded">{'{{bateria_porcentaje}}'}</code></p>
                    </div>
                </div>
                <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-400">
                        <Save size={16} /> {loading ? 'Guardando...' : 'Guardar'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default IntegrationModal;