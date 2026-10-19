"""A character's reply in a group chat (Chats asks for it): the character's
sheet, the cast, the transcript seen from its side, and read-only tools.
A mixin of the Agent (service/agent.py)."""
import copy
import json

from stilo.kernel.log import best_effort as _best_effort
from stilo.modules.characters import character_instructions, characters_view, notes_mode, persona_header, split_author_notes


class CharacterReplies:
    # Group-chat transcripts are many short turns from several speakers, so they
    # get a longer memory than agent threads, bounded by size instead.
    PERSONA_MAX_MESSAGES = 60
    PERSONA_MAX_TRANSCRIPT_CHARS = 40000
    PERSONA_MAX_SHEET_CHARS = 40000
    PERSONA_MAX_CAST = 8
    PERSONA_DEFAULT_TEMPERATURE = 0.8
    PERSONA_MAX_TEMPERATURE = 1.5

    @staticmethod
    def _clean_text(value, limit: int) -> str:
        return str(value or "").strip()[:limit]

    def _persona_transcript(self, messages) -> list[dict]:
        """Map a group chat onto user/assistant turns for one character.

        The character's own earlier replies become `assistant` turns; everything
        else (people and other characters) becomes `user` turns labelled
        "Name: text", merged so the roles alternate as chat APIs expect. The
        newest messages win when the transcript has to be shortened."""
        rows = []
        for message in (messages or [])[-self.PERSONA_MAX_MESSAGES:]:
            if not isinstance(message, dict):
                continue
            content = str(message.get("content", "")).strip()[:16000]
            if not content:
                continue
            is_self = message.get("self") is True
            name = self._clean_text(message.get("name"), 80) or "Someone"
            rows.append((is_self, content if is_self else f"{name}: {content}"))
        kept, used = [], 0
        for row in reversed(rows):
            if kept and used + len(row[1]) > self.PERSONA_MAX_TRANSCRIPT_CHARS:
                break
            kept.append(row)
            used += len(row[1])
        kept.reverse()
        if not any(not is_self for is_self, _ in kept):
            raise ValueError("A user message is required.")
        turns: list[dict] = []
        for is_self, text in kept:
            role = "assistant" if is_self else "user"
            if turns and turns[-1]["role"] == role:
                turns[-1]["content"] += "\n\n" + text
            else:
                turns.append({"role": role, "content": text})
        if turns[0]["role"] == "assistant":
            turns.insert(0, {"role": "user", "content": "(Earlier conversation omitted.)"})
        if turns[-1]["role"] == "assistant":
            turns.append({"role": "user", "content": "(Continue.)"})
        return turns

    def _persona_temperature(self, value) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return self.PERSONA_DEFAULT_TEMPERATURE
        if number != number:  # NaN
            return self.PERSONA_DEFAULT_TEMPERATURE
        return min(self.PERSONA_MAX_TEMPERATURE, max(0.0, number))

    def build_persona_payload(self, messages, context_files, project_name, project_snapshot, persona, cast,
                              active_model) -> tuple[dict, list]:
        """The chat-completions request for one character's reply: the system
        prompt (sheet, cast, workspace), the transcript, and read-only tools.
        Used by the server's own turns and handed to a browser that runs the
        model itself (a local model or the user's own key)."""
        name = self._clean_text(persona.get("name"), 80)
        # The character knows its sheet; the author's notes only as hints, and only
        # when the sheet says `notes: hints` (Characters module).
        parsed = persona_header(persona.get("content"))
        parts = split_author_notes(parsed["body"])
        sheet = self._clean_text(parts["sheet"], self.PERSONA_MAX_SHEET_CHARS)
        hint_notes = self._clean_text(parts["notes"], self.PERSONA_MAX_SHEET_CHARS) if notes_mode(parsed["header"]) == "hints" else ""
        project_snapshot = characters_view(project_snapshot)
        turns = self._persona_transcript(messages)
        others = []
        for member in (cast if isinstance(cast, list) else [])[:self.PERSONA_MAX_CAST]:
            if not isinstance(member, dict):
                continue
            other = self._clean_text(member.get("name"), 80)
            if not other or other == name:
                continue
            summary = self._clean_text(member.get("summary"), 300)
            others.append(f"- {other}" + (f": {summary}" if summary else ""))

        context_text, used_paths = self._serialize_context(context_files or [])
        system_sections = character_instructions(name, sheet, hint_notes)
        if others:
            system_sections.append("Other characters in this conversation:\n" + "\n".join(others))
        system_sections.append(
            (f"Project: {project_name}. " if project_name else "")
            + "The workspace holds the author's material (story, notes, setting). Call list_files "
            "and read_file to consult it when that helps you stay consistent. You cannot change files."
        )
        if project_snapshot:
            tree_text = self._build_project_tree(project_snapshot)
            if tree_text:
                system_sections.append("Workspace file tree:\n" + tree_text)
        if context_text:
            system_sections.append("Files the author attached to this message:\n" + context_text)

        payload: dict = self.providers.options({
            "model": active_model,
            "temperature": self._persona_temperature(persona.get("temperature")),
            "messages": [{"role": "system", "content": "\n\n".join(system_sections)}, *turns],
        })
        if project_snapshot is not None:
            payload["tools"] = [tool for tool in self._get_tool_schemas()
                                if tool["function"]["name"] in self.READ_TOOLS]
            payload["tool_choice"] = "auto"
        return payload, used_paths

    def _persona_inner(self, messages, context_files, project_name, client_project,
                       progress, model, own_key: bool, own_model: str, persona, cast) -> dict:
        if not isinstance(persona, dict):
            raise ValueError("Persona must be an object.")
        name = self._clean_text(persona.get("name"), 80)
        sheet = self._clean_text(persona.get("content"), self.PERSONA_MAX_SHEET_CHARS)
        path = self._clean_text(persona.get("path"), 512)
        if not name:
            raise ValueError("The character needs a name.")
        route = self._ready_route(model, own_key, own_model)
        active_model = route.model

        project_snapshot = None
        if isinstance(client_project, dict) and client_project.get("nodes"):
            project_snapshot = client_project
        elif self.default_workspace is not None:
            with self.default_workspace.lock:
                project_snapshot = copy.deepcopy(self.default_workspace.project)
        # What the character may read: no hidden files, nobody's author's notes.
        project_snapshot = characters_view(project_snapshot)

        payload, used_paths = self.build_persona_payload(messages, context_files, project_name, project_snapshot,
                                                         persona, cast, active_model)

        emit = _best_effort(progress, "the browser stopped receiving the character's progress; the reply finishes without it")

        reply = ""
        for iteration in range(self.max_tool_iterations + 1):
            if getattr(self._req, "cancelled", lambda: False)():
                raise RuntimeError("Chat stopped.")
            if iteration == self.max_tool_iterations and "tools" in payload:
                payload["tool_choice"] = "none"  # last step: answer with what was read
            emit({"type": "status", "stage": "thinking", "iteration": iteration})
            response_payload = self._complete(payload, emit)
            tool_calls = self._extract_tool_calls(response_payload) if "tools" in payload else []
            if not tool_calls or iteration >= self.max_tool_iterations:
                reply = self._extract_message_text(response_payload)
                break
            payload["messages"].append({
                "role": "assistant",
                "content": self._extract_message_text(response_payload) or "",
                "tool_calls": tool_calls,
            })
            for tc in tool_calls:
                emit({"type": "tool", **self._describe_tool_call(tc)})
                result = self._execute_tool_call(tc, project_snapshot, [], read_only=True)
                payload["messages"].append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": json.dumps(result),
                })

        # Models often echo the transcript's "Name:" label on their own line.
        prefix = f"{name}:"
        if reply.startswith(prefix):
            reply = reply[len(prefix):].lstrip()
        if not reply:
            raise RuntimeError(f"{name} did not reply.")
        return {
            "message": reply,
            "model": active_model,
            "provider": route.label,
            "contextPaths": used_paths,
            "proposedOperations": [],
            "batchId": None,
            "speaker": path,
        }
