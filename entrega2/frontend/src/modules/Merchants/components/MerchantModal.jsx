import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { X, Save } from 'lucide-react';

const InputField = ({ label, ...props }) => (
    <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
        <input
            {...props}
            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
    </div>
);

const MerchantModal = ({ isOpen, onClose, onSave, editingMerchant }) => {
    const [formData, setFormData] = useState({
        id_comercio: '',
        nombre: '',
        latitud: '',
        longitud: '',
        numero_contacto: '',
        direccion: '',
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (editingMerchant) {
            setFormData({
                id_comercio: editingMerchant.id_comercio || '',
                nombre: editingMerchant.nombre || '',
                latitud: editingMerchant.latitud || '',
                longitud: editingMerchant.longitud || '',
                numero_contacto: editingMerchant.numero_contacto || '',
                direccion: editingMerchant.direccion || '',
            });
        } else {
            setFormData({ id_comercio: '', nombre: '', latitud: '', longitud: '', numero_contacto: '', direccion: '' });
        }
    }, [editingMerchant]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        // Preparamos el payload, convirtiendo coordenadas a float
        const payload = {
            ...formData,
            latitud: parseFloat(formData.latitud) || null,
            longitud: parseFloat(formData.longitud) || null,
        };

        try {
            if (editingMerchant) {
                // Modo Edición (PUT)
                await apiClient.put(`/comercios/${editingMerchant.id_comercio}`, payload);
            } else {
                // Modo Creación (POST)
                await apiClient.post('/comercios', payload);
            }
            onSave();
        } catch (error) {
            alert("Error al guardar: " + (error.response?.data?.detail || error.message));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-4 border-b flex justify-between items-center">
                        <h3 className="font-bold text-lg">{editingMerchant ? 'Modificar Comercio' : 'Crear Nuevo Comercio'}</h3>
                        <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
                    </div>
                    <div className="p-6 space-y-4">
                        <InputField label="ID del Comercio" name="id_comercio" value={formData.id_comercio} onChange={handleChange} required disabled={!!editingMerchant} placeholder="ej: comercio_pizza_01" />
                        <InputField label="Nombre del Comercio" name="nombre" value={formData.nombre} onChange={handleChange} required />
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="Latitud" name="latitud" type="number" step="any" value={formData.latitud} onChange={handleChange} placeholder="10.4806" />
                            <InputField label="Longitud" name="longitud" type="number" step="any" value={formData.longitud} onChange={handleChange} placeholder="-66.9036" />
                        </div>
                        <InputField label="Teléfono de Contacto" name="numero_contacto" value={formData.numero_contacto} onChange={handleChange} />
                        <InputField label="Dirección (Opcional)" name="direccion" value={formData.direccion} onChange={handleChange} />
                    </div>
                    <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                        <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-400">
                            <Save size={16} /> {loading ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MerchantModal;