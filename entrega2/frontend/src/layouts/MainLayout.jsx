import React, { useState, useEffect, useContext, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { WebSocketContext } from '../context/WebSocketContext';
import { AlertTriangle, X } from 'lucide-react';

// --- INICIO DE LA CORRECCIÓN 1: AlertToast ahora es consciente de los colores ---

// Función helper para obtener los estilos según el tipo de alerta
const getAlertStyles = (type) => {
  switch (type) {
    case 'pending':
      return {
        bgColor: 'bg-yellow-400',
        textColor: 'text-yellow-900',
        iconColor: 'text-yellow-800'
      };
    case 'accepted':
    case 'in_progress':
      return {
        bgColor: 'bg-red-500',
        textColor: 'text-white',
        iconColor: 'text-red-200'
      };
    case 'ticket':
      return {
        bgColor: 'bg-purple-500',
        textColor: 'text-white',
        iconColor: 'text-purple-200'
      };
    default:
      return {
        bgColor: 'bg-slate-500',
        textColor: 'text-white',
        iconColor: 'text-slate-200'
      };
  }
};

const AlertToast = ({ alert, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(alert.id);
    }, 5000); // Desaparece después de 5 segundos
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  const styles = getAlertStyles(alert.type);

  return (
    <div className={`${styles.bgColor} ${styles.textColor} font-bold p-4 rounded-lg shadow-2xl flex items-start gap-4 animate-in slide-in-from-top`}>
      <AlertTriangle size={24} className={`${styles.iconColor} mt-1 flex-shrink-0`} />
      <div className="flex-1">
        <p className="text-sm">{alert.message}</p>
      </div>
      <button onClick={() => onDismiss(alert.id)} className="flex-shrink-0 opacity-70 hover:opacity-100">
        <X size={18} />
      </button>
    </div>
  );
};
// --- FIN DE LA CORRECCIÓN 1 ---


const MainLayout = () => {
  const { liveOrders, alertConfig, lastMessage } = useContext(WebSocketContext);
  const [alerts, setAlerts] = useState([]);
  const audioRef = useRef(null);

  // Efecto para las alertas basadas en tiempo (pedidos demorados)
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (!liveOrders || !alertConfig) return;

      const now = new Date();
      const newAlerts = [];

      liveOrders.forEach(order => {
        // Usamos fecha_actualizacion para ser más precisos con el último cambio de estado
        const timeDiffMinutes = (now - new Date(order.fecha_actualizacion)) / 60000;
        
        let threshold = null;
        let message = '';
        let type = ''; // <-- Almacenamos el tipo de alerta

        if (order.estado === 'pendiente' && timeDiffMinutes > alertConfig.pending) {
          threshold = alertConfig.pending;
          message = `Pedido #${order.id} lleva PENDIENTE más de ${threshold} min.`;
          type = 'pending';
        } else if (order.estado === 'aceptado' && timeDiffMinutes > alertConfig.accepted) {
          threshold = alertConfig.accepted;
          message = `Pedido #${order.id} lleva ACEPTADO más de ${threshold} min. sin moverse.`;
          type = 'accepted';
        } else if (['retirando', 'llevando'].includes(order.estado) && timeDiffMinutes > alertConfig.in_progress) {
          threshold = alertConfig.in_progress;
          message = `Pedido #${order.id} lleva EN PROGRESO más de ${threshold} min.`;
          type = 'in_progress';
        }

        // --- INICIO DE LA CORRECCIÓN 2: Añadir el 'type' al objeto de la alerta ---
        if (message && !alerts.some(a => a.id === order.id)) {
          newAlerts.push({ id: order.id, message, type }); // <-- Se añade 'type'
        }
        // --- FIN DE LA CORRECCIÓN 2 ---
      });

      if (newAlerts.length > 0) {
        setAlerts(prev => [...prev, ...newAlerts]);
        audioRef.current?.play().catch(e => console.warn("El navegador bloqueó la reproducción automática de audio."));
      }
    }, 30000);

    return () => clearInterval(checkInterval);
  }, [liveOrders, alertConfig, alerts]);

  // Efecto para las alertas basadas en eventos (nuevos tickets)
  useEffect(() => {
    if (lastMessage?.type === 'NEW_TICKET' && alertConfig?.new_support_ticket) {
      // --- INICIO DE LA CORRECCIÓN 3: Añadir el 'type' a la alerta de ticket ---
      const newAlert = { 
        id: `ticket-${Date.now()}`, 
        message: `¡Nuevo ticket de soporte recibido! ID: ${lastMessage.data.id_ticket}`,
        type: 'ticket' // <-- Se añade 'type'
      };
      // --- FIN DE LA CORRECCIÓN 3 ---
      setAlerts(prev => [...prev, newAlert]);
      audioRef.current?.play().catch(e => console.warn("El navegador bloqueó la reproducción automática de audio."));
    }
  }, [lastMessage, alertConfig]);

  const dismissAlert = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };
  
  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <Outlet />
      </main>

      <div className="fixed top-5 right-5 z-[99999] space-y-3 w-96">
        {alerts.map(alert => (
          <AlertToast key={alert.id} alert={alert} onDismiss={dismissAlert} />
        ))}
      </div>
      
      <audio ref={audioRef} src="/alert-sound.mp3" preload="auto"></audio>
    </div>
  );
};

export default MainLayout;