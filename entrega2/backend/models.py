from pydantic import BaseModel, Field, field_validator, validator, EmailStr
from typing import Optional, List, Any, Dict
from datetime import datetime, timezone
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
    location: dict[str, float] # e.g., {"lat": 10.123, "lng": -67.456}

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
    pedido: str = Field(..., example="Pizza Margherita grande y una Coca-Cola")
    direccion_entrega: str = Field(..., alias="telefono", example="Avenida Siempre Viva 742, Springfield")
    latitud_entrega: float = Field(..., example=-34.603722)
    longitud_entrega: float = Field(..., example=-58.381592)
    detalles: Optional[str] = Field(None, example="Sin cebolla, masa fina")
    link_maps: Optional[str] = Field(None, example="https://maps.google.com/?q=-34.603722,-58.381592")
    id_comercio: str = Field(..., example="comercio_001")
    nombre_comercio: str = Field(..., example="Super Pizza Place")
    telefono_contacto: Optional[str] = Field(None, example="+584127418193")
    telefono_comercio: Optional[str] = Field(None, example="+584127418193")
    latitud_retiro: float = Field(..., example=37.309710)
    longitud_retiro: float = Field(..., example=-122.103940)
    tipo_vehiculo: TipoVehiculo = Field(..., example="moto")
    creado_por_usuario_id: str = Field(..., example="admin@example.com")
    # --- CAMPO AÑADIDO ---
    id_externo: Optional[str] = Field(None, example="ext-order-abc-12345", description="ID opcional para integraciones externas.")


    model_config = {
        "populate_by_name": True,
        "from_attributes": True,
        "use_enum_values": True,
    }

class PedidoCreate(PedidoBase):
    pass

class Pedido(PedidoBase):
    id: int
    estado: EstadoPedido = Field(default=EstadoPedido.PENDIENTE)
    estado_previo_novedad: Optional[str] = Field(None)
    fecha_creacion: datetime
    # --- INICIO DE LA MODIFICACIÓN ---
    fecha_actualizacion: datetime = Field(default_factory=datetime.utcnow, description="Timestamp de la última actualización del pedido.")
    # --- FIN DE LA MODIFICACIÓN ---
    costo_servicio: Optional[float] = Field(None, example=2.50)
    repartidor_id: Optional[str] = Field(None, example="repartidor_007")
    tiene_ticket_abierto: Optional[bool] = Field(default=False)


class PedidoEstadoUpdate(BaseModel):
    estado: EstadoPedido
    repartidor_id: Optional[str] = None

class PedidoAsignarRepartidor(BaseModel):
    repartidor_id: str

class PedidoRechazarAsignacion(BaseModel):
    repartidor_id: str

# --- UBICACION MODELS ---
class UbicacionUsuario(BaseModel):
    id_usuario: str = Field(..., example="repartidor_001")
    latitud: float = Field(..., example=-34.6083)
    longitud: float = Field(..., example=-58.3712)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    estado: Optional[str] = Field("Disponible", example="Disponible")
    bateria_porcentaje: Optional[int] = Field(None, ge=0, le=100, example=85)

    @field_validator('timestamp', mode='before')
    @classmethod
    def parse_timestamp_str(cls, v: any) -> datetime:
        if isinstance(v, str):
            try:
                dt_obj = datetime.fromisoformat(v.replace('Z', '+00:00'))
                return dt_obj.astimezone(timezone.utc)
            except ValueError:
                raise ValueError("Timestamp debe estar en formato ISO, ej., 2024-07-15T12:00:00Z")
        elif isinstance(v, datetime):
            return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return v

    model_config = {
        "populate_by_name": True,
        "from_attributes": True
    }

class UbicacionLog(UbicacionUsuario):
    id_log: Optional[int] = None

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

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }

class UsuarioFCMTokenUpdate(BaseModel):
    fcm_token: str

class EstadisticasRepartidor(BaseModel):
    pedidos_completados_30d: int
    ganancias_estimadas_30d: float
    pedidos_completados_7d: int
    ganancias_estimadas_7d: float
    porcentaje_comision_actual: float


# --- COMERCIO MODELS ---
class ComercioBase(BaseModel):
    id_comercio: str = Field(..., example="comercio_xyz_001")
    nombre: str = Field(..., example="Super Pizza Place")
    direccion: Optional[str] = Field(None, example="Calle Principal 456, Ciudad")
    latitud: Optional[float] = Field(None, example=37.300000)
    longitud: Optional[float] = Field(None, example=-122.100000)
    numero_contacto: Optional[str] = Field(None, example="+1-555-0100")

    model_config = {
        "populate_by_name": True,
        "from_attributes": True
    }

class ComercioCreate(ComercioBase):
    pass

# --- INICIO DE LA MODIFICACIÓN ---
class ComercioUpdate(BaseModel):
    """
    Modelo para actualizar un comercio. Todos los campos son opcionales
    para permitir actualizaciones parciales.
    """
    nombre: Optional[str] = None
    direccion: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    numero_contacto: Optional[str] = None
# --- FIN DE LA MODIFICACIÓN ---

class Comercio(ComercioBase):
    pass


# --- TICKET MODELS ---
class TicketBase(BaseModel):
    id_pedido: int
    asunto_ticket: Optional[str] = Field(None, example="Problema con la entrega")

class TicketCreate(TicketBase):
    pass

class Ticket(TicketBase):
    id_ticket: int
    id_usuario_creador: str
    estado_ticket: EstadoTicket = Field(default=EstadoTicket.ABIERTO)
    fecha_creacion_ticket: datetime

    model_config = {"from_attributes": True, "use_enum_values": True}


class MensajeTicketBase(BaseModel):
    contenido_mensaje: str = Field(..., example="El cliente no se encuentra en la dirección.")
    nombre_archivo_adjunto: Optional[str] = Field(None, example="foto_problema.jpg")

class MensajeTicketCreate(MensajeTicketBase):
    pass

class MensajeTicket(MensajeTicketBase):
    id_mensaje: int
    id_ticket: int
    id_remitente: str
    tipo_remitente: TipoRemitenteTicket
    timestamp_mensaje: datetime

    model_config = {"from_attributes": True, "use_enum_values": True}

class TicketEstadoUpdate(BaseModel):
    estado_ticket: EstadoTicket

class NewUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    display_name: str

class UpdateUserRequest(BaseModel):
    disabled: Optional[bool] = None  # <-- Hazlo opcional también
    display_name: Optional[str] = None # <-- AÑADE ESTA LÍNEA

class ChangePasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6)
    
class UpdateCommissionRequest(BaseModel):
    porcentaje_comision: float = Field(..., ge=0, le=100)

class UsuarioProfileUpdate(BaseModel):
    nombre_display: Optional[str] = None

class IntegrationWebhookConfig(BaseModel):
    """Define la estructura de un único webhook para un evento específico."""
    url: str = Field(..., description="La URL a la que se enviará la petición POST.")
    payload_template: Dict[str, Any] = Field(..., description="El template del JSON que se enviará.")

class IntegrationConfigBase(BaseModel):
    """Campos base para una configuración de integración."""
    name: str = Field(..., description="Nombre legible para la integración, ej: 'PideFacil'")
    is_active: bool = True
    id_externo_prefix: str = Field(..., description="Prefijo para identificar pedidos de esta integración, ej: 'pd_'")
    webhooks: Dict[str, IntegrationWebhookConfig] = Field(..., description="Diccionario de webhooks, donde la clave es el tipo de evento.")

class IntegrationConfigCreate(IntegrationConfigBase):
    """Modelo para crear una nueva configuración."""
    pass

class IntegrationConfigUpdate(BaseModel):
    """Modelo para actualizar una configuración. Todos los campos son opcionales."""
    name: Optional[str] = None
    is_active: Optional[bool] = None
    id_externo_prefix: Optional[str] = None
    webhooks: Optional[Dict[str, IntegrationWebhookConfig]] = None

class IntegrationConfig(IntegrationConfigBase):
    """Modelo completo para respuestas de la API, incluyendo campos de la BD."""
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}