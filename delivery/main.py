import streamlit as st
import requests
import folium
from folium.plugins import Draw
from streamlit_folium import st_folium
import polyline
import pandas as pd
from shapely.geometry import Point, Polygon
import copy
import sqlite3
import json
import uuid

# --- CONFIGURACIÓN ---
DEFAULT_LAT = 10.251519
DEFAULT_LON = -67.598037
DB_FILE = "delivery_system.db"

# --- DATOS POR DEFECTO ---
TARIFA_DEFAULT = [
    {"nombre": "Cerca", "min_km": 0, "max_km": 1, "precio": 1.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Corta", "min_km": 1, "max_km": 3, "precio": 2.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Normal", "min_km": 3, "max_km": 7, "precio": 3.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Larga", "min_km": 7, "max_km": 10, "precio": 4.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Extra Larga", "min_km": 10, "max_km": 15, "precio": 6.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Interurbano", "min_km": 15, "max_km": 999, "precio": 10.0, "es_base": True, "precio_adicional": 0.5}
]

# ==========================================
#      CAPA DE BASE DE DATOS (SQLite)
# ==========================================

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Tabla para cotizaciones históricas
    c.execute('''CREATE TABLE IF NOT EXISTS quotes 
                 (id TEXT PRIMARY KEY, 
                  data TEXT, 
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Tabla para configuración (Zonas y Tarifas)
    c.execute('''CREATE TABLE IF NOT EXISTS config 
                 (key TEXT PRIMARY KEY, value TEXT)''')
    conn.commit()
    conn.close()

def save_config(key, data):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", (key, json.dumps(data)))
    conn.commit()
    conn.close()

def load_config(key, default_value):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key=?", (key,))
    result = c.fetchone()
    conn.close()
    if result:
        return json.loads(result[0])
    return default_value

def save_quote_to_db(quote_data):
    quote_id = str(uuid.uuid4())[:8] # ID corto de 8 caracteres
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT INTO quotes (id, data) VALUES (?, ?)", (quote_id, json.dumps(quote_data)))
    conn.commit()
    conn.close()
    return quote_id

def get_quote_from_db(quote_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT data FROM quotes WHERE id=?", (quote_id,))
    result = c.fetchone()
    conn.close()
    if result:
        return json.loads(result[0])
    return None

# ==========================================
#      LÓGICA DE NEGOCIO
# ==========================================

def verificar_zonas(lat, lon, zonas_activas):
    punto = Point(lat, lon) 
    recargo_total = 0
    zonas_afectadas = []
    for zona in zonas_activas:
        if not zona['activa']: continue
        poly = Polygon(zona['coords'])
        if poly.contains(punto):
            recargo_total += zona['precio']
            zonas_afectadas.append(zona['nombre'])
    return recargo_total, zonas_afectadas

def calcular_precio_base(distancia_km, tabla_tarifas):
    for tier in tabla_tarifas:
        min_k = float(tier["min_km"])
        max_k = float(tier["max_km"])
        if tier["es_base"]: 
            if distancia_km >= min_k:
                extra = (distancia_km - min_k) * float(tier["precio_adicional"])
                total = float(tier["precio"]) + extra
                return round(total, 2), tier["nombre"]
        else: 
            if min_k <= distancia_km < max_k:
                return float(tier["precio"]), tier["nombre"]
    return 0.0, "Fuera de Rango"

def obtener_ruta_osrm(p1, p2):
    coords = f"{p1[0]},{p1[1]};{p2[0]},{p2[1]}"
    url = f"http://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=polyline"
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        if data.get("code") != "Ok": return None
        route = data["routes"][0]
        return {
            "distancia_km": round(route["distance"] / 1000, 2),
            "duracion_min": round(route["duration"] / 60, 0),
            "ruta_coords": polyline.decode(route["geometry"])
        }
    except:
        return None

# ==========================================
#      INTERFAZ DE USUARIO
# ==========================================

def main():
    st.set_page_config(page_title="Sistema Delivery", layout="wide", initial_sidebar_state="collapsed")
    init_db()

    # 1. VERIFICAR SI ESTAMOS EN MODO VISOR (CLIENTE)
    # Streamlit query params: ?id=xxxx
    query_params = st.query_params
    quote_id = query_params.get("id", None)

    if quote_id:
        render_client_view(quote_id)
    else:
        render_admin_panel()

def render_client_view(quote_id):
    """Vista simplificada para el cliente final"""
    data = get_quote_from_db(quote_id)
    
    if not data:
        st.error("Cotización no encontrada o expirada.")
        if st.button("Ir al Inicio"):
            st.query_params.clear()
            st.rerun()
        return

    st.markdown("### 🧾 Detalle de Cotización")
    
    col_map, col_detail = st.columns([2, 1])
    
    with col_map:
        # Mapa estático (sin herramientas de dibujo)
        puntos = data['puntos']
        # Centrar mapa
        m = folium.Map(location=[puntos[0][1], puntos[0][0]], zoom_start=13)
        
        # Ruta y Marcadores
        folium.PolyLine(data['ruta']['ruta_coords'], color="blue", weight=5).add_to(m)
        folium.Marker([puntos[0][1], puntos[0][0]], popup="Origen", icon=folium.Icon(color="green")).add_to(m)
        folium.Marker([puntos[1][1], puntos[1][0]], popup="Destino", icon=folium.Icon(color="red")).add_to(m)
        
        st_folium(m, width="100%", height=500)

    with col_detail:
        st.info(f"ID Referencia: {quote_id}")
        st.metric("Total a Pagar", f"${data['total']}")
        
        st.divider()
        st.write(f"Distancia: **{data['ruta']['distancia_km']} km**")
        st.write(f"Tiempo est.: **{data['ruta']['duracion_min']} min**")
        
        st.markdown("#### Desglose")
        st.write(f"Tarifa Base: ${data['p_base']}")
        if data['p_zona'] > 0:
            st.write(f"Recargo Zona: ${data['p_zona']}")
            for z in data['detalles']['zonas']:
                st.caption(f"- {z}")
                
        st.caption("Esta cotización es válida por 24 horas.")

def render_admin_panel():
    """Panel completo de administración"""
    
    # Cargar Configuración desde DB
    if 'zonas_registradas' not in st.session_state:
        st.session_state['zonas_registradas'] = load_config('zonas', [])
        
    if 'perfiles_tarifas' not in st.session_state:
        st.session_state['perfiles_tarifas'] = load_config('tarifas', {"Estándar": copy.deepcopy(TARIFA_DEFAULT)})
        
    if 'perfil_activo' not in st.session_state:
        st.session_state['perfil_activo'] = load_config('perfil_activo', "Estándar")

    if 'cotizacion' not in st.session_state:
        st.session_state['cotizacion'] = {'ruta': None, 'puntos': [], 'precio': 0, 'id': None}

    # Sidebar
    with st.sidebar:
        st.header("Panel de Control")
        modo = st.radio("Navegación", ["Cotizador", "Zonas", "Tarifas"])
        st.divider()
        st.caption("Sistema v3.0 - DB Activa")

    # --- MODO TARIFAS ---
    if modo == "Tarifas":
        st.subheader("Configuración de Tarifas")
        col_list, col_edit = st.columns([1, 3])
        
        with col_list:
            perfiles = list(st.session_state['perfiles_tarifas'].keys())
            seleccion = st.selectbox("Seleccionar Perfil", perfiles, index=perfiles.index(st.session_state['perfil_activo']) if st.session_state['perfil_activo'] in perfiles else 0)
            
            if st.button("Activar Perfil"):
                st.session_state['perfil_activo'] = seleccion
                save_config('perfil_activo', seleccion)
                st.success("Perfil activado")
            
            if st.session_state['perfil_activo'] == seleccion:
                st.caption("✅ Perfil Activo")
            
            st.divider()
            nuevo = st.text_input("Nuevo Perfil")
            if st.button("Crear") and nuevo:
                if nuevo not in st.session_state['perfiles_tarifas']:
                    st.session_state['perfiles_tarifas'][nuevo] = copy.deepcopy(TARIFA_DEFAULT)
                    save_config('tarifas', st.session_state['perfiles_tarifas'])
                    st.rerun()

        with col_edit:
            df_actual = pd.DataFrame(st.session_state['perfiles_tarifas'][seleccion])
            df_editado = st.data_editor(
                df_actual, num_rows="dynamic", use_container_width=True,
                column_config={
                    "nombre": "Nombre",
                    "min_km": st.column_config.NumberColumn("Min KM", format="%.1f"),
                    "max_km": st.column_config.NumberColumn("Max KM", format="%.1f"),
                    "precio": st.column_config.NumberColumn("Precio Base ($)", format="$%.2f"),
                    "es_base": st.column_config.CheckboxColumn("Es Base+Extra"),
                    "precio_adicional": st.column_config.NumberColumn("Extra/KM ($)", format="$%.2f")
                }
            )
            if st.button("Guardar Cambios"):
                st.session_state['perfiles_tarifas'][seleccion] = df_editado.to_dict('records')
                save_config('tarifas', st.session_state['perfiles_tarifas'])
                st.success("Guardado en Base de Datos")

    # --- MODO ZONAS ---
    elif modo == "Zonas":
        st.subheader("Configuración de Zonas Geográficas")
        col_map, col_list = st.columns([2, 1])
        
        with col_map:
            m = folium.Map(location=[DEFAULT_LAT, DEFAULT_LON], zoom_start=13)
            for z in st.session_state['zonas_registradas']:
                color = "red" if z['activa'] else "gray"
                folium.Polygon(locations=z['coords'], color=color, fill=True, fill_opacity=0.4, popup=z['nombre']).add_to(m)
            
            Draw(export=False, draw_options={'polyline':False,'polygon':True,'marker':False,'circle':False,'rectangle':False}, edit_options={'edit':False,'remove':True}).add_to(m)
            output = st_folium(m, width="100%", height=500, returned_objects=["all_drawings"])
            
            if output and output.get("all_drawings"):
                polys = [d for d in output["all_drawings"] if d["geometry"]["type"] == "Polygon"]
                if polys:
                    coords = [[p[1], p[0]] for p in polys[-1]["geometry"]["coordinates"][0]]
                    is_new = True
                    for z in st.session_state['zonas_registradas']:
                        if z['coords'] == coords: is_new = False
                    
                    if is_new:
                        new_zone = {"nombre": f"Zona {len(st.session_state['zonas_registradas'])+1}", "precio": 2.0, "activa": True, "coords": coords}
                        st.session_state['zonas_registradas'].append(new_zone)
                        save_config('zonas', st.session_state['zonas_registradas'])
                        st.rerun()
        
        with col_list:
            zonas = st.session_state['zonas_registradas']
            for i, z in enumerate(zonas):
                with st.expander(f"{z['nombre']}", expanded=False):
                    n = st.text_input("Nombre", z['nombre'], key=f"n{i}")
                    p = st.number_input("Extra ($)", value=z['precio'], key=f"p{i}")
                    a = st.checkbox("Activa", value=z['activa'], key=f"a{i}")
                    if st.button("Actualizar", key=f"u{i}"):
                        zonas[i].update({'nombre': n, 'precio': p, 'activa': a})
                        save_config('zonas', zonas)
                        st.rerun()
                    if st.button("Borrar", key=f"d{i}"):
                        zonas.pop(i)
                        save_config('zonas', zonas)
                        st.rerun()

    # --- MODO COTIZADOR ---
    elif modo == "Cotizador":
        st.subheader("Nueva Cotización")
        col_map, col_res = st.columns([3, 1])
        
        with col_map:
            m = folium.Map(location=[DEFAULT_LAT, DEFAULT_LON], zoom_start=13)
            # Zonas visuales
            for z in st.session_state['zonas_registradas']:
                if z['activa']: folium.Polygon(locations=z['coords'], color="red", weight=1, fill=True, fill_opacity=0.1).add_to(m)
            
            # Ruta
            session = st.session_state['cotizacion']
            if session['ruta']:
                folium.PolyLine(session['ruta']['ruta_coords'], color="blue", weight=5).add_to(m)
                folium.Marker([session['puntos'][0][1], session['puntos'][0][0]], icon=folium.Icon(color="green")).add_to(m)
                folium.Marker([session['puntos'][1][1], session['puntos'][1][0]], icon=folium.Icon(color="red")).add_to(m)
                
            Draw(export=False, draw_options={'polyline':False,'polygon':False,'marker':True,'circle':False,'rectangle':False}, edit_options={'edit':True,'remove':True}).add_to(m)
            output = st_folium(m, width="100%", height=600, returned_objects=["all_drawings"])
            
            if output and output.get("all_drawings"):
                pts = [d["geometry"]["coordinates"] for d in output["all_drawings"] if d["geometry"]["type"] == "Point"]
                if len(pts) >= 2 and pts != session['puntos']:
                    route = obtener_ruta_osrm(pts[0], pts[1])
                    if route:
                        prof = st.session_state['perfil_activo']
                        p_base, nom = calcular_precio_base(route['distancia_km'], st.session_state['perfiles_tarifas'][prof])
                        p_zona, z_names = verificar_zonas(pts[1][1], pts[1][0], st.session_state['zonas_registradas'])
                        
                        # GUARDAR EN DB
                        quote_data = {
                            'ruta': route, 'puntos': pts, 'p_base': p_base, 'p_zona': p_zona,
                            'total': p_base + p_zona, 'detalles': {'tarifa': nom, 'zonas': z_names}
                        }
                        new_id = save_quote_to_db(quote_data)
                        
                        st.session_state['cotizacion'] = quote_data
                        st.session_state['cotizacion']['id'] = new_id
                        st.rerun()
                elif len(pts) < 2 and session['ruta']:
                    st.session_state['cotizacion'] = {'ruta': None, 'puntos': [], 'precio': 0, 'id': None}
                    st.rerun()

        with col_res:
            if session['ruta']:
                st.success(f"ID: {session['id']}")
                st.metric("Total", f"${session['total']}")
                st.write(f"Base: ${session['p_base']}")
                if session['p_zona'] > 0: st.write(f"Zona: +${session['p_zona']}")
                st.write(f"Distancia: {session['ruta']['distancia_km']} km")
                
                # GENERADOR DE LINK
                base_url = st.query_params.get("base_url", "http://localhost:8501") # Detecta o usa default
                # Nota: En Streamlit local la URL base no siempre es detectable, se asume localhost para dev
                
                st.divider()
                st.markdown("##### 🔗 Link para Cliente")
                # Obtenemos la URL base actual si es posible, sino mostramos relativo
                link = f"/?id={session['id']}"
                st.code(link, language="text")
                st.info("Copia el link de arriba y agrégalo al final de la URL de tu navegador para probar la vista de cliente.")
            else:
                st.info("Marca Origen y Destino")
                
            with st.expander("Tarifa Vigente"):
                prof = st.session_state['perfil_activo']
                data = st.session_state['perfiles_tarifas'][prof]
                view_data = []
                for r in data:
                    rango = f"{r['min_km']} - {r['max_km']} km" if r['max_km'] < 500 else f"> {r['min_km']} km"
                    pr = f"${r['precio']}" + (f" + ${r['precio_adicional']}/km" if r['es_base'] else "")
                    view_data.append({"Rango": rango, "Precio": pr})
                st.table(pd.DataFrame(view_data))

if __name__ == "__main__":
    main()