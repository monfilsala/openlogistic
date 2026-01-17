// entrega2/frontend/src/modules/Dashboard/components/StatsCards.jsx

import React from 'react'; // Eliminamos useContext y WebSocketContext
import { ShoppingBag, CheckCircle, Users, AlertCircle } from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, color, bgIconColor }) => (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between hover:shadow-md transition-all duration-200">
        <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{title}</span>
            <span className="text-2xl font-bold text-slate-800">{value}</span>
        </div>
        <div className={`p-3 rounded-lg ${bgIconColor} bg-opacity-10 flex items-center justify-center`}>
            <Icon className={`w-6 h-6 ${color}`} />
        </div>
    </div>
);

const StatsCards = ({ metrics }) => {
    // --- LÍNEAS ELIMINADAS ---
    // Ya no necesitamos el contexto ni la lógica de actualización aquí.
    // El componente ahora solo se encarga de mostrar los datos que recibe.

    if (!metrics) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-24 animate-pulse"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
            <StatCard
                title="Pedidos Hoy"
                value={metrics.pedidos_hoy ?? 0}
                icon={ShoppingBag}
                color="text-blue-600"
                bgIconColor="bg-blue-600"
            />
            <StatCard
                title="Entregados"
                value={metrics.pedidos_completados_hoy ?? 0}
                icon={CheckCircle}
                color="text-emerald-600"
                bgIconColor="bg-emerald-600"
            />
            <StatCard
                title="Deliveries Activos"
                value={metrics.drivers_activos ?? 0}
                icon={Users}
                color="text-violet-600"
                bgIconColor="bg-violet-600"
            />
            <StatCard
                title="Tickets"
                value={metrics.tickets_abiertos ?? 0}
                icon={AlertCircle}
                color="text-rose-600"
                bgIconColor="bg-rose-600"
            />
        </div>
    );
};

export default StatsCards;