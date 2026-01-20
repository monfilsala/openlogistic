import React, { useState, useEffect } from 'react';
import apiClient from '../../api/axiosConfig';
import { Share2, Plus, Edit, Trash2 } from 'lucide-react';
import IntegrationModal from './components/IntegrationModal';

const IntegrationsPage = () => {
    const [integrations, setIntegrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedIntegration, setSelectedIntegration] = useState(null);

    const fetchIntegrations = () => {
        setLoading(true);
        apiClient.get('/integrations')
            .then(res => setIntegrations(res.data))
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchIntegrations();
    }, []);

    const handleOpenModal = (integration = null) => {
        setSelectedIntegration(integration);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedIntegration(null);
    };

    // --- CORRECCIÓN CLAVE ---
    // Esta función se llama después de cualquier acción exitosa en el modal.
    const handleActionSuccess = () => {
        handleCloseModal(); // Cierra el modal
        fetchIntegrations(); // Y luego refresca la lista.
    };

    const handleDelete = async (integration) => {
        if (window.confirm(`¿Seguro que quieres eliminar la integración "${integration.name}"?`)) {
            try {
                await apiClient.delete(`/integrations/${integration.id}`);
                fetchIntegrations();
                alert("Integración eliminada.");
            } catch (error) {
                alert("Error al eliminar: " + (error.response?.data?.detail || error.message));
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow-sm border">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Integraciones API (Webhooks)</h1>
                    <p className="text-sm text-slate-500">Conecta tu sistema con plataformas externas para notificar cambios de estado.</p>
                </div>
                <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-medium">
                    <Plus size={20} /> Nueva Integración
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
                        <tr>
                            <th className="px-6 py-4">Nombre</th>
                            <th className="px-6 py-4">Prefijo de ID</th>
                            <th className="px-6 py-4">Estado</th>
                            <th className="px-6 py-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan="4" className="text-center py-10 text-slate-400">Cargando...</td></tr>
                        ) : integrations.map(integration => (
                            <tr key={integration.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-semibold text-slate-800">{integration.name}</td>
                                <td className="px-6 py-4 font-mono text-slate-500">{integration.id_externo_prefix}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${integration.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {integration.is_active ? 'Activa' : 'Inactiva'}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-2">
                                        <button onClick={() => handleOpenModal(integration)} title="Modificar" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Edit size={16} /></button>
                                        <button onClick={() => handleDelete(integration)} title="Eliminar" className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 size={16} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <IntegrationModal
                    isOpen={isModalOpen}
                    onClose={handleCloseModal}
                    // La prop 'onSave' ahora se llama 'onSuccess' para ser más genérica
                    onSuccess={fetchIntegrations}
                    // Y pasamos una prop específica para cuando el formulario principal se guarda
                    onFormSubmitSuccess={handleActionSuccess}
                    integration={selectedIntegration}
                />
            )}
        </div>
    );
};

export default IntegrationsPage;