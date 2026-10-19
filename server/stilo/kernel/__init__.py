"""The kernel: starts modules in dependency order and hands each one only the
public APIs it declared it uses. It holds no state of its own and knows no
domain (docs/ARCHITECTURE.md, rule 8); a structure test keeps it that way.
The browser has the same kernel in app/kernel/index.js.

A module is a package under stilo/modules with a module.json manifest
(name, level, uses, owns) and, in its __init__.py:

    MODULE = define_module(__file__, start)

    def start(ctx):          # ctx.use(name), ctx.registry(), ctx.emitter(), ctx.log(), ctx.config
        ...
        return api           # what other modules may call

ctx.config is what the server was started with (read-only; each module reads
its own keys, and a missing one means "not set"). ctx.every(seconds, run)
runs run() again and again, that many seconds apart, once every module has
started; ctx.on_stop(run) runs when the modules stop (the highest level
first). start_modules returns the APIs by name, and stop().
"""
import json
import re
import threading
import types
from collections.abc import Mapping
from pathlib import Path

_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


class Module:
    __slots__ = ("name", "level", "uses", "owns", "start")

    def __init__(self, name, level, uses, owns, start):
        if not isinstance(name, str) or not _NAME.match(name):
            raise ValueError(f"Bad module name: {name!r}")
        if not isinstance(level, int) or level < 1:
            raise ValueError(f"{name}: level must be a whole number from 1")
        if not isinstance(uses, list) or not all(isinstance(u, str) for u in uses):
            raise ValueError(f"{name}: uses must be a list of names")
        if not isinstance(owns, dict):
            raise ValueError(f"{name}: owns must be an object")
        if not callable(start):
            raise ValueError(f"{name}: start must be callable")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "level", level)
        object.__setattr__(self, "uses", tuple(uses))
        object.__setattr__(self, "owns", owns)
        object.__setattr__(self, "start", start)

    def __setattr__(self, key, value):
        raise AttributeError("module definitions are read-only")


def define_module(init_path, start) -> Module:
    """The module whose package holds init_path, described by the module.json
    beside it (the one manifest; tests read the same one)."""
    manifest = json.loads((Path(init_path).resolve().parent / "module.json").read_text(encoding="utf-8"))
    for key in ("name", "level", "uses", "owns"):
        if key not in manifest:
            raise ValueError(f"{init_path}: module.json needs {key!r}")
    return Module(manifest["name"], manifest["level"], manifest["uses"], manifest["owns"], start)


class _Context:
    def __init__(self, module, apis, log, config, timers, stops):
        self._module = module
        self._apis = apis
        self._log = log
        self._timers, self._stops = timers, stops
        self.name = module.name
        self.config = config

    def every(self, seconds, run):
        self._timers.append((self._module.name, float(seconds), run))

    def on_stop(self, run):
        self._stops.append((self._module.name, run))

    def use(self, name):
        if name not in self._module.uses:
            raise LookupError(f"{self._module.name} did not declare that it uses {name}")
        return self._apis[name]

    def registry(self, key="id", validate=None):
        return Registry(key=key, validate=validate, owner=self._module.name)

    def emitter(self):
        return Emitter(owner=self._module.name, log=self._log)

    def log(self, *parts):
        self._log(self._module.name, *parts)


def start_modules(modules, log=lambda *parts: None, config=None):
    """Starts every module, lowest level first, and returns a read-only map of
    name -> api. A module that raises while starting stops the whole start.
    config: what the server was started with, read-only to every module."""
    config = types.MappingProxyType(dict(config or {}))
    by_name = {}
    for module in modules:
        if module.name in by_name:
            raise ValueError(f"Two modules are called {module.name}")
        by_name[module.name] = module
    for module in modules:
        for used in module.uses:
            target = by_name.get(used)
            if target is None:
                raise LookupError(f"{module.name} uses {used}, which is not being started")
            if target.level >= module.level:
                raise ValueError(f"{module.name} (level {module.level}) may not use {used} (level {target.level})")
    apis, timers, stops = {}, [], []
    for module in sorted(modules, key=lambda m: (m.level, m.name)):
        apis[module.name] = module.start(_Context(module, apis, log, config, timers, stops))
        log("kernel", f"started {module.name}")
    return Started(apis, timers, stops, log)


class Started(Mapping):
    """The started modules' APIs by name (read-only), their timers running, and
    stop(): the timers end and each module's on_stop runs, the highest level
    first (a module stops before the ones it uses). A failing one is logged
    and the others still run."""

    def __init__(self, apis, timers, stops, log):
        self._apis = dict(apis)
        self._stops = stops
        self._log = log
        self._stopped = threading.Event()
        for owner, seconds, run in timers:
            threading.Thread(target=self._repeat, args=(owner, seconds, run), daemon=True, name=f"{owner}-every-{seconds:g}s").start()

    def _repeat(self, owner, seconds, run):
        while not self._stopped.wait(seconds):
            try:
                run()
            except Exception as error:  # noqa: BLE001 - one failed round never stops the timer
                self._log(owner, f"a timer failed: {error}")

    def __getitem__(self, name):
        return self._apis[name]

    def __iter__(self):
        return iter(self._apis)

    def __len__(self):
        return len(self._apis)

    def stop(self):
        if self._stopped.is_set():
            return
        self._stopped.set()
        for owner, run in reversed(self._stops):
            try:
                run()
            except Exception as error:  # noqa: BLE001 - every module gets to stop
                self._log(owner, f"stopping failed: {error}")


class Registry:
    """A list of entries one module offers others to add to (an extension
    point). Each entry is a dict with a unique key; add() returns a function
    that removes it again. Safe to use from several threads."""

    def __init__(self, key="id", validate=None, owner=""):
        self._key = key
        self._validate = validate or (lambda entry: None)
        self._owner = owner
        self._entries = {}
        self._listeners = []
        self._lock = threading.Lock()

    def add(self, entry):
        ident = entry.get(self._key) if isinstance(entry, dict) else None
        if not isinstance(ident, str) or not ident:
            raise ValueError(f"{self._owner}: an entry needs a {self._key!r}")
        self._validate(entry)
        with self._lock:
            if ident in self._entries:
                raise ValueError(f"{self._owner}: {ident!r} is already registered")
            self._entries[ident] = types.MappingProxyType(dict(entry))
        self._changed()

        def remove():
            with self._lock:
                gone = self._entries.pop(ident, None) is not None
            if gone:
                self._changed()
        return remove

    def get(self, ident):
        return self._entries.get(ident)

    def has(self, ident):
        return ident in self._entries

    def all(self):
        with self._lock:
            return list(self._entries.values())

    def on_change(self, listener):
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def _changed(self):
        for listener in list(self._listeners):
            listener()


class Emitter:
    """Named events a module emits for the modules above it. A listener that
    raises is logged and does not stop the others."""

    def __init__(self, owner="", log=lambda *parts: None):
        self._owner = owner
        self._log = log
        self._listeners = {}

    def on(self, event, listener):
        self._listeners.setdefault(event, []).append(listener)
        return lambda: self._listeners.get(event, []).remove(listener) if listener in self._listeners.get(event, []) else None

    def emit(self, event, payload=None):
        for listener in list(self._listeners.get(event, [])):
            try:
                listener(payload)
            except Exception as error:  # noqa: BLE001 - one listener never stops the rest
                self._log(self._owner, f"a listener for {event} failed: {error}")
