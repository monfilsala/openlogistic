import React, { useState, useEffect } from 'react';
import apiClient from '../../api/axiosConfig';
import { PieChart, Loader, AlertCircle, TrendingUp, TrendingDown, DollarSign, Package, XCircle, Clock, Ticket, Star, Store, User } from 'lucide-react';

// --- Sub-Componente: Tarjeta de Métrica (KPI Card) ---
const StatCard = ({ title, value, unit = '', icon: Icon, color = 'text-slate-800' }) => (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
        <div>
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
            <p className={`text-3xl font-bold mt-2 ${color}`}>
                {value} <span className="text-lg font-medium text-slate-400">{unit}</span>
            </p>
        </div>
        {Icon && <div className="bg-slate-100 p-3 rounded-lg"><Icon className="text-slate-500" size={20}/></div>}
    </div>
);

// --- Sub-Componente: Gráfico de Barras Simple para Rankings ---
const SimpleBarChart = ({ data, labelKey, valueKey, title, icon: Icon }) => {
    if (!data || data.length === 0) return (
        <div>
             <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-4"><Icon size={18}/> {title}</h4>
             <p className="text-sm text-slate-400 italic">No hay datos para mostrar.</p>
        </div>
    );

    const maxValue = Math.max(...data.map(item => item[valueKey]));

    return (
        <div>
            <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-4"><Icon size={18}/> {title}</h4>
            <div className="space-y-3">
                {data.map((item, index) => (
                    <div key={index} className="flex items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${index * 50}ms` }}>
                        <div className="w-1/3 text-xs font-medium text-slate-600 truncate text-right">{item[labelKey]}</div>
                        <div className="w-2/3 bg-slate-100 rounded-full h-6 relative">
                            <div
                                className="bg-blue-500 h-6 rounded-full flex items-center justify-end px-2 text-white text-xs font-bold transition-all duration-500"
                                style={{ width: `${(item[valueKey] / maxValue) * 100}%` }}
                            >
                                {item[valueKey]}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};


// --- Sub-Componente: Botones de Filtro de Fecha ---
const DateFilter = ({ setDateRange, activePreset, setActivePreset }) => {
    const today = new Date();
    const getISODate = (date) => date.toISOString().split('T')[0];

    const presets = {
        'Hoy': () => {
            setDateRange({ start: getISODate(today), end: getISODate(today) });
            setActivePreset('Hoy');
        },
        'Esta Semana': () => {
            const dayOfWeek = today.getDay();
            const firstDayOfWeek = new Date(today.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1))); // Lunes
            setDateRange({ start: getISODate(firstDayOfWeek), end: getISODate(new Date()) });
            setActivePreset('Esta Semana');
        },
        'Este Mes': () => {
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            setDateRange({ start: getISODate(firstDayOfMonth), end: getISODate(new Date()) });
            setActivePreset('Este Mes');
        },
        'Últimos 7 Días': () => {
            const start = new Date();
            start.setDate(start.getDate() - 6);
            setDateRange({ start: getISODate(start), end: getISODate(new Date()) });
            setActivePreset('Últimos 7 Días');
        },
        'Últimos 30 Días': () => {
             const start = new Date();
            start.setDate(start.getDate() - 29);
            setDateRange({ start: getISODate(start), end: getISODate(new Date()) });
            setActivePreset('Últimos 30 Días');
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            {Object.keys(presets).map(key => (
                <button 
                    key={key} 
                    onClick={presets[key]} 
                    className={`text-sm px-4 py-2 border rounded-lg font-medium transition-colors ${activePreset === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-50 hover:border-slate-300'}`}
                >
                    {key}
                </button>
            ))}
        </div>
    );
};


const AnalyticsPage = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [dateRange, setDateRange] = useState(() => {
        const today = new Date().toISOString().split('T')[0];
        return { start: today, end: today };
    });
    const [activePreset, setActivePreset] = useState('Hoy');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError('');
            try {
                const res = await apiClient.get(`/analytics/summary?start_date=${dateRange.start}&end_date=${dateRange.end}`);
                setData(res.data);
            } catch (err) {
                setError("No se pudieron cargar las estadísticas. Revisa la consola para más detalles.");
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [dateRange]);

    const formatMinutes = (minutes) => {
        if (minutes === null || minutes === undefined || minutes <= 0) return 'N/A';
        return `${Math.round(minutes)} min`;
    };
    const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;
    const formatPercentage = (rate) => `${(rate || 0).toFixed(1)}%`;

    return (
        <div className="space-y-6">
            <div className='p-4 bg-white rounded-xl shadow-sm border'><h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Estadísticas Avanzadas</h1></div>
            
            
            <div className="bg-white p-4 rounded-xl border shadow-sm">
                <DateFilter setDateRange={setDateRange} activePreset={activePreset} setActivePreset={setActivePreset} />
                <div className="text-xs text-slate-500 mt-2 pl-1">Resultados para: <span className="font-semibold">{dateRange.start}</span> al <span className="font-semibold">{dateRange.end}</span></div>
            </div>

            {loading && <div className="flex items-center justify-center py-20"><Loader className="animate-spin w-8 h-8 text-blue-600"/></div>}
            {error && <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2"><AlertCircle className="inline"/>{error}</div>}

            {data && !loading && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div>
                        <h2 className="font-bold text-xl mb-4">Resumen Financiero</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <StatCard title="Ingresos Totales" value={formatCurrency(data.financials.total_revenue)} icon={DollarSign} color="text-green-600"/>
                            <StatCard title="Comisiones Pagadas" value={formatCurrency(data.financials.total_driver_commission)} icon={DollarSign} color="text-orange-600"/>
                            <StatCard title="Ingreso Neto" value={formatCurrency(data.financials.net_revenue)} icon={DollarSign} color="text-blue-600"/>
                        </div>
                    </div>
                    
                    <div>
                        <h2 className="font-bold text-xl mb-4">Resumen de Operaciones</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <StatCard title="Pedidos Totales" value={data.operations.total_orders} icon={Package}/>
                            <StatCard title="Pedidos Entregados" value={data.operations.completed_orders} icon={Package}/>
                            <StatCard title="Pedidos Cancelados" value={data.operations.cancelled_orders} icon={XCircle}/>
                            <StatCard title="Tasa de Cancelación" value={formatPercentage(data.operations.cancellation_rate)} icon={TrendingDown}/>
                        </div>
                    </div>

                    <div>
                         <h2 className="font-bold text-xl mb-4">Eficiencia y Soporte</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <StatCard title="Prom. Aceptación" value={formatMinutes(data.timing.avg_time_to_accept_minutes)} icon={Clock}/>
                            <StatCard title="Prom. Retiro" value={formatMinutes(data.timing.avg_time_to_pickup_minutes)} icon={Clock}/>
                            <StatCard title="Prom. Entrega" value={formatMinutes(data.timing.avg_time_to_deliver_minutes)} icon={Clock}/>
                            <StatCard title="Tickets Creados" value={data.operations.total_tickets} icon={Ticket}/>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl border shadow-sm">
                        <h2 className="font-bold text-xl mb-4">Rankings</h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <SimpleBarChart data={data.top_drivers_by_orders} labelKey="nombre_display" valueKey="order_count" title="Top 5 Repartidores por Pedidos" icon={User}/>
                            <SimpleBarChart data={data.top_merchants_by_orders} labelKey="nombre" valueKey="order_count" title="Top 5 Comercios por Pedidos" icon={Store}/>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnalyticsPage;