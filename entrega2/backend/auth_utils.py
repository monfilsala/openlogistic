import firebase_admin
from firebase_admin import auth, credentials
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, APIKeyHeader
from psycopg2.extras import RealDictCursor
from typing import Optional, Any
from passlib.context import CryptContext # <-- AÑADIR IMPORT

# --- INICIO DE LA CORRECCIÓN ---
# Importamos 'get_db' y 'get_db_connection' desde 'database'
from database import get_db, get_db_connection

# Movemos la definición de pwd_context aquí. Este es su lugar lógico.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# --- FIN DE LA CORRECCIÓN ---


# --- INICIALIZACIÓN DE FIREBASE ---
try:
    cred = credentials.Certificate("./google-services.json")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
except FileNotFoundError:
    print("ADVERTENCIA: Archivo google-services.json no encontrado.")


# --- DEFINICIÓN DE ESQUEMAS DE SEGURIDAD ---
http_bearer_scheme = HTTPBearer(auto_error=False)
api_key_header_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


# --- MODELO DE USUARIO INTERNO ---
class User:
    def __init__(self, uid: str, email: str, role: str):
        self.uid = uid
        self.email = email
        self.role = role


# --- DEPENDENCIAS DE VALIDACIÓN INDIVIDUALES ---
def get_current_user(credentials: Optional[HTTPBearer] = Depends(http_bearer_scheme)) -> Optional[User]:
    if not credentials or not credentials.credentials:
        return None
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        email = decoded_token.get('email', 'N/A')
        role = decoded_token.get('role', 'viewer')
        return User(uid=uid, email=email, role=role)
    except Exception:
        return None

async def get_api_key_principal(api_key: Optional[str] = Depends(api_key_header_scheme), db=Depends(get_db)) -> Optional[str]:
    if not api_key:
        return None
    try:
        prefix = api_key.split('_')[0] + "_" + api_key.split('_')[1]
    except IndexError:
        return None
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT hashed_key, client_name FROM api_keys WHERE prefix = %s AND is_active = TRUE", (prefix,))
        result = cur.fetchone()
        if not result or not pwd_context.verify(api_key, result['hashed_key']):
            return None
        cur.execute("UPDATE api_keys SET last_used_at = NOW() WHERE prefix = %s", (prefix,))
        db.commit()
        return result['client_name']

# --- DEPENDENCIA DE AUTENTICACIÓN DUAL ---
async def get_current_principal(
    user: Optional[User] = Depends(get_current_user),
    client_name: Optional[str] = Depends(get_api_key_principal)
) -> Any:
    if user:
        return user
    if client_name:
        return client_name
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer, X-API-Key"},
    )

# --- DEPENDENCIA DE CHEQUEO DE ROLES ---
def require_user(user: Optional[User] = Depends(get_current_user)) -> User:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Se requiere un token de usuario válido para esta operación",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return user

class RoleChecker:
    def __init__(self, required_permission: str):
        self.required_permission = required_permission
    def __call__(self, user: User = Depends(require_user)):
        conn = None
        try:
            conn = get_db_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT valor FROM app_config WHERE clave = 'user_roles_permissions'")
                config_row = cur.fetchone()
                if not config_row:
                    raise HTTPException(500, "Configuración de roles no encontrada.")
                permissions_config = config_row[0]
                user_permissions = permissions_config.get(user.role, [])
                if self.required_permission not in user_permissions and "superadmin" not in user_permissions:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para esta acción.")
        finally:
            if conn:
                conn.close()
        return user