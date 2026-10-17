"""One open project on the server: its tree in memory, its revision, and its
storage (a folder of real files, a single state file, or nothing for a
guest-hosted session). A commit that failed is finished, or the last
committed copy reloaded, before anything else is served or accepted."""
import copy

from ..model.tree import default_project


class LiveProject:
    def __init__(self, store):
        """store: adapters/folder_store.py's FolderStore, adapters/state_file.py's
        StateFile, or None (in memory only). Each has load() -> (project,
        revision) | None and save(project, revision, previous) -> project."""
        self.store = store
        self.project = default_project()
        self.revision = 0
        self._committed = None   # the tree as last saved (a folder store writes only what changed)
        self.failed = False
        self.load()

    def load(self) -> None:
        loaded = self.store.load() if self.store is not None else None
        self.project, self.revision = loaded if loaded is not None else (default_project(), 0)
        self._committed = copy.deepcopy(self.project)

    def save(self) -> None:
        """Commit the tree. Raises OSError (and remembers the failure) when the store cannot."""
        if self.store is None:
            return
        try:
            self.project = self.store.save(self.project, self.revision, self._committed)
            self._committed = copy.deepcopy(self.project)
        except OSError:
            self.failed = True
            raise

    def recover(self) -> bool:
        """After a failed commit: reload what was last committed. True when it did."""
        if not self.failed:
            return False
        self.load()
        self.failed = False
        return True
