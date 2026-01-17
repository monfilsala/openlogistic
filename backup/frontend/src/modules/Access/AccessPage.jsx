import React, { useState, useEffect } from 'react';
import apiClient from '../../api/axiosConfig';
import { Shield, UserPlus, Edit, Trash2 } from 'lucide-react';
import UserAccessModal from './components/UserAccessModal';

const AccessPage = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);

    const fetchUsers = () => {
        setLoading(true);
        apiClient.get('/admin/users')
            .then(res => {
                // Ordenar por fecha de creación, más reciente primero
                const sortedUsers = res.data.sort((a, b) => b.creation_timestamp - a.creation_timestamp);
                setUsers(sortedUsers);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleOpenModal = (user = null) => {
        setSelectedUser(user);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedUser(null);
    };

    const handleSave = () => {
        handleCloseModal();
        fetchUsers(); // Recargar la lista de usuarios para ver los cambios
    };

    const handleDelete = async (user) => {
        if (window.confirm(`¿Estás seguro de que quieres eliminar permanentemente al usuario ${user.email}? Esta acción no se puede deshacer.`)) {
            try {
                await apiClient.delete(`/admin/users/${user.uid}`);
                fetchUsers();
                alert("Usuario eliminado con éxito.");
            } catch (error) {
                alert("Error al eliminar: " + (error.response?.data?.detail || error.message));
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Shield size={24} /> Gestión de Accesos</h1>
                    <p className="text-sm text-slate-500">Administra todos los usuarios del sistema (Firebase).</p>
                </div>
                <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-medium">
                    <UserPlus size={20} /> Nuevo Usuario
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
                        <tr>
                            <th className="px-6 py-4">Email / ID de Usuario</th>
                            <th className="px-6 py-4">Nombre para Mostrar</th>
                            <th className="px-6 py-4">UID de Firebase</th>
                            <th className="px-6 py-4">Estado</th>
                            <th className="px-6 py-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan="5" className="text-center py-10 text-slate-400">Cargando usuarios...</td></tr>
                        ) : users.map(user => (
                            <tr key={user.uid} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-semibold text-slate-800">{user.email}</td>
                                <td className="px-6 py-4 text-slate-600">{user.display_name || '--'}</td>
                                <td className="px-6 py-4 font-mono text-xs text-slate-400">{user.uid}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${user.disabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                        {user.disabled ? 'Deshabilitado' : 'Habilitado'}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-2">
                                        <button onClick={() => handleOpenModal(user)} title="Gestionar" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Edit size={16} /></button>
                                        <button onClick={() => handleDelete(user)} title="Eliminar" className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 size={16} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <UserAccessModal
                    isOpen={isModalOpen}
                    onClose={handleCloseModal}
                    onSave={handleSave}
                    user={selectedUser}
                />
            )}
        </div>
    );
};

export default AccessPage;