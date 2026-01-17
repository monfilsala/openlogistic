import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import sql
import os
import logging
from dotenv import load_dotenv
from math import radians, sin, cos, sqrt, atan2
import json
import requests
from urllib.parse import urlparse, parse_qs
import uuid
import redis
import time
import sys

# Configurar un logger para este módulo
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cargar variables de entorno
load_dotenv()

# --- INICIALIZACIÓN DE FIREBASE ---
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    
    cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY_PATH")
    
    if cred_path and os.path.exists(cred_path):
        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
            logger.info("Firebase Admin SDK inicializado correctamente.")
            FIREBASE_INITIALIZED = True
        else:
            logger.info("Firebase Admin SDK ya estaba inicializado.")
            FIREBASE_INITIALIZED = True
    else:
        logger.warning("FIREBASE_SERVICE_ACCOUNT_KEY_PATH no configurado. Push notifications deshabilitadas.")
        FIREBASE_INITIALIZED = False
except ImportError:
    logger.warning("firebase-admin no instalado.")
    FIREBASE_INITIALIZED = False
except Exception as e:
    logger.error(f"Error inicializando Firebase: {e}", exc_info=True)
    FIREBASE_INITIALIZED = False


# --- CONFIGURACIÓN DE INFRAESTRUCTURA Y APIS ---
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_NAME = os.getenv("DB_NAME", "delivery_db")
ADMIN_DB_NAME = os.getenv("ADMIN_DB_NAME", "postgres")

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
OSRM_BASE_URL = os.getenv("OSRM_URL", "http://router.project-osrm.org/route/v1/driving")

# --- CONFIGURACIÓN DE REDIS ---
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", 6379)
REDIS_DB = os.getenv("REDIS_DB", 0)

redis_client = None
try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True, socket_connect_timeout=2)
    redis_client.ping()
    logger.info(f"Conectado a Redis en {REDIS_HOST}:{REDIS_PORT}")
except Exception as e:
    logger.error(f"No se pudo conectar a Redis: {e}")
    redis_client = None

def get_redis_client():
    return redis_client

# --- LÓGICA DE CÁLCULO DE COSTO Y GEOCODIFICACIÓN ---

def extraer_coordenadas_de_url(url: str) -> str | None:
    """Extrae las coordenadas de un link de Google Maps y las devuelve como 'lat,lon'."""
    try:
        parsed_url = urlparse(url)
        query_params = parse_qs(parsed_url.query)
        if 'q' in query_params:
            coords_str = query_params['q'][0]
            lat, lon = map(float, coords_str.split(','))
            return f"{lat},{lon}"
        
        path_parts = parsed_url.path.split('/')
        for part in path_parts:
            if '@' in part:
                coords_part = part.strip('@')
                coords = coords_part.split(',')
                if len(coords) >= 2:
                    lat_str, lon_str = coords[0], coords[1]
                    if lat_str.replace('.', '', 1).replace('-', '', 1).isdigit() and \
                       lon_str.replace('.', '', 1).replace('-', '', 1).isdigit():
                        return f"{float(lat_str)},{float(lon_str)}"
        return None
    except Exception:
        logger.error(f"Error extrayendo coordenadas: {url}", exc_info=True)
        return None

def obtener_distancia_osrm(origen_coords: str, destino_coords: str) -> dict | None:
    """Obtiene distancia y duración usando OSRM (OpenStreetMap)."""
    try:
        lat1, lon1 = origen_coords.split(',')
        lat2, lon2 = destino_coords.split(',')
        
        url = f"{OSRM_BASE_URL}/{lon1},{lat1};{lon2},{lat2}?overview=false"
        response = requests.get(url, timeout=5)
        
        if response.status_code != 200:
            logger.error(f"Error OSRM API: {response.status_code}")
            return None
            
        data = response.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None

        route = data["routes"][0]
        return {
            "km": route["distance"] / 1000,
            "distancia_texto": f"{route['distance']/1000:.1f} km",
            "duracion_texto": f"{route['duration']/60:.0f} min"
        }
    except Exception as e:
        logger.error(f"Error conectando con OSRM: {e}")
        return None

# En backend/database.py

# En backend/database.py

def calcular_costo_delivery_ruta(origen_coords: str, destino_coords: str, tipo_vehiculo: str, config_completa: dict = None) -> dict:
    """
    Función definitiva para calcular costo, con manejo de fallos de OSRM.
    """
    info_ruta = obtener_distancia_osrm(origen_coords, destino_coords)
    
    # --- CORRECCIÓN: Manejo de fallo en OSRM ---
    if not info_ruta:
        # Si OSRM falla (ej: ruta imposible), intentamos un cálculo en línea recta como fallback
        logger.warning(f"OSRM falló para {origen_coords} -> {destino_coords}. Usando cálculo Haversine como fallback.")
        try:
            lat1, lon1 = map(float, origen_coords.split(','))
            lat2, lon2 = map(float, destino_coords.split(','))
            dist_lineal = haversine(lat1, lon1, lat2, lon2)
            # Aplicamos un factor de corrección para simular la ruta en calle (aprox. 1.4)
            distancia_km = dist_lineal * 1.4
            info_ruta = {
                "km": distancia_km,
                "distancia_texto": f"~{distancia_km:.1f} km (est.)",
                "duracion_texto": "N/A" # No podemos estimar duración sin OSRM
            }
        except (ValueError, IndexError):
            # Si ni siquiera podemos parsear las coordenadas, devolvemos error.
            return {"error": "Coordenadas inválidas."}
    
    distancia_km = info_ruta['km']
    
    if config_completa is None:
        conn = get_db_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT valor FROM app_config WHERE clave = 'pricing_tiers'")
                config_row = cur.fetchone()
                if not config_row: return {"error": "Configuración de tarifas no encontrada en la DB."}
                config_completa = config_row['valor']
        finally:
            conn.close()

    if tipo_vehiculo not in config_completa:
        return {"error": f"Tipo de vehículo '{tipo_vehiculo}' no está definido en la configuración."}
        
    config_vehiculo = config_completa[tipo_vehiculo]
    tiers = config_vehiculo.get('tiers', [])
    costo = 0.0
    tier_aplicado = "No definido"
    
    sorted_tiers = sorted(tiers, key=lambda x: x.get('min_km', float('inf')))
    
    for tier in sorted_tiers:
        if 'max_km' in tier:
            if distancia_km <= tier['max_km']:
                tier_aplicado = tier.get('nombre')
                costo = tier.get('precio_fijo')
                break
        elif 'precio_base' in tier:
            tier_aplicado = tier.get('nombre')
            distancia_adicional = distancia_km - tier.get('min_km', 0)
            costo = tier.get("precio_base", 0) + (distancia_adicional * tier.get("precio_por_km_adicional", 0))
            break

    # Asegurarnos de que las claves siempre existan
    return {
        "origen": origen_coords, "destino": destino_coords,
        "distancia_km": round(distancia_km, 2),
        "distancia_texto": info_ruta.get('distancia_texto', 'N/A'),
        "duracion_estimada": info_ruta.get('duracion_estimada', 'N/A'), # <-- CORRECCIÓN
        "tier_aplicado": tier_aplicado,
        "costo": round(costo, 2),
        "moneda": config_vehiculo.get("moneda", "USD"),
        "tipo_vehiculo": tipo_vehiculo
    }

def get_address_autocomplete(input_text: str, session_token: str) -> dict:
    if not GOOGLE_MAPS_API_KEY: return {"error": "Google API Key no configurada"}
    api_url = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    params = {"input": input_text, "key": GOOGLE_MAPS_API_KEY, "language": "es", "components": "country:VE", "sessiontoken": session_token}
    try:
        response = requests.get(api_url, params=params)
        data = response.json()
        if data['status'] == 'OK': return {"suggestions": data['predictions']}
        return {"error": data.get('error_message', 'Error API')}
    except Exception as e: return {"error": str(e)}

def get_place_details(place_id: str, session_token: str) -> dict:
    if not GOOGLE_MAPS_API_KEY: return {"error": "Google API Key no configurada"}
    api_url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {"place_id": place_id, "fields": "geometry,formatted_address", "key": GOOGLE_MAPS_API_KEY, "language": "es", "sessiontoken": session_token}
    try:
        response = requests.get(api_url, params=params)
        data = response.json()
        if data['status'] == 'OK': return {"details": data['result']}
        return {"error": data.get('error_message', 'Error API')}
    except Exception as e: return {"error": str(e)}

# --- FUNCIONES DE NOTIFICACIÓN Y BD ---

def send_fcm_notification(token: str, title: str, body: str, data: dict = None):
    if not FIREBASE_INITIALIZED or not token: return False
    try:
        message = messaging.Message(notification=messaging.Notification(title=title, body=body), data=data or {}, token=token)
        messaging.send(message)
        return True
    except Exception as e:
        logger.error(f"FCM Error: {e}")
        return False

def get_db_connection(dbname=None):
    """Conexión robusta para Docker con reintentos."""
    retry_interval = 3
    while True:
        try:
            conn = psycopg2.connect(
                host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
                database=dbname if dbname else DB_NAME, options="-c TimeZone=America/Caracas"
            )
            return conn
        except psycopg2.Error:
            logger.warning(f"Esperando DB ({DB_HOST})... Reintentando en {retry_interval}s.")
            time.sleep(retry_interval)
        except Exception as e:
            logger.error(f"Error inesperado DB: {e}")
            time.sleep(retry_interval)

def db_exists():
    conn_admin = None
    try:
        conn_admin = get_db_connection(ADMIN_DB_NAME)
        conn_admin.autocommit = True
        with conn_admin.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (DB_NAME,))
            return cur.fetchone() is not None
    except Exception: return False
    finally:
        if conn_admin: conn_admin.close()

def create_db_if_not_exists():
    if not db_exists():
        conn_admin = get_db_connection(ADMIN_DB_NAME)
        conn_admin.autocommit = True
        try:
            with conn_admin.cursor() as cur:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DB_NAME)))
            logger.info(f"Base de datos {DB_NAME} creada.")
        finally: conn_admin.close()

def create_tables_if_not_exist():
    """Define y crea todas las tablas necesarias."""
    commands = (
        "CREATE TABLE IF NOT EXISTS usuarios (id_usuario VARCHAR(255) PRIMARY KEY, nombre_display VARCHAR(255), ultima_latitud DOUBLE PRECISION, ultima_longitud DOUBLE PRECISION, ultima_actualizacion_loc TIMESTAMP WITH TIME ZONE, estado_actual VARCHAR(50) DEFAULT 'Disponible', porcentaje_comision DOUBLE PRECISION DEFAULT 0.0, ultima_bateria_porcentaje INTEGER, fcm_token TEXT);",
        "CREATE TABLE IF NOT EXISTS comercios (id_comercio VARCHAR(255) PRIMARY KEY, nombre VARCHAR(255) NOT NULL, direccion TEXT, latitud DOUBLE PRECISION, longitud DOUBLE PRECISION, numero_contacto VARCHAR(50));",
        "CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, pedido TEXT NOT NULL, direccion_entrega TEXT NOT NULL, latitud_entrega DOUBLE PRECISION NOT NULL, longitud_entrega DOUBLE PRECISION NOT NULL, latitud_retiro DOUBLE PRECISION NOT NULL, longitud_retiro DOUBLE PRECISION NOT NULL, estado VARCHAR(50) DEFAULT 'pendiente', estado_previo_novedad VARCHAR(50), fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, detalles TEXT, telefono_contacto VARCHAR(50), telefono_comercio VARCHAR(50), link_maps TEXT, id_comercio VARCHAR(255) NOT NULL, costo_servicio DOUBLE PRECISION, repartidor_id VARCHAR(255), tiene_ticket_abierto BOOLEAN DEFAULT FALSE, tipo_vehiculo VARCHAR(20) NOT NULL, creado_por_usuario_id VARCHAR(255), FOREIGN KEY (repartidor_id) REFERENCES usuarios(id_usuario) ON DELETE SET NULL, FOREIGN KEY (id_comercio) REFERENCES comercios(id_comercio) ON DELETE CASCADE);",
        "CREATE TABLE IF NOT EXISTS ubicaciones_log (id_log SERIAL PRIMARY KEY, id_usuario VARCHAR(255) NOT NULL, latitud DOUBLE PRECISION NOT NULL, longitud DOUBLE PRECISION NOT NULL, timestamp TIMESTAMP WITH TIME ZONE NOT NULL, FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE);",
        "CREATE TABLE IF NOT EXISTS tickets (id_ticket SERIAL PRIMARY KEY, id_pedido INTEGER NOT NULL, id_usuario_creador VARCHAR(255) NOT NULL, estado_ticket VARCHAR(50) DEFAULT 'abierto', fecha_creacion_ticket TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, asunto_ticket TEXT, FOREIGN KEY (id_pedido) REFERENCES pedidos(id) ON DELETE CASCADE, FOREIGN KEY (id_usuario_creador) REFERENCES usuarios(id_usuario) ON DELETE CASCADE);",
        "CREATE TABLE IF NOT EXISTS mensajes_ticket (id_mensaje SERIAL PRIMARY KEY, id_ticket INTEGER NOT NULL, id_remitente VARCHAR(255) NOT NULL, tipo_remitente VARCHAR(50) NOT NULL, contenido_mensaje TEXT NOT NULL, nombre_archivo_adjunto VARCHAR(255), timestamp_mensaje TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (id_ticket) REFERENCES tickets(id_ticket) ON DELETE CASCADE);",
        "CREATE TABLE IF NOT EXISTS pedidos_logs (log_id SERIAL PRIMARY KEY, id_pedido INTEGER NOT NULL, repartidor_id VARCHAR(255), estado_registrado VARCHAR(50) NOT NULL, latitud DOUBLE PRECISION, longitud DOUBLE PRECISION, timestamp_log TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (id_pedido) REFERENCES pedidos(id) ON DELETE CASCADE);",
        "CREATE TABLE IF NOT EXISTS integraciones (pedido_id INTEGER PRIMARY KEY, id_externo VARCHAR(255) NOT NULL, fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE);",
        "CREATE TABLE IF NOT EXISTS system_logs (id SERIAL PRIMARY KEY, nivel VARCHAR(20) NOT NULL, accion VARCHAR(100) NOT NULL, usuario_responsable VARCHAR(255), detalles JSONB, timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);",
        "CREATE TABLE IF NOT EXISTS app_config (clave VARCHAR(100) PRIMARY KEY, valor JSONB NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);",
        "CREATE TABLE IF NOT EXISTS pedidos_programados (id SERIAL PRIMARY KEY, payload_pedido JSONB NOT NULL, fecha_liberacion TIMESTAMP WITH TIME ZONE NOT NULL, estado VARCHAR(50) DEFAULT 'pendiente', fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);"
    )
    conn = get_db_connection()
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for c in commands: cur.execute(c)
        logger.info("Tablas verificadas/creadas exitosamente.")
    except psycopg2.Error as e:
        logger.error(f"Error al crear/verificar tablas: {e}")
    finally:
        conn.close()

def init_database():
    """Función principal para inicializar la base de datos y las tablas."""
    create_db_if_not_exists()
    create_tables_if_not_exist()

def haversine(lat1, lon1, lat2, lon2):
    """Calcula la distancia en línea recta (Haversine) entre dos puntos en kilómetros."""
    R = 6371 # Radio de la Tierra en km
    if None in [lat1, lon1, lat2, lon2]: return float('inf') 
    try:
        lat1_r, lon1_r, lat2_r, lon2_r = map(radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
        dlon = lon2_r - lon1_r
        dlat = lat2_r - lat1_r
        a = sin(dlat / 2)**2 + cos(lat1_r) * cos(lat2_r) * sin(dlon / 2)**2
        return R * 2 * atan2(sqrt(a), sqrt(1 - a))
    except ValueError:
        return float('inf')

if __name__ == "__main__":
    init_database()