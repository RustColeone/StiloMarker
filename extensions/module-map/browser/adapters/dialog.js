// The module map dialog's markup, added to the page the first time the
// dialog opens (adapters/tools.js); its styles are ../module-map.css.
export const DIALOG_HTML = `
<dialog id="mtree-tools-dialog">
  <form method="dialog" class="settings-form mtree-tools-form">
    <header class="dialog-header">
      <div>
        <div class="eyebrow">MTREE Tools</div>
        <h2>Module Map</h2>
      </div>
      <p id="mtree-source-text" class="subtle-label">Choose an MTREE file from the explorer to generate a module map.</p>
      <button class="dialog-close-corner" type="submit" value="cancel" formnovalidate aria-label="Close">&#215;</button>
    </header>

    <div class="settings-grid mtree-tools-grid">
      <section class="settings-section">
        <h3>Options</h3>

        <label class="checkbox-row">
          <input id="mtree-simplify-input" type="checkbox" checked>
          <span>Simplify repeated subtrees</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-continuation-input" type="checkbox" checked>
          <span>Split continuation trees</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-include-navigation-input" type="checkbox" checked>
          <span>Include Navigation</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-include-modules-input" type="checkbox" checked>
          <span>Include Modules</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-include-parents-input" type="checkbox" checked>
          <span>Include Parents</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-include-children-input" type="checkbox" checked>
          <span>Include Children</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-include-descriptions-input" type="checkbox" checked>
          <span>Include Description</span>
        </label>

        <label class="checkbox-row">
          <input id="mtree-include-empty-input" type="checkbox">
          <span>Show Empty Sections</span>
        </label>

        <label>
          Target Markdown File
          <select id="mtree-target-file-select">
            <option value="__new__">Create new markdown file</option>
          </select>
        </label>

        <label>
          New Markdown File Name
          <input id="mtree-output-name-input" type="text" placeholder="module-map.md">
        </label>

        <div class="settings-status-panel">
          <p id="mtree-quality-text" class="subtle-label">No module map generated yet.</p>
        </div>

        <div id="mtree-warning-list" class="presence-list mtree-warning-list"></div>
      </section>

      <section class="settings-section">
        <div class="mtree-pane-header">
          <h3>Generated Markdown</h3>
          <div class="settings-actions-row mtree-editor-actions">
            <button id="mtree-keep-button" type="button">Keep</button>
            <button id="mtree-undo-button" type="button">Undo</button>
          </div>
        </div>

        <div class="mtree-editor-grid">
          <div class="mtree-editor-pane">
            <div class="mtree-editor-surface">
              <pre id="mtree-output-highlight" class="mtree-output-highlight" aria-hidden="true"></pre>
              <textarea id="mtree-output-text" class="mtree-output-text" spellcheck="false" placeholder="Generate a module map to preview the Markdown output."></textarea>
            </div>
          </div>
          <article id="mtree-render-preview" class="preview-output mtree-render-preview"></article>
        </div>
      </section>
    </div>

    <menu class="dialog-actions">
      <button id="mtree-create-button" type="button">Write to Target</button>
    </menu>
  </form>
</dialog>
`;
