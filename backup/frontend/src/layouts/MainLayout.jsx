import React, { useState, useEffect, useContext, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { WebSocketContext } from '../context/WebSocketContext';
import { AlertTriangle, X } from 'lucide-react';

// --- Componente para una Alerta (Toast) ---
const AlertToast = ({ alert, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(alert.id);
    }, 5000); // Desaparece después de 5 segundos
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  return (
    <div className="bg-yellow-400 text-slate-900 font-bold p-4 rounded-lg shadow-2xl flex items-start gap-4 animate-in slide-in-from-top">
      <AlertTriangle size={24} className="mt-1 flex-shrink-0"/>
      <div className="flex-1">
        <p className="text-sm">{alert.message}</p>
      </div>
      <button onClick={() => onDismiss(alert.id)} className="flex-shrink-0"><X size={18}/></button>
    </div>
  );
};

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
        // Usamos fecha_creacion como un proxy. Una mejor implementación usaría una fecha de "último cambio de estado".
        const timeDiffMinutes = (now - new Date(order.fecha_creacion)) / 60000;
        
        let threshold = null;
        let message = '';

        if (order.estado === 'pendiente' && timeDiffMinutes > alertConfig.pending) {
          threshold = alertConfig.pending;
          message = `Pedido #${order.id} lleva PENDIENTE más de ${threshold} min.`;
        } else if (order.estado === 'aceptado' && timeDiffMinutes > alertConfig.accepted) {
          threshold = alertConfig.accepted;
          message = `Pedido #${order.id} lleva ACEPTADO más de ${threshold} min. sin moverse.`;
        } else if (['retirando', 'llevando'].includes(order.estado) && timeDiffMinutes > alertConfig.in_progress) {
          threshold = alertConfig.in_progress;
          message = `Pedido #${order.id} lleva EN PROGRESO más de ${threshold} min.`;
        }

        if (message && !alerts.some(a => a.id === order.id)) {
          newAlerts.push({ id: order.id, message });
        }
      });

      if (newAlerts.length > 0) {
        setAlerts(prev => [...prev, ...newAlerts]);
        audioRef.current?.play().catch(e => console.warn("El navegador bloqueó la reproducción automática de audio."));
      }
    }, 30000); // Revisa cada 30 segundos

    return () => clearInterval(checkInterval);
  }, [liveOrders, alertConfig, alerts]);

  // Efecto para las alertas basadas en eventos (nuevos tickets)
  useEffect(() => {
    if (lastMessage?.type === 'NEW_TICKET' && alertConfig?.new_support_ticket) {
      const newAlert = { id: `ticket-${Date.now()}`, message: `¡Nuevo ticket de soporte recibido! Asunto: ${lastMessage.data.asunto_ticket}` };
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

      {/* Contenedor de Alertas (Toasts) */}
      <div className="fixed top-5 right-5 z-[99999] space-y-3 w-96">
        {alerts.map(alert => (
          <AlertToast key={alert.id} alert={alert} onDismiss={dismissAlert} />
        ))}
      </div>
      
      {/* Elemento de Audio (asegúrate de tener este archivo en tu carpeta /public) */}
      <audio ref={audioRef} src="/alert-sound.mp3" preload="auto"></audio>
    </div>
  );
};

export default MainLayout;