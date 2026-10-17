"""Who is in a chat and who answers. Members are keys: user:<account> for
people, char:<path of a character file> for characters. Pure."""
from stilo.modules.characters import find_mentions
from stilo.modules.file_types import BUILTIN as FILE_TYPES


def user_key(username: str) -> str:
    return f"user:{username}"


def char_key(path: str) -> str:
    return f"char:{path}"


def clean_member(key) -> str:
    key = str(key or "").strip()
    if key.startswith("user:") and len(key) > 5:
        return key
    if key.startswith("char:") and FILE_TYPES.is_type(key[5:].rsplit("/", 1)[-1], "persona"):
        return key
    raise ValueError(f"Not a chat member: {key!r}")


def responders(conversation: dict, message: dict, characters: list[dict]) -> list[str]:
    """In a private chat with a character it answers every message; in a group
    the characters @mentioned answer (@all = every character), in order."""
    cast = [c for c in characters if c["key"] in conversation["members"]]
    if conversation["kind"] == "pair":
        return [c["key"] for c in cast]
    by_handle = {c["handle"]: c["key"] for c in cast}
    return [by_handle[h] for h in find_mentions(message["content"], [c["handle"] for c in cast]) if h in by_handle]
