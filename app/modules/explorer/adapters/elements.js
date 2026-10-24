// The Explorer's elements on the page (the tree and its menu, the Add File and New File dialogs),
// looked up once when it starts. A missing one stops the start: the page and
// the code disagree.
function query(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing DOM node: ${selector}`);
  return node;
}

export function findElements() {
  return {
    addFileDialog: query("#add-file-dialog"),
    addFileDropzone: query("#add-file-dropzone"),
    addFileNameInput: query("#add-file-name-input"),
    addFilePickerButton: query("#add-file-picker-button"),
    addFilePickerInput: query("#add-file-picker-input"),
    addFileSourceText: query("#add-file-source-text"),
    addFileStatusText: query("#add-file-status-text"),
    addFileSubmitButton: query("#add-file-submit-button"),
    addFileTargetText: query("#add-file-target-text"),
    addFileUrlInput: query("#add-file-url-input"),
    explorerAddButton: query("#explorer-add-button"),
    explorerContextMenu: query("#explorer-context-menu"),
    explorerFilterButton: query("#explorer-filter-button"),
    explorerNameFilter: query("#explorer-name-filter"),
    explorerPanel: query("#explorer-panel"),
    explorerTree: query("#explorer-tree"),
    newFileCancelButton: query("#new-file-cancel-button"),
    newFileDialog: query("#new-file-dialog"),
    newFileFolder: query("#new-file-folder"),
    newFileName: query("#new-file-name"),
    newFileStatus: query("#new-file-status"),
    newFileType: query("#new-file-type"),
    replaceFileInput: query("#replace-file-input")
  };
}
