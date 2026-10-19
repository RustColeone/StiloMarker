"""What type a file name has, and what follows from it. Pure: a list of type
entries goes in, answers come out. The browser has the same rules in
app/modules/file-types/model/types.js; spec/file-types/type-of.cases.json keeps
the two in step (docs/ARCHITECTURE.md, rule 6)."""


class TypeTable:
    def __init__(self, entries):
        self._entries = list(entries)

    def _find(self, name):
        lower = str(name or "").lower()
        best = None
        for entry in self._entries:
            for extension in entry["extensions"]:
                if lower.endswith(extension) and len(lower) > len(extension):
                    if best is None or len(extension) > len(best[1]):
                        best = (entry, extension)
        return best

    def type_of(self, name):
        hit = self._find(name)
        return hit[0] if hit else None

    def extension_of(self, name):
        hit = self._find(name)
        text = str(name or "")
        if hit:
            return text[-len(hit[1]):].lower()
        dot = text.rfind(".")
        return text[dot:].lower() if dot > 0 else ""

    def base_name(self, name):
        extension = self.extension_of(name)
        text = str(name or "")
        return text[: -len(extension)] if extension else text

    def is_known(self, name):
        return self.type_of(name) is not None

    def is_text(self, name):
        entry = self.type_of(name)
        return bool(entry) and entry["kind"] == "text"

    def is_image(self, name):
        entry = self.type_of(name)
        return bool(entry) and entry["kind"] == "image"

    def is_type(self, name, ident):
        entry = self.type_of(name)
        return bool(entry) and entry["id"] == ident

    def format_of(self, name):
        entry = self.type_of(name)
        return entry["format"] if entry else None

    def mime_of(self, name):
        hit = self._find(name)
        return hit[0]["extensions"][hit[1]] if hit else "application/octet-stream"

    def generated_extensions(self):
        """The extensions an image model can write a picture as (the first is the usual one)."""
        return [extension for entry in self._entries for extension in entry.get("generated", [])]

    def extensions_of(self, ident):
        entry = next((e for e in self._entries if e["id"] == ident), None)
        return list(entry["extensions"]) if entry else []
