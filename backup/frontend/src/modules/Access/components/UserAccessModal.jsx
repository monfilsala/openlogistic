import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { X, Save, User, Key, Mail, AlertTriangle } from 'lucide-react';

const UserAccessModal = ({ isOpen, onClose, onSave, user }) => {
    const isEditMode = !!user;
    const [formData, setFormData] = useState({
        email: '',
        display_name: '',
        password: '',
        disabled: false
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isEditMode && user) {
            setFormData({
                email: user.email || '',
                display_name: user.display_name || '',
                password: '', // Siempre vacío por seguridad
                disabled: user.disabled || false,
            });
        } else {
            setFormData({ email: '', display_name: '', password: '', disabled: false });
        }
    }, [user, isEditMode]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isEditMode) {
                const promises = [];
                const updatePayload = {};

                if (formData.display_name !== user.display_name) {
                    updatePayload.display_name = formData.display_name;
                }
                if (formData.disabled !== user.disabled) {
                    updatePayload.disabled = formData.disabled;
                }
                if (Object.keys(updatePayload).length > 0) {
                    promises.push(apiClient.put(`/admin/users/${user.uid}`, updatePayload));
                }
                if (formData.password) {
                    if (formData.password.length < 6) throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
                    promises.push(apiClient.post(`/admin/users/${user.uid}/password`, { new_password: formData.password }));
                }

                await Promise.all(promises);
                alert('Usuario actualizado con éxito.');
            } else {
                if (!formData.email || !formData.password || !formData.display_name) {
                    throw new Error('Email, contraseña y nombre son requeridos.');
                }
                await apiClient.post('/admin/users', {
                    email: formData.email,
                    password: formData.password,
                    display_name: formData.display_name
                });
                alert('Usuario creado con éxito.');
            }
            onSave();
        } catch (error) {
            alert('Error: ' + (error.response?.data?.detail || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleToggleAccount = () => {
        setFormData(prev => ({ ...prev, disabled: !prev.disabled }));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                <div className="p-4 border-b flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-lg">{isEditMode ? 'Gestionar Usuario' : 'Crear Nuevo Usuario'}</h3>
                        <p className="text-xs text-slate-500">{isEditMode ? user.email : 'Complete los datos de la nueva cuenta'}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
                </div>
                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    <div className="space-y-2">
                        <label className="font-semibold text-sm flex items-center gap-2"><Mail size={16}/> Email</label>
                        <input type="email" name="email" value={formData.email} onChange={handleChange} required disabled={isEditMode} className="w-full border p-2 rounded-lg disabled:bg-slate-100" />
                    </div>
                    <div className="space-y-2">
                        <label className="font-semibold text-sm flex items-center gap-2"><User size={16}/> Nombre para Mostrar</label>
                        <input type="text" name="display_name" value={formData.display_name} onChange={handleChange} required className="w-full border p-2 rounded-lg" />
                    </div>
                    <div className="space-y-2">
                        <label className="font-semibold text-sm flex items-center gap-2"><Key size={16}/> Contraseña</label>
                        <input type="password" name="password" value={formData.password} onChange={handleChange} required={!isEditMode} placeholder={isEditMode ? 'Dejar en blanco para no cambiar' : 'Mínimo 6 caracteres'} className="w-full border p-2 rounded-lg"/>
                    </div>
                    {isEditMode && (
                        <div className="space-y-3 pt-4 border-t">
                            <label className="font-semibold text-sm flex items-center gap-2"><AlertTriangle size={16} className="text-red-500"/> Estado de la Cuenta</label>
                            <button type="button" onClick={handleToggleAccount} disabled={loading} className={`w-full p-3 font-bold rounded-lg ${formData.disabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                {formData.disabled ? 'Cuenta Deshabilitada (Hacer clic para Habilitar)' : 'Cuenta Habilitada (Hacer clic para Deshabilitar)'}
                            </button>
                        </div>
                    )}
                </div>
                <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-400">
                        <Save size={16} /> {loading ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default UserAccessModal;