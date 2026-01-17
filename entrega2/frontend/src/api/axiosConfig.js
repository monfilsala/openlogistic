import axios from 'axios';

const apiClient = axios.create({
    baseURL: '/api'
});

// Interceptor para AÑADIR el token a CADA petición
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Interceptor para MANEJAR tokens expirados (error 401)
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            console.log("Token expirado o inválido. Redirigiendo al login.");
            localStorage.removeItem('authToken');
            // Redirige al login. La página se recargará completamente.
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default apiClient;