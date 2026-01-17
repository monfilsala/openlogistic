import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { X, Save, User, Key, Percent, AlertTriangle, Mail } from 'lucide-react';

const DriverAdminModal = ({ isOpen, onClose, onSave, driver }) => {
    // Variable booleana para saber si estamos editando o creando
    const isEditMode = !!driver;

    const [formData, setFormData] = useState({
        email: '',
        nombre_display: '',
        password: '',
        porcentaje_comision: 0,
        disabled: false,
    });
    const [loading, setLoading] = useState(false);
    const [firebaseUser, setFirebaseUser] = useState(null);

    // Este efecto se ejecuta cuando el modal se abre o el 'driver' a editar cambia
    useEffect(() => {
        if (isEditMode && driver) { // MODO EDICIÓN
            setFormData({
                email: driver.id_usuario || '',
                nombre_display: driver.nombre_display || '',
                password: '', // La contraseña nunca se precarga
                porcentaje_comision: driver.porcentaje_comision || 0,
                disabled: false, // El valor real se cargará desde Firebase
            });

            // Buscamos el usuario de Firebase para obtener su UID y estado 'disabled'
            apiClient.get('/admin/users').then(res => {
                const user = res.data.find(u => u.email === driver.id_usuario);
                if (user) {
                    setFirebaseUser(user);
                    setFormData(prev => ({ ...prev, disabled: user.disabled }));
                }
            }).catch(err => console.error("No se pudo obtener el usuario de Firebase:", err));

        } else { // MODO CREACIÓN
            setFormData({
                email: '',
                nombre_display: '',
                password: '',
                porcentaje_comision: 0,
                disabled: false,
            });
            setFirebaseUser(null);
        }
    }, [driver, isEditMode]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isEditMode) {
                // --- LÓGICA DE EDICIÓN ---
                const promises = [];

                // 1. Actualizar datos de Firebase (nombre, estado disabled)
                if (firebaseUser) {
                    const firebasePayload = {};
                    if (formData.nombre_display !== driver.nombre_display) {
                        firebasePayload.display_name = formData.nombre_display;
                    }
                    if (formData.disabled !== firebaseUser.disabled) {
                        firebasePayload.disabled = formData.disabled;
                    }
                    if (Object.keys(firebasePayload).length > 0) {
                        promises.push(apiClient.put(`/admin/users/${firebaseUser.uid}`, firebasePayload));
                    }
                    if (formData.password) {
                        if (formData.password.length < 6) throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
                        promises.push(apiClient.post(`/admin/users/${firebaseUser.uid}/password`, { new_password: formData.password }));
                    }
                }
                
                // 2. Actualizar comisión en la BD local
                if (parseFloat(formData.porcentaje_comision) !== driver.porcentaje_comision) {
                     promises.push(apiClient.put(`/usuarios/${driver.id_usuario}/comision`, { porcentaje_comision: parseFloat(formData.porcentaje_comision) }));
                }
                
                // 3. Actualizar nombre en la BD local
                if (formData.nombre_display !== driver.nombre_display) {
                    promises.push(apiClient.put(`/usuarios/${driver.id_usuario}/profile`, { nombre_display: formData.nombre_display }));
                }

                await Promise.all(promises);
                alert('Repartidor actualizado con éxito.');

            } else {
                // --- LÓGICA DE CREACIÓN ---
                if (!formData.email || !formData.password || !formData.nombre_display) {
                    throw new Error('Email, contraseña y nombre son requeridos.');
                }
                await apiClient.post('/admin/users', {
                    email: formData.email,
                    password: formData.password,
                    display_name: formData.nombre_display,
                });
                
                // Asignar nombre y comisión en la base de datos local
                await apiClient.put(`/usuarios/${formData.email}/profile`, { nombre_display: formData.nombre_display });
                if (formData.porcentaje_comision > 0) {
                    await apiClient.put(`/usuarios/${formData.email}/comision`, { porcentaje_comision: parseFloat(formData.porcentaje_comision) });
                }
                alert('Repartidor creado con éxito.');
            }
            onSave(); // Llama a la función del padre para cerrar y refrescar
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
                        <h3 className="font-bold text-lg">{isEditMode ? 'Editar Repartidor' : 'Crear Nuevo Repartidor'}</h3>
                        <p className="text-xs text-slate-500">{isEditMode ? formData.email : 'Complete los datos para el nuevo acceso'}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
                </div>
                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Campos Principales */}
                    <div className="space-y-2">
                        <label className="font-semibold text-sm flex items-center gap-2"><Mail size={16}/> Email (ID de Usuario)</label>
                        <input type="email" name="email" value={formData.email} onChange={handleChange} required disabled={isEditMode} className="w-full border p-2 rounded-lg disabled:bg-slate-100" />
                    </div>
                     <div className="space-y-2">
                        <label className="font-semibold text-sm flex items-center gap-2"><User size={16}/> Nombre para Mostrar</label>
                        <input type="text" name="nombre_display" value={formData.nombre_display} onChange={handleChange} required className="w-full border p-2 rounded-lg" />
                    </div>
                    <div className="space-y-2">
                        <label className="font-semibold text-sm flex items-center gap-2"><Key size={16}/> Contraseña</label>
                        <input type="password" name="password" value={formData.password} onChange={handleChange} required={!isEditMode} placeholder={isEditMode ? 'Dejar en blanco para no cambiar' : 'Mínimo 6 caracteres'} className="w-full border p-2 rounded-lg"/>
                    </div>
                    
                    <div className="space-y-2 pt-4 border-t">
                        <label className="font-semibold text-sm flex items-center gap-2"><Percent size={16}/> Comisión (%)</label>
                        <input type="number" name="porcentaje_comision" value={formData.porcentaje_comision} onChange={handleChange} className="w-full border p-2 rounded-lg" />
                    </div>

                    {/* Campos que solo aparecen en modo Edición */}
                    {isEditMode && (
                        <div className="space-y-3 pt-4 border-t">
                            <label className="font-semibold text-sm flex items-center gap-2"><AlertTriangle size={16} className="text-red-500"/> Zona de Riesgo</label>
                            <button type="button" onClick={handleToggleAccount} disabled={loading} className={`w-full p-3 font-bold rounded-lg ${formData.disabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {formData.disabled ? 'Habilitar Cuenta' : 'Deshabilitar Cuenta'}
                            </button>
                        </div>
                    )}
                </div>
                 <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-400">
                        <Save size={16} /> {loading ? 'Guardando...' : (isEditMode ? 'Guardar Cambios' : 'Crear Repartidor')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default DriverAdminModal;