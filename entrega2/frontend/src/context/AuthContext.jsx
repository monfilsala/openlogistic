import React, { createContext, useState, useContext } from 'react';
import { auth } from '../firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import apiClient from '../api/axiosConfig';

export const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

// Función HELPER modificada: Ahora lee un objeto de perfil, no solo el token.
const getInitialUser = () => {
    try {
        const token = localStorage.getItem('authToken');
        const userProfileString = localStorage.getItem('userProfile');

        if (!token || !userProfileString) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userProfile');
            return null;
        }

        // Validar que el token no haya expirado
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (Date.now() >= payload.exp * 1000) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userProfile');
            return null;
        }

        // Si el token es válido, confiamos en el perfil guardado en localStorage
        return JSON.parse(userProfileString);
    } catch {
        // Si hay cualquier error de parseo, limpiar todo
        localStorage.removeItem('authToken');
        localStorage.removeItem('userProfile');
        return null;
    }
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(getInitialUser());

  const login = async (email, password) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const tokenResult = await userCredential.user.getIdTokenResult(true);
    const token = tokenResult.token;
    
    // CORRECCIÓN CLAVE: Crear y guardar un objeto de perfil completo
    const userProfile = { 
        email: userCredential.user.email,
        displayName: userCredential.user.displayName, // Incluimos el nombre para mostrar
        role: tokenResult.claims.role || 'viewer' 
    };

    localStorage.setItem('authToken', token);
    localStorage.setItem('userProfile', JSON.stringify(userProfile)); // Guardamos el perfil completo
    
    setCurrentUser(userProfile);
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  };

  const logout = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error en signOut de Firebase:", error);
    } finally {
        // CORRECCIÓN CLAVE: Limpiar también el perfil del localStorage
        localStorage.removeItem('authToken');
        localStorage.removeItem('userProfile'); 
        delete apiClient.defaults.headers.common['Authorization'];
        setCurrentUser(null);
        window.location.href = '/login';
    }
  };

  const value = { currentUser, login, logout };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};