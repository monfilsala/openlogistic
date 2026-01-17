from fastapi import FastAPI, HTTPException, Depends, Body, Path, Query, UploadFile, File, Form, BackgroundTasks, WebSocket, WebSocketDisconnect, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from typing import List, Optional, Dict, Any
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
import logging
import pytz
import uuid
import shutil
import httpx
from decimal import Decimal
import io
import csv
from firebase_admin import auth
# Importar modelos, base de datos y utilidades de autenticación
from models import *
from database import *
from auth_utils import get_current_user, RoleChecker, User
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from contextlib import asynccontextmanager
import asyncio

# --- CONFIGURACIÓN INICIAL ---
CARACAS_TZ = pytz.timezone('America/Caracas')
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(name)s - %(message)s')
logger = logging.getLogger(__name__)

init_database()

scheduler = AsyncIOScheduler(timezone=str(CARACAS_TZ))

async def process_scheduled_orders():
    """
    Versión final y robusta del cron job:
    1. Calcula precios correctamente, solucionando el bug de 'tipo_vehiculo_str'.
    2. Crea comercios personalizados "al vuelo" si no existen.
    3. Registra logs detallados en la tabla system_logs para éxito o error.
    4. Emite un evento por WebSocket para notificar al frontend del procesamiento.
    """
    logger.info("CRON JOB: Verificando pedidos programados...")
    db = None
    try:
        db = get_db_connection()
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            # Usamos SKIP LOCKED para evitar que múltiples procesos tomen el mismo pedido
            cur.execute(
                "SELECT * FROM pedidos_programados WHERE fecha_liberacion <= NOW() AND estado = 'pendiente' FOR UPDATE SKIP LOCKED"
            )
            orders_to_process = cur.fetchall()

            if not orders_to_process:
                return # Salimos silenciosamente si no hay nada que hacer.

            cur.execute("SELECT valor FROM app_config WHERE clave = 'pricing_tiers'")
            config_row = cur.fetchone()
            if not config_row:
                logger.error("CRON JOB: ¡CONFIGURACIÓN DE TARIFAS NO ENCONTRADA! No se pueden procesar pedidos.")
                return

            logger.info(f"CRON JOB: Se encontraron {len(orders_to_process)} pedidos para procesar.")
            for scheduled_order in orders_to_process:
                order_id_log = scheduled_order['id']
                try:
                    payload = scheduled_order['payload_pedido']
                    pedido_data = PedidoCreate(**payload)

                    if 'custom_' in pedido_data.id_comercio:
                        logger.info(f"CRON JOB: Detectado comercio personalizado '{pedido_data.id_comercio}'. Creando registro...")
                        cur.execute(
                            "INSERT INTO comercios (id_comercio, nombre, numero_contacto) VALUES (%s, %s, %s) ON CONFLICT (id_comercio) DO NOTHING",
                            (pedido_data.id_comercio, pedido_data.nombre_comercio, pedido_data.telefono_comercio)
                        )

                    costo = 0.0
                    tipo_vehiculo_str = pedido_data.tipo_vehiculo.value if hasattr(pedido_data.tipo_vehiculo, 'value') else str(pedido_data.tipo_vehiculo)
                    
                    if all([pedido_data.latitud_retiro, pedido_data.longitud_retiro, pedido_data.latitud_entrega, pedido_data.longitud_entrega]):
                        costo_res = calcular_costo_delivery_ruta(
                            f"{pedido_data.latitud_retiro},{pedido_data.longitud_retiro}",
                            f"{pedido_data.latitud_entrega},{pedido_data.longitud_entrega}",
                            tipo_vehiculo_str,
                            config_completa=config_row['valor']
                        )
                        costo = costo_res.get('costo', 0.0)
                    else:
                        logger.warning(f"CRON JOB: No se pudo calcular costo para pedido programado #{order_id_log} por falta de coordenadas.")

                    q = "INSERT INTO pedidos (pedido, direccion_entrega, latitud_entrega, longitud_entrega, latitud_retiro, longitud_retiro, estado, detalles, telefono_contacto, telefono_comercio, link_maps, id_comercio, costo_servicio, tipo_vehiculo, creado_por_usuario_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *"
                    cur.execute(q, (
                        pedido_data.pedido, pedido_data.direccion_entrega, pedido_data.latitud_entrega,
                        pedido_data.longitud_entrega, pedido_data.latitud_retiro, pedido_data.longitud_retiro,
                        'pendiente', pedido_data.detalles, pedido_data.telefono_contacto,
                        pedido_data.telefono_comercio, pedido_data.link_maps, pedido_data.id_comercio,
                        costo, tipo_vehiculo_str, pedido_data.creado_por_usuario_id
                    ))
                    nuevo_pedido = cur.fetchone()
                    
                    nuevo_pedido['nombre_comercio'] = pedido_data.nombre_comercio

                    log_system_action(db, "INFO", "scheduled_order_released", {
                        "scheduled_order_id": order_id_log,
                        "new_order_id": nuevo_pedido['id'],
                        "status": "success"
                    })
                    
                    cur.execute("UPDATE pedidos_programados SET estado = 'procesado' WHERE id = %s", (order_id_log,))
                    
                    await manager.broadcast({"type": "SCHEDULED_ORDER_PROCESSED", "data": {"id": order_id_log, "status": "procesado"}})
                    await manager.broadcast({"type": "NEW_ORDER", "data": nuevo_pedido})
                    
                    logger.info(f"CRON JOB: Pedido programado #{order_id_log} procesado. Creado pedido real #{nuevo_pedido['id']} con costo ${costo}.")

                except Exception as e:
                    db.rollback()
                    error_message = str(e)
                    logger.error(f"CRON JOB: Error procesando pedido programado #{order_id_log}: {error_message}")
                    
                    log_system_action(db, "ERROR", "scheduled_order_failed", {
                        "scheduled_order_id": order_id_log,
                        "error": error_message
                    })
                    
                    with db.cursor() as error_cur:
                        error_cur.execute("UPDATE pedidos_programados SET estado = 'error' WHERE id = %s", (order_id_log,))
                    db.commit()
                    
                    await manager.broadcast({"type": "SCHEDULED_ORDER_PROCESSED", "data": {"id": order_id_log, "status": "error"}})
                    continue

            db.commit()
    
    except Exception as e:
        logger.error(f"CRON JOB: Fallo general en la tarea de procesamiento: {e}")
        if db: db.rollback()
    finally:
        if db: db.close()


# --- USAMOS LIFESPAN PARA INICIAR Y DETENER EL SCHEDULER ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Código que se ejecuta al iniciar la aplicación
    scheduler.add_job(process_scheduled_orders, IntervalTrigger(minutes=1), id="process_orders_job", replace_existing=True)
    scheduler.start()
    logger.info("Planificador de tareas iniciado. Verificará pedidos cada minuto.")
    yield
    # Código que se ejecuta al detener la aplicación
    scheduler.shutdown()
    logger.info("Planificador de tareas detenido.")


REPORT_DEFINITIONS = {
    'fields': {
        'id_pedido': ('ID Pedido', 'p.id'),
        'fecha_creacion': ('Fecha Creación', 'p.fecha_creacion'),
        'estado': ('Estado', 'p.estado'),
        'descripcion_pedido': ('Descripción Pedido', 'p.pedido'),
        'direccion_entrega': ('Dirección Entrega', 'p.direccion_entrega'),
        'costo_servicio': ('Costo Servicio ($)', 'p.costo_servicio'),
        'tipo_vehiculo': ('Tipo Vehículo', 'p.tipo_vehiculo'),
        'id_repartidor': ('ID Repartidor', 'p.repartidor_id'),
        'nombre_repartidor': ('Nombre Repartidor', 'u.nombre_display'),
        'id_comercio': ('ID Comercio', 'p.id_comercio'),
        'nombre_comercio': ('Nombre Comercio', 'c.nombre'),
    },
    'formulas': {
        'duracion_pedido_min': ('Duración Pedido (min)', "EXTRACT(EPOCH FROM (p.fecha_actualizacion - p.fecha_creacion)) / 60"),
        'comision_repartidor': ('Comisión Repartidor ($)', '(p.costo_servicio * u.porcentaje_comision / 100)'),
    },
    'filters': {
        'fecha_inicio': "DATE(p.fecha_creacion) >= %s",
        'fecha_fin': "DATE(p.fecha_creacion) <= %s",
        'repartidor_id': "p.repartidor_id = %s",
        'id_comercio': "p.id_comercio = %s",
        'estado': "p.estado = ANY(%s)",
    }
}
# --- ACTUALIZA LA CREACIÓN DE TU APP ---
app = FastAPI(
    title="Delivery App Enterprise API",
    version="4.0.1",
    description="Plataforma de logística completa con Roles y Permisos basados en Firebase.",
    lifespan=lifespan # <-- AÑADE ESTO
)

UPLOAD_DIR = "uploads/ticket_attachments"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

class PedidoProgramadoResponse(BaseModel):
    id: int
    payload_pedido: Dict[str, Any]
    fecha_liberacion: datetime
    estado: str
    fecha_creacion: datetime

# --- WEBSOCKET CONNECTION MANAGER ---
class ConnectionManager:
    def __init__(self): self.active_connections: List[WebSocket] = []
    async def connect(self, ws: WebSocket): await ws.accept(); self.active_connections.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections: self.active_connections.remove(ws)
    async def broadcast(self, msg: dict):
        json_msg = json.dumps(msg, default=str)
        for conn in list(self.active_connections):
            try: await conn.send_text(json_msg)
            except Exception: pass
manager = ConnectionManager()

# --- UTILS DE BD Y LOGGING ---
def get_db():
    conn = get_db_connection()
    try: yield conn
    finally: conn.close()

def log_system_action(db_conn, nivel: str, accion: str, detalles: dict, usuario: str = "sistema"):
    """
    Registra una acción en la base de datos Y emite un evento por WebSocket.
    """
    try:
        # 1. Insertar en la base de datos (como antes)
        with db_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO system_logs (nivel, accion, usuario_responsable, detalles) VALUES (%s, %s, %s, %s)",
                (nivel, accion, usuario, json.dumps(detalles, default=str))
            )

        # --- INICIO DE LA CORRECCIÓN ---
        # 2. Preparar el payload para el WebSocket
        # Creamos un objeto que se parezca a lo que la base de datos guardaría
        log_payload = {
            "timestamp": datetime.now(CARACAS_TZ).isoformat(),
            "nivel": nivel,
            "accion": accion,
            "usuario_responsable": usuario,
            "detalles": detalles,
        }

        # 3. Enviar el evento por WebSocket de forma asíncrona
        # Usamos asyncio.create_task para no bloquear la función síncrona
        asyncio.create_task(
            manager.broadcast({"type": "NEW_SYSTEM_LOG", "data": log_payload})
        )
        # --- FIN DE LA CORRECCIÓN ---

    except Exception as e:
        logger.error(f"Fallo al escribir o transmitir log de sistema: {e}")

def log_pedido_status_change(cur, pedido_id, nuevo_estado, repartidor_id=None, manual_change=False):
    lat, lon = None, None
    if repartidor_id:
        cur.execute("SELECT ultima_latitud, ultima_longitud FROM usuarios WHERE id_usuario = %s", (repartidor_id,))
        r = cur.fetchone()
        if r: lat, lon = r['ultima_latitud'], r['ultima_longitud']
    est = f"manual_{nuevo_estado}" if manual_change else nuevo_estado
    cur.execute("INSERT INTO pedidos_logs (id_pedido, repartidor_id, estado_registrado, latitud, longitud) VALUES (%s, %s, %s, %s, %s)", (pedido_id, repartidor_id, est, lat, lon))

# --- MIDDLEWARE DE AUDITORÍA ---
class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        req_body_bytes = await request.body()
        response = await call_next(request)
        res_body_bytes = b''
        async for chunk in response.body_iterator: res_body_bytes += chunk
        path = request.url.path
        if path.startswith(("/dashboard", "/drivers", "/ws")) or path == "/":
            return Response(content=res_body_bytes, status_code=response.status_code, headers=dict(response.headers))
        log_details = {"client_ip": request.client.host, "method": request.method, "path": path, "request_body": req_body_bytes.decode(errors='ignore'), "status_code": response.status_code}
        db_conn = get_db_connection()
        try:
            log_system_action(db_conn, "INFO", "api_request", log_details, usuario=request.client.host)
            db_conn.commit()
        finally: db_conn.close()
        return Response(content=res_body_bytes, status_code=response.status_code, headers=dict(response.headers))

app.add_middleware(AuditLogMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: manager.disconnect(websocket)

@app.get("/")
async def root(): return {"message": "Delivery Platform V4.0.1 Running"}

# --- ENDPOINTS DE ADMINISTRACIÓN DE USUARIOS ---

@app.post("/admin/users", response_model=dict, tags=["Admin"], dependencies=[Depends(get_current_user)])
async def create_firebase_user(user_data: NewUserRequest):
    """
    Crea un nuevo usuario en Firebase Authentication para un repartidor.
    """
    try:
        user = auth.create_user(
            email=user_data.email,
            password=user_data.password,
            display_name=user_data.display_name,
            email_verified=False
        )
        return {"uid": user.uid, "email": user.email, "message": "Usuario creado exitosamente"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/admin/users", tags=["Admin"], dependencies=[Depends(get_current_user)])
async def list_firebase_users():
    """
    Obtiene una lista de todos los usuarios registrados en Firebase Authentication.
    """
    try:
        users_list = []
        for user in auth.list_users().iterate_all():
            users_list.append({
                "uid": user.uid,
                "email": user.email,
                "display_name": user.display_name,
                "disabled": user.disabled,
                "creation_timestamp": user.user_metadata.creation_timestamp,
            })
        return users_list
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/admin/users/{uid}", response_model=dict, tags=["Admin"], dependencies=[Depends(get_current_user)])
async def update_firebase_user(uid: str, update_data: UpdateUserRequest):
    """
    Actualiza datos de un usuario en Firebase (nombre, estado habilitado/deshabilitado).
    """
    update_payload = update_data.model_dump(exclude_unset=True)
    if not update_payload:
        raise HTTPException(status_code=400, detail="No se enviaron datos para actualizar.")
    try:
        updated_user = auth.update_user(uid, **update_payload)
        return {"uid": updated_user.uid, "disabled": updated_user.disabled, "displayName": updated_user.display_name}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/admin/users/{uid}/password", status_code=200, tags=["Admin"], dependencies=[Depends(get_current_user)])
async def change_user_password(uid: str, password_data: ChangePasswordRequest):
    """
    Cambia la contraseña de un usuario de Firebase.
    """
    try:
        auth.update_user(uid, password=password_data.new_password)
        return {"status": "success", "message": "Contraseña actualizada."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/usuarios/{id_usuario}/comision", response_model=Usuario, tags=["Usuarios"], dependencies=[Depends(get_current_user)])
async def actualizar_comision_usuario(
    id_usuario: str, 
    data: UpdateCommissionRequest, 
    db=Depends(get_db)
):
    """
    Actualiza el porcentaje de comisión de un repartidor en la base de datos local.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "UPDATE usuarios SET porcentaje_comision = %s WHERE id_usuario = %s RETURNING *",
            (data.porcentaje_comision, id_usuario)
        )
        if cur.rowcount == 0:
            # Si el usuario no existe, lo creamos para poder asignarle la comisión
            cur.execute(
                "INSERT INTO usuarios (id_usuario, porcentaje_comision) VALUES (%s, %s) RETURNING *",
                (id_usuario, data.porcentaje_comision)
            )
        updated_user = cur.fetchone()
        db.commit()
        return Usuario(**updated_user)

@app.delete("/admin/users/{uid}", status_code=200, tags=["Admin"], dependencies=[Depends(get_current_user)])
async def delete_firebase_user(uid: str):
    """
    Elimina permanentemente un usuario de Firebase Authentication.
    """
    try:
        auth.delete_user(uid)
        return {"status": "deleted", "uid": uid}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/admin/users/{uid}/role", tags=["Admin"], dependencies=[Depends(get_current_user)])
async def set_user_role(
    uid: str, 
    role_data: dict = Body(...), 
    current_user: User = Depends(get_current_user) # Todavía requiere login, pero no rol
):
    """
    Asigna un rol a un usuario de Firebase a través de Custom Claims.
    (Versión temporalmente desprotegida para asignar el primer admin).
    """
    role = role_data.get('role')
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El campo 'role' es requerido.")
    
    try:
        # Esto incrusta el rol en el token JWT del usuario para futuros logins
        auth.set_custom_user_claims(uid, {'role': role})
        
        # Loguear la acción
        db = get_db_connection()
        try:
            log_system_action(db, "CRITICAL", "role_changed", 
                              {"target_uid": uid, "new_role": role}, 
                              usuario=current_user.email)
            db.commit()
        finally:
            db.close()
            
        return {"status": "success", "message": f"Rol '{role}' asignado al usuario {uid}."}
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))

@app.put("/usuarios/{id_usuario}/profile", response_model=Usuario, tags=["Usuarios"], dependencies=[Depends(get_current_user)])
async def actualizar_perfil_usuario(
    id_usuario: str,
    data: UsuarioProfileUpdate,
    db=Depends(get_db)
):
    """
    Actualiza el nombre para mostrar de un repartidor en la base de datos local.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "UPDATE usuarios SET nombre_display = %s WHERE id_usuario = %s RETURNING *",
            (data.nombre_display, id_usuario)
        )
        if cur.rowcount == 0:
            # Si no existe, lo creamos
            cur.execute(
                "INSERT INTO usuarios (id_usuario, nombre_display) VALUES (%s, %s) RETURNING *",
                (id_usuario, data.nombre_display)
            )
        updated_user = cur.fetchone()
        db.commit()
        return Usuario(**updated_user)

# --- ENDPOINTS DE PEDIDOS (CORE) ---

@app.post("/pedidos", response_model=Pedido, status_code=201, tags=["Pedidos"])
async def crear_pedido(pedido_data: PedidoCreate, db=Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        if isinstance(pedido_data.tipo_vehiculo, str): tipo_vehiculo_str = pedido_data.tipo_vehiculo
        else: tipo_vehiculo_str = pedido_data.tipo_vehiculo.value
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT valor FROM app_config WHERE clave = 'pricing_tiers'")
            config_row = cur.fetchone()
            if not config_row: raise HTTPException(503, "Configuración de tarifas no encontrada.")
            costo_res = calcular_costo_delivery_ruta(f"{pedido_data.latitud_retiro},{pedido_data.longitud_retiro}", f"{pedido_data.latitud_entrega},{pedido_data.longitud_entrega}", tipo_vehiculo_str, config_completa=config_row['valor'])
        costo = costo_res.get('costo', 0.0)
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("INSERT INTO comercios (id_comercio, nombre) VALUES (%s, %s) ON CONFLICT (id_comercio) DO NOTHING", (pedido_data.id_comercio, pedido_data.nombre_comercio))
            q = "INSERT INTO pedidos (pedido, direccion_entrega, latitud_entrega, longitud_entrega, latitud_retiro, longitud_retiro, estado, detalles, telefono_contacto, telefono_comercio, link_maps, id_comercio, costo_servicio, tipo_vehiculo, creado_por_usuario_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *"
            cur.execute(q, (pedido_data.pedido, pedido_data.direccion_entrega, pedido_data.latitud_entrega, pedido_data.longitud_entrega, pedido_data.latitud_retiro, pedido_data.longitud_retiro, 'pendiente', pedido_data.detalles, pedido_data.telefono_contacto, pedido_data.telefono_comercio, pedido_data.link_maps, pedido_data.id_comercio, costo, tipo_vehiculo_str, current_user.email))
            nuevo_pedido = cur.fetchone()
            if pedido_data.id_externo: cur.execute("INSERT INTO integraciones (pedido_id, id_externo) VALUES (%s, %s)", (nuevo_pedido['id'], pedido_data.id_externo)); nuevo_pedido['id_externo'] = pedido_data.id_externo
            log_system_action(db, "INFO", "create_order", {"id": nuevo_pedido['id'], "cost": costo}, usuario=current_user.email)
            db.commit()
        nuevo_pedido['nombre_comercio'] = pedido_data.nombre_comercio
        await manager.broadcast({"type": "NEW_ORDER", "data": nuevo_pedido})
        return Pedido(**nuevo_pedido)
    except Exception as e:
        db.rollback(); raise HTTPException(500, str(e))

@app.get("/pedidos", response_model=List[Pedido], tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def listar_pedidos(limit: int=100, estado: Optional[str]=None, fecha_inicio: Optional[str]=None, fecha_fin: Optional[str]=None, db=Depends(get_db)):
    q = "SELECT p.*, c.nombre as nombre_comercio, i.id_externo FROM pedidos p JOIN comercios c ON p.id_comercio = c.id_comercio LEFT JOIN integraciones i ON p.id = i.pedido_id WHERE 1=1"
    params = []
    if estado: q += " AND p.estado = ANY(%s)"; params.append(estado.split(','))
    if fecha_inicio: q += " AND DATE(p.fecha_creacion) >= %s"; params.append(fecha_inicio)
    if fecha_fin: q += " AND DATE(p.fecha_creacion) <= %s"; params.append(fecha_fin)
    q += " ORDER BY p.fecha_creacion DESC LIMIT %s"; params.append(limit)
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(q, tuple(params))
        return [Pedido(**p) for p in cur.fetchall()]



@app.put("/pedidos/{pedido_id}", response_model=Pedido, tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def editar_pedido_completo(pedido_id: int, datos: dict = Body(...), db=Depends(get_db), current_user: User = Depends(get_current_user)):
    
    # --- LÍNEA A MODIFICAR ---
    # Se añaden los cuatro campos de coordenadas a la lista de campos permitidos.
    allowed_fields = [
        'pedido', 'direccion_entrega', 'detalles', 
        'telefono_contacto', 'telefono_comercio', 
        'costo_servicio', 'repartidor_id',
        'latitud_retiro', 'longitud_retiro',       # <--- AÑADIDO
        'latitud_entrega', 'longitud_entrega'      # <--- AÑADIDO
    ]
    # --- FIN DE LA MODIFICACIÓN ---

    updates = []
    values = []
    
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT repartidor_id FROM pedidos WHERE id = %s", (pedido_id,))
        pedido_actual = cur.fetchone()
        if not pedido_actual: raise HTTPException(404, "Pedido no encontrado")
        
        repartidor_anterior = pedido_actual['repartidor_id']

    # Lógica de cambio de estado al cambiar repartidor
    if 'repartidor_id' in datos and datos['repartidor_id'] != repartidor_anterior:
        nuevo_repartidor = datos.get('repartidor_id')
        if nuevo_repartidor:
            updates.append("estado = 'aceptado'")
        else:
            updates.append("estado = 'pendiente'")

    for key, val in datos.items():
        if key in allowed_fields:
            updates.append(f"{key} = %s")
            values.append(val if val != '' else None)
            
    if not updates: raise HTTPException(400, "No hay campos válidos")
    values.append(pedido_id)
    
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f"UPDATE pedidos SET {', '.join(updates)} WHERE id = %s RETURNING *", tuple(values))
        updated = cur.fetchone()
        log_system_action(db, "WARNING", "edit_order_details", {"id": pedido_id, "changes": datos}, usuario=current_user.email)
        db.commit()
        
        cur.execute("SELECT nombre FROM comercios WHERE id_comercio = %s", (updated['id_comercio'],))
        updated['nombre_comercio'] = cur.fetchone()['nombre']
        
        await manager.broadcast({"type": "ORDER_STATUS_UPDATE", "id": pedido_id, "data": updated})
        return Pedido(**updated)

@app.patch("/pedidos/{pedido_id}/estado", response_model=Pedido, tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def actualizar_estado_pedido(
    pedido_id: int, 
    data: PedidoEstadoUpdate, 
    db=Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Actualiza el estado de un pedido (ej: a llevando, entregado, etc.)."""
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Bloquear el pedido y obtener su estado actual
            cur.execute("SELECT estado, repartidor_id FROM pedidos WHERE id = %s FOR UPDATE", (pedido_id,))
            pedido_actual = cur.fetchone()
            if not pedido_actual:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")

            # 2. Lógica de negocio para el repartidor
            repartidor_id_final = pedido_actual['repartidor_id']
            if data.estado == EstadoPedido.PENDIENTE:
                repartidor_id_final = None
            elif data.estado == EstadoPedido.ACEPTADO and not repartidor_id_final:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se puede aceptar un pedido sin repartidor asignado.")

            # 3. Actualizar la base de datos
            cur.execute(
                "UPDATE pedidos SET estado = %s, repartidor_id = %s WHERE id = %s RETURNING *",
                (data.estado.value, repartidor_id_final, pedido_id)
            )
            updated = cur.fetchone()

            # 4. Logs
            # --- LÍNEA AÑADIDA Y CORREGIDA ---
            log_pedido_status_change(cur, pedido_id, data.estado.value, repartidor_id_final, manual_change=True)
            # --- FIN DE LA CORRECCIÓN ---
            log_system_action(db, "INFO", "update_status", {"id": pedido_id, "new_status": data.estado.value}, usuario=current_user.email)
            
            db.commit()

            # 5. Enviar respuesta y notificar
            cur.execute("SELECT nombre FROM comercios WHERE id_comercio = %s", (updated['id_comercio'],))
            updated['nombre_comercio'] = cur.fetchone()['nombre']
            
            await manager.broadcast({"type": "ORDER_STATUS_UPDATE", "id": pedido_id, "data": updated})
            
            return Pedido(**updated)
    except HTTPException as http_exc:
        db.rollback()
        raise http_exc
    except Exception as e:
        db.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))

@app.get("/pedidos/{pedido_id}/logs", tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def obtener_logs_del_pedido(pedido_id: int, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM pedidos_logs WHERE id_pedido = %s ORDER BY timestamp_log ASC;", (pedido_id,))
        return cur.fetchall()

@app.post("/pedidos/programados", tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def crear_programado(payload: dict = Body(...), fecha_liberacion: str = Body(...), db=Depends(get_db)):
    try:
        dt = datetime.fromisoformat(fecha_liberacion)
        with db.cursor() as cur: cur.execute("INSERT INTO pedidos_programados (payload_pedido, fecha_liberacion) VALUES (%s, %s)", (json.dumps(payload.get('payload', payload)), dt))
        db.commit()
        return {"status": "created"}
    except Exception as e: db.rollback(); raise HTTPException(500, str(e))

@app.get("/pedidos/programados", response_model=List[PedidoProgramadoResponse], tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def listar_programados(db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM pedidos_programados WHERE estado = 'pendiente' ORDER BY fecha_liberacion ASC")
        return cur.fetchall()

class ScheduledOrderUpdate(BaseModel):
    fecha_liberacion: datetime
    payload_pedido: Dict[str, Any]

@app.put("/pedidos/programados/{programado_id}", status_code=200, tags=["Pedidos"])
async def modificar_pedido_programado(
    programado_id: int,
    data: ScheduledOrderUpdate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        with db.cursor() as cur:
            cur.execute(
                "UPDATE pedidos_programados SET fecha_liberacion = %s, payload_pedido = %s WHERE id = %s",
                (data.fecha_liberacion, json.dumps(data.payload_pedido), programado_id)
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Pedido programado no encontrado")
            db.commit()
        return {"status": "success", "id": programado_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/pedidos/programados/{programado_id}", status_code=200, tags=["Pedidos"])
async def eliminar_pedido_programado(
    programado_id: int,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        with db.cursor() as cur:
            cur.execute("DELETE FROM pedidos_programados WHERE id = %s", (programado_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Pedido programado no encontrado")
            db.commit()
        return {"status": "deleted", "id": programado_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/pedidos/{pedido_id}", response_model=Pedido, tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def obtener_pedido_por_id(pedido_id: int, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT p.*, c.nombre as nombre_comercio, i.id_externo FROM pedidos p LEFT JOIN comercios c ON p.id_comercio = c.id_comercio LEFT JOIN integraciones i ON p.id = i.pedido_id WHERE p.id = %s;", (pedido_id,))
        pedido = cur.fetchone()
        if not pedido: raise HTTPException(404, f"Pedido {pedido_id} no encontrado.")
        return Pedido(**pedido)
# --- ENDPOINTS TICKETS ---

@app.post("/pedidos/{pedido_id}/repartidor/{id_repartidor}/tickets", response_model=Ticket, tags=["Tickets"])
async def crear_ticket_para_pedido(pedido_id: int, id_repartidor: str, data: TicketCreate, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT estado, repartidor_id FROM pedidos WHERE id = %s FOR UPDATE", (pedido_id,))
        pedido = cur.fetchone()
        if not pedido: raise HTTPException(404, "Pedido no encontrado")
        if pedido['repartidor_id'] != id_repartidor: raise HTTPException(403, "No puedes crear ticket para este pedido")
        estado_previo = pedido['estado']
        cur.execute("UPDATE pedidos SET estado = %s, tiene_ticket_abierto = TRUE, estado_previo_novedad = %s WHERE id = %s", ('con_novedad', estado_previo, pedido_id))
        cur.execute("INSERT INTO tickets (id_pedido, id_usuario_creador, asunto_ticket) VALUES (%s, %s, %s) RETURNING *", (pedido_id, id_repartidor, data.asunto_ticket))
        nuevo_ticket = cur.fetchone()
        log_system_action(db, "WARNING", "ticket_created", {"id": nuevo_ticket['id_ticket'], "pedido": pedido_id}, usuario=id_repartidor)
        db.commit()
        await manager.broadcast({"type": "NEW_TICKET", "data": nuevo_ticket})
        cur.execute("SELECT p.*, c.nombre as nombre_comercio FROM pedidos p JOIN comercios c ON p.id_comercio = c.id_comercio WHERE p.id = %s", (pedido_id,))
        await manager.broadcast({"type": "ORDER_STATUS_UPDATE", "id": pedido_id, "data": cur.fetchone()})
        return Ticket(**nuevo_ticket)

@app.get("/tickets/active", tags=["Tickets"], dependencies=[Depends(get_current_user)])
async def get_active_tickets(db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT t.*, p.pedido as nombre_pedido, u.nombre_display as creador_display FROM tickets t JOIN pedidos p ON t.id_pedido = p.id JOIN usuarios u ON t.id_usuario_creador = u.id_usuario WHERE t.estado_ticket IN ('abierto', 'en_progreso') ORDER BY t.fecha_creacion_ticket DESC")
        return cur.fetchall()

@app.get("/tickets/{ticket_id}/mensajes", response_model=List[MensajeTicket], tags=["Tickets"], dependencies=[Depends(get_current_user)])
async def listar_mensajes_por_ticket(ticket_id: int, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM mensajes_ticket WHERE id_ticket = %s ORDER BY timestamp_mensaje ASC", (ticket_id,))
        return [MensajeTicket(**m) for m in cur.fetchall()]

@app.post("/tickets/{ticket_id}/mensajes", response_model=MensajeTicket, tags=["Tickets"], dependencies=[Depends(get_current_user)])
async def agregar_mensaje_a_ticket(ticket_id: int, contenido_mensaje: Optional[str] = Form(""), id_remitente: str = Form(...), tipo_remitente: TipoRemitenteTicket = Form(...), archivo_adjunto: Optional[UploadFile] = File(None), db=Depends(get_db)):
    if not contenido_mensaje and not archivo_adjunto: raise HTTPException(400, "Se requiere contenido o archivo.")
    filename = None
    if archivo_adjunto:
        filename = f"{uuid.uuid4()}_{archivo_adjunto.filename}"
        with open(os.path.join(UPLOAD_DIR, filename), "wb") as f: shutil.copyfileobj(archivo_adjunto.file, f)
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("INSERT INTO mensajes_ticket (id_ticket, id_remitente, tipo_remitente, contenido_mensaje, nombre_archivo_adjunto) VALUES (%s, %s, %s, %s, %s) RETURNING *", (ticket_id, id_remitente, tipo_remitente.value, contenido_mensaje, filename))
        msg = cur.fetchone()
        db.commit()
        await manager.broadcast({"type": "NEW_TICKET_MESSAGE", "data": msg})
        return MensajeTicket(**msg)

@app.patch("/tickets/{ticket_id}/estado", response_model=Ticket, tags=["Tickets"], dependencies=[Depends(get_current_user)])
async def actualizar_estado_ticket(ticket_id: int, data: TicketEstadoUpdate, db=Depends(get_db), current_user: User = Depends(get_current_user)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id_pedido FROM tickets WHERE id_ticket = %s FOR UPDATE", (ticket_id,))
        ticket_info = cur.fetchone()
        if not ticket_info: raise HTTPException(404, "Ticket no encontrado")
        cur.execute("UPDATE tickets SET estado_ticket = %s WHERE id_ticket = %s RETURNING *", (data.estado_ticket.value, ticket_id))
        ticket_actualizado = cur.fetchone()
        if data.estado_ticket in [EstadoTicket.RESUELTO, EstadoTicket.CERRADO]:
            cur.execute("SELECT estado_previo_novedad FROM pedidos WHERE id = %s", (ticket_info['id_pedido'],))
            estado_a_restaurar = cur.fetchone()['estado_previo_novedad'] or 'aceptado'
            cur.execute("UPDATE pedidos SET estado = %s, tiene_ticket_abierto = FALSE WHERE id = %s", (estado_a_restaurar, ticket_info['id_pedido']))
        log_system_action(db, "INFO", "ticket_status_updated", {"id": ticket_id, "new": data.estado_ticket.value}, usuario=current_user.email)
        db.commit()
        await manager.broadcast({"type": "TICKET_STATUS_UPDATE", "data": ticket_actualizado})
        cur.execute("SELECT p.*, c.nombre as nombre_comercio FROM pedidos p JOIN comercios c ON p.id_comercio = c.id_comercio WHERE p.id = %s", (ticket_info['id_pedido'],))
        await manager.broadcast({"type": "ORDER_STATUS_UPDATE", "id": ticket_info['id_pedido'], "data": cur.fetchone()})
        return Ticket(**ticket_actualizado)

# --- DASHBOARD, DRIVERS, USUARIOS ---
@app.get("/dashboard/summary", tags=["Dashboard"], dependencies=[Depends(get_current_user)])
async def get_dashboard_summary(db=Depends(get_db)):
    """Métricas en tiempo real para el Dashboard de React."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # Pedidos Creados Hoy
        cur.execute("SELECT COUNT(*) as total FROM pedidos WHERE DATE(fecha_creacion) = CURRENT_DATE;")
        pedidos_hoy = cur.fetchone()['total']
        
        # Pedidos Completados Hoy (Entregados)
        cur.execute("SELECT COUNT(*) as total FROM pedidos WHERE estado = 'entregado' AND DATE(fecha_creacion) = CURRENT_DATE;")
        pedidos_completados_hoy = cur.fetchone()['total']
        
        # --- CORRECCIÓN CLAVE AQUÍ ---
        # Cambiar el intervalo de 30 a 10 minutos para la definición de "activo"
        cur.execute("SELECT COUNT(DISTINCT id_usuario) as total FROM usuarios WHERE ultima_actualizacion_loc >= NOW() - INTERVAL '10 minutes';")
        drivers_activos = cur.fetchone()['total']
        # --- FIN DE LA CORRECCIÓN ---
        
        # Tickets Abiertos
        cur.execute("SELECT COUNT(*) as total FROM tickets WHERE estado_ticket = 'abierto';")
        tickets_abiertos = cur.fetchone()['total']

        return {
            "pedidos_hoy": pedidos_hoy,
            "pedidos_completados_hoy": pedidos_completados_hoy,
            "drivers_activos": drivers_activos,
            "tickets_abiertos": tickets_abiertos
        }

@app.get("/drivers/detailed", tags=["Drivers"], dependencies=[Depends(get_current_user)])
async def get_drivers_detailed(db=Depends(get_db)):
    query = "SELECT u.*, (SELECT json_build_object('id', p.id, 'fecha', p.fecha_creacion, 'comercio', c.nombre, 'monto', p.costo_servicio) FROM pedidos p JOIN comercios c ON p.id_comercio = c.id_comercio WHERE p.repartidor_id = u.id_usuario AND p.estado = 'entregado' ORDER BY p.fecha_creacion DESC LIMIT 1) as ultimo_pedido FROM usuarios u WHERE u.ultima_latitud IS NOT NULL ORDER BY u.ultima_actualizacion_loc DESC NULLS LAST;"
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query)
        res = cur.fetchall()
        for d in res:
            if d.get('ultimo_pedido') and isinstance(d['ultimo_pedido'], str): d['ultimo_pedido'] = json.loads(d['ultimo_pedido'])
        return res

@app.post("/ubicaciones", tags=["Ubicaciones"])
async def actualizar_ubicacion_usuario(data: UbicacionUsuario, db=Depends(get_db)):
    ts = data.timestamp.astimezone(CARACAS_TZ)
    
    # --- INICIO DE LA CORRECCIÓN ---
    
    # Paso 1: Notificar a todos los dashboards conectados INMEDIATAMENTE.
    # Esta es la parte más importante para la actualización en tiempo real.
    await manager.broadcast({"type": "DRIVER_LOCATION_UPDATE", "data": data.model_dump()})

    # Paso 2: Intentar guardar en Redis para acceso rápido (opcional pero recomendado)
    r = get_redis_client()
    if r:
        try:
            r.hset(f"driver:{data.id_usuario}", mapping={"lat": data.latitud, "lng": data.longitud, "estado": data.estado, "bat": data.bateria_porcentaje or 0, "ts": str(ts)})
            r.expire(f"driver:{data.id_usuario}", 3600)
        except Exception as e:
            # Es buena idea registrar si Redis falla, pero no detener el flujo.
            logger.warning(f"No se pudo escribir la ubicación en Redis: {e}")

    # --- FIN DE LA CORRECCIÓN ---

    # Paso 3: Guardar en la base de datos para persistencia a largo plazo.
    with db.cursor() as cur:
        cur.execute("INSERT INTO usuarios (id_usuario, ultima_latitud, ultima_longitud, ultima_actualizacion_loc, estado_actual, ultima_bateria_porcentaje) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (id_usuario) DO UPDATE SET ultima_latitud=EXCLUDED.ultima_latitud, ultima_longitud=EXCLUDED.ultima_longitud, ultima_actualizacion_loc=EXCLUDED.ultima_actualizacion_loc, estado_actual=EXCLUDED.estado_actual, ultima_bateria_porcentaje=EXCLUDED.ultima_bateria_porcentaje", (data.id_usuario, data.latitud, data.longitud, ts, data.estado, data.bateria_porcentaje))
        cur.execute("INSERT INTO ubicaciones_log (id_usuario, latitud, longitud, timestamp) VALUES (%s,%s,%s,%s)", (data.id_usuario, data.latitud, data.longitud, ts))
        db.commit()
        
    return {"msg": "OK"}
    
@app.get("/usuarios/{id_usuario}", response_model=Usuario, tags=["Usuarios"], dependencies=[Depends(get_current_user)])
async def obtener_usuario(id_usuario: str, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM usuarios WHERE id_usuario = %s", (id_usuario,))
        data = cur.fetchone()
        if not data: raise HTTPException(404, "Usuario no encontrado")
        return Usuario(**data)

# --- LOGS, CONFIG, GEOCODING, REPORTES ---
@app.get("/system/logs", tags=["System"], dependencies=[Depends(get_current_user)])
async def get_system_logs(limit: int = 100, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT %s", (limit,))
        return cur.fetchall()

@app.get("/config", tags=["Config"], dependencies=[Depends(get_current_user)])
async def get_all_config_keys(db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT clave, updated_at FROM app_config ORDER BY clave ASC")
        return cur.fetchall()

@app.get("/config/{key}", tags=["Config"], dependencies=[Depends(get_current_user)])
async def get_config_by_key(key: str, db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute("SELECT valor FROM app_config WHERE clave = %s", (key,))
        res = cur.fetchone()
        if not res: raise HTTPException(404, "Clave no encontrada.")
        return res[0]

@app.put("/config/{key}", tags=["Config"], dependencies=[Depends(get_current_user)])
async def update_config_by_key(key: str, value: Any = Body(...), db=Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Actualiza o crea una clave de configuración.
    (Versión final protegida por rol 'admin').
    """
    try:
        json_value = json.dumps(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="El cuerpo de la petición no es un JSON válido.")

    with db.cursor() as cur:
        cur.execute("""
            INSERT INTO app_config (clave, valor, updated_at) 
            VALUES (%s, %s, NOW())
            ON CONFLICT (clave) DO UPDATE SET 
                valor = EXCLUDED.valor, 
                updated_at = NOW()
        """, (key, json_value))
    
    # Logueamos con el email del admin que hizo el cambio
    log_system_action(db, "CRITICAL", "config_updated", {"key": key}, usuario=current_user.email)
    db.commit()
    return {"status": "success", "key": key, "value": value}

@app.get("/geocoding/autocomplete", tags=["Geocoding"], dependencies=[Depends(get_current_user)])
async def autocomplete_address(input: str = Query(...)):
    res = get_address_autocomplete(input, str(uuid.uuid4()))
    if "error" in res: raise HTTPException(500, res["error"])
    return res

@app.get("/geocoding/details", tags=["Geocoding"], dependencies=[Depends(get_current_user)])
async def get_coordinates_for_place(place_id: str = Query(...)):
    res = get_place_details(place_id, str(uuid.uuid4()))
    if "error" in res: raise HTTPException(500, res["error"])
    return res
    
@app.get("/reports/definitions", tags=["Reports"], dependencies=[Depends(get_current_user)])
async def get_report_definitions():
    return {
        'fields': {key: val[0] for key, val in REPORT_DEFINITIONS['fields'].items()},
        'formulas': {key: val[0] for key, val in REPORT_DEFINITIONS['formulas'].items()}
    }

@app.post("/reports/generate", tags=["Reports"], dependencies=[Depends(get_current_user)])
async def generate_report(request: Request, db=Depends(get_db)):
    config = await request.json()
    selected_keys, filters_config = config.get('columns', []), config.get('filters', {})
    
    if not selected_keys:
        raise HTTPException(400, "Selecciona al menos una columna.")

    # --- Lógica de construcción de la query (sin cambios) ---
    select_clauses, headers = [], []
    for key in selected_keys:
        if key in REPORT_DEFINITIONS['fields']:
            headers.append(REPORT_DEFINITIONS['fields'][key][0])
            select_clauses.append(f"{REPORT_DEFINITIONS['fields'][key][1]} AS \"{key}\"")
        elif key in REPORT_DEFINITIONS['formulas']:
            headers.append(REPORT_DEFINITIONS['formulas'][key][0])
            select_clauses.append(f"{REPORT_DEFINITIONS['formulas'][key][1]} AS \"{key}\"")
    
    base_query = "FROM pedidos p LEFT JOIN usuarios u ON p.repartidor_id = u.id_usuario LEFT JOIN comercios c ON p.id_comercio = c.id_comercio"
    
    where_clauses, params = [], []
    for key, value in filters_config.items():
        if key in REPORT_DEFINITIONS['filters'] and value:
            # Soporte para múltiples estados
            if key == 'estado' and isinstance(value, list):
                where_clauses.append(f"p.estado = ANY(%s)")
                params.append(value)
            elif key == 'estado':
                where_clauses.append(REPORT_DEFINITIONS['filters'][key])
                params.append([value]) # Asegurarse de que sea una lista para ANY
            else:
                where_clauses.append(REPORT_DEFINITIONS['filters'][key])
                params.append(value)

    where_string = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    full_query = f"SELECT {', '.join(select_clauses)} {base_query} {where_string} ORDER BY p.fecha_creacion DESC LIMIT 1000;"

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # --- Ejecutar Query Principal ---
        cur.execute(full_query, tuple(params))
        data = cur.fetchall()
        results = [{k: float(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, datetime) else v for k, v in row.items()} for row in data]

        # --- NUEVO: Ejecutar Query de Resumen ---
        summary_query = f"SELECT COUNT(*) as total_records, SUM(p.costo_servicio) as total_costo_servicio {base_query} {where_string}"
        cur.execute(summary_query, tuple(params))
        summary_data = cur.fetchone()

        summary = {
            "total_records": summary_data.get('total_records', 0),
            "total_costo_servicio": float(summary_data.get('total_costo_servicio', 0) or 0)
        }

        # --- Formato de respuesta ---
        response_data = {
            "headers": headers, 
            "keys": selected_keys, 
            "data": results,
            "summary": summary # Añadir el resumen a la respuesta JSON
        }

        if "text/csv" in request.headers.get("accept", ""):
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=selected_keys)
            writer.writerow(dict(zip(selected_keys, headers)))
            writer.writerows(results)
            return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=reporte.csv"})
        
        return response_data

@app.get("/comercios", response_model=List[Comercio], tags=["Comercios"], dependencies=[Depends(get_current_user)])
async def listar_comercios(db=Depends(get_db)):
    """
    Obtiene una lista de todos los comercios, ordenados alfabéticamente.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM comercios ORDER BY nombre ASC")
        return [Comercio(**c) for c in cur.fetchall()]

@app.get("/comercios/{comercio_id}", response_model=Comercio, tags=["Comercios"], dependencies=[Depends(get_current_user)])
async def obtener_comercio_por_id(comercio_id: str, db=Depends(get_db)):
    """
    Obtiene los detalles completos de un único comercio por su ID.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM comercios WHERE id_comercio = %s", (comercio_id,))
        comercio = cur.fetchone()
        if not comercio:
            raise HTTPException(status_code=404, detail="Comercio no encontrado")
        return Comercio(**comercio)

@app.post("/comercios", response_model=Comercio, status_code=201, tags=["Comercios"])
async def crear_comercio(
    comercio_data: ComercioCreate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Crea un nuevo registro de comercio.
    Si el ID ya existe, actualiza el registro existente (upsert).
    """
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                INSERT INTO comercios (id_comercio, nombre, latitud, longitud, numero_contacto, direccion)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id_comercio) DO UPDATE SET
                    nombre = EXCLUDED.nombre,
                    latitud = EXCLUDED.latitud,
                    longitud = EXCLUDED.longitud,
                    numero_contacto = EXCLUDED.numero_contacto,
                    direccion = EXCLUDED.direccion
                RETURNING *;
            """
            cur.execute(query, (
                comercio_data.id_comercio, comercio_data.nombre, comercio_data.latitud,
                comercio_data.longitud, comercio_data.numero_contacto, comercio_data.direccion
            ))
            nuevo_comercio = cur.fetchone()
            db.commit()
            return Comercio(**nuevo_comercio)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/comercios/{comercio_id}", response_model=Comercio, tags=["Comercios"])
async def actualizar_comercio(
    comercio_id: str,
    comercio_data: ComercioUpdate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Actualiza los datos de un comercio existente. Solo modifica los campos enviados en el body.
    """
    update_dict = comercio_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    updates = [f"{key} = %s" for key in update_dict.keys()]
    values = list(update_dict.values())
    values.append(comercio_id)
    
    query = f"UPDATE comercios SET {', '.join(updates)} WHERE id_comercio = %s RETURNING *"

    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, tuple(values))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Comercio no encontrado")
            updated_comercio = cur.fetchone()
            db.commit()
            return Comercio(**updated_comercio)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/comercios/{comercio_id}", status_code=200, tags=["Comercios"])
async def eliminar_comercio(
    comercio_id: str,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Elimina un comercio de la base de datos.
    """
    try:
        with db.cursor() as cur:
            cur.execute("DELETE FROM comercios WHERE id_comercio = %s", (comercio_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Comercio no encontrado")
            db.commit()
        return {"status": "deleted", "id": comercio_id}
    except Exception as e:
        db.rollback()
        if "violates foreign key constraint" in str(e).lower():
            raise HTTPException(status_code=409, detail="Conflicto: No se puede eliminar el comercio porque está asociado a pedidos existentes.")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/dashboard/active-drivers", tags=["Dashboard"], dependencies=[Depends(get_current_user)])
async def get_active_drivers(db=Depends(get_db)):
    r = get_redis_client()
    drivers = []
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id_usuario, nombre_display, estado_actual, ultima_latitud, ultima_longitud, ultima_bateria_porcentaje FROM usuarios WHERE ultima_actualizacion_loc >= NOW() - INTERVAL '2 hours'")
        db_drivers = cur.fetchall()
        for d in db_drivers:
            lat, lng, estado, bateria = d['ultima_latitud'], d['ultima_longitud'], d['estado_actual'], d['ultima_bateria_porcentaje']
            if r:
                try:
                    redis_data = r.hgetall(f"driver:{d['id_usuario']}")
                    if redis_data:
                        lat = float(redis_data.get('lat', lat))
                        lng = float(redis_data.get('lng', lng))
                        estado = redis_data.get('estado', estado)
                        bateria = int(redis_data.get('bat', bateria or 0))
                except Exception: pass
            if lat and lng:
                drivers.append({"id": d['id_usuario'], "nombre": d['nombre_display'], "lat": lat, "lng": lng, "estado": estado, "bateria": bateria})
    return drivers

@app.post("/pedidos/{pedido_id}/asignar", response_model=Pedido, tags=["Pedidos"], dependencies=[Depends(get_current_user)])
async def asignar_repartidor_a_pedido(
    pedido_id: int, 
    data: PedidoAsignarRepartidor, 
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Asigna un repartidor a un pedido pendiente. 
    Esta es la acción principal del botón 'Asignar' del dashboard.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # 1. Bloquear y verificar el pedido
        cur.execute("SELECT * FROM pedidos WHERE id = %s FOR UPDATE", (pedido_id,))
        pedido = cur.fetchone()
        if not pedido:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")
        if pedido['estado'] != 'pendiente':
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No se puede asignar. El pedido ya está en estado '{pedido['estado']}'.")

        # 2. Verificar que el repartidor exista (opcional pero recomendado)
        cur.execute("SELECT id_usuario FROM usuarios WHERE id_usuario = %s", (data.repartidor_id,))
        if not cur.fetchone():
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Repartidor con ID '{data.repartidor_id}' no encontrado.")
            
        # 3. Asignar repartidor y cambiar estado a 'aceptado'
        cur.execute(
            "UPDATE pedidos SET repartidor_id = %s, estado = 'aceptado' WHERE id = %s RETURNING *",
            (data.repartidor_id, pedido_id)
        )
        updated_pedido = cur.fetchone()

        # 4. Registrar logs
        log_pedido_status_change(cur, pedido_id, "aceptado", data.repartidor_id, manual_change=True)
        log_system_action(db, "WARNING", "manual_assign", {"pedido_id": pedido_id, "driver_id": data.repartidor_id}, usuario=current_user.email)
        
        db.commit()

        # 5. Preparar y enviar respuesta
        cur.execute("SELECT nombre FROM comercios WHERE id_comercio = %s", (updated_pedido['id_comercio'],))
        updated_pedido['nombre_comercio'] = cur.fetchone()['nombre']
        
        await manager.broadcast({"type": "ORDER_ASSIGNED", "id": pedido_id, "repartidor_id": data.repartidor_id, "data": updated_pedido})
        
        # (Opcional) Enviar notificación FCM al repartidor
        # ...

        return Pedido(**updated_pedido)