from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import get_settings


class SecretsManager:
    def __init__(self) -> None:
        settings = get_settings()
        material = settings.ssh_secret_key or settings.secret_key
        digest = hashlib.sha256(material.encode("utf-8")).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def encrypt(self, secret: str | None) -> str | None:
        if not secret:
            return None
        return self._fernet.encrypt(secret.encode("utf-8")).decode("utf-8")

    def decrypt(self, encrypted_secret: str | None) -> str | None:
        if not encrypted_secret:
            return None
        return self._fernet.decrypt(encrypted_secret.encode("utf-8")).decode("utf-8")

