# Vox Trader - API key şifreleme (Fernet)
import base64
import hashlib
from cryptography.fernet import Fernet
from config import get_settings


def _get_fernet() -> Fernet:
    s = get_settings()
    key = getattr(s, "ENCRYPTION_KEY", None)
    if key:
        key = key.encode() if isinstance(key, str) else key
    else:
        raw = hashlib.sha256((s.JWT_SECRET + "vox_binance_salt").encode()).digest()
        key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_api_value(plain: str) -> str:
    if not plain:
        return ""
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_api_value(cipher: str) -> str:
    if not cipher:
        return ""
    return _get_fernet().decrypt(cipher.encode()).decode()
