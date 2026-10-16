"""Characters (server): what a character file is, what a character knows and
what it may read. The browser's half is app/modules/characters.

Static, for code from before the restructure: persona_header, persona_summary,
persona_handle, find_mentions, split_author_notes, notes_mode,
without_author_notes, hidden_from_characters, characters_view, PERSONA_SUFFIX.
"""
from stilo.kernel import define_module
from .model import (PERSONA_SUFFIX, character_instructions, characters_view, find_mentions, hidden_from_characters, notes_mode,  # noqa: F401
                    persona_handle, persona_header, persona_summary, split_author_notes,
                    without_author_notes)


def start(ctx):
    return {name: globals()[name] for name in ("persona_header", "split_author_notes", "notes_mode",
                                               "without_author_notes", "hidden_from_characters")}


MODULE = define_module(__file__, start)
