import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/axiosConfig';
import { useAuth } from '../../../context/AuthContext';
import { X, Save, User, Key, Mail, AlertTriangle, ShieldCheck } from 'lucide-react';

const UserAccessModal = ({ onClose, onSave, user }) => {
    const isEditMode = !!user;
    const { currentUser, hasPermission, refreshUserPermissions } = useAuth();
    const canManageRoles = hasPermission('access:all');

    const [formData, setFormData] = useState({
        email: '',
        display_name: '',
        password: '',
        disabled: false,
        role: 'viewer'
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isEditMode && user) {
            // Si estamos editando al usuario actual, usamos el rol del AuthContext para asegurar que sea el más reciente.
            const initialRole = user.uid === currentUser.uid ? currentUser.role : user.role;
            setFormData({
                email: user.email || '',
                display_name: user.display_name || '',
                password: '',
                disabled: user.disabled || false,
                role: initialRole || 'viewer'
            });
        } else {
            // Modo Creación: estado inicial limpio
            setFormData({ email: '', display_name: '', password: '', disabled: false, role: 'viewer' });
        }
    }, [user, isEditMode, currentUser]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isEditMode) {
                const promises = [];
                // Preparar payload para actualizar datos de Firebase
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

                // Preparar promesa para actualizar contraseña si se ingresó una nueva
                if (formData.password) {
                    if (formData.password.length < 6) throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
                    promises.push(apiClient.post(`/admin/users/${user.uid}/password`, { new_password: formData.password }));
                }

                // Preparar promesa para actualizar rol si cambió y el usuario tiene permiso
                if (canManageRoles && formData.role !== user.role) {
                    promises.push(apiClient.post(`/admin/users/${user.uid}/role`, { role: formData.role }));
                }

                await Promise.all(promises);
                
                // Si el usuario modificado es el actual, refrescamos su propio contexto para ver los cambios de permisos al instante
                if (currentUser.uid === user.uid) {
                    await refreshUserPermissions();
                }
                
                alert('Usuario actualizado con éxito.');
            } else {
                // Lógica de Creación
                if (!formData.email || !formData.password || !formData.display_name) {
                    throw new Error('Email, contraseña y nombre son requeridos.');
                }
                // 1. Crear usuario en Firebase
                const newUserRes = await apiClient.post('/admin/users', {
                    email: formData.email,
                    password: formData.password,
                    display_name: formData.display_name
                });
                const newUserUid = newUserRes.data.uid;

                // 2. Asignar rol si es diferente de 'viewer'
                if (newUserUid && canManageRoles && formData.role !== 'viewer') {
                    await apiClient.post(`/admin/users/${newUserUid}/role`, { role: formData.role });
                }
                alert('Usuario creado con éxito.');
            }
            onSave(); // Llama a la función del padre que cierra el modal y refresca la lista
        } catch (error) {
            alert('Error: ' + (error.response?.data?.detail || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleToggleAccount = () => {
        setFormData(prev => ({ ...prev, disabled: !prev.disabled }));
    };
    
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                <div className="p-4 border-b flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-lg">{isEditMode ? 'Gestionar Usuario' : 'Crear Nuevo Usuario'}</h3>
                        <p className="text-xs text-slate-500">{isEditMode && user ? user.email : 'Complete los datos de la nueva cuenta'}</p>
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
                    
                    {canManageRoles && (
                        <div className="space-y-2 pt-4 border-t">
                            <label className="font-semibold text-sm flex items-center gap-2"><ShieldCheck size={16}/> Rol del Usuario</label>
                            <select
                                name="role"
                                value={formData.role}
                                onChange={handleChange}
                                className="w-full border p-2 rounded-lg bg-white"
                            >
                                <option value="superadmin">Superadmin</option>
                                <option value="admin">Admin</option>
                                <option value="operator">Operator</option>
                                <option value="support">Support</option>
                                <option value="viewer">Viewer</option>
                                <option value="bloqueado">Bloqueado</option>
                            </select>
                        </div>
                    )}
                    
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