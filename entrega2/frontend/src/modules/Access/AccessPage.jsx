import React, { useState, useEffect } from 'react';
import apiClient from '../../api/axiosConfig';
import { useAuth } from '../../context/AuthContext';
import { Shield, UserPlus, Edit, Trash2, RefreshCw } from 'lucide-react';
import UserAccessModal from './components/UserAccessModal';

const AccessPage = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);

    const { hasPermission } = useAuth();
    const canManageAccess = hasPermission('access:all');

    const fetchUsers = () => {
        setLoading(true);
        apiClient.get('/admin/users')
            .then(res => setUsers(res.data))
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleSync = async () => {
        setSyncing(true);
        try {
            await apiClient.post('/admin/users/sync');
            fetchUsers();
            alert("Sincronización con Firebase completada.");
        } catch (error) {
            alert("Error durante la sincronización: " + error.message);
        } finally {
            setSyncing(false);
        }
    };
    
    const handleOpenModal = (user = null) => { setSelectedUser(user); setIsModalOpen(true); };
    const handleCloseModal = () => { setIsModalOpen(false); setSelectedUser(null); };
    const handleSave = () => { handleCloseModal(); fetchUsers(); };
    const handleDelete = async (user) => { /* ... (sin cambios) */ };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow-sm border">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Gestión de Accesos</h1>
                    <p className="text-sm text-slate-500">Administra los usuarios del panel de control.</p>
                </div>
                <div className="flex items-center gap-4">
                    {canManageAccess && (
                        <button onClick={handleSync} disabled={syncing} title="Sincronizar con Firebase" className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
                            <RefreshCw size={20} className={syncing ? 'animate-spin' : ''}/>
                        </button>
                    )}
                    {canManageAccess && (
                        <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-medium">
                            <UserPlus size={20} /> Nuevo Usuario
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
                        <tr>
                            <th className="px-6 py-4">Email</th>
                            <th className="px-6 py-4">Nombre</th>
                            <th className="px-6 py-4">Rol</th>
                            <th className="px-6 py-4">Estado</th>
                            <th className="px-6 py-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? ( <tr><td colSpan="5" className="text-center py-10 text-slate-400">Cargando...</td></tr> ) : (
                            users.map(user => (
                                <tr key={user.uid}>
                                    <td className="px-6 py-4 font-semibold text-slate-800">{user.email}</td>
                                    <td className="px-6 py-4 text-slate-600">{user.display_name || '--'}</td>
                                    <td className="px-6 py-4 font-medium capitalize text-slate-700">{user.role || 'viewer'}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${user.disabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                            {user.disabled ? 'Deshabilitado' : 'Habilitado'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center justify-center gap-2">
                                            {canManageAccess && <>
                                                <button onClick={() => handleOpenModal(user)} title="Gestionar" className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Edit size={16} /></button>
                                                <button onClick={() => handleDelete(user)} title="Eliminar" className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 size={16} /></button>
                                            </>}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && ( <UserAccessModal onClose={handleCloseModal} onSave={handleSave} user={selectedUser} /> )}
        </div>
    );
};

export default AccessPage;