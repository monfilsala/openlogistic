import React, { useEffect, useState, useMemo } from 'react';
import apiClient from '../../api/axiosConfig';
import { FileDown, Table, SlidersHorizontal, BarChart, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react';

// --- Componente de Gráfico Simple ---
const SimpleBarChart = ({ data, labelKey, valueKey, title }) => {
    if (!data || data.length === 0) return null;

    const maxValue = Math.max(...data.map(item => item[valueKey]));

    return (
        <div className="mt-8 border-t pt-6">
            <h4 className="font-bold text-slate-700 mb-4">{title}</h4>
            <div className="space-y-2 pr-4">
                {data.map((item) => (
                    <div key={item[labelKey]} className="flex items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="w-1/4 text-xs font-medium text-slate-600 truncate text-right">{item[labelKey]}</div>
                        <div className="w-3/4 bg-slate-100 rounded-full h-6">
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

// --- Componente para Icono de Ordenamiento ---
const SortIcon = ({ direction }) => {
    if (!direction) return <ChevronsUpDown size={14} className="text-slate-400" />;
    return direction === 'ascending' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
};


const ReportsPage = () => {
    // --- State Management ---
    const [definitions, setDefinitions] = useState({ fields: {}, formulas: {} });
    const [selectedColumns, setSelectedColumns] = useState(['id_pedido', 'fecha_creacion', 'nombre_comercio', 'nombre_repartidor', 'estado', 'costo_servicio']);
    const [filters, setFilters] = useState({ 
        fecha_inicio: '', 
        fecha_fin: '', 
        repartidor_id: '', 
        id_comercio: '', // <-- DEBE SER UN STRING VACÍO, NO UN ARRAY
        estado: [] 
    });
    const [reportResult, setReportResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [drivers, setDrivers] = useState([]);
    const [merchants, setMerchants] = useState([]);
    const [sortConfig, setSortConfig] = useState({ key: 'fecha_creacion', direction: 'descending' });
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    // --- Data Fetching ---
    useEffect(() => {
        apiClient.get('/reports/definitions').then(res => setDefinitions(res.data));
        apiClient.get('/drivers/detailed').then(res => setDrivers(res.data));
        apiClient.get('/comercios').then(res => setMerchants(res.data));
    }, []);

    // --- Handlers ---
    const handleColumnToggle = (key) => setSelectedColumns(prev => prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]);
    const handleFilterChange = (e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleMultiSelectChange = (e) => {
        const values = Array.from(e.target.selectedOptions, option => option.value);
        setFilters(prev => ({ ...prev, [e.target.name]: values }));
    };
    const setDatePreset = (days) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);
        setFilters(prev => ({
            ...prev,
            fecha_inicio: start.toISOString().split('T')[0],
            fecha_fin: end.toISOString().split('T')[0],
        }));
    };

    const generateReport = async (format) => {
        if (selectedColumns.length === 0) { alert("Por favor, selecciona al menos una columna."); return; }
        setLoading(true);
        setReportResult(null);
        setCurrentPage(1);

        try {
            const config = format === 'csv' ? { headers: { 'Accept': 'text/csv' }, responseType: 'blob' } : {};
            const res = await apiClient.post('/reports/generate', { columns: selectedColumns, filters: filters }, config);

            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `reporte_${new Date().toISOString().split('T')[0]}.csv`);
                document.body.appendChild(link);
                link.click();
                link.remove();
            } else {
                setReportResult(res.data);
            }
        } catch (e) { alert("Error generando reporte: " + e.message); } 
        finally { setLoading(false); }
    };
    
    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    // --- Data Processing (Client-Side Sorting & Pagination) ---
    const sortedData = useMemo(() => {
        if (!reportResult?.data) return [];
        const sortableData = [...reportResult.data];
        sortableData.sort((a, b) => {
            if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'ascending' ? 1 : -1;
            return 0;
        });
        return sortableData;
    }, [reportResult, sortConfig]);

    const paginatedData = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return sortedData.slice(startIndex, startIndex + itemsPerPage);
    }, [sortedData, currentPage, itemsPerPage]);
    
    const totalPages = reportResult ? Math.ceil(sortedData.length / itemsPerPage) : 0;
    
    const chartData = useMemo(() => {
        if (!reportResult || !reportResult.data.some(d => d.nombre_repartidor)) return [];
        const dataByDriver = reportResult.data.reduce((acc, row) => {
            const driverName = row.nombre_repartidor || 'Sin Asignar';
            acc[driverName] = (acc[driverName] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(dataByDriver).map(([name, count]) => ({ repartidor: name, pedidos: count })).sort((a,b) => b.pedidos - a.pedidos);
    }, [reportResult]);

    // --- JSX Rendering ---
    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border">
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Generador de Reportes</h1>
                <p className="text-sm text-slate-500 mt-1">Construye, visualiza y descarga reportes personalizados.</p>
            </div>

            <div className="bg-white p-5 rounded-xl border shadow-sm">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><SlidersHorizontal size={20}/> Filtros</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <input type="date" name="fecha_inicio" value={filters.fecha_inicio} onChange={handleFilterChange} className="border p-2 rounded-lg text-sm"/>
                    <input type="date" name="fecha_fin" value={filters.fecha_fin} onChange={handleFilterChange} className="border p-2 rounded-lg text-sm"/>
                    <select name="repartidor_id" value={filters.repartidor_id} onChange={handleFilterChange} className="border p-2 rounded-lg text-sm"><option value="">-- Repartidor --</option>{drivers.map(d=>(<option key={d.id_usuario} value={d.id_usuario}>{d.id_usuario}</option>))}</select>
                    <select name="id_comercio" value={filters.id_comercio} onChange={handleFilterChange} className="border p-2 rounded-lg text-sm"><option value="">-- Comercio --</option>{merchants.map(m=>(<option key={m.id_comercio} value={m.id_comercio}>{m.nombre}</option>))}</select>
                    <select name="estado" multiple value={filters.estado} onChange={handleMultiSelectChange} className="border p-2 rounded-lg text-sm h-24"><option value="" disabled>-- Estado (múltiple) --</option>{['pendiente', 'aceptado', 'retirando', 'llevando', 'entregado', 'cancelado', 'con_novedad'].map(s=>(<option key={s} value={s}>{s}</option>))}</select>
                </div>
                <div className="flex gap-2 mt-4"><button onClick={()=>setDatePreset(0)} className="text-xs px-3 py-1 bg-slate-100 rounded-full hover:bg-slate-200">Hoy</button><button onClick={()=>setDatePreset(6)} className="text-xs px-3 py-1 bg-slate-100 rounded-full hover:bg-slate-200">Últimos 7 Días</button><button onClick={()=>setDatePreset(29)} className="text-xs px-3 py-1 bg-slate-100 rounded-full hover:bg-slate-200">Últimos 30 Días</button></div>
            </div>

            <div className="bg-white p-5 rounded-xl border shadow-sm">
                <h3 className="font-bold text-lg mb-4">Columnas y Fórmulas</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                    {Object.entries(definitions.fields).map(([key, label]) => (<label key={key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"><input type="checkbox" checked={selectedColumns.includes(key)} onChange={()=>handleColumnToggle(key)}/>{label}</label>))}
                    <div className="col-span-full border-t my-2"></div>
                    {Object.entries(definitions.formulas).map(([key, label]) => (<label key={key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer text-blue-600 font-medium"><input type="checkbox" checked={selectedColumns.includes(key)} onChange={()=>handleColumnToggle(key)}/>{label}</label>))}
                </div>
            </div>
            
            <div className="bg-white p-5 rounded-xl border shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg">Resultado</h3>
                    {/* --- CORRECCIÓN: Atributos restaurados en los botones --- */}
                    <div className="flex gap-3">
                        <button onClick={() => generateReport('preview')} disabled={loading || selectedColumns.length === 0} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm flex items-center gap-2 disabled:bg-slate-400 disabled:cursor-not-allowed"><Table size={16}/> Visualizar</button>
                        <button onClick={() => generateReport('csv')} disabled={loading || selectedColumns.length === 0} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2 disabled:bg-slate-400 disabled:cursor-not-allowed"><FileDown size={16}/> Descargar CSV</button>
                    </div>
                </div>
                
                {loading && <div className="text-center py-10">Generando reporte...</div>}
                {!loading && !reportResult && <div className="text-center py-10 text-slate-400">Selecciona filtros y columnas, y haz clic en "Visualizar".</div>}

                {reportResult && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-slate-50 p-4 rounded-lg border"><p className="text-xs text-slate-500">Pedidos Encontrados</p><p className="text-2xl font-bold">{reportResult.summary.total_records}</p></div>
                        <div className="bg-slate-50 p-4 rounded-lg border"><p className="text-xs text-slate-500">Total Facturado ($)</p><p className="text-2xl font-bold">{reportResult.summary.total_costo_servicio.toFixed(2)}</p></div>
                    </div>

                    <div className="overflow-x-auto border rounded-lg">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-100"><tr className="text-left">{reportResult.headers.map((h, i) => <th key={h} className="p-2 font-bold cursor-pointer hover:bg-slate-200" onClick={() => requestSort(reportResult.keys[i])}><div className="flex items-center gap-2">{h} <SortIcon direction={sortConfig.key === reportResult.keys[i] ? sortConfig.direction : null}/></div></th>)}</tr></thead>
                            <tbody className="divide-y">{paginatedData.map((row, i) => <tr key={i} className="hover:bg-slate-50">{reportResult.keys.map(key => <td key={key} className="p-2 truncate max-w-[200px]">{String(row[key])}</td>)}</tr>)}</tbody>
                        </table>
                    </div>
                    
                    <div className="flex justify-between items-center mt-4 text-sm">
                        <p className="text-xs text-slate-500">Mostrando {paginatedData.length} de {sortedData.length} resultados</p>
                        <div className="flex items-center gap-2"><button className="px-3 py-1 border rounded-md disabled:opacity-50" disabled={currentPage===1} onClick={()=>setCurrentPage(c=>c-1)}>Anterior</button><span className="text-xs font-bold">Página {currentPage} de {totalPages}</span><button className="px-3 py-1 border rounded-md disabled:opacity-50" disabled={currentPage===totalPages} onClick={()=>setCurrentPage(c=>c+1)}>Siguiente</button></div>
                    </div>
                    
                    <SimpleBarChart data={chartData} labelKey="repartidor" valueKey="pedidos" title="Pedidos por Repartidor"/>
                  </>
                )}
            </div>
        </div>
    );
};

export default ReportsPage;