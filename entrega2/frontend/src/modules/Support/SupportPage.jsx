import React, { useEffect, useState, useContext, useRef } from 'react';
import apiClient from '../../api/axiosConfig';
import { WebSocketContext } from '../../context/WebSocketContext';
import { useAuth } from '../../context/AuthContext';
import { LifeBuoy, Send, Paperclip, User, Headset, Loader, Edit, CheckCircle, Clock, X, Inbox, MessageSquare } from 'lucide-react';
import EditOrderModal from '../Orders/components/EditOrderModal';

// --- SUB-COMPONENTE: Un solo item en la lista de tickets ---
const TicketListItem = ({ ticket, onSelect, isSelected }) => (
    <button 
        onClick={() => onSelect(ticket)}
        className={`w-full text-left p-4 border-b border-slate-100 transition-colors ${isSelected ? 'bg-blue-100/50 border-l-4 border-blue-500' : 'hover:bg-slate-100'}`}
    >
        <div className="flex justify-between items-start">
            <span className="font-bold text-sm text-slate-800 truncate">{ticket.asunto_ticket || `Pedido #${ticket.id_pedido}`}</span>
            <span className="text-xs text-slate-400">{new Date(ticket.fecha_creacion_ticket).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
        <p className="text-xs text-slate-600 truncate mt-1">Pedido #{ticket.id_pedido} - {ticket.nombre_pedido}</p>
        <p className="text-xs text-slate-500">De: {ticket.creador_display}</p>
    </button>
);

// --- SUB-COMPONENTE: La lista completa de tickets (Columna Izquierda) ---
const TicketList = ({ tickets, activeTicket, onSelectTicket, loading }) => (
  <div className="bg-slate-50 border-r border-slate-200 flex flex-col h-full">
    <div className="p-4 border-b border-slate-200">
      <h2 className="font-bold text-slate-800 flex items-center gap-2">
        <Inbox size={18}/> Novedades Activas ({tickets.length})
      </h2>
    </div>
    <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400"><Loader className="animate-spin inline"/></div>
      ) : tickets.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">No hay tickets activos.</div>
      ) : (
        tickets.map(ticket => (
          <TicketListItem 
            key={ticket.id_ticket}
            ticket={ticket} 
            onSelect={onSelectTicket} 
            isSelected={activeTicket?.id_ticket === ticket.id_ticket}
          />
        ))
      )}
    </div>
  </div>
);

// --- SUB-COMPONENTE: Una sola burbuja de mensaje en el chat ---
const MessageBubble = ({ message }) => {
    const isSupport = message.tipo_remitente === 'soporte_web';
    return (
        <div className={`flex items-end gap-3 ${isSupport ? 'justify-end' : 'justify-start'}`}>
            {!isSupport && (
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-slate-500">
                    <User size={16} className="text-white"/>
                </div>
            )}
            <div className={`p-3 rounded-xl max-w-lg shadow-sm ${isSupport ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 border'}`}>
                {message.nombre_archivo_adjunto && (
                    <a href={`/uploads/ticket_attachments/${message.nombre_archivo_adjunto}`} target="_blank" rel="noopener noreferrer" className="block mb-2">
                        <img 
                            src={`/uploads/ticket_attachments/${message.nombre_archivo_adjunto}`} 
                            alt="Archivo adjunto"
                            className="max-w-xs max-h-60 rounded-lg cursor-pointer object-cover border-2 border-white/20"
                        />
                    </a>
                )}
                {message.contenido_mensaje && <p className="text-sm whitespace-pre-wrap">{message.contenido_mensaje}</p>}
                <p className={`text-xs mt-1 text-right ${isSupport ? 'text-blue-200 opacity-70' : 'text-slate-400'}`}>{new Date(message.timestamp_mensaje).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
            {isSupport && (
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-500">
                    <Headset size={16} className="text-white"/>
                </div>
            )}
        </div>
    );
};

// --- SUB-COMPONENTE: La ventana de chat completa (Columna Derecha) ---
const ChatWindow = ({ activeTicket, onNewMessage, onManageOrder, onUpdateTicketStatus, currentUser }) => {
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [file, setFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (activeTicket) {
      setLoadingMessages(true);
      apiClient.get(`/tickets/${activeTicket.id_ticket}/mensajes`)
        .then(res => setMessages(res.data))
        .catch(console.error)
        .finally(() => setLoadingMessages(false));
    } else {
      setMessages([]);
    }
  }, [activeTicket]);

  useEffect(() => {
    if (onNewMessage && onNewMessage.id_ticket === activeTicket?.id_ticket) {
      setMessages(prevMessages => {
        const messageExists = prevMessages.some(msg => msg.id_mensaje === onNewMessage.id_mensaje);
        if (!messageExists) {
          return [...prevMessages, onNewMessage];
        }
        return prevMessages;
      });
    }
  }, [onNewMessage, activeTicket]);

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
    formData.append('id_remitente', currentUser.email);
    formData.append('tipo_remitente', 'soporte_web');
    if (file) {
      formData.append('archivo_adjunto', file);
    }
    try {
      await apiClient.post(`/tickets/${activeTicket.id_ticket}/mensajes`, formData);
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
      <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50">
        {loadingMessages ? <div className="text-center"><Loader className="animate-spin inline-block"/></div> : messages.map(msg => <MessageBubble key={msg.id_mensaje} message={msg} />)}
        <div ref={chatEndRef} />
      </div>
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
  const { lastMessage, drivers } = useContext(WebSocketContext);
  const { currentUser } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [activeTicket, setActiveTicket] = useState(null);
  const [newestMessage, setNewestMessage] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState(null);

  useEffect(() => {
    setLoadingTickets(true);
    apiClient.get('/tickets/active')
      .then(res => {
        setTickets(res.data);
        if (res.data.length > 0 && !activeTicket) {
          setActiveTicket(res.data[0]);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingTickets(false));
  }, []);

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
      apiClient.get(`/pedidos/${activeTicket.id_pedido}`)
        .then(res => {
            setOrderToEdit(res.data);
            setIsEditModalOpen(true);
        })
        .catch(err => alert("No se pudo cargar la información del pedido."));
  };
  
  const handleUpdateTicketStatus = async (newStatus) => {
    if (!activeTicket) return;
    try {
        await apiClient.patch(`/tickets/${activeTicket.id_ticket}/estado`, { estado_ticket: newStatus });
    } catch (err) {
        alert(`Error al actualizar estado: ${err.message}`);
    }
  };

  return (
    <>
      <div className="h-[calc(100vh-100px)] grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        
        <div className="col-span-1 h-full">
          <TicketList 
            tickets={tickets} 
            activeTicket={activeTicket} 
            onSelectTicket={setActiveTicket}
            loading={loadingTickets}
          />
        </div>

        <div className="col-span-1 md:col-span-2 xl:col-span-3 h-full">
          <ChatWindow 
            activeTicket={activeTicket} 
            onNewMessage={newestMessage}
            onManageOrder={handleManageOrder}
            onUpdateTicketStatus={handleUpdateTicketStatus}
            currentUser={currentUser}
          />
        </div>
      </div>

      <EditOrderModal 
        isOpen={isEditModalOpen}
        order={orderToEdit}
        drivers={drivers} 
        onClose={() => setIsEditModalOpen(false)}
        onOrderUpdated={(updatedOrder) => {
            console.log("Pedido actualizado desde Soporte:", updatedOrder);
        }}
      />
    </>
  );
};

export default SupportPage;