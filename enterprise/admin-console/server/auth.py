"""
Authentication module for OpenClaw Enterprise.
Supports two auth modes:
  1. Azure AD (RS256) — validated via JWKS, employee looked up by email
  2. Local JWT (HS256) — self-signed, employee ID in token payload
"""
import os
import time
import hashlib
import hmac
import json
import base64
import logging
from typing import Optional
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# ── Azure AD configuration ───────────────────────────────────────────────────
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")

_AZURE_ENABLED = bool(AZURE_TENANT_ID and AZURE_CLIENT_ID)
if not _AZURE_ENABLED:
    logger.warning("AZURE_TENANT_ID / AZURE_CLIENT_ID not set — Azure AD login disabled")

_JWKS_URI = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"
_ISSUER = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/v2.0"
_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(_JWKS_URI, cache_keys=True, lifespan=3600)
    return _jwks_client


# ── Local JWT configuration ──────────────────────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    JWT_SECRET = "dev-only-" + hashlib.sha256(os.urandom(16)).hexdigest()[:32]
JWT_EXPIRY_HOURS = 24


@dataclass
class UserContext:
    employee_id: str
    name: str
    role: str  # admin | manager | employee
    department_id: str
    position_id: str
    email: str = ""
    must_change_password: bool = False


# ── Token detection ──────────────────────────────────────────────────────────

def _peek_alg(token: str) -> str:
    """Read the 'alg' from a JWT header without verifying."""
    try:
        header_b64 = token.split(".")[0]
        padding = 4 - len(header_b64) % 4
        if padding != 4:
            header_b64 += "=" * padding
        header = json.loads(base64.urlsafe_b64decode(header_b64))
        return header.get("alg", "")
    except Exception:
        return ""


# ── Azure AD token verification ──────────────────────────────────────────────

def _verify_azure_token(token: str) -> Optional[dict]:
    """Verify an Azure AD RS256 token and return decoded claims."""
    if not _AZURE_ENABLED:
        return None
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=AZURE_CLIENT_ID,
            issuer=_ISSUER,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
        return claims
    except jwt.ExpiredSignatureError:
        logger.warning("Azure AD token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning("Azure AD token invalid: %s", e)
        return None
    except Exception as e:
        logger.warning("Azure AD token verification failed: %s", e)
        return None


def _user_from_azure_claims(claims: dict) -> Optional[UserContext]:
    """Map Azure AD claims to a UserContext via DynamoDB email lookup."""
    email = (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("upn")
        or ""
    )
    if not email:
        logger.warning("Azure AD token has no email/preferred_username claim")
        return None

    import db
    emp = db.get_employee_by_email(email)

    # Fallback: extract original email from #EXT# UPN
    if not emp and "#EXT#" in email:
        local_part = email.split("#EXT#")[0]
        last_underscore = local_part.rfind("_")
        if last_underscore > 0:
            original_email = local_part[:last_underscore] + "@" + local_part[last_underscore + 1:]
            emp = db.get_employee_by_email(original_email)
            if emp:
                email = original_email

    if not emp:
        logger.warning("No employee found for Azure AD email: %s", email)
        return None

    return UserContext(
        employee_id=emp["id"],
        name=emp.get("name", claims.get("name", "")),
        role=emp.get("role", "employee"),
        department_id=emp.get("departmentId", ""),
        position_id=emp.get("positionId", ""),
        email=email,
    )


# ── Local JWT creation / verification ────────────────────────────────────────

def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_token(employee: dict, must_change_password: bool = False) -> str:
    """Create a local HS256 JWT from an employee record."""
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload_data = {
        "sub": employee.get("id", ""),
        "name": employee.get("name", ""),
        "role": employee.get("role", "employee"),
        "departmentId": employee.get("departmentId", ""),
        "positionId": employee.get("positionId", ""),
        "mustChangePassword": must_change_password,
        "exp": int(time.time()) + JWT_EXPIRY_HOURS * 3600,
    }
    payload = _b64encode(json.dumps(payload_data).encode())
    signature = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    sig = _b64encode(signature)
    return f"{header}.{payload}.{sig}"


def _verify_local_token(token: str) -> Optional[UserContext]:
    """Verify a local HS256 JWT and return UserContext."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, payload, sig = parts

        expected = hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
        actual = _b64decode(sig)
        if not hmac.compare_digest(expected, actual):
            return None

        data = json.loads(_b64decode(payload))
        if data.get("exp", 0) < time.time():
            return None

        return UserContext(
            employee_id=data.get("sub", ""),
            name=data.get("name", ""),
            role=data.get("role", "employee"),
            department_id=data.get("departmentId", ""),
            position_id=data.get("positionId", ""),
            must_change_password=data.get("mustChangePassword", False),
        )
    except Exception:
        return None


# ── Public API ───────────────────────────────────────────────────────────────

def get_user_from_request(authorization: str = "") -> Optional[UserContext]:
    """Extract user from Authorization header. Auto-detects token type:
    RS256 → Azure AD, HS256 → local JWT."""
    if not authorization:
        return None
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        return None

    alg = _peek_alg(token)

    if alg == "RS256":
        claims = _verify_azure_token(token)
        if not claims:
            return None
        return _user_from_azure_claims(claims)
    else:
        # HS256 or unknown → try local JWT
        return _verify_local_token(token)
