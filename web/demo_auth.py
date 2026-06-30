"""Verify the short-lived demo token that gates the public ``/ws/pipeline`` endpoint.

The portal (``/api/demo-token``) issues an HS256 JWT — ``{"purpose": "demo"}`` with
``iat``/``exp`` (5 min) — signed with the raw bytes of the hex ``DEMO_TOKEN_SECRET``
(``bytes.fromhex(secret)``, matching the portal's ``secretKey()``). We verify the
signature and expiry the same way so a tunnelled demo can't be driven without a
freshly-issued token.
"""

from __future__ import annotations

import jwt


def verify_demo_token(token: str, secret_hex: str) -> bool:
    """Return True iff ``token`` is a valid, unexpired demo JWT for ``secret_hex``.

    ``secret_hex`` is the hex string from the env; the signing key is its raw bytes
    (same as the portal). Any malformed/expired/wrong-signature token returns False.
    """
    if not token or not secret_hex:
        return False
    try:
        key = bytes.fromhex(secret_hex)
    except ValueError:
        return False
    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=["HS256"],
            options={"require": ["exp"]},
        )
    except jwt.PyJWTError:
        return False
    return payload.get("purpose") == "demo"
