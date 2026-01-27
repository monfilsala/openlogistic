from pydantic import BaseModel, Field, field_validator, EmailStr
from typing import Optional, List, Any, Dict
from datetime import datetime, timezone, time
from enum import Enum

# --- ENUMS ---
class EstadoPedido(str, Enum):
    PENDIENTE = "pendiente"
    ACEPTADO = "aceptado"
    RETIRANDO = "retirando"
    LLEVANDO = "llevando"
    ENTREGADO = "entregado"
    CANCELADO = "cancelado"
    CON_NOVEDAD = "con_novedad"
    ASIGNADO = "asignado"

class EstadoTicket(str, Enum):
    ABIERTO = "abierto"
    EN_PROGRESO = "en_progreso"
    RESUELTO = "resuelto"
    CERRADO = "cerrado"

class TipoRemitenteTicket(str, Enum):
    REPARTIDOR = "repartidor"
    SOPORTE_WEB = "soporte_web"
    
class TipoVehiculo(str, Enum):
    MOTO = "moto"
    CARRO = "carro"
    VAN = "van"
    CREDITO = "credito"
    TE1 = "te1"
    TE2 = "te2"
    TP = "tp"
    DE_CONTADO = "de_contado"
    TPF = "tpf"
    
# --- MODELOS DE GEOCODIFICACIÓN ---
class AutocompleteSuggestion(BaseModel):
    description: str
    place_id: str

class AutocompleteResponse(BaseModel):
    suggestions: List[AutocompleteSuggestion]

class PlaceGeometry(BaseModel):
    location: dict[str, float]

class PlaceDetails(BaseModel):
    geometry: PlaceGeometry
    formatted_address: str

class PlaceDetailsResponse(BaseModel):
    details: PlaceDetails

# --- MODELO PARA RESPUESTA DE COSTO ---
class CostoDeliveryResponse(BaseModel):
    origen: str
    destino: str
    distancia_km: float
    distancia_texto: str
    duracion_estimada: str
    tier_aplicado: str
    costo: float
    moneda: str
    tipo_vehiculo: str

# --- PEDIDO MODELS ---
class PedidoBase(BaseModel):
    pedido: str
    direccion_entrega: str
    latitud_entrega: float
    longitud_entrega: float
    detalles: Optional[str] = None
    link_maps: Optional[str] = None
    id_comercio: str
    nombre_comercio: str
    telefono_contacto: Optional[str] = None
    telefono_comercio: Optional[str] = None
    latitud_retiro: float
    longitud_retiro: float
    tipo_vehiculo: TipoVehiculo
    creado_por_usuario_id: str
    id_externo: Optional[str] = None

    model_config = { "from_attributes": True, "use_enum_values": True }

class PedidoCreate(PedidoBase):
    pass

class Pedido(PedidoBase):
    id: int
    estado: EstadoPedido = Field(default=EstadoPedido.PENDIENTE)
    estado_previo_novedad: Optional[str] = None
    fecha_creacion: datetime
    fecha_actualizacion: datetime = Field(default_factory=datetime.utcnow)
    costo_servicio: Optional[float] = None
    repartidor_id: Optional[str] = None
    tiene_ticket_abierto: bool = False

class PedidoEstadoUpdate(BaseModel):
    estado: EstadoPedido
    repartidor_id: Optional[str] = None

class PedidoAsignarRepartidor(BaseModel):
    repartidor_id: str

# --- UBICACION MODELS ---
class UbicacionUsuario(BaseModel):
    id_usuario: str
    latitud: float
    longitud: float
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    estado: Optional[str] = "Disponible"
    bateria_porcentaje: Optional[int] = Field(None, ge=0, le=100)

    @field_validator('timestamp', mode='before')
    @classmethod
    def parse_timestamp_str(cls, v: any) -> datetime:
        if isinstance(v, str):
            try:
                dt_obj = datetime.fromisoformat(v.replace('Z', '+00:00'))
                return dt_obj.astimezone(timezone.utc)
            except ValueError:
                raise ValueError("Timestamp debe estar en formato ISO")
        elif isinstance(v, datetime):
            return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return v

    model_config = { "from_attributes": True }

# --- USUARIO MODELS ---
class Usuario(BaseModel):
    id_usuario: str
    nombre_display: Optional[str] = None
    ultima_latitud: Optional[float] = None
    ultima_longitud: Optional[float] = None
    ultima_actualizacion_loc: Optional[datetime] = None
    estado_actual: Optional[str] = None
    porcentaje_comision: Optional[float] = Field(default=0.0)
    ultima_bateria_porcentaje: Optional[int] = None
    fcm_token: Optional[str] = None
    
    model_config = {"from_attributes": True}

class NewUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    display_name: str

class UpdateUserRequest(BaseModel):
    disabled: Optional[bool] = None
    display_name: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6)

class UsuarioProfileUpdate(BaseModel):
    nombre_display: Optional[str] = None

class UpdateCommissionRequest(BaseModel):
    porcentaje_comision: float = Field(..., ge=0, le=100)

# --- COMERCIO MODELS ---
class ComercioBase(BaseModel):
    id_comercio: str
    nombre: str
    direccion: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    numero_contacto: Optional[str] = None
    
    model_config = {"from_attributes": True}

class ComercioCreate(ComercioBase):
    pass

class ComercioUpdate(BaseModel):
    nombre: Optional[str] = None
    direccion: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    numero_contacto: Optional[str] = None

class Comercio(ComercioBase):
    pass

# --- INICIO DE LA CORRECCIÓN DE ORDEN ---

# --- API KEY MODELS ---
# (Definidos ANTES de IntegrationConfig para resolver el NameError)
class ApiKeyBase(BaseModel):
    client_name: str

class ApiKeyCreate(ApiKeyBase):
    pass

class ApiKey(ApiKeyBase):
    id: int
    prefix: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None
    
    model_config = {"from_attributes": True}

class NewApiKeyResponse(BaseModel):
    prefix: str
    full_key: str
    client_name: str
    message: str

# --- INTEGRATION MODELS ---
class IntegrationWebhookConfig(BaseModel):
    url: str
    payload_template: Dict[str, Any]

class IntegrationConfigBase(BaseModel):
    name: str
    is_active: bool = True
    id_externo_prefix: str
    webhooks: Dict[str, IntegrationWebhookConfig]

class IntegrationConfigCreate(IntegrationConfigBase):
    pass

class IntegrationConfigUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    id_externo_prefix: Optional[str] = None
    webhooks: Optional[Dict[str, IntegrationWebhookConfig]] = None

class IntegrationConfig(IntegrationConfigBase):
    id: int
    created_at: datetime
    updated_at: datetime
    api_key: Optional[ApiKey] = None # <-- Esta línea ahora es válida

    model_config = {"from_attributes": True}

# --- FIN DE LA CORRECCIÓN DE ORDEN ---

# --- ANALYTICS MODELS ---
class FinancialMetrics(BaseModel):
    total_revenue: float
    total_driver_commission: float
    net_revenue: float

class OperationalMetrics(BaseModel):
    total_orders: int
    completed_orders: int
    cancelled_orders: int
    cancellation_rate: float
    total_tickets: int

class TimingMetrics(BaseModel):
    avg_time_to_accept_minutes: Optional[float] = None
    avg_time_to_pickup_minutes: Optional[float] = None
    avg_time_to_deliver_minutes: Optional[float] = None
    avg_total_delivery_time_minutes: Optional[float] = None

class AnalyticsResponse(BaseModel):
    start_date: str
    end_date: str
    financials: FinancialMetrics
    operations: OperationalMetrics
    timing: TimingMetrics
    top_drivers_by_orders: List[Dict] = []
    top_merchants_by_orders: List[Dict] = []

# --- TICKET MODELS ---
class TicketBase(BaseModel):
    id_pedido: int
    asunto_ticket: Optional[str] = None

class TicketCreate(TicketBase):
    pass

class Ticket(TicketBase):
    id_ticket: int
    id_usuario_creador: str
    estado_ticket: EstadoTicket = Field(default=EstadoTicket.ABIERTO)
    fecha_creacion_ticket: datetime

    model_config = {"from_attributes": True, "use_enum_values": True}

class MensajeTicketBase(BaseModel):
    contenido_mensaje: str
    nombre_archivo_adjunto: Optional[str] = None

class MensajeTicket(MensajeTicketBase):
    id_mensaje: int
    id_ticket: int
    id_remitente: str
    tipo_remitente: TipoRemitenteTicket
    timestamp_mensaje: datetime

    model_config = {"from_attributes": True, "use_enum_values": True}

class TicketEstadoUpdate(BaseModel):
    estado_ticket: EstadoTicket

class RestrictedZoneBase(BaseModel):
    name: str
    is_active: bool = True
    polygon_coords: List[List[float]] # [[lng, lat], [lng, lat], ...]
    restricted_from: Optional[time] = None
    restricted_to: Optional[time] = None

class RestrictedZoneCreate(RestrictedZoneBase):
    pass

class RestrictedZoneUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    polygon_coords: Optional[List[List[float]]] = None
    restricted_from: Optional[time] = None
    restricted_to: Optional[time] = None

class RestrictedZone(RestrictedZoneBase):
    id: int
    class Config:
        from_attributes = True

class LoginSuccessRequest(BaseModel):
    fcm_token: Optional[str] = None
    device_info: Optional[str] = None