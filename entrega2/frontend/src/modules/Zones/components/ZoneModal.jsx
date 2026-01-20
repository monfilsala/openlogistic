import React, { useState, useEffect } from 'react';
import { X, Save, Clock } from 'lucide-react';

const ZoneModal = ({ isOpen, onClose, onSave, zoneData }) => {
    const [name, setName] = useState('');
    const [isActive, setIsActive] = useState(true);
    const [restrictedFrom, setRestrictedFrom] = useState('');
    const [restrictedTo, setRestrictedTo] = useState('');
    const [is247, setIs247] = useState(false);

    useEffect(() => {
        if (zoneData) {
            setName(zoneData.name || '');
            setIsActive(zoneData.is_active !== undefined ? zoneData.is_active : true);
            setRestrictedFrom(zoneData.restricted_from || '');
            setRestrictedTo(zoneData.restricted_to || '');
            setIs247(!zoneData.restricted_from && !zoneData.restricted_to);
        } else {
            // Estado inicial para una nueva zona
            setName('');
            setIsActive(true);
            setRestrictedFrom('');
            setRestrictedTo('');
            setIs247(false);
        }
    }, [zoneData]);

    const handleSave = () => {
        onSave({
            ...zoneData,
            name,
            is_active: isActive,
            restricted_from: is247 ? null : restrictedFrom,
            restricted_to: is247 ? null : restrictedTo,
        });
    };
    
    const handle247Toggle = (e) => {
        const checked = e.target.checked;
        setIs247(checked);
        if (checked) {
            setRestrictedFrom('');
            setRestrictedTo('');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                <div className="px-6 py-4 border-b flex justify-between items-center">
                    <h3 className="font-bold text-lg">{zoneData?.id ? 'Editar Zona' : 'Crear Nueva Zona'}</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre de la Zona</label>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Centro Peligroso" required className="w-full border p-2 rounded-lg"/>
                    </div>

                    <div className="space-y-2 pt-4 border-t">
                         <label className="block text-xs font-bold text-slate-500 uppercase">Horario de Restricción</label>
                         <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={is247} onChange={handle247Toggle} />
                            Restringido 24/7
                        </label>
                        <div className={`grid grid-cols-2 gap-4 transition-opacity ${is247 ? 'opacity-40' : 'opacity-100'}`}>
                            <div>
                                <label className="text-xs">Desde</label>
                                <input type="time" value={restrictedFrom} onChange={(e) => setRestrictedFrom(e.target.value)} disabled={is247} className="w-full border p-2 rounded-lg"/>
                            </div>
                             <div>
                                <label className="text-xs">Hasta</label>
                                <input type="time" value={restrictedTo} onChange={(e) => setRestrictedTo(e.target.value)} disabled={is247} className="w-full border p-2 rounded-lg"/>
                            </div>
                        </div>
                    </div>
                    
                    <div className="pt-4 border-t">
                         <label className="flex items-center gap-2 cursor-pointer font-semibold">
                            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4"/>
                            Activar esta regla
                        </label>
                    </div>
                </div>
                <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700">
                        <Save size={16} /> Guardar Zona
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ZoneModal;