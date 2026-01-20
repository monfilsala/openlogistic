import React, { useState, useEffect } from 'react';
import apiClient from '../../api/axiosConfig';
import { Store, Plus, Edit, Trash2, MapPin, Phone } from 'lucide-react';
import MerchantModal from './components/MerchantModal'; // Crearemos este componente a continuación

const MerchantsPage = () => {
    const [merchants, setMerchants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMerchant, setEditingMerchant] = useState(null);

    const fetchMerchants = () => {
        setLoading(true);
        apiClient.get('/comercios')
            .then(res => setMerchants(res.data))
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchMerchants();
    }, []);

    const handleOpenModal = (merchant = null) => {
        setEditingMerchant(merchant);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingMerchant(null);
    };

    const handleSave = () => {
        handleCloseModal();
        fetchMerchants(); // Recargar la lista después de guardar
    };

    const handleDelete = async (merchantId) => {
        if (window.confirm(`¿Estás seguro de que quieres eliminar el comercio ${merchantId}?`)) {
            try {
                await apiClient.delete(`/comercios/${merchantId}`);
                fetchMerchants(); // Recargar la lista
                alert("Comercio eliminado con éxito.");
            } catch (error) {
                alert("Error al eliminar: " + (error.response?.data?.detail || error.message));
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow-sm border">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Store size={24} /> Gestión de Comercios</h1>
                    <p className="text-sm text-slate-500">Administra los puntos de retiro de tus clientes.</p>
                </div>
                <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-medium">
                    <Plus size={20} /> Crear Comercio
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
                        <tr>
                            <th className="px-6 py-4">ID Comercio</th>
                            <th className="px-6 py-4">Nombre</th>
                            <th className="px-6 py-4">Contacto</th>
                            <th className="px-6 py-4">Coordenadas</th>
                            <th className="px-6 py-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan="5" className="text-center py-10 text-slate-400">Cargando...</td></tr>
                        ) : merchants.map(merchant => (
                            <tr key={merchant.id_comercio} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-mono text-slate-500">{merchant.id_comercio}</td>
                                <td className="px-6 py-4 font-semibold text-slate-800">{merchant.nombre}</td>
                                <td className="px-6 py-4">
                                    {merchant.numero_contacto && <div className="flex items-center gap-2 text-slate-600"><Phone size={14} /> {merchant.numero_contacto}</div>}
                                </td>
                                <td className="px-6 py-4">
                                    {merchant.latitud && merchant.longitud && <div className="flex items-center gap-2 text-slate-600"><MapPin size={14} /> {`${merchant.latitud}, ${merchant.longitud}`}</div>}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-2">
                                        <button onClick={() => handleOpenModal(merchant)} title="Modificar" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Edit size={16} /></button>
                                        <button onClick={() => handleDelete(merchant.id_comercio)} title="Eliminar" className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 size={16} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <MerchantModal
                    isOpen={isModalOpen}
                    onClose={handleCloseModal}
                    onSave={handleSave}
                    editingMerchant={editingMerchant}
                />
            )}
        </div>
    );
};

export default MerchantsPage;