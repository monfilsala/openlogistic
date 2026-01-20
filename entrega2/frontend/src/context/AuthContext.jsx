import React, { createContext, useState, useEffect, useContext } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import apiClient from '../api/axiosConfig';

export const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

const fetchPermissionsForRole = async (role) => {
    try {
        const res = await apiClient.get('/config/user_roles_permissions');
        return res.data[role] || [];
    } catch (error) {
        console.error("No se pudo cargar la configuración de permisos:", error);
        return [];
    }
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState([]);

  const fetchAllUsers = async () => {
    try {
        const res = await apiClient.get('/admin/users');
        const sortedUsers = res.data.sort((a, b) => (a.email > b.email) ? 1 : -1);
        setAllUsers(sortedUsers);
    } catch (error) {
        console.error("No se pudieron cargar los usuarios:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      if (user) {
        const tokenResult = await user.getIdTokenResult(true);
        const role = tokenResult.claims.role || 'viewer';
        const userPermissions = await fetchPermissionsForRole(role);
        const userProfile = { uid: user.uid, email: user.email, displayName: user.displayName, role: role };

        setCurrentUser(userProfile);
        setPermissions(userPermissions);
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${tokenResult.token}`;
        await fetchAllUsers();
      } else {
        setCurrentUser(null);
        setPermissions([]);
        setAllUsers([]);
        delete apiClient.defaults.headers.common['Authorization'];
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email, password) => await signInWithEmailAndPassword(auth, email, password);
  const logout = async () => await signOut(auth);
  const hasPermission = (requiredPermission) => permissions.includes('access:all') || permissions.includes(requiredPermission);

  const refreshUserPermissions = async () => {
    const user = auth.currentUser;
    if (user) {
      setLoading(true);
      try {
        const tokenResult = await user.getIdTokenResult(true);
        const role = tokenResult.claims.role || 'viewer';
        const userPermissions = await fetchPermissionsForRole(role);
        const userProfile = { uid: user.uid, email: user.email, displayName: user.displayName, role: role };
        
        setCurrentUser(userProfile);
        setPermissions(userPermissions);
        
        await fetchAllUsers();
      } catch (error) {
        console.error("Error al refrescar los permisos del usuario:", error);
      } finally {
        setLoading(false);
      }
    }
  };

  const value = { currentUser, permissions, hasPermission, allUsers, fetchAllUsers, setAllUsers, login, logout, loading, refreshUserPermissions };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};