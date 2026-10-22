"""File types: the one place on the server that knows what each kind of file
is. The list lives in protocol/file-types.json, shared with the browser.

API (also BUILTIN, the same table for code from before the restructure):
    type_of(name) -> entry or None   is_type(name, id)   is_known / is_text / is_image(name)
    format_of(name)   extension_of(name)   base_name(name)   mime_of(name)   extensions_of(id)
    generated_extensions() -> what an image model can write a picture as
    is_reserved(name) -> a name no file or folder may have at a workspace's top
"""
from stilo.kernel import define_module
from .adapters.data import load_reserved, load_types
from .model import TypeTable

# For code from before the restructure, which looks types up without the kernel.
BUILTIN = TypeTable(load_types(), load_reserved())


def start(ctx):
    return BUILTIN


MODULE = define_module(__file__, start)
