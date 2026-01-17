import firebase_admin
from firebase_admin import auth, credentials
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials # <-- CAMBIO AQUÍ
from database import get_db_connection
import json

# Inicializar Firebase Admin
try:
    cred = credentials.Certificate("./google-services.json")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
except FileNotFoundError:
    print("ADVERTENCIA: Archivo google-services.json no encontrado. La autenticación fallará.")

# --- CAMBIO IMPORTANTE: Usar HTTPBearer ---
# Esto le dirá a SwaggerUI que solo pida un token "Bearer".
http_bearer_scheme = HTTPBearer()

class User:
    """Modelo simple para el usuario autenticado."""
    def __init__(self, uid: str, email: str, role: str):
        self.uid = uid
        self.email = email
        self.role = role

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(http_bearer_scheme)) -> User:
    """
    Dependencia de FastAPI: Verifica el token de Firebase y devuelve un objeto User.
    Extrae el token de la cabecera 'Authorization: Bearer <token>'.
    """
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        email = decoded_token.get('email', 'N/A')
        role = decoded_token.get('role', 'viewer')
        return User(uid=uid, email=email, role=role)
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token ha expirado")
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Error de autenticación: {e}")

class RoleChecker:
    """
    Dependencia de FastAPI que verifica si el rol del usuario tiene un permiso específico.
    """
    def __init__(self, required_permission: str):
        self.required_permission = required_permission

    def __call__(self, user: User = Depends(get_current_user)):
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT valor FROM app_config WHERE clave = 'user_roles_permissions'")
                config_row = cur.fetchone()
                if not config_row:
                    raise HTTPException(500, "Configuración de roles no encontrada.")
                
                permissions_config = config_row[0]
                user_permissions = permissions_config.get(user.role, [])

                if self.required_permission not in user_permissions and "superadmin" not in user_permissions: # <-- Opcional: un superadmin puede todo
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para esta acción.")
        finally:
            conn.close()
        
        return user