import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // <-- CORRECCIÓN: Ruta de importación corregida

import { 
  LayoutDashboard, ShoppingBag, Users, Settings, PieChart,
  ChevronDown, ChevronRight, Map, FileText, LifeBuoy, LogOut, Shield, Store, Share2
} from 'lucide-react';

const MenuItem = ({ icon: Icon, label, to, subItems }) => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  const hasSubItems = subItems && subItems.length > 0;
  const isParentActive = hasSubItems && (location.pathname === to || subItems.some(item => location.pathname.startsWith(item.to)));
  
  const toggleSubMenu = (e) => {
    if (hasSubItems) {
      e.preventDefault();
      setIsOpen(!isOpen);
    }
  };

  useEffect(() => {
    if (isParentActive) {
      setIsOpen(true);
    }
  }, [isParentActive]);

  return (
    <div className="mb-1">
      <NavLink
        to={to || '#'}
        onClick={toggleSubMenu}
        className={({ isActive }) => `
          flex items-center justify-between px-4 py-3 rounded-lg transition-colors duration-200
          ${(isActive && !hasSubItems) || isParentActive
            ? 'bg-blue-600 text-white shadow-md' 
            : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
        `}
      >
        <div className="flex items-center gap-3">
          <Icon size={20} />
          <span className="font-medium text-sm">{label}</span>
        </div>
        {hasSubItems && (
          isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />
        )}
      </NavLink>

      {hasSubItems && isOpen && (
        <div className="ml-4 mt-1 border-l-2 border-slate-700 pl-2 space-y-1 animate-in fade-in duration-300">
          {subItems.map((item, index) => (
            <NavLink
              key={index}
              to={item.to}
              className={({ isActive }) => `
                block px-3 py-2 rounded-md text-sm transition-colors
                ${isActive ? 'text-blue-400 font-semibold' : 'text-slate-500 hover:text-slate-300'}
              `}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};

const Sidebar = () => {
  const { currentUser: user, logout, hasPermission } = useAuth();

  const getUserDisplayName = () => {
    if (user?.displayName) return user.displayName;
    if (user?.email) return user.email.split('@')[0];
    return 'Usuario';
  };

  const getInitials = () => {
    const name = getUserDisplayName();
    const names = name.split(' ');
    if (names.length > 1 && names[1]) {
      return (names[0][0] + names[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <aside className="w-64 bg-slate-900 h-screen flex flex-col fixed left-0 top-0 overflow-y-auto border-r border-slate-800">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold">E2</span>
          </div>
          Entrega2
        </h1>
        <p className="text-xs text-slate-500 mt-1 ml-10">Panel de Administración</p>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2">
        <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Principal</p>
        
        {hasPermission('dashboard:view') && <MenuItem icon={LayoutDashboard} label="Dashboard" to="/" />}
        
        {hasPermission('orders:view') && (
          <MenuItem 
            icon={ShoppingBag} 
            label="Pedidos" 
            to="/pedidos"
            subItems={[
              { label: 'Todos los Pedidos', to: '/pedidos' },
              { label: 'Programados', to: '/pedidos/programados' },
              { label: 'Historial', to: '/pedidos/historial' }
            ].filter(Boolean)} 
          />
        )}
        
        {(hasPermission('drivers:view') || hasPermission('merchants:view') || hasPermission('map:view') || hasPermission('support:view')) && (
          <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mt-6 mb-2">Operaciones</p>
        )}
        
        {hasPermission('drivers:view') && <MenuItem icon={Users} label="Repartidores" to="/conductores"/>}
        {hasPermission('merchants:view') && <MenuItem icon={Store} label="Comercios" to="/comercios"/>}
        {hasPermission('map:view') && <MenuItem icon={Map} label="Mapa en Vivo" to="/mapa" />}
        {hasPermission('support:view') && <MenuItem icon={LifeBuoy} label="Soporte / Tickets" to="/soporte" />}

        {(hasPermission('analytics:view') || hasPermission('reports:view') || hasPermission('settings:view')) && (
          <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mt-6 mb-2">Sistema</p>
        )}

        {hasPermission('analytics:view') && <MenuItem icon={PieChart} label="Estadísticas" to="/analytics" />} 
        {hasPermission('reports:view') && <MenuItem icon={FileText} label="Reportes" to="/reportes" />}
        
        {(hasPermission('access:view') || hasPermission('settings:view') || hasPermission('integrations:view')) && (
          <MenuItem 
            icon={Settings} 
            label="Administración" 
            to="#"
            subItems={[
              hasPermission('access:view') && { label: 'Gestión de Accesos', to: '/access' },
              hasPermission('integrations:view') && { label: 'Integraciones API', to: '/integrations' },
              hasPermission('settings:view') && { label: 'Configuración', to: '/configuracion' },
              hasPermission('settings:view') && { label: 'Logs del Sistema', to: '/logs' },
              hasPermission('zones:view') && { label: 'Zonas', to: '/zonas' },
            ].filter(Boolean)}
          />
        )}
      </nav>

      <div className="p-4 border-t border-slate-800 bg-slate-900">
        {user ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold">
                {getInitials()}
              </div>
              <div>
                <p className="text-sm font-medium text-white truncate max-w-[150px]">{getUserDisplayName()}</p>
                <p className="text-xs text-slate-500 truncate max-w-[150px]">{user.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              title="Cerrar Sesión"
              className="w-full flex items-center justify-center gap-2 mt-4 px-4 py-2 text-sm text-slate-400 rounded-lg hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <LogOut size={16} />
              Cerrar Sesión
            </button>
          </>
        ) : (
          <div className="text-center text-slate-500 text-xs py-4">Cargando usuario...</div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;