from fastapi import FastAPI, HTTPException, Depends, Body, Path, Query, UploadFile, File, Form, BackgroundTasks, WebSocket, WebSocketDisconnect, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from typing import List, Optional, Dict, Any
from datetime import datetime, date, timedelta, time
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
from auth_utils import get_current_user, RoleChecker, User, get_current_principal
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from contextlib import asynccontextmanager
import asyncio
from passlib.context import CryptContext
import secrets

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


async def trigger_integration_webhooks(event_type: str, data: dict, db_conn):
    """
    Versión final y robusta:
    - Busca integraciones basadas en el prefijo del ID_COMERCIO.
    - Envía un webhook en segundo plano.
    - Maneja correctamente las variables nulas (ej: id_externo).
    - Busca el pedido activo del repartidor para eventos de ubicación.
    """
    pedido_id = None
    
    try:
        # 1. Determinar el pedido_id basado en el tipo de evento
        if event_type == "DRIVER_LOCATION_UPDATE":
            repartidor_id = data.get('id_usuario')
            if not repartidor_id: return
            with db_conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id FROM pedidos WHERE repartidor_id = %s AND estado NOT IN ('entregado', 'cancelado') ORDER BY fecha_creacion DESC LIMIT 1", (repartidor_id,))
                active_order = cur.fetchone()
                if active_order:
                    pedido_id = active_order['id']
        else: # Para eventos como ORDER_STATUS_UPDATE, ORDER_ASSIGNED
            pedido_id = data.get('id')

        if not pedido_id:
            return

        with db_conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 2. Obtener datos clave del pedido
            cur.execute("SELECT p.id_comercio, i.id_externo FROM pedidos p LEFT JOIN integraciones i ON p.id = i.pedido_id WHERE p.id = %s", (pedido_id,))
            pedido_info = cur.fetchone()
            if not pedido_info or not pedido_info.get('id_comercio'):
                return

            id_comercio = pedido_info['id_comercio']
            id_externo = pedido_info.get('id_externo')

            # 3. Buscar una configuración de integración que coincida con el PREFIJO DEL COMERCIO
            cur.execute("SELECT * FROM integration_configs WHERE is_active = TRUE AND %s LIKE id_externo_prefix || '%%'", (id_comercio,))
            config = cur.fetchone()
            if not config: return

            webhook_config = config.get('webhooks', {}).get(event_type)
            if not webhook_config: return

            # 4. Construir el payload
            payload_template = json.dumps(webhook_config['payload_template'])
            
            repartidor_id = data.get('repartidor_id') or (data.get('id_usuario') if event_type == "DRIVER_LOCATION_UPDATE" else None)
            if not repartidor_id:
                cur.execute("SELECT repartidor_id FROM pedidos WHERE id = %s", (pedido_id,))
                repartidor_row = cur.fetchone()
                if repartidor_row:
                    repartidor_id = repartidor_row['repartidor_id']

            replacements = {
                "{{id_externo}}": id_externo,
                "{{pedido_id}}": pedido_id,
                "{{id_comercio}}": id_comercio,
                "{{estado}}": data.get('estado'),
                "{{timestamp}}": datetime.now(CARACAS_TZ).isoformat(),
                "{{repartidor_id}}": repartidor_id,
                "{{latitud}}": data.get('latitud'),
                "{{longitud}}": data.get('longitud'),
                "{{bateria_porcentaje}}": data.get('bateria_porcentaje')
            }
            
            for key, value in replacements.items():
                replacement_value = json.dumps(value) if value is not None else 'null'
                payload_template = payload_template.replace(f'"{key}"', replacement_value)

            final_payload = json.loads(payload_template)
            target_url = webhook_config['url']

            # 5. Enviar el webhook en segundo plano
            async with httpx.AsyncClient() as client:
                try:
                    await client.post(target_url, json=final_payload, timeout=10.0)
                    log_system_action(db_conn, "INFO", "webhook_sent", {"integration": config['name'], "event": event_type, "url": target_url, "payload": final_payload})
                except Exception as e:
                    log_system_action(db_conn, "ERROR", "webhook_failed", {"integration": config['name'], "event": event_type, "error": str(e)})
    finally:
        db_conn.close()

def is_point_in_polygon(point_lat: float, point_lng: float, polygon_coords: List[List[float]]) -> bool:
    """
    Determina si un punto (lat, lng) está dentro de un polígono.
    El polígono se define como una lista de puntos [[lng, lat], ...].
    Algoritmo: Ray Casting.
    """
    num_vertices = len(polygon_coords)
    if num_vertices < 3:
        return False
    
    inside = False
    
    # El primer punto del polígono
    p1_lng, p1_lat = polygon_coords[0]
    
    for i in range(1, num_vertices + 1):
        # El siguiente punto del polígono (el último se conecta con el primero)
        p2_lng, p2_lat = polygon_coords[i % num_vertices]
        
        # Comprobar si el punto está entre las latitudes de la arista del polígono
        if min(p1_lat, p2_lat) < point_lat <= max(p1_lat, p2_lat):
            # Comprobar si el punto está a la izquierda de la arista
            if point_lng <= max(p1_lng, p2_lng):
                # Calcular la intersección en el eje X
                if p1_lat != p2_lat:
                    x_intersection = (point_lat - p1_lat) * (p2_lng - p1_lng) / (p2_lat - p1_lat) + p1_lng
                
                # Si el punto está a la izquierda de la intersección, cruzamos una arista
                if p1_lng == p2_lng or point_lng <= x_intersection:
                    inside = not inside
                    
        # Mover al siguiente punto
        p1_lng, p1_lat = p2_lng, p2_lat
        
    return inside

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
@app.post("/admin/users/sync", tags=["Admin"], dependencies=[Depends(RoleChecker("access:all"))])
async def sync_firebase_users_with_db(db=Depends(get_db)):
    """
    Sincroniza la lista de usuarios de Firebase con la tabla local 'admin_users'.
    """
    try:
        firebase_users = auth.list_users().iterate_all()
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            for user in firebase_users:
                role = user.custom_claims.get('role', 'viewer') if user.custom_claims else 'viewer'
                query = """
                    INSERT INTO admin_users (uid, email, display_name, role, is_disabled)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (uid) DO UPDATE SET
                        email = EXCLUDED.email,
                        display_name = EXCLUDED.display_name,
                        role = EXCLUDED.role,
                        is_disabled = EXCLUDED.is_disabled,
                        updated_at = NOW();
                """
                cur.execute(query, (user.uid, user.email, user.display_name, role, user.disabled))
            db.commit()
        return {"status": "success", "message": "Usuarios del panel sincronizados con la base de datos."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/admin/users", response_model=dict, tags=["Admin"], dependencies=[Depends(RoleChecker("access:all"))])
async def create_admin_user(user_data: NewUserRequest, db=Depends(get_db)):
    """
    Crea un nuevo usuario en Firebase y lo registra en la tabla 'admin_users'.
    """
    try:
        # 1. Crear en Firebase
        user = auth.create_user(
            email=user_data.email,
            password=user_data.password,
            display_name=user_data.display_name
        )
        # 2. Asignar rol 'viewer' por defecto en Firebase
        auth.set_custom_user_claims(user.uid, {'role': 'viewer'})
        
        # 3. Insertar en nuestra base de datos local
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO admin_users (uid, email, display_name, role) VALUES (%s, %s, %s, %s)",
                (user.uid, user.email, user.display_name, 'viewer')
            )
            db.commit()
            
        return {"uid": user.uid, "email": user.email, "message": "Usuario creado con rol 'viewer' por defecto."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/admin/users", tags=["Admin"], dependencies=[Depends(get_current_user)])
async def list_admin_users(db=Depends(get_db)):
    """
    CORREGIDO: Obtiene la lista de usuarios del panel desde la tabla 'admin_users'.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT uid, email, display_name, role, is_disabled as disabled FROM admin_users ORDER BY email ASC")
        users = cur.fetchall()
        return users

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

@app.post("/admin/users/{uid}/role", tags=["Admin"], dependencies=[Depends(RoleChecker("access:all"))])
async def set_user_role(uid: str, role_data: dict = Body(...), db=Depends(get_db)):
    """
    Actualiza el rol en Firebase Y en la tabla local 'admin_users'.
    """
    role = role_data.get('role')
    try:
        # 1. Actualizar en Firebase
        auth.set_custom_user_claims(uid, {'role': role})
        # 2. Actualizar en nuestra base de datos
        with db.cursor() as cur:
            cur.execute("UPDATE admin_users SET role = %s, updated_at = NOW() WHERE uid = %s", (role, uid))
            db.commit()
        return {"status": "success", "message": f"Rol actualizado a '{role}'."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

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
async def crear_pedido(
    pedido_data: PedidoCreate,
    db=Depends(get_db),
    principal: Any = Depends(get_current_principal)
):
    """
    Crea un nuevo pedido.
    1. Valida la autenticación (JWT o API Key).
    2. Valida si la dirección de entrega está en una zona restringida activa.
    3. Si todo es válido, crea el pedido y lo notifica.
    """
    # --- INICIO DE LA VALIDACIÓN DE ZONA RESTRINGIDA (CON LOGS) ---
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM restricted_zones WHERE is_active = TRUE")
        active_zones = cur.fetchall()

    now_time = datetime.now(CARACAS_TZ).time()
    logger.info(f"--- VALIDACIÓN DE ZONA PARA NUEVO PEDIDO ---")
    logger.info(f"Punto de Entrega a Validar: Lat={pedido_data.latitud_entrega}, Lng={pedido_data.longitud_entrega}")
    logger.info(f"Hora Actual: {now_time.strftime('%H:%M:%S')}")

    for zone in active_zones:
        logger.info(f"Verificando contra la zona '{zone['name']}' (ID: {zone['id']})")
        
        # 1. Comprobar si el punto está dentro del polígono
        is_inside = is_point_in_polygon(pedido_data.latitud_entrega, pedido_data.longitud_entrega, zone['polygon_coords'])
        
        if not is_inside:
            logger.info(f"-> Resultado: FUERA del polígono. Pasando a la siguiente zona.")
            continue
        
        logger.warning(f"-> Resultado: ¡DENTRO del polígono de la zona '{zone['name']}'!")
        
        # 2. Comprobar si la restricción de horario aplica
        is_restricted_24_7 = zone['restricted_from'] is None and zone['restricted_to'] is None
        if is_restricted_24_7:
            logger.warning(f"-> La zona '{zone['name']}' está restringida 24/7. RECHAZANDO PEDIDO.")
            raise HTTPException(
                status_code=403,
                detail=f"La dirección de entrega se encuentra en la zona restringida"
            )

        if zone['restricted_from'] and zone['restricted_to']:
            start_time = zone['restricted_from']
            end_time = zone['restricted_to']
            logger.info(f"-> Verificando rango de horario: {start_time.strftime('%H:%M')} a {end_time.strftime('%H:%M')}")
            
            is_in_time_range = False
            if start_time > end_time: # Rango que cruza la medianoche (ej: 22:00 a 06:00)
                if now_time >= start_time or now_time <= end_time:
                    is_in_time_range = True
            else: # Rango normal (ej: 08:00 a 17:00)
                if start_time <= now_time <= end_time:
                    is_in_time_range = True
            
            if is_in_time_range:
                logger.warning(f"-> La hora actual está DENTRO del rango restringido. RECHAZANDO PEDIDO.")
                raise HTTPException(
                    status_code=403,
                    detail=f"La dirección de entrega se encuentra en la zona restringida '{zone['name']}' en este horario."
                )
            else:
                 logger.info(f"-> La hora actual está FUERA del rango restringido. PERMITIENDO PEDIDO.")
        else:
            logger.info(f"-> La zona '{zone['name']}' no tiene un rango de horario definido (y no es 24/7). PERMITIENDO PEDIDO.")

    logger.info(f"--- FIN DE LA VALIDACIÓN. El pedido es válido. ---")
    # --- FIN DE LA VALIDACIÓN ---
    
    # Determinar el creador del pedido basado en el 'principal' de seguridad
    creado_por: str
    if isinstance(principal, User):
        creado_por = principal.email
    elif isinstance(principal, str):
        creado_por = f"api:{principal}"
    else:
        raise HTTPException(status_code=403, detail="Principal de seguridad desconocido.")
        
    try:
        tipo_vehiculo_str = pedido_data.tipo_vehiculo.value if hasattr(pedido_data.tipo_vehiculo, 'value') else str(pedido_data.tipo_vehiculo)
        
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT valor FROM app_config WHERE clave = 'pricing_tiers'")
            config_row = cur.fetchone()
            if not config_row: raise HTTPException(503, "Configuración de tarifas no encontrada.")
            
            # Asumo que tienes una función 'calcular_costo_delivery_ruta'
            costo_res = calcular_costo_delivery_ruta(
                f"{pedido_data.latitud_retiro},{pedido_data.longitud_retiro}",
                f"{pedido_data.latitud_entrega},{pedido_data.longitud_entrega}",
                tipo_vehiculo_str,
                config_completa=config_row['valor']
            )
            costo = costo_res.get('costo', 0.0)

            cur.execute("INSERT INTO comercios (id_comercio, nombre) VALUES (%s, %s) ON CONFLICT (id_comercio) DO NOTHING", (pedido_data.id_comercio, pedido_data.nombre_comercio))

            query = "INSERT INTO pedidos (pedido, direccion_entrega, latitud_entrega, longitud_entrega, latitud_retiro, longitud_retiro, estado, detalles, telefono_contacto, telefono_comercio, link_maps, id_comercio, costo_servicio, tipo_vehiculo, creado_por_usuario_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *"
            cur.execute(query, (
                pedido_data.pedido, pedido_data.direccion_entrega, pedido_data.latitud_entrega,
                pedido_data.longitud_entrega, pedido_data.latitud_retiro, pedido_data.longitud_retiro,
                'pendiente', pedido_data.detalles, pedido_data.telefono_contacto,
                pedido_data.telefono_comercio, pedido_data.link_maps, pedido_data.id_comercio,
                costo, tipo_vehiculo_str, creado_por
            ))
            nuevo_pedido = cur.fetchone()

            if pedido_data.id_externo:
                cur.execute("INSERT INTO integraciones (pedido_id, id_externo) VALUES (%s, %s)", (nuevo_pedido['id'], pedido_data.id_externo))
                nuevo_pedido['id_externo'] = pedido_data.id_externo
            
            log_system_action(db, "INFO", "create_order", {"id": nuevo_pedido['id'], "cost": costo}, usuario=creado_por)
            db.commit()

        nuevo_pedido['nombre_comercio'] = pedido_data.nombre_comercio
        await manager.broadcast({"type": "NEW_ORDER", "data": nuevo_pedido})
        
        return Pedido(**nuevo_pedido)
        
    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

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
    background_tasks: BackgroundTasks, # <-- MODIFICACIÓN
    db=Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """
    Actualiza el estado de un pedido (ej: a llevando, entregado, etc.) y dispara un webhook.
    """
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
            elif data.estado == EstadoPedido.ACEPTADO and not repartidor_id_final and not data.repartidor_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se puede aceptar un pedido sin repartidor asignado.")
            elif data.repartidor_id:
                repartidor_id_final = data.repartidor_id

            # 3. Actualizar la base de datos
            cur.execute(
                "UPDATE pedidos SET estado = %s, repartidor_id = %s, fecha_actualizacion = NOW() WHERE id = %s RETURNING *",
                (data.estado.value, repartidor_id_final, pedido_id)
            )
            updated = cur.fetchone()

            # 4. Logs
            log_pedido_status_change(cur, pedido_id, data.estado.value, repartidor_id_final, manual_change=True)
            log_system_action(db, "INFO", "update_status", {"id": pedido_id, "new_status": data.estado.value}, usuario=current_user.email)
            
            db.commit()

            # 5. Preparar respuesta y notificar por WebSocket
            cur.execute("SELECT nombre FROM comercios WHERE id_comercio = %s", (updated['id_comercio'],))
            updated['nombre_comercio'] = cur.fetchone()['nombre']
            
            await manager.broadcast({"type": "ORDER_STATUS_UPDATE", "id": pedido_id, "data": updated})
            
            # --- INICIO DE LA MODIFICACIÓN CLAVE ---
            # 6. Disparar el webhook de cambio de estado en segundo plano
            background_tasks.add_task(trigger_integration_webhooks, "ORDER_STATUS_UPDATE", updated.copy(), get_db_connection())
            # --- FIN DE LA MODIFICACIÓN CLAVE ---
            
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
async def actualizar_ubicacion_usuario(
    data: UbicacionUsuario,
    background_tasks: BackgroundTasks, # <-- MODIFICACIÓN: Inyectar BackgroundTasks
    db=Depends(get_db)
):
    """
    Actualiza la ubicación de un usuario, la guarda en la BD, notifica por WebSocket
    y dispara un webhook de integración si aplica.
    """
    ts = data.timestamp.astimezone(CARACAS_TZ)
    
    # Notificar a todos los dashboards conectados inmediatamente.
    await manager.broadcast({"type": "DRIVER_LOCATION_UPDATE", "data": data.model_dump()})

    # Intentar guardar en Redis para acceso rápido
    r = get_redis_client()
    if r:
        try:
            r.hset(f"driver:{data.id_usuario}", mapping={"lat": data.latitud, "lng": data.longitud, "estado": data.estado, "bat": data.bateria_porcentaje or 0, "ts": str(ts)})
            r.expire(f"driver:{data.id_usuario}", 3600)
        except Exception as e:
            logger.warning(f"No se pudo escribir la ubicación en Redis: {e}")

    # Guardar en la base de datos para persistencia.
    with db.cursor() as cur:
        cur.execute("INSERT INTO usuarios (id_usuario, ultima_latitud, ultima_longitud, ultima_actualizacion_loc, estado_actual, ultima_bateria_porcentaje) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (id_usuario) DO UPDATE SET ultima_latitud=EXCLUDED.ultima_latitud, ultima_longitud=EXCLUDED.ultima_longitud, ultima_actualizacion_loc=EXCLUDED.ultima_actualizacion_loc, estado_actual=EXCLUDED.estado_actual, ultima_bateria_porcentaje=EXCLUDED.ultima_bateria_porcentaje", (data.id_usuario, data.latitud, data.longitud, ts, data.estado, data.bateria_porcentaje))
        cur.execute("INSERT INTO ubicaciones_log (id_usuario, latitud, longitud, timestamp) VALUES (%s,%s,%s,%s)", (data.id_usuario, data.latitud, data.longitud, ts))
        db.commit()

    # --- INICIO DE LA MODIFICACIÓN ---
    # Disparamos el webhook de ubicación en segundo plano.
    # La función trigger_integration_webhooks se encargará de buscar el pedido activo del repartidor.
    background_tasks.add_task(trigger_integration_webhooks, "DRIVER_LOCATION_UPDATE", data.model_dump(), get_db_connection())
    # --- FIN DE LA MODIFICACIÓN ---
        
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
    background_tasks: BackgroundTasks, # <-- MODIFICACIÓN
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Asigna un repartidor a un pedido pendiente y dispara el webhook de cambio de estado.
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        # 1. Bloquear y validar el pedido
        cur.execute("SELECT * FROM pedidos WHERE id = %s FOR UPDATE", (pedido_id,))
        pedido = cur.fetchone()
        if not pedido:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")
        if pedido['estado'] != 'pendiente':
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No se puede asignar. El pedido ya está en estado '{pedido['estado']}'.")

        # 2. Validar que el repartidor exista
        cur.execute("SELECT id_usuario FROM usuarios WHERE id_usuario = %s", (data.repartidor_id,))
        if not cur.fetchone():
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Repartidor con ID '{data.repartidor_id}' no encontrado.")
            
        # 3. Actualizar el pedido en la base de datos
        cur.execute(
            "UPDATE pedidos SET repartidor_id = %s, estado = 'aceptado', fecha_actualizacion = NOW() WHERE id = %s RETURNING *",
            (data.repartidor_id, pedido_id)
        )
        updated_pedido = cur.fetchone()

        # 4. Registrar logs
        log_pedido_status_change(cur, pedido_id, "aceptado", data.repartidor_id, manual_change=True)
        log_system_action(db, "WARNING", "manual_assign", {"pedido_id": pedido_id, "driver_id": data.repartidor_id}, usuario=current_user.email)
        
        db.commit()

        # 5. Preparar respuesta y notificar por WebSocket
        cur.execute("SELECT nombre FROM comercios WHERE id_comercio = %s", (updated_pedido['id_comercio'],))
        updated_pedido['nombre_comercio'] = cur.fetchone()['nombre']
        
        await manager.broadcast({"type": "ORDER_ASSIGNED", "id": pedido_id, "repartidor_id": data.repartidor_id, "data": updated_pedido})
        
        # --- INICIO DE LA MODIFICACIÓN CLAVE ---
        # 6. Disparar el webhook de cambio de estado en segundo plano
        background_tasks.add_task(trigger_integration_webhooks, "ORDER_STATUS_UPDATE", updated_pedido.copy(), get_db_connection())
        # --- FIN DE LA MODIFICACIÓN CLAVE ---

        return Pedido(**updated_pedido)

@app.get("/integrations", response_model=List[IntegrationConfig], tags=["Integrations"])
async def list_integrations(db=Depends(get_db)):
    query = """
        SELECT i.*, row_to_json(ak.*) as api_key
        FROM integration_configs i
        LEFT JOIN api_keys ak ON i.name = ak.client_name AND ak.is_active = TRUE
        ORDER BY i.name ASC;
    """
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query)
        return [IntegrationConfig(**row) for row in cur.fetchall()]

@app.get("/integrations/{integration_id}", response_model=IntegrationConfig, tags=["Integrations"], dependencies=[Depends(get_current_user)])
async def get_integration(integration_id: int, db=Depends(get_db)):
    """Obtiene los detalles de una configuración de integración específica."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM integration_configs WHERE id = %s", (integration_id,))
        config = cur.fetchone()
        if not config:
            raise HTTPException(status_code=404, detail="Configuración de integración no encontrada")
        return IntegrationConfig(**config)

@app.post("/integrations", response_model=IntegrationConfig, status_code=201, tags=["Integrations"], dependencies=[Depends(get_current_user)])
async def create_integration(config_data: IntegrationConfigCreate, db=Depends(get_db)):
    """Crea una nueva configuración de integración."""
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                INSERT INTO integration_configs (name, is_active, id_externo_prefix, webhooks)
                VALUES (%s, %s, %s, %s) RETURNING *;
            """
            cur.execute(query, (
                config_data.name, config_data.is_active,
                config_data.id_externo_prefix, json.dumps(config_data.model_dump()['webhooks'])
            ))
            new_config = cur.fetchone()
            db.commit()
            return IntegrationConfig(**new_config)
    except errors.UniqueViolation as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Conflicto: Ya existe una integración con ese nombre o prefijo.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/integrations/{integration_id}", response_model=IntegrationConfig, tags=["Integrations"], dependencies=[Depends(get_current_user)])
async def update_integration(integration_id: int, config_data: IntegrationConfigUpdate, db=Depends(get_db)):
    """Actualiza una configuración de integración existente."""
    update_dict = config_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    if 'webhooks' in update_dict:
        update_dict['webhooks'] = json.dumps(update_dict['webhooks'])

    updates = [f"{key} = %s" for key in update_dict.keys()]
    values = list(update_dict.values()) + [integration_id]
    
    query = f"UPDATE integration_configs SET {', '.join(updates)}, updated_at = NOW() WHERE id = %s RETURNING *"

    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, tuple(values))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Configuración de integración no encontrada")
            updated_config = cur.fetchone()
            db.commit()
            return IntegrationConfig(**updated_config)
    except errors.UniqueViolation:
        db.rollback()
        raise HTTPException(status_code=409, detail="Conflicto: El nombre o prefijo ya está en uso por otra integración.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/integrations/{integration_id}", status_code=200, tags=["Integrations"], dependencies=[Depends(get_current_user)])
async def delete_integration(integration_id: int, db=Depends(get_db)):
    """Elimina una configuración de integración."""
    with db.cursor() as cur:
        cur.execute("DELETE FROM integration_configs WHERE id = %s", (integration_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Configuración de integración no encontrada")
        db.commit()
    return {"status": "deleted", "id": integration_id}

@app.get("/analytics/summary", response_model=AnalyticsResponse, tags=["Analytics"])
async def get_analytics_summary(
    start_date: date,
    end_date: date,
    repartidor_id: Optional[str] = None,
    id_comercio: Optional[str] = None,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Calcula y devuelve un resumen completo de estadísticas, AHORA CON CORRECCIÓN DE ZONA HORARIA.
    """
    # --- INICIO DE LA CORRECCIÓN CLAVE ---
    timezone = str(CARACAS_TZ) # Usamos la zona horaria definida en la configuración
    params = {'start_date': start_date, 'end_date': end_date, 'tz': timezone}
    
    # Construimos los filtros dinámicos, convirtiendo la fecha del pedido a la zona horaria local ANTES de comparar
    filter_clauses = "WHERE (p.fecha_creacion AT TIME ZONE %(tz)s)::date BETWEEN %(start_date)s AND %(end_date)s"
    # --- FIN DE LA CORRECCIÓN CLAVE ---
    
    if repartidor_id:
        filter_clauses += " AND p.repartidor_id = %(repartidor_id)s"
        params['repartidor_id'] = repartidor_id
    if id_comercio:
        filter_clauses += " AND p.id_comercio = %(id_comercio)s"
        params['id_comercio'] = id_comercio

    # El resto de la query funciona igual, ya que opera sobre los datos ya filtrados correctamente.
    query = f"""
        WITH PedidosEnRango AS (
            SELECT p.*, u.porcentaje_comision 
            FROM pedidos p
            LEFT JOIN usuarios u ON p.repartidor_id = u.id_usuario
            {filter_clauses}
        ),
        LogsDeEstado AS (
            SELECT 
                id_pedido, 
                estado_registrado, 
                timestamp_log,
                LAG(timestamp_log, 1) OVER (PARTITION BY id_pedido ORDER BY timestamp_log) as prev_timestamp
            FROM pedidos_logs
            WHERE id_pedido IN (SELECT id FROM PedidosEnRango)
        ),
        TiemposPorPedido AS (
            SELECT
                id_pedido,
                MAX(CASE WHEN estado_registrado = 'aceptado' THEN EXTRACT(EPOCH FROM (timestamp_log - prev_timestamp))/60 END) as t_aceptar,
                MAX(CASE WHEN estado_registrado = 'retirando' THEN EXTRACT(EPOCH FROM (timestamp_log - prev_timestamp))/60 END) as t_retirar,
                MAX(CASE WHEN estado_registrado = 'entregado' THEN EXTRACT(EPOCH FROM (timestamp_log - prev_timestamp))/60 END) as t_entregar
            FROM LogsDeEstado
            GROUP BY id_pedido
        )
        SELECT
            COALESCE(SUM(costo_servicio), 0) as total_revenue,
            COALESCE(SUM(costo_servicio * (porcentaje_comision / 100)), 0) as total_driver_commission,
            COUNT(p.id) as total_orders,
            COUNT(CASE WHEN p.estado = 'entregado' THEN 1 END) as completed_orders,
            COUNT(CASE WHEN p.estado = 'cancelado' THEN 1 END) as cancelled_orders,
            AVG(t.t_aceptar) as avg_time_to_accept_minutes,
            AVG(t.t_retirar) as avg_time_to_pickup_minutes,
            AVG(t.t_entregar) as avg_time_to_deliver_minutes
        FROM PedidosEnRango p
        LEFT JOIN TiemposPorPedido t ON p.id = t.id_pedido
    """

    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, params)
        results = cur.fetchone()

        total_orders = results['total_orders']
        cancellation_rate = (results['cancelled_orders'] / total_orders * 100) if total_orders > 0 else 0
        
        # Aplicamos la misma corrección de zona horaria a las sub-queries
        cur.execute(f"SELECT COUNT(*) as total_tickets FROM tickets t JOIN pedidos p ON t.id_pedido = p.id {filter_clauses}", params)
        total_tickets = cur.fetchone()['total_tickets']
        
        cur.execute(f"SELECT u.nombre_display, COUNT(p.id) as order_count FROM pedidos p JOIN usuarios u ON p.repartidor_id = u.id_usuario {filter_clauses} AND p.repartidor_id IS NOT NULL GROUP BY u.nombre_display ORDER BY order_count DESC LIMIT 5", params)
        top_drivers = cur.fetchall()
        
        cur.execute(f"SELECT c.nombre, COUNT(p.id) as order_count FROM pedidos p JOIN comercios c ON p.id_comercio = c.id_comercio {filter_clauses} GROUP BY c.nombre ORDER BY order_count DESC LIMIT 5", params)
        top_merchants = cur.fetchall()

    net_revenue = results['total_revenue'] - results['total_driver_commission']
    
    response = AnalyticsResponse(
        start_date=str(start_date),
        end_date=str(end_date),
        financials=FinancialMetrics(
            total_revenue=results['total_revenue'],
            total_driver_commission=results['total_driver_commission'],
            net_revenue=net_revenue,
        ),
        operations=OperationalMetrics(
            total_orders=total_orders,
            completed_orders=results['completed_orders'],
            cancelled_orders=results['cancelled_orders'],
            cancellation_rate=cancellation_rate,
            total_tickets=total_tickets,
        ),
        timing=TimingMetrics(
            avg_time_to_accept_minutes=results.get('avg_time_to_accept_minutes'),
            avg_time_to_pickup_minutes=results.get('avg_time_to_pickup_minutes'),
            avg_time_to_deliver_minutes=results.get('avg_time_to_deliver_minutes'),
        ),
        top_drivers_by_orders=top_drivers,
        top_merchants_by_orders=top_merchants,
    )
    
    return response

@app.post("/api-keys", response_model=NewApiKeyResponse, tags=["API Keys"])
async def create_api_key(api_key_data: ApiKeyCreate, db=Depends(get_db)):
    prefix = f"{api_key_data.client_name[:4].lower()}_sk"
    secret = secrets.token_urlsafe(32)
    full_key = f"{prefix}_{secret}"
    hashed_key = pwd_context.hash(full_key)

    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            # --- INICIO DE LA CORRECCIÓN ---
            # 1. Revocar TODAS las claves antiguas para este cliente.
            # Esto asegura que solo la nueva clave que vamos a crear estará activa.
            cur.execute("UPDATE api_keys SET is_active = FALSE WHERE client_name = %s", (api_key_data.client_name,))
            # --- FIN DE LA CORRECCIÓN ---

            # 2. Insertar la nueva clave.
            cur.execute(
                "INSERT INTO api_keys (hashed_key, prefix, client_name) VALUES (%s, %s, %s)",
                (hashed_key, prefix, api_key_data.client_name)
            )
            db.commit()
            
        return NewApiKeyResponse(
            prefix=prefix,
            full_key=full_key,
            client_name=api_key_data.client_name,
            message="Clave generada. ¡Guárdala ahora! No podrás verla de nuevo."
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api-keys/{prefix}/revoke", response_model=ApiKey, tags=["API Keys"])
async def revoke_api_key(prefix: str, db=Depends(get_db)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("UPDATE api_keys SET is_active = FALSE WHERE prefix = %s RETURNING *", (prefix,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Clave no encontrada")
        revoked_key = cur.fetchone()
        db.commit()
        return ApiKey(**revoked_key)

# --- ENDPOINTS CRUD PARA ZONAS RESTRINGIDAS ---

@app.get("/zones", response_model=List[RestrictedZone], tags=["Zones"])
async def list_restricted_zones(db=Depends(get_db)):
    """Obtiene una lista de todas las zonas restringidas configuradas."""
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM restricted_zones ORDER BY name ASC")
        return [RestrictedZone(**row) for row in cur.fetchall()]

@app.post("/zones", response_model=RestrictedZone, status_code=201, tags=["Zones"])
async def create_restricted_zone(zone_data: RestrictedZoneCreate, db=Depends(get_db)):
    """Crea una nueva zona restringida."""
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                INSERT INTO restricted_zones (name, is_active, polygon_coords, restricted_from, restricted_to)
                VALUES (%s, %s, %s, %s, %s) RETURNING *;
            """
            cur.execute(query, (
                zone_data.name, zone_data.is_active,
                json.dumps(zone_data.polygon_coords),
                zone_data.restricted_from, zone_data.restricted_to
            ))
            new_zone = cur.fetchone()
            db.commit()
            return RestrictedZone(**new_zone)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/zones/{zone_id}", response_model=RestrictedZone, tags=["Zones"])
async def update_restricted_zone(zone_id: int, zone_data: RestrictedZoneUpdate, db=Depends(get_db)):
    """Actualiza una zona restringida existente."""
    update_dict = zone_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    if 'polygon_coords' in update_dict:
        update_dict['polygon_coords'] = json.dumps(update_dict['polygon_coords'])

    updates = [f"{key} = %s" for key in update_dict.keys()]
    values = list(update_dict.values()) + [zone_id]
    
    query = f"UPDATE restricted_zones SET {', '.join(updates)}, updated_at = NOW() WHERE id = %s RETURNING *"
    
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, tuple(values))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Zona no encontrada")
        updated_zone = cur.fetchone()
        db.commit()
        return RestrictedZone(**updated_zone)

@app.delete("/zones/{zone_id}", status_code=200, tags=["Zones"])
async def delete_restricted_zone(zone_id: int, db=Depends(get_db)):
    """Elimina una zona restringida."""
    with db.cursor() as cur:
        cur.execute("DELETE FROM restricted_zones WHERE id = %s", (zone_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Zona no encontrada")
        db.commit()
    return {"status": "deleted", "id": zone_id}