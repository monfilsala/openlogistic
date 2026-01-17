import React from 'react';
import { Map } from 'lucide-react';

const MapSkeleton = () => {
  return (
    <div className="w-full h-full bg-slate-200 animate-pulse flex flex-col items-center justify-center text-slate-400">
      <Map size={64} />
      <p className="mt-4 font-medium">Cargando Mapa...</p>
    </div>
  );
};

export default MapSkeleton;