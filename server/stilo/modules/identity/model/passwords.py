"""Passwords as the account file keeps them: a salted scrypt hash,

    scrypt$<n>$<r>$<p>$<salt, base64>$<hash, base64>

or, in a file from before hashing, the password itself (plaintext), which
is still accepted until the file is converted (server/accounts.py convert).
Pure: computing, no reading or writing."""
import base64
import hashlib
import hmac
import secrets

PREFIX = "scrypt$"
N, R, P = 2 ** 14, 8, 1   # about 16 MB and a few tens of ms per check
SALT_BYTES, HASH_BYTES = 16, 32
MIN_LENGTH = 8            # for a password set from now on


def is_hashed(stored: str) -> bool:
    return str(stored).startswith(PREFIX)


def hash_password(password: str, *, salt: bytes | None = None, n: int = N, r: int = R, p: int = P) -> str:
    salt = secrets.token_bytes(SALT_BYTES) if salt is None else salt
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=HASH_BYTES, maxmem=64 * 1024 * 1024)
    return f"{PREFIX}{n}${r}${p}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(stored: str, password: str) -> bool:
    """Whether `password` is the one `stored` keeps (hashed, or plaintext from before)."""
    stored, password = str(stored or ""), str(password or "")
    if not stored or not password:
        return False
    if not is_hashed(stored):
        return hmac.compare_digest(stored.encode("utf-8"), password.encode("utf-8"))
    try:
        _, n, r, p, salt, digest = stored.split("$")
        want = base64.b64decode(digest)
        got = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(want), maxmem=64 * 1024 * 1024)
    except (ValueError, TypeError):
        return False  # a damaged entry signs no one in
    return hmac.compare_digest(got, want)


def password_problem(password: str) -> str | None:
    """Why a new password will not do, or None."""
    if len(str(password or "")) < MIN_LENGTH:
        return f"A password needs at least {MIN_LENGTH} characters."
    return None
