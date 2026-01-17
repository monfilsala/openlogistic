import streamlit as st
import requests
import folium
from folium.plugins import Draw
from streamlit_folium import st_folium
import polyline
import pandas as pd
from shapely.geometry import Point, Polygon
import copy

# --- CONFIGURACIÓN ---
DEFAULT_LAT = 10.251519
DEFAULT_LON = -67.598037

# --- DATOS POR DEFECTO (Para inicializar el sistema) ---
TARIFA_DEFAULT = [
    {"nombre": "Cerca",           "min_km": 0,  "max_km": 1,  "precio": 1.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Corta",           "min_km": 1,  "max_km": 3,  "precio": 2.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Normal",          "min_km": 3,  "max_km": 7,  "precio": 3.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Larga",           "min_km": 7,  "max_km": 10, "precio": 4.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Extra Larga",     "min_km": 10, "max_km": 15, "precio": 6.0, "es_base": False, "precio_adicional": 0.0},
    {"nombre": "Viaje Interurbano", "min_km": 15, "max_km": 999, "precio": 10.0, "es_base": True,  "precio_adicional": 0.5}
]

# --- FUNCIONES DE LÓGICA ---

def verificar_zonas(lat, lon, zonas_activas):
    """Revisa si el destino cae en alguna zona activa"""
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
    """Calcula precio basándose en la tabla de tarifas activa"""
    for tier in tabla_tarifas:
        # Convertimos a float por seguridad
        min_k = float(tier["min_km"])
        max_k = float(tier["max_km"])
        
        if tier["es_base"]: # Lógica de precio base + km adicional
            if distancia_km >= min_k:
                extra = (distancia_km - min_k) * float(tier["precio_adicional"])
                total = float(tier["precio"]) + extra
                return round(total, 2), tier["nombre"]
        else: # Precio fijo
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

# --- UI PRINCIPAL ---
def main():
    st.set_page_config(page_title="Delivery Admin", layout="wide")

    # --- 1. INICIALIZAR BASE DE DATOS (EN MEMORIA) ---
    if 'zonas_registradas' not in st.session_state:
        st.session_state['zonas_registradas'] = [] 
        
    if 'perfiles_tarifas' not in st.session_state:
        # Diccionario de perfiles. Clave = Nombre Perfil, Valor = Lista de dicts
        st.session_state['perfiles_tarifas'] = {
            "Estándar 2024": copy.deepcopy(TARIFA_DEFAULT)
        }
        
    if 'perfil_activo' not in st.session_state:
        st.session_state['perfil_activo'] = "Estándar 2024"

    if 'cotizacion' not in st.session_state:
        st.session_state['cotizacion'] = {'ruta': None, 'puntos': [], 'precio': 0}


    # --- 2. SIDEBAR NAVEGACIÓN ---
    with st.sidebar:
        st.title("Panel de Control")
        modo = st.radio("Menú:", [
            "Modo Cotizador", 
            "Configurar Zonas", 
            "Configurar Tarifas"
        ])
        
        st.divider()
        if modo == "Modo Cotizador":
            st.success(f"Tarifa Activa:\n**{st.session_state['perfil_activo']}**")
        

    # ==========================================
    #      MODO 1: CONFIGURAR TARIFAS
    # ==========================================
    if modo == "Configurar Tarifas":
        st.subheader("Gestión de Listas de Precios")
        
        col_list, col_edit = st.columns([1, 3])
        
        with col_list:
            st.markdown("#### Perfiles")
            perfiles = list(st.session_state['perfiles_tarifas'].keys())
            
            # Selector de cuál editar
            seleccion = st.radio("Selecciona perfil para editar:", perfiles)
            
            # Botón para activar
            if st.button("Usar por Defecto", use_container_width=True):
                st.session_state['perfil_activo'] = seleccion
                st.toast(f"Perfil '{seleccion}' activado para cotizaciones.")
                st.rerun()
            
            if st.session_state['perfil_activo'] == seleccion:
                st.caption("(Actualmente Activo)")
            
            st.divider()
            
            # Crear nuevo
            nuevo_nombre = st.text_input("Nuevo Perfil")
            if st.button("Crear Nuevo") and nuevo_nombre:
                if nuevo_nombre not in st.session_state['perfiles_tarifas']:
                    st.session_state['perfiles_tarifas'][nuevo_nombre] = copy.deepcopy(TARIFA_DEFAULT)
                    st.rerun()
                else:
                    st.error("Ya existe ese nombre")

        with col_edit:
            st.markdown(f"#### Editando: {seleccion}")            
            # Convertimos la lista de diccionarios a DataFrame para editar
            df_actual = pd.DataFrame(st.session_state['perfiles_tarifas'][seleccion])
            
            # EDITOR DE DATOS INTERACTIVO
            df_editado = st.data_editor(
                df_actual,
                num_rows="dynamic", # Permite agregar/borrar filas
                use_container_width=True,
                column_config={
                    "nombre": "Nombre Tarifa",
                    "min_km": st.column_config.NumberColumn("Min KM", format="%.1f"),
                    "max_km": st.column_config.NumberColumn("Max KM", format="%.1f"),
                    "precio": st.column_config.NumberColumn("Precio Fijo / Base ($)", format="$%.2f"),
                    "es_base": st.column_config.CheckboxColumn("¿Cobra Adicional?", help="Si se marca, cobra el precio base + (km extra * precio adicional)"),
                    "precio_adicional": st.column_config.NumberColumn("Precio x Km Extra ($)", format="$%.2f")
                }
            )
            
            if st.button("Guardar Cambios en Tarifa"):
                # Convertimos DF de vuelta a lista de dicts y guardamos
                lista_actualizada = df_editado.to_dict('records')
                st.session_state['perfiles_tarifas'][seleccion] = lista_actualizada
                st.success("Cambios guardados correctamente.")

    # ==========================================
    #      MODO 2: CONFIGURAR ZONAS
    # ==========================================
    elif modo == "Configurar Zonas":
        st.subheader("Editor de Zonas Geográficas (Recargos)")
        col_admin_map, col_admin_list = st.columns([2, 1])

        with col_admin_map:
            m = folium.Map(location=[DEFAULT_LAT, DEFAULT_LON], zoom_start=13)
            
            for zona in st.session_state['zonas_registradas']:
                color = "red" if zona['activa'] else "gray"
                folium.Polygon(
                    locations=zona['coords'], color=color, fill=True, fill_opacity=0.4,
                    popup=f"{zona['nombre']} (+${zona['precio']})"
                ).add_to(m)

            draw = Draw(
                export=False, position='topleft',
                draw_options={'polyline':False,'polygon':True,'circle':False,'rectangle':False,'marker':False},
                edit_options={'edit':False, 'remove':True}
            )
            draw.add_to(m)
            output = st_folium(m, width="100%", height=500, returned_objects=["all_drawings"])

            if output and output.get("all_drawings"):
                poligonos = [d for d in output["all_drawings"] if d["geometry"]["type"] == "Polygon"]
                if poligonos:
                    coords_raw = poligonos[-1]["geometry"]["coordinates"][0]
                    coords_clean = [[p[1], p[0]] for p in coords_raw] # Swap a [lat, lon]
                    
                    es_nueva = True
                    for z in st.session_state['zonas_registradas']:
                        if z['coords'] == coords_clean: es_nueva = False
                    
                    if es_nueva:
                        nueva_zona = {"nombre": f"Zona {len(st.session_state['zonas_registradas'])+1}", "precio": 2.0, "activa": True, "coords": coords_clean}
                        st.session_state['zonas_registradas'].append(nueva_zona)
                        st.rerun()

        with col_admin_list:
            st.write("Listado de Zonas")
            zonas_temp = st.session_state['zonas_registradas'].copy()
            for i, zona in enumerate(zonas_temp):
                with st.expander(f"📍 {zona['nombre']}", expanded=False):
                    new_name = st.text_input("Nombre", zona['nombre'], key=f"n_{i}")
                    new_price = st.number_input("Recargo ($)", value=zona['precio'], key=f"p_{i}")
                    is_active = st.checkbox("Activa", value=zona['activa'], key=f"a_{i}")
                    if st.button("Guardar", key=f"s_{i}"):
                        st.session_state['zonas_registradas'][i].update({'nombre': new_name, 'precio': new_price, 'activa': is_active})
                        st.rerun()
                    if st.button("Eliminar", key=f"d_{i}"):
                        st.session_state['zonas_registradas'].pop(i)
                        st.rerun()

    # ==========================================
    #      MODO 3: COTIZADOR (CLIENTE)
    # ==========================================
    elif modo == "Modo Cotizador":
        st.subheader("Cotizador de Rutas")
        col_mapa, col_info = st.columns([3, 1])

        with col_mapa:
            m = folium.Map(location=[DEFAULT_LAT, DEFAULT_LON], zoom_start=13)

            # Mostrar Zonas
            for zona in st.session_state['zonas_registradas']:
                if zona['activa']:
                    folium.Polygon(locations=zona['coords'], color="red", weight=1, fill=True, fill_opacity=0.2).add_to(m)

            # Mostrar Ruta
            session = st.session_state['cotizacion']
            if session['ruta']:
                folium.PolyLine(session['ruta']['ruta_coords'], color="blue", weight=5).add_to(m)
                if len(session['puntos']) >= 2:
                     folium.Marker([session['puntos'][0][1], session['puntos'][0][0]], icon=folium.Icon(color="green")).add_to(m)
                     folium.Marker([session['puntos'][1][1], session['puntos'][1][0]], icon=folium.Icon(color="red")).add_to(m)

            # Herramienta Dibujo
            draw = Draw(
                export=False, position='topleft',
                draw_options={'polyline':False,'polygon':False,'circle':False,'rectangle':False,'marker':True},
                edit_options={'edit':True, 'remove':True}
            )
            draw.add_to(m)
            output = st_folium(m, width="100%", height=600, returned_objects=["all_drawings"])

            # Cálculo
            if output and output.get("all_drawings"):
                puntos = [d["geometry"]["coordinates"] for d in output["all_drawings"] if d["geometry"]["type"] == "Point"]
                if len(puntos) >= 2:
                    if puntos != session['puntos']:
                        origen, destino = puntos[0], puntos[1]
                        ruta = obtener_ruta_osrm(origen, destino)
                        if ruta:
                            # OBTENER TARIFA ACTIVA
                            nombre_perfil = st.session_state['perfil_activo']
                            tabla_actual = st.session_state['perfiles_tarifas'][nombre_perfil]
                            
                            # CÁLCULOS
                            p_base, nom_tarifa = calcular_precio_base(ruta['distancia_km'], tabla_actual)
                            recargo_zonas, nombres_zonas = verificar_zonas(destino[1], destino[0], st.session_state['zonas_registradas'])
                            
                            st.session_state['cotizacion'] = {
                                'ruta': ruta, 'puntos': puntos, 'p_base': p_base, 'p_zona': recargo_zonas,
                                'total': p_base + recargo_zonas, 'detalles': {'tarifa': nom_tarifa, 'zonas': nombres_zonas}
                            }
                            st.rerun()
                elif len(puntos) < 2 and session['ruta']:
                    st.session_state['cotizacion'] = {'ruta': None, 'puntos': [], 'precio': 0}
                    st.rerun()

        with col_info:
            st.markdown(f"**Perfil de Tarifas:** {st.session_state['perfil_activo']}")
            datos = st.session_state['cotizacion']
            
            if datos['ruta']:
                st.success("¡Cotización Lista!")
                st.write(f"Distancia: **{datos['ruta']['distancia_km']} km**")
                st.write(f"Tiempo: **{datos['ruta']['duracion_min']} min**")
                st.divider()
                st.write(f"Base: **${datos['p_base']}**")
                if datos['p_zona'] > 0:
                    st.write(f"Extra Zona: **+${datos['p_zona']}**")
                st.metric("TOTAL", f"${datos['total']}")
            else:
                st.info("Marca 2 puntos en el mapa.")

            # TABLA DE TARIFAS CON RANGOS
            with st.expander("Ver Tabla de Precios", expanded=True):
                nombre_perfil = st.session_state['perfil_activo']
                tabla_raw = st.session_state['perfiles_tarifas'][nombre_perfil]
                
                # Preparamos tabla visual
                tabla_visual = []
                for fila in tabla_raw:
                    # Formato Km
                    if float(fila['max_km']) > 500:
                        rango = f"> {fila['min_km']} km"
                    else:
                        rango = f"{fila['min_km']} - {fila['max_km']} km"
                    
                    # Formato Precio
                    if fila['es_base']:
                        precio = f"${fila['precio']} + ${fila['precio_adicional']}/km"
                    else:
                        precio = f"${fila['precio']}"
                        
                    tabla_visual.append({
                        "Rango": rango,
                        "Precio": precio
                    })
                
                st.table(pd.DataFrame(tabla_visual))

if __name__ == "__main__":
    main()