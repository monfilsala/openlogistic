import React, { useEffect, useState, useContext, useRef } from 'react';
import apiClient from '../../api/axiosConfig'; // <-- CAMBIO IMPORTANTE
import { WebSocketContext } from '../../context/WebSocketContext';
import { MessageSquare, Inbox, Send, Paperclip, Edit, CheckCircle, Clock, X } from 'lucide-react';
import EditOrderModal from '../Orders/components/EditOrderModal'; // Reutilizamos el modal de edición

// --- SUB-COMPONENTE: Lista de Tickets (Izquierda) ---
const TicketList = ({ tickets, activeTicket, onSelectTicket }) => (
  <div className="bg-slate-50 border-r border-slate-200 flex flex-col h-full">
    <div className="p-4 border-b border-slate-200">
      <h2 className="font-bold text-slate-800 flex items-center gap-2">
        <Inbox size={18}/> Novedades Activas ({tickets.length})
      </h2>
    </div>
    <div className="overflow-y-auto flex-1">
      {tickets.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">No hay tickets activos.</div>
      ) : (
        tickets.map(ticket => (
          <div 
            key={ticket.id_ticket}
            onClick={() => onSelectTicket(ticket)}
            className={`p-4 border-b border-slate-100 cursor-pointer transition-colors ${activeTicket?.id_ticket === ticket.id_ticket ? 'bg-blue-100/50 border-l-4 border-blue-500' : 'hover:bg-slate-100'}`}
          >
            <div className="flex justify-between items-start">
              <span className="font-bold text-sm text-slate-800">Ticket #{ticket.id_ticket}</span>
              <span className="text-xs text-slate-400">{new Date(ticket.fecha_creacion_ticket).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <p className="text-xs text-slate-600 truncate mt-1">Pedido #{ticket.id_pedido} - {ticket.nombre_pedido}</p>
            <p className="text-xs text-slate-500">De: {ticket.creador_display}</p>
          </div>
        ))
      )}
    </div>
  </div>
);

// --- SUB-COMPONENTE: Ventana de Chat (Derecha) ---
const ChatWindow = ({ activeTicket, onNewMessage, onManageOrder, onUpdateTicketStatus }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [file, setFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (activeTicket) {
      apiClient.get(`/api/tickets/${activeTicket.id_ticket}/mensajes`)
        .then(res => setMessages(res.data))
        .catch(console.error);
    } else {
      setMessages([]); // Limpiar al deseleccionar
    }
  }, [activeTicket]);
  
  // Escuchar por nuevos mensajes en este ticket específico (CON FIX ANTI-DUPLICADOS)
  useEffect(() => {
    if (onNewMessage && onNewMessage.id_ticket === activeTicket?.id_ticket) {
      setMessages(prevMessages => {
        // Verificar si el mensaje ya existe en la lista por su ID
        const messageExists = prevMessages.some(msg => msg.id_mensaje === onNewMessage.id_mensaje);

        if (messageExists) {
          // Si ya existe, no hacer nada y devolver la lista sin cambios.
          return prevMessages;
        } else {
          // Si no existe, agregarlo.
          return [...prevMessages, onNewMessage];
        }
      });
    }
  }, [onNewMessage, activeTicket]);

  // Scroll automático al final
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setImagePreview(URL.createObjectURL(selectedFile));
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() && !file) return;

    const formData = new FormData();
    formData.append('contenido_mensaje', newMessage || '');
    formData.append('id_remitente', 'admin_support');
    formData.append('tipo_remitente', 'soporte_web');
    if (file) {
      formData.append('archivo_adjunto', file);
    }

    try {
      await apiClient.post(`/api/tickets/${activeTicket.id_ticket}/mensajes`, formData);
      setNewMessage('');
      setFile(null);
      setImagePreview(null);
      if(fileInputRef.current) fileInputRef.current.value = ""; 
    } catch (err) {
      alert("Error enviando mensaje: " + (err.response?.data?.detail || err.message));
    }
  };

  if (!activeTicket) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 h-full bg-white">
        <MessageSquare size={48} />
        <p className="mt-4">Selecciona un ticket para ver la conversación.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header del Chat con Acciones */}
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/70">
        <div>
          <h3 className="font-bold text-lg text-slate-800">Ticket #{activeTicket.id_ticket}</h3>
          <p className="text-xs text-slate-500">Pedido #{activeTicket.id_pedido} - {activeTicket.nombre_pedido}</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => onUpdateTicketStatus('en_progreso')} className="px-3 py-1 text-xs font-bold text-amber-700 bg-amber-100 rounded-full hover:bg-amber-200 flex items-center gap-1 transition-colors"><Clock size={14}/> En Progreso</button>
            <button onClick={() => onUpdateTicketStatus('resuelto')} className="px-3 py-1 text-xs font-bold text-green-700 bg-green-100 rounded-full hover:bg-green-200 flex items-center gap-1 transition-colors"><CheckCircle size={14}/> Resolver</button>
            <button onClick={onManageOrder} className="px-3 py-1 text-xs font-bold text-blue-700 bg-blue-100 rounded-full hover:bg-blue-200 flex items-center gap-1 transition-colors"><Edit size={14}/> Gestionar Pedido</button>
        </div>
      </div>

      {/* Cuerpo del Chat (Scrollable) */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50">
        {messages.map(msg => (
          <div key={msg.id_mensaje} className={`flex ${msg.tipo_remitente === 'soporte_web' ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-3 rounded-xl max-w-lg shadow-sm ${msg.tipo_remitente === 'soporte_web' ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 border'}`}>
              
              {msg.nombre_archivo_adjunto && (
                <a href={`/uploads/ticket_attachments/${msg.nombre_archivo_adjunto}`} target="_blank" rel="noopener noreferrer" className="block mb-2">
                  <img 
                    src={`/uploads/ticket_attachments/${msg.nombre_archivo_adjunto}`} 
                    alt="Archivo adjunto"
                    className="max-w-xs max-h-60 rounded-lg cursor-pointer object-cover"
                  />
                </a>
              )}

              {msg.contenido_mensaje && <p className="text-sm">{msg.contenido_mensaje}</p>}
              
              <p className="text-xs opacity-70 mt-1 text-right">{new Date(msg.timestamp_mensaje).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input para Enviar Mensaje */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <form onSubmit={handleSend} className="space-y-3">
            {imagePreview && (
                <div className="relative w-24 h-24 p-2 border bg-slate-100 rounded-lg">
                    <img src={imagePreview} alt="Previsualización" className="w-full h-full object-cover rounded"/>
                    <button type="button" onClick={() => { setFile(null); setImagePreview(null); if(fileInputRef.current) fileInputRef.current.value = ""; }}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors">
                        <X size={14}/>
                    </button>
                </div>
            )}
            <div className="flex items-center gap-3">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                <button type="button" onClick={() => fileInputRef.current.click()} className="p-3 text-slate-500 hover:bg-slate-200 rounded-full transition-colors"><Paperclip size={20}/></button>
                <input type="text" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Escribe tu respuesta..." className="flex-1 px-4 py-2 border border-slate-300 rounded-full focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"/>
                <button type="submit" className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 shadow-md transition-transform active:scale-95"><Send size={20}/></button>
            </div>
        </form>
      </div>
    </div>
  );
};


// --- COMPONENTE PRINCIPAL DE LA PÁGINA ---
const SupportPage = () => {
  const { lastMessage } = useContext(WebSocketContext);
  const [tickets, setTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [newestMessage, setNewestMessage] = useState(null);
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState(null);

  useEffect(() => {
    apiClient.get('/api/tickets/active')
      .then(res => {
        setTickets(res.data);
        if (res.data.length > 0 && !activeTicket) {
          setActiveTicket(res.data[0]);
        }
      })
      .catch(console.error);
  }, []);

  // Escuchar por eventos de WebSocket
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'NEW_TICKET') {
      const newTicket = lastMessage.data;
      setTickets(prev => [newTicket, ...prev]);
      if (!activeTicket) setActiveTicket(newTicket);
    } 
    else if (lastMessage.type === 'NEW_TICKET_MESSAGE') {
      setNewestMessage(lastMessage.data);
    }
    else if (lastMessage.type === 'TICKET_STATUS_UPDATE') {
        const updatedTicket = lastMessage.data;
        if (['resuelto', 'cerrado'].includes(updatedTicket.estado_ticket)) {
            setTickets(prev => prev.filter(t => t.id_ticket !== updatedTicket.id_ticket));
            if (activeTicket?.id_ticket === updatedTicket.id_ticket) {
                const currentIndex = tickets.findIndex(t => t.id_ticket === updatedTicket.id_ticket);
                const nextTicket = tickets[currentIndex + 1] || (tickets.length > 1 ? tickets[0] : null);
                setActiveTicket(nextTicket);
            }
        }
    }
  }, [lastMessage, activeTicket, tickets]);
  
  const handleManageOrder = () => {
      if (!activeTicket) return;
      apiClient.get(`/api/pedidos/${activeTicket.id_pedido}`)
        .then(res => {
            setOrderToEdit(res.data);
            setIsEditModalOpen(true);
        })
        .catch(err => alert("No se pudo cargar la información del pedido."));
  };
  
  const handleUpdateTicketStatus = async (newStatus) => {
    if (!activeTicket) return;
    try {
        await apiClient.patch(`/api/tickets/${activeTicket.id_ticket}/estado`, { estado_ticket: newStatus });
        // La UI se actualiza via WebSocket
    } catch (err) {
        alert(`Error al actualizar estado: ${err.message}`);
    }
  };

  return (
    <>
      <div className="h-[calc(100vh-100px)] grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        
        <div className="col-span-1 h-full">
          <TicketList tickets={tickets} activeTicket={activeTicket} onSelectTicket={setActiveTicket} />
        </div>

        <div className="col-span-1 md:col-span-2 xl:col-span-3 h-full">
          <ChatWindow 
            activeTicket={activeTicket} 
            onNewMessage={newestMessage}
            onManageOrder={handleManageOrder}
            onUpdateTicketStatus={handleUpdateTicketStatus}
          />
        </div>
      </div>

      <EditOrderModal 
        isOpen={isEditModalOpen}
        order={orderToEdit}
        onClose={() => setIsEditModalOpen(false)}
        onOrderUpdated={(updatedOrder) => {
            // Opcional: Notificar al usuario que el pedido se actualizó
            console.log("Pedido actualizado desde Soporte:", updatedOrder);
        }}
      />
    </>
  );
};

export default SupportPage;