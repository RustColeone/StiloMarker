"""Test access to the app's modules for the browser regressions.

app/main.js only starts the modules (`const modules = await startModules(...)`).
Browser tests that serve the app from this checkout append a line to main.js
that exposes what they need on `window`; `app_hook(js)` wraps that line in a
block where the names tests have always used are defined from `modules`.
"""

_PRELUDE = (
    "const { shell, workspace, identity } = modules;"
    " const settings = shell.settings, controller = workspace.project(), collaboration = modules.sync.session();"
    " const syncMode = modules.sync.mode, syncState = modules.sync.status;"
    " const editorParts = modules.editor.parts(), explorerParts = modules.explorer.parts(), cloudParts = modules.cloud.parts();"
    " const setActiveSourceFile = (...a) => editorParts.setActiveSourceFile(...a),"
    " setEditorSelection = (...a) => editorParts.setEditorSelection(...a),"
    " getViewState = (...a) => editorParts.getViewState(...a),"
    " renderEditorContent = (...a) => editorParts.renderEditorContent(...a),"
    " getEditorText = (...a) => editorParts.getEditorText(...a),"
    " openFileFromExplorer = (...a) => editorParts.openFileFromExplorer(...a),"
    " renameFileById = (...a) => explorerParts.renameFileById(...a),"
    " handleAccountLogout = (...a) => cloudParts.handleAccountLogout(...a),"
    " openSettingsDialog = (page = \"appearance\") => shell.settingsDialog.open(page);"
)


def app_hook(js: str) -> bytes:
    """`js` (one or more statements) with the app's usual names in scope, as bytes to append to main.js."""
    return ("\n{ " + _PRELUDE + "\n" + js + "\n}\n").encode()
