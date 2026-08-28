// Typed application composition controller for cross-feature DOM and workspace state.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { PREFERENCE_KEYS, preferenceIsEnabled } from "./preferences";
import {
  buildTaskFilename,
  nextDuplicateFilename,
  normalizeTaskPriority,
  parseTaskFilename,
  regularNoteFilename,
  taskDisplayTitle,
} from "../features/tasks/filenames";
import { parseThemeCatalog as parseThemeConfig, parseExternalThemeCatalog, type ThemeCatalog, type ThemeDefinition } from "../features/themes/catalog";
import {
  applyThemeVariables,
  FALLBACK_THEME_CATALOG,
  FALLBACK_THEME_VARIABLES,
  installThemeOptions,
  themeRuntimeState,
} from "../features/themes/runtime";
import { calendarMonth, localIsoDate } from "../features/tasks/date-picker";
import { DAILYLOGS_ROOT, TASKS_ROOT, isJournalPath, isWorkspaceTaskPath, isWorkspaceWorkingTaskPath, journalLocationForDate, journalTitleFromPath, latestJournalPathBefore } from "../features/tasks/paths";
import { preserveExtraBlankLines } from "../services/markdown-spacing";
import { CommandRegistry } from "../features/commands/registry";
import { paletteMode, rankCommands } from "../features/commands/ranking";
import { createLazyMarkdownEditor } from "../features/editor/lazy-markdown-editor";
import { PreviewScheduler } from "../features/editor/preview-scheduler";
import { contentZoomScale, nextContentZoom, normalizeContentZoom, scaledMediaWidth } from "../features/editor/content-zoom";
import { assetMarkdownLink, isScreenshotItem, joinDroppedAssetLinks } from "../features/editor/assets";
import { nativeDraftPath as resolveNativeDraftPath, rewriteAssetLinks, runBestEffort, toggleMarkdownCheckbox } from "../features/editor/lifecycle";
import {
  activeTab as findActiveTab,
  findTabByPath as findTabForPath,
  relativeTab,
  rememberClosedTab,
  remapTabPaths as remapOpenTabPaths,
  reorderTabs as reorderOpenTabs,
  syncTabFromDocument,
  type EditorTab,
} from "../features/editor/tabs";
import { renderAppView } from "../features/editor/view-controller";
import {
  parseDateLocal,
  removeLegacyTaskHeader,
  taskMetaFor,
} from "../features/tasks/metadata";
import {
  setChoiceSelection as syncChoiceSelection,
  syncDateInputBorders as syncTaskDateInputBorders,
  taskKindIndicatorMarkup as renderTaskKindIndicator,
  taskMetaSummaryHtml,
} from "../features/tasks/date-bar";
import {
  createArchiveToggle,
  createNavButton,
  createNavCombo,
  createNavSeparator,
  setActiveNavigation,
  syncNavModeButtons,
} from "../features/navigation/dom";
import { createCurrentViewStore, listReloadMode, parseLastFolderView, serializeLastFolderView } from "../features/navigation/view-state";
import {
  discoverWorkspaces,
  readWorkspaceNavigationPreferences,
  selectInitialWorkspace,
  type WorkspaceDirectory,
} from "../features/workspaces/catalog";
import {
  BROWSER_VIEWABLE_EXTS,
  appendSectionDivider as appendSectionDividerTo,
  appendTaskSection as appendTaskSectionTo,
  fileExt,
  formatMtime,
  renderEmptyFileList,
  renderInboxFileGroups,
  renderNoteCards,
  renderTaskCountBar as renderTaskCountBarInto,
  sortFiles as sortListedFiles,
} from "../features/notes/file-list";
import {
  createMarkdownFilesystem,
  dirExists,
  ensureWorkspaceStructure,
  fileExistsInDir,
  getDirHandle,
  listAllFiles,
  listDirs,
  listMdFiles,
  uniqueFilenameInDir,
  type NamedDirectory,
} from "../services/filesystem";
import {
  assetLocation,
  clipFilename,
  collectReferencedAssets,
  formatAssetSize,
  isImageFilename,
  orphanAssetNames,
  referencedAssets,
} from "../features/assets/catalog";
import {
  buildCalendarTaskMap,
  filteredCalendarTasks,
  renderCalendar as renderCalendarInto,
  renderCalendarTaskPanel as renderCalendarTaskPanelInto,
} from "../features/calendar/calendar";
import { listOutputFiles, outputDocumentPath, renderOutputFiles } from "../features/outputs/files";
import {
  indexMarkdownDirectory,
  mapNativeIndex,
  mapNativeSearchResults,
  removeSearchEntry,
  renderSearchResults as renderSearchResultsInto,
  searchLocalIndex,
  upsertSearchEntry,
  type NativeSearchResult,
  type SearchIndexEntry,
} from "../features/search/search";
import { healthReportMarkdown, loadDocumentWithFallback } from "../ui/components/documents";
import { createModalController } from "../ui/components/modal";
import { DependencyStatusController } from "../ui/components/dependency-status";
import { createToastController } from "../ui/components/toast";
import { bindNativeProgressEvents } from "../services/native-progress";
import { portableNameError } from "../services/portable-names";
import { newMarkdownFileTitle, newMarkdownStoredFilename } from "../features/notes/new-file";
import { NewFileModalController } from "../ui/components/new-file-modal";
import { QuickTabSwitcherController, tabJumpCodes } from "../ui/components/quick-tab-switcher";
import { ListingModalController, type ListingSection, type ListingSort } from "../ui/components/listing-modal";
import { KEY_BINDINGS, bindingsByCategory, comboFor } from "../features/commands/keymap";
import {
  allFilesAreMarkdown,
  buildImportedFilePath,
  mergeSelectedFiles,
  openImportActionEnabled,
  partitionMarkdownFilenames,
  removeSelectedFile,
  resolveImportDestination,
  type OpenImportMode,
  type SelectableFile,
} from "../features/editor/import-files";

type ViewName = "welcome" | "list" | "editor" | "search" | "calendar" | "outputs";
type BacklinkEntry = { sourcePath: string; sourceTitle: string; anchor?: string | null; kind: string };
type NavigationOptions = {
  restoreView?: boolean;
  preferredL1?: string;
  preferredL2?: string | null;
  preferRoot?: boolean;
};
type OpenWorkspaceOptions = NavigationOptions & {
  freshRoot?: boolean;
  preferredWorkspaceName?: string | null;
};
type OpenFileOptions = { restoringLastView?: boolean; pinned?: boolean };
type TaskLocation = {
  rootParts: string[];
  inWorking: boolean;
  reload: () => Promise<void>;
};

(() => {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const MAX_RECENT_WORKSPACES = 6;
  const DEFAULT_WORKSPACE_ROOT_PATH = '/home/scdev/notes';
  const WORKSPACE_ROOT_PATH_KEY = PREFERENCE_KEYS.workspaceRootPath;
  const OUTPUTS_FOLDER_PATH_KEY = PREFERENCE_KEYS.outputsFolderPath;
  const SYSTEM_FOLDER_NAMES = new Set([TASKS_ROOT, DAILYLOGS_ROOT]);
  let   DB_WS_PREFIX = 'Data/';            // updated each time the workspace switches

  // ── SVG icon strings ─────────────────────────────────────────────────────────
  const SVG_ARCHIVE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`;
  const SVG_FOLDER  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_RESTORE     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3"/></svg>`;
  const SVG_NEW_FOLDER  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`;
  const SVG_EDIT        = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const SVG_MOVE        = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/><path d="M5 5v14"/></svg>`;
  const SVG_TASK_STATUS = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h7"/><path d="M4 12h12"/><path d="M4 18h9"/><circle cx="18" cy="6" r="2"/><circle cx="20" cy="18" r="2"/></svg>`;
  const SVG_TASK_FOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h6l2 3h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7 13h10"/><path d="M7 17h6"/></svg>`;

  // ── State ────────────────────────────────────────────────────────────────────
  let rootHandle: FileSystemDirectoryHandle | null = null;
  let dataHandle: FileSystemDirectoryHandle | null = null;
  let notesHandle: FileSystemDirectoryHandle | null = null;
  let workspaces: WorkspaceDirectory[] = [];
  let currentWorkspace: WorkspaceDirectory | null = null;
  let activeWorkspace: string | null = null;
  let l1Active: NamedDirectory | null = null;
  let l2Active: NamedDirectory | null = null;
  let currentPath: string | null = null;
  const nativeFileVersions = new Map<string, string>();
  const currentView = createCurrentViewStore();
  currentView.subscribe(state => {
    document.dispatchEvent(new CustomEvent('recallstack:viewchange', { detail: state }));
  });
  const markdownFilesystem = createMarkdownFilesystem({
    notesHandle: () => notesHandle!,
    dbPrefix: () => DB_WS_PREFIX,
    nativeVersions: nativeFileVersions,
  });
  const readMdFile = markdownFilesystem.read;
  const writeMdFile = markdownFilesystem.write;
  const removeMdFile = markdownFilesystem.remove;
  const uniquePathInFolder = markdownFilesystem.uniquePath;
  let savedContent: string | null = null;
  let isNew         = false;  // true when creating a brand-new file
  let archiveMode   = false;  // true when browsing the archived/ subfolder
  let sortMode: "mtime" | "alpha" = 'mtime';
  let newFolderRow     = 0;      // 1 or 2 — which nav row triggered the new-folder modal
  let allTasksMode        = false;  // true when All Tasks aggregate view is active
  let returnToAllTasks    = false;  // true when a file was opened from All Tasks view
  const ALL_TASKS_ENABLED_KEY = PREFERENCE_KEYS.allTasksEnabled;
  let allTasksEnabled = localStorage.getItem(ALL_TASKS_ENABLED_KEY) !== 'off'; // global, persists across sessions
  let allTasksStatusMode  = true;   // true: group All Tasks by priority/status; false: by folder
  let listLoadGeneration  = 0;      // prevents stale async list responses from repainting the UI
  let outputsMode         = false;  // true when in Outputs view
  // The configured Outputs folder — any directory on disk, not necessarily
  // inside the open workspace. Native mode: an absolute-path-backed handle
  // re-derived each time from OUTPUTS_FOLDER_PATH_KEY (see
  // ensureConfiguredOutputsHandle()). Browser mode: a FileSystemDirectoryHandle
  // from showDirectoryPicker(), held in memory only for the current session —
  // see chooseOutputsFolder() below for why this isn't persisted across reloads.
  let outputsHandle: FileSystemDirectoryHandle | null = null;
  let outputsAvailable    = false;  // true if the configured outputs folder is currently reachable
  let outputsActiveFolder: NamedDirectory | null = null;
  let returnToOutputs     = false;  // true when a file was opened from Outputs view
  let isOutputsFile       = false;  // true when currently editing a file from Outputs
  let currentOutputsFh: FileSystemFileHandle | null = null;
  let currentOutputsDirFh: FileSystemDirectoryHandle | null = null;
  // ── Open / Import Files (external, non-workspace-owned tabs) ─────────────────
  let isExternalFile      = false;  // true when currently editing a "Temporary" external file in place
  let currentExternalPath: string | null = null;             // absolute OS path (Tauri desktop mode)
  let currentExternalFileHandle: FileSystemFileHandle | null = null; // real handle (browser mode)
  let navRow1Mode: "buttons" | "combo" = 'buttons';
  let navRow2Mode: "buttons" | "combo" = 'buttons';
  let renameFolderRow     = 0;         // 1 or 2 — which nav row triggered the rename modal
  let preSearchView: ViewName | null = null;
  let saveInProgress      = false;
  let savePromise: Promise<boolean> | null = null;
  let saveShouldNotify    = false;
  let searchIndex: SearchIndexEntry[] = [];
  let lastSearchBuffer: { query: string; results: any[] } | null = null;
  let searchSelectedIndex = 0;
  let searchTypedCode = "";
  let currentBacklinks: BacklinkEntry[] = [];

  // ── Tabs (Improvement 11, Phase 1) ─────────────────────────────────────────────
  // A tab is a lightweight record; the single shared editor/preview is swapped to
  // match whichever tab is active.
  // { id, path, title, isNew, dirty, isOutputsFile, outputsFileHandle, outputsDirHandle,
  //   returnToOutputs, returnToAllTasks }
  let tabs: EditorTab[] = [];
  let activeTabId: number | null = null;
  let nextTabId           = 1;
  let closedTabHistory: Array<{ path: string; title: string }> = [];
  let draggedTabId: number | null = null;
  let protectedDailyJournalPath: string | null = null;

  const assetBlobUrls = new Map<string, string>();
  let remoteMediaSessionAllowed = false;
  let workspaceSessionGeneration = 0;

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  function $id(id: `btn-${string}` | `${string}-btn`): HTMLButtonElement;
  function $id(id: "search-input" | "title-input" | "task-input-start" | "task-input-completed" | "task-input-due" | "modal-new-file-name" | "modal-folder-name" | "modal-rename-input" | "modal-move-as-non-task" | "command-palette-input" | "settings-outputs-path"): HTMLInputElement;
  function $id(id: "content-zoom-select" | "theme-select" | "modal-move-l1" | "modal-move-l2"): HTMLSelectElement;
  function $id(id: "cal-filter-started" | "cal-filter-completed" | "cal-filter-due"): HTMLInputElement;
  function $id<T extends HTMLElement = HTMLButtonElement>(id: string): T;
  function $id(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required application element #${id} is missing`);
    return element;
  }
  function $maybe(id: `btn-${string}`): HTMLButtonElement | null;
  function $maybe(id: "nav1-combo" | "nav2-combo"): HTMLSelectElement | null;
  function $maybe<T extends HTMLElement = HTMLElement>(id: string): T | null;
  function $maybe(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  // Keyboard-shortcut hint helpers — keep button tooltips in sync with keymap.ts.
  function withShortcutHint(label: string, bindingId: string): string {
    const combo = comboFor(bindingId);
    return combo ? `${label} (${combo})` : label;
  }
  function applyShortcutHint(el: HTMLElement | null, bindingId: string, fallbackLabel?: string): void {
    if (!el) return;
    const combo = comboFor(bindingId);
    if (!combo) return;
    const base = (fallbackLabel ?? el.getAttribute('title') ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    el.setAttribute('title', base ? `${base} (${combo})` : combo);
    el.setAttribute('aria-keyshortcuts', combo);
  }

  const welcomeEl    = $id('welcome');
  const appEl        = $id('app');
  const appHeader    = $id<HTMLElement>('app-header');
  const navRow1      = $id('nav-row-1');
  const navRow2      = $id('nav-row-2');
  const fileListView  = $id('file-list-view');
  const searchView    = $id('search-view');
  const searchGrid    = $id('search-grid');
  searchGrid.tabIndex = 0;
  searchGrid.setAttribute('role', 'listbox');
  const searchHeading = $id('search-heading');
  const searchInput   = $id('search-input');
  const btnSearch     = $id('btn-search');
  const btnSearchClear = $id('btn-search-clear');
  const btnRefreshWorkspace = $id('btn-refresh-workspace');
  const btnOutputsTop = $id('btn-outputs-top');
  const btnOpenImport = $id('btn-open-import');
  const btnSafetyTools = $id('btn-safety-tools');
  const editorView    = $id('editor-view');
  const listHeading  = $id('list-heading');
  const fileGrid     = $id('file-grid');
  const taskCountBar = $id('task-count-bar');
  const btnNew       = $id('btn-new');
  const btnSortMtime        = $id('btn-sort-mtime');
  const btnSortAlpha        = $id('btn-sort-alpha');
  const btnAllTasksMode     = $id('btn-all-tasks-mode');
  const titleInput   = $id('title-input');
  const btnSave      = $id('btn-save');
  const btnStampDate = $id('btn-stamp-date');
  const btnDelete    = $id('btn-delete');
  const btnArchive         = $id('btn-archive');
  const btnMove            = $id('btn-move');
  const btnConvertToTask   = $id('btn-convert-to-task');
  const btnConvertToNote   = $id('btn-convert-to-note');
  const btnMakeCopy        = $id('btn-make-copy');
  const btnCopyMd          = $id('btn-copy-md');
  const btnCopyHtml        = $id('btn-copy-html');
  const btnCopyPath        = $id('btn-copy-path');
  const btnCopyInternalLink = $id('btn-copy-internal-link');
  const btnCancel         = $id('btn-cancel');
  const btnNewFromEditor  = $id('btn-new-from-editor');
  const btnViewJournal    = $id('btn-view-journal');
  const tabStripEl        = $id('tab-strip');
  const mdEditor     = createLazyMarkdownEditor($id('md-editor'), {
    lineNumbers: preferenceIsEnabled(localStorage.getItem(PREFERENCE_KEYS.lineNumbers), true),
    wordWrap: localStorage.getItem(PREFERENCE_KEYS.wordWrap) === 'on',
    getCompletions(prefix, query) {
      if (prefix === '[[') {
        return searchIndex
          .filter(note => !query || note.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 50)
          .map(note => ({ label: note.notesRelPath.replace(/\.md$/i, ''), type: 'text' }));
      }
      const tags = new Set<string>();
      searchIndex.forEach(note => (note.tags || []).forEach(tag => tags.add(tag)));
      return [...tags].filter(tag => !query || tag.toLowerCase().includes(query.toLowerCase())).slice(0, 50).map(label => ({ label, type: 'keyword' }));
    },
  });
  const previewOut   = $id('preview-output');
  const toastEl      = $id('toast');
  const depStatusList = $id('dep-status-list');
  const depStatusErrorLine = $id('dep-status-error-line');
  const contentZoomSelect = $id('content-zoom-select');
  const splitPane    = $id('split-pane');
  const editorPane   = $id('editor-pane');
  const resizerEl    = $id('resizer');
  const previewPane     = $id('preview-pane');
  const taskDateBar        = $id('task-date-bar');
  const taskInputStart     = $id('task-input-start');
  const taskInputCompleted = $id('task-input-completed');
  const taskSetStartToday  = $id('task-set-start-today');
  const taskSetCompletedToday = $id('task-set-completed-today');
  const taskClearStart = $id('task-clear-start');
  const taskClearCompleted = $id('task-clear-completed');
  const taskClearDue = $id('task-clear-due');
  const taskInputDue       = $id('task-input-due');
  const taskInputPriority  = $id('task-input-priority');
  const taskInputStatus    = $id('task-input-status');
  const taskMetaSummary = $id('task-meta-summary');
  const taskKindIndicator = $id('task-kind-indicator');
  const taskEditorLayout = $id('task-editor-layout');
  const taskEditorTop = $id('task-editor-top');
  const btnPinCurrentFile = $id('btn-pin-current-file');
  const newFileModalEl = $id('modal-new-file');
  const newFileModal = new NewFileModalController({
    overlay: newFileModalEl,
    title: $id('modal-new-file-title'),
    input: $id('modal-new-file-name'),
    error: $id('modal-new-file-error'),
    cancelButton: $id('modal-new-file-cancel'),
    createButton: $id('modal-new-file-create'),
  });
  const newFolderModal  = $id('modal-new-folder');
  const newFolderTitle  = $id('modal-new-folder-title');
  const newFolderInput  = $id('modal-folder-name');
  const modalCancelBtn  = $id('modal-cancel-btn');
  const modalCreateBtn  = $id('modal-create-btn');
  const btnNav1Mode          = $id('btn-nav1-mode');
  const btnNav2Mode          = $id('btn-nav2-mode');
  const renameFolderModal    = $id('modal-rename-folder');
  const renameFolderTitle    = $id('modal-rename-title');
  const renameFolderInput    = $id('modal-rename-input');
  const renameFolderCancelBtn = $id('modal-rename-cancel-btn');
  const renameFolderApplyBtn  = $id('modal-rename-apply-btn');
  const moveFileModal      = $id('modal-move-file');
  const moveFileTitle      = $id('modal-move-title');
  const moveL1Select       = $id('modal-move-l1');
  const moveL2Wrap         = $id('modal-move-l2-wrap');
  const moveL2Select       = $id('modal-move-l2');
  const moveAsNonTaskWrap  = $id('modal-move-as-non-task-wrap');
  const moveAsNonTaskInput = $id('modal-move-as-non-task');
  const moveFileCancelBtn  = $id('modal-move-cancel-btn');
  const moveFileApplyBtn   = $id('modal-move-apply-btn');
  const openImportModal        = $id('modal-open-import');
  const openImportDropzone     = $id<HTMLDivElement>('open-import-dropzone');
  const openImportBrowseBtn    = $id('open-import-browse-btn');
  const openImportFileListEl   = $id<HTMLDivElement>('open-import-file-list');
  const openImportModeTemp     = $id<HTMLInputElement>('open-import-mode-temp');
  const openImportModeImport   = $id<HTMLInputElement>('open-import-mode-import');
  const openImportDestination  = $id<HTMLDivElement>('open-import-destination');
  const openImportL1Select     = $id<HTMLSelectElement>('open-import-l1');
  const openImportL2Select     = $id<HTMLSelectElement>('open-import-l2');
  const openImportCancelBtn    = $id('open-import-cancel-btn');
  const openImportApplyBtn     = $id('open-import-apply-btn');
  interface OpenImportSelection extends SelectableFile {
    // Absolute OS path (Tauri desktop mode) — key is this same value when set.
    nativePath: string | null;
    // Real handle obtained from window.showOpenFilePicker()/getAsFileSystemHandle()
    // (browser mode) — key is a synthetic value derived from it when set.
    browserHandle: FileSystemFileHandle | null;
  }
  let openImportSelectedFiles: OpenImportSelection[] = [];
  const inboxDeleteModal      = $id('modal-inbox-delete');
  const inboxDeleteMsg        = $id('modal-inbox-delete-msg');
  const inboxDeleteCancelBtn  = $id('modal-inbox-delete-cancel');
  const inboxDeleteConfirmBtn = $id('modal-inbox-delete-confirm');
  let _pendingInboxDelete: { f: any; dirHandle: FileSystemDirectoryHandle; onDeleted: () => void } | null = null;
  btnMove.innerHTML = SVG_MOVE;

  function depSource(key: any): "local" | "native" | "unknown" {
    const src = window.__depSources && window.__depSources[key];
    return src === "local" || src === "native" ? src : "unknown";
  }
  const dependencyStatus = new DependencyStatusController(depStatusList, depStatusErrorLine, window.__depSources || {});
  const setDependencyStatus = (key: Parameters<DependencyStatusController["set"]>[0], patch: Parameters<DependencyStatusController["set"]>[1] = {}) => dependencyStatus.set(key, patch);
  function refreshDependencyStatuses() {
    setDependencyStatus('marked', {
      state: typeof marked !== 'undefined' ? 'loaded' : 'missing',
      source: depSource('marked'),
      detail: typeof marked !== 'undefined' ? 'Markdown renderer ready' : 'Markdown renderer unavailable',
      errorText: typeof marked !== 'undefined' ? '' : 'Markdown renderer unavailable'
    });
    setDependencyStatus('hljs', {
      state: typeof hljs !== 'undefined' ? 'loaded' : 'missing',
      source: depSource('hljs'),
      detail: typeof hljs !== 'undefined' ? 'Syntax highlighting core ready' : 'Syntax highlighter unavailable',
      errorText: typeof hljs !== 'undefined' ? '' : 'Syntax highlighter unavailable'
    });
    const mermaidIsLazy = window.__recallstackNative?.active && typeof mermaid === 'undefined';
    setDependencyStatus('mermaid', {
      state: typeof mermaid !== 'undefined' ? 'loaded' : mermaidIsLazy ? 'lazy' : 'missing',
      source: depSource('mermaid'),
      detail: typeof mermaid !== 'undefined' ? 'Diagram renderer ready' : mermaidIsLazy ? 'Loads when a diagram is shown' : 'Diagram renderer unavailable',
      errorText: typeof mermaid !== 'undefined' || mermaidIsLazy ? '' : 'Diagram renderer unavailable'
    });
    setDependencyStatus('sql', { state: 'loaded', source: 'native', detail: 'Native SQLite ready', errorText: '' });
    if (!_hljsFullLoaded && !_hljsFullPromise) {
      setDependencyStatus('hljsFull', { state: 'lazy', source: 'local', detail: 'Extra syntax bundle loads only when needed', errorText: '' });
    }
  }

  let mermaidLoadPromise: Promise<void> | null = null;
  let mermaidInitialized = false;
  async function ensureMermaidReady() {
    if (typeof mermaid === 'undefined' && !mermaidLoadPromise) {
      setDependencyStatus('mermaid', { state: 'loading', detail: 'Loading diagram renderer', errorText: '' });
      mermaidLoadPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'lib/mermaid.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load the bundled Mermaid renderer'));
        document.head.appendChild(script);
      }).catch(error => {
        mermaidLoadPromise = null;
        setDependencyStatus('mermaid', { state: 'missing', detail: 'Diagram renderer unavailable', errorText: error.message });
        throw error;
      });
    }
    if (mermaidLoadPromise) await mermaidLoadPromise;
    if (typeof mermaid === 'undefined') throw new Error('Mermaid renderer unavailable');
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      mermaidInitialized = true;
    }
    setDependencyStatus('mermaid', { state: 'loaded', source: depSource('mermaid'), detail: 'Diagram renderer ready', errorText: '' });
    return mermaid;
  }
  function initDependencyStatusBar() {
    dependencyStatus.render();
    refreshDependencyStatuses();
  }

  // ── Scaled-image button: recheck all images in preview when pane resizes ──────
  function updateScaledImages() {
    const previewStyle = getComputedStyle(previewOut);
    const availableWidth = Math.max(
      0,
      previewOut.clientWidth
        - (Number.parseFloat(previewStyle.paddingLeft) || 0)
        - (Number.parseFloat(previewStyle.paddingRight) || 0),
    );
    const scale = contentZoomScale(contentZoomPercent);
    previewOut.querySelectorAll<HTMLImageElement>('.img-wrap img').forEach(img => {
      const targetWidth = scaledMediaWidth(img.naturalWidth, availableWidth, scale);
      if (targetWidth > 0) {
        img.style.width = `${targetWidth}px`;
        img.style.height = 'auto';
      }
      const btn = img.parentElement?.querySelector('.img-open-btn');
      if (btn) btn.classList.toggle('scaled', img.naturalWidth > 0 && img.naturalWidth > img.offsetWidth);
    });
    previewOut.querySelectorAll<SVGSVGElement>('.mermaid svg').forEach(svg => {
      const viewBoxWidth = svg.viewBox?.baseVal?.width || 0;
      let naturalWidth = Number.parseFloat(svg.dataset.zoomNaturalWidth || '0');
      if (!(naturalWidth > 0)) {
        naturalWidth = viewBoxWidth || svg.getBoundingClientRect().width;
        if (naturalWidth > 0) svg.dataset.zoomNaturalWidth = String(naturalWidth);
      }
      const targetWidth = scaledMediaWidth(naturalWidth, availableWidth, scale);
      if (targetWidth > 0) {
        svg.style.width = `${targetWidth}px`;
        svg.style.maxWidth = '100%';
        svg.style.height = 'auto';
      }
    });
  }
  new ResizeObserver(updateScaledImages).observe(previewOut);

  let contentZoomPercent = normalizeContentZoom(localStorage.getItem(PREFERENCE_KEYS.contentZoom));
  function applyContentZoom(save = false) {
    const scale = contentZoomScale(contentZoomPercent);
    editorView.style.setProperty('--content-editor-font-size', `${13.5 * scale}px`);
    editorView.style.setProperty('--content-preview-font-size', `${14 * scale}px`);
    contentZoomSelect.value = String(contentZoomPercent);
    contentZoomSelect.title = contentZoomPercent
      ? `Editor and preview content: ${Math.round(scale * 100)}%`
      : 'Editor and preview content: Default (100%)';
    if (save) localStorage.setItem(PREFERENCE_KEYS.contentZoom, String(contentZoomPercent));
    mdEditor.view.requestMeasure();
    requestAnimationFrame(updateScaledImages);
  }
  function setContentZoom(percent: number, save = true) {
    contentZoomPercent = normalizeContentZoom(percent);
    applyContentZoom(save);
  }
  function stepContentZoom(delta: number) {
    setContentZoom(nextContentZoom(contentZoomPercent, delta));
  }
  contentZoomSelect.addEventListener('change', () => {
    contentZoomPercent = normalizeContentZoom(contentZoomSelect.value);
    applyContentZoom(true);
  });
  applyContentZoom();

  // ── Toast ─────────────────────────────────────────────────────────────────────
  const toast = createToastController(toastEl);

  async function saveWorkspaceHandle(_handle: FileSystemDirectoryHandle) {
    return window.__recallstackNative?.saveWorkspaceHandle();
  }

  async function loadWorkspaceHandle() {
    return window.__recallstackNative?.loadWorkspaceHandle() ?? null;
  }

  // ── Permission helper (same pattern as markdown-kanban) ───────────────────────
  async function verifyPermission(handle: any, mode = 'readwrite') {
    if (!handle) return false;
    const opts = { mode };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (await handle.requestPermission(opts) === 'granted') return true;
    return false;
  }

  // ── File System helpers ───────────────────────────────────────────────────────

  async function buildWorkspaceList(root: any) {
    const discovered = await discoverWorkspaces(root);
    dataHandle = discovered.dataHandle;
    return discovered.workspaces;
  }

  async function listWorkspaceTopDirs() {
    const dirs = currentWorkspace?.topLevelDirs || await listDirs(notesHandle!);
    return dirs.filter(dir => !SYSTEM_FOLDER_NAMES.has(String(dir.name).toLowerCase()));
  }

  function isManagedSystemWorkspace() {
    return activeWorkspace != null && SYSTEM_WORKSPACES.has(activeWorkspace);
  }

  function openInboxDeleteModal(f: any, dirHandle: any, onDeleted: any) {
    _pendingInboxDelete = { f, dirHandle, onDeleted };
    inboxDeleteMsg.textContent = `Move "${f.name}" to RecallStack Trash?`;
    inboxDeleteModal.classList.remove('hidden');
    inboxDeleteConfirmBtn.focus();
  }

  function closeInboxDeleteModal() {
    _pendingInboxDelete = null;
    inboxDeleteModal.classList.add('hidden');
  }

  async function openInboxNonMdFile(f: any) {
    try {
      const file = await f.handle.getFile();
      const ext  = fileExt(f.name);
      const url  = URL.createObjectURL(file);
      if (BROWSER_VIEWABLE_EXTS.has(ext)) {
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement('a');
        a.href     = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      toast('Could not open file: ' + e.message, 'error');
    }
  }

  function sortFiles(files: any) {
    return sortListedFiles(files, sortMode);
  }

  const QA_REVIEW_TAG = ' - (In QA Review)';
  const DEPLOYMENT_TAG = ' - (Marked for Deployment)';
  const DEPLOYED_TAG_REGEX = / - \(Deployed \d{4}-\d{2}-\d{2}\)/;
  const BACKLOG_TAG = ' - (Backlog)';
  const WAITING_TAG = ' - (Waiting)';

  function buildDeployedTag() {
    return ' - (Deployed ' + new Date().toISOString().slice(0, 10) + ')';
  }
  function stripStatusTags(base: any) {
    return base.replaceAll(QA_REVIEW_TAG, '').replaceAll(DEPLOYMENT_TAG, '').replace(DEPLOYED_TAG_REGEX, '').replaceAll(BACKLOG_TAG, '').replaceAll(WAITING_TAG, '');
  }
  function detectStatusTag(name: any) {
    if (name.includes(DEPLOYMENT_TAG)) return 'Deployment';
    if (name.includes(QA_REVIEW_TAG)) return 'QA';
    if (DEPLOYED_TAG_REGEX.test(name)) return 'Deployed';
    if (name.includes(BACKLOG_TAG)) return 'Backlog';
    if (name.includes(WAITING_TAG)) return 'Waiting';
    return '';
  }

  const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2, blocked: 3, onhold: 4 };
  const PRIORITY_LABELS: Record<string, string> = {
    high: 'High Priority',
    normal: 'Normal Priority',
    low: 'Low Priority',
    blocked: 'Blocked',
    onhold: 'On Hold',
  };

  function taskPriorityLabel(priorityKey: any) {
    return PRIORITY_LABELS[priorityKey]
      || priorityKey.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c: any) => c.toUpperCase());
  }

  function sortTaskFiles(enrichedFiles: any) {
    return [...enrichedFiles].sort((a, b) => {
      const pa = PRIORITY_ORDER[normalizeTaskPriority(taskMetaFor(a.name, a.content || '').priority)] ?? 1;
      const pb = PRIORITY_ORDER[normalizeTaskPriority(taskMetaFor(b.name, b.content || '').priority)] ?? 1;
      if (pa !== pb) return pa - pb;
      if (sortMode === 'alpha') return a.name.localeCompare(b.name);
      return b.mtime - a.mtime;
    });
  }

  // Partitions task items into the "special" buckets (Deployment / QA Review / Deployed / Completed)
  // plus a `rest` bucket, first-match-wins, for use by both loadFiles and loadAllTasks.
  function partitionTasksBySuffix(items: any, getName: any, getContent: any) {
    const buckets: Record<"deployment" | "qaReview" | "deployed" | "completed" | "backlog" | "rest", any[]> = {
      deployment: [], qaReview: [], deployed: [], completed: [], backlog: [], rest: [],
    };
    items.forEach((item: any) => {
      const name = getName(item);
      if (name.includes(DEPLOYMENT_TAG)) buckets.deployment.push(item);
      else if (name.includes(QA_REVIEW_TAG)) buckets.qaReview.push(item);
      else if (DEPLOYED_TAG_REGEX.test(name)) buckets.deployed.push(item);
      else if (name.includes(BACKLOG_TAG)) buckets.backlog.push(item);
      else if (parseDateLocal(taskMetaFor(name, getContent(item) || '').completedDate)) buckets.completed.push(item);
      else buckets.rest.push(item);
    });
    return buckets;
  }

  // Sorts { file, ... } entries by delegating to sortTaskFiles on the underlying files.
  function sortTaskEntries(entries: any) {
    return sortTaskFiles(entries.map((e: any) => e.file)).map(file => entries.find((e: any) => e.file === file));
  }

  // Appends a `.tasks-section` block (skipped when empty) for the given already-sorted items.
  function appendTaskSection(title: any, items: any, cardFn: any, className = '') {
    appendTaskSectionTo(fileGrid, title, items, cardFn, esc, className);
  }

  // Inserts a visual divider between the special sections above and the normal listing below.
  function appendSectionDivider() {
    appendSectionDividerTo(fileGrid);
  }

  // Renders a thin proportional segmented bar — one solid block per non-empty category,
  // sized by percentage of total, left-to-right in the same order sections render
  // top-to-bottom (Normal → Completed → QA → Deployment → Deployed → Backlog).
  function renderTaskCountBar(nameBuckets: any) {
    renderTaskCountBarInto(taskCountBar, nameBuckets);
  }

  // ── Asset helpers ─────────────────────────────────────────────────────────────

  // Returns the directory handle for the currently active file's folder
  // Returns { parentHandle, prefix } for asset operations, accounting for archived/ files.
  // Files inside an archived/ subfolder use '../assets/' links; normal files use 'assets/'.
  async function getAssetsDirInfo() {
    const location = assetLocation(currentPath, activeFolderPath());
    const parentHandle = await getDirHandle(notesHandle!, location.parentParts);
    const prefix = location.prefix;
    return { parentHandle, prefix };
  }

  // Save a binary asset into the assets/ subfolder and cache a blob URL for preview
  async function saveAsset(filename: any, arrayBuffer: any, mimeType: any) {
    const { parentHandle, prefix } = await getAssetsDirInfo();
    const assetsDir = await parentHandle.getDirectoryHandle('assets', { create: true });
    filename = await uniqueFilenameInDir(assetsDir, filename);
    const fh        = await assetsDir.getFileHandle(filename, { create: true });
    const writable  = await fh.createWritable();
    try {
      await writable.write(arrayBuffer);
    } finally {
      await writable.close();
    }
    const blob = new Blob([arrayBuffer], mimeType ? { type: mimeType } : undefined);
    const url  = URL.createObjectURL(blob);
    const oldUrl = assetBlobUrls.get(prefix + filename);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    assetBlobUrls.set(prefix + filename, url);
    return prefix + filename;
  }

  // Insert text at the current cursor position in the markdown editor
  function insertAtCursor(text: any) {
    const start = mdEditor.selectionStart;
    const end   = mdEditor.selectionEnd;
    const val   = mdEditor.value;
    const caret = start + text.length;
    mdEditor.applyUserEdit(val.slice(0, start) + text + val.slice(end), caret, caret);
    renderPreview();
  }

  // Load all files from the assets/ folder for the current file and cache blob URLs.
  // For archived files (inside archived/) the assets/ folder is in the parent directory,
  // so blob URLs are keyed with '../assets/' to match the links written in the markdown.
  async function loadAssetsForCurrentFile() {
    const oldUrls = [...assetBlobUrls.values()];
    assetBlobUrls.clear();
    try {
      const { parentHandle, prefix } = await getAssetsDirInfo();
      let assetsDir;
      try { assetsDir = await parentHandle.getDirectoryHandle('assets'); }
      catch {
        for (const url of oldUrls) URL.revokeObjectURL(url);
        return;
      } // no assets folder yet — nothing to load
      for await (const entry of assetsDir.values()) {
        if (entry.kind !== 'file') continue;
        try {
          const nativePath = (entry as FileSystemFileHandle & { path?: string }).path;
          if (window.__recallstackNative?.active && nativePath) {
            assetBlobUrls.set(prefix + entry.name, window.__recallstackNative!.assetUrl(nativePath));
            continue;
          }
          const file = await entry.getFile();
          const url  = URL.createObjectURL(file);
          assetBlobUrls.set(prefix + entry.name, url);
        } catch { /* skip unreadable */ }
      }
    } catch { /* folder may not exist */ }
    for (const url of oldUrls) URL.revokeObjectURL(url);
  }

  // Move assets referenced in content from the source file's assets/ to the destination's assets/.
  // Accounts for archived/ files (which use ../assets/). Creates dest assets/ if missing.
  async function moveAssetsWithFile(srcPath: any, destFolderParts: any, content: any) {
    const refs = referencedAssets(content);
    if (refs.size === 0) return;

    const srcFolderParts = srcPath.split('/').slice(0, -1);
    const srcIsArchived = srcFolderParts.at(-1)! === 'archived';
    const srcAssetParentParts = srcIsArchived ? srcFolderParts.slice(0, -1) : srcFolderParts;

    let srcAssetsDir;
    try {
      const srcParent = await getDirHandle(notesHandle!, srcAssetParentParts);
      srcAssetsDir = await srcParent.getDirectoryHandle('assets');
    } catch {
      return; // no assets folder in source — nothing to move
    }

    const destIsArchived = destFolderParts.at(-1)! === 'archived';
    const destAssetParentParts = destIsArchived ? destFolderParts.slice(0, -1) : destFolderParts;
    const destParent = await getDirHandle(notesHandle!, destAssetParentParts);
    const destAssetsDir = await destParent.getDirectoryHandle('assets', { create: true });

    for (const name of refs) {
      try {
        const srcFh = await srcAssetsDir.getFileHandle(name);
        let destExists = false;
        try { await destAssetsDir.getFileHandle(name); destExists = true; } catch {}
        if (destExists) continue;
        const file = await srcFh.getFile();
        const buf  = await file.arrayBuffer();
        const destFh   = await destAssetsDir.getFileHandle(name, { create: true });
        const writable = await destFh.createWritable();
        try {
          await writable.write(buf);
        } finally {
          await writable.close();
        }
        // Keep the source asset in place: other notes in the source folder may
        // reference the same assets/name link.
      } catch { /* skip missing or unreadable assets */ }
    }
  }

  // ── Orphan Assets ─────────────────────────────────────────────────────────────

  // Build the broken-link nav button for nav-row-2
  function mkOrphanAssetsBtn() {
    const btn = document.createElement('button');
    btn.id        = 'btn-orphan-assets';
    btn.className = 'nav-orphan-btn';
    btn.title     = 'Orphan Assets — find unreferenced files in assets/';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      <line x1="2" y1="2" x2="22" y2="22"/>
    </svg>`;
    btn.addEventListener('click', loadOrphanAssets);
    return btn;
  }

  // Show orphan assets as a file-list-view, similar to loadFiles()
  // Reads current l2Active / l1Active from state at call time.
  async function loadOrphanAssets() {
    const activeFolder = l2Active || l1Active;
    if (!activeFolder) { toast('Select a folder first', 'error'); return; }
    const dirHandle  = activeFolder.handle;
    const folderLabel = l2Active ? l2Active!.name : l1Active!.name;

    showView('list');
    updateAllTasksGroupingModeBtn();

    // Mark the nav button active
    const existing = $maybe('btn-orphan-assets');
    if (existing) existing.classList.add('active');

    listHeading.textContent = folderLabel + ' / orphan assets';
    fileGrid.innerHTML = '';

    // Try to get assets/ subfolder
    let assetsDir;
    try { assetsDir = await dirHandle.getDirectoryHandle('assets'); }
    catch {
      fileGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🗂️</div><div class="empty-text">No <code>assets/</code> folder found here.</div></div>`;
      return;
    }

    // Collect all files in assets/
    const assetFiles: FileSystemFileHandle[] = [];
    for await (const entry of assetsDir.values()) {
      if (entry.kind === 'file') assetFiles.push(entry);
    }
    if (!assetFiles.length) {
      fileGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">The <code>assets/</code> folder is empty.</div></div>`;
      return;
    }

    // Collect all references from .md files in this folder recursively (including archived/)
    const folderPath = [l1Active?.name, l2Active?.name].filter(Boolean).join('/');
    const allRefs = window.__recallstackNative?.active
      ? new Set(await window.__recallstackNative!.referencedAssets(folderPath))
      : await collectReferencedAssets(dirHandle);

    const orphanNames = orphanAssetNames(assetFiles.map(entry => entry.name), allRefs);
    const orphans = orphanNames
      .map(name => assetFiles.find(entry => entry.name === name))
      .filter((entry): entry is FileSystemFileHandle => entry != null);

    if (!orphans.length) {
      fileGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">No orphan assets — every file in <code>assets/</code> is referenced.</div></div>`;
      return;
    }

    for (const entry of orphans) {
      const isImg = isImageFilename(entry.name);
      const icon  = isImg ? '🖼️' : '📎';

      const card = document.createElement('div');
      card.className = 'file-card';

      // Icon
      const iconEl = document.createElement('span');
      iconEl.className   = 'file-icon';
      iconEl.textContent = icon;
      card.appendChild(iconEl);

      // Name
      const nameEl = document.createElement('span');
      nameEl.className   = 'file-name';
      nameEl.textContent = entry.name;
      nameEl.title       = entry.name;
      card.appendChild(nameEl);

      // File size
      const metaEl = document.createElement('span');
      metaEl.className = 'file-meta';
      try {
        const f = await entry.getFile();
        metaEl.textContent = formatAssetSize(f.size);
      } catch { metaEl.textContent = ''; }
      card.appendChild(metaEl);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'file-card-actions';

      // Preview (images only)
      if (isImg) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'btn-icon preview';
        previewBtn.title     = 'Open image in new tab';
        previewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
        previewBtn.addEventListener('click', async (e: any) => {
          e.stopPropagation();
          try {
            const file = await entry.getFile();
            const url  = URL.createObjectURL(file);
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          } catch (err: any) { toast('Could not open image: ' + err.message, 'error'); }
        });
        actions.appendChild(previewBtn);
      }

      // Delete
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon danger';
      delBtn.title     = 'Move this file to RecallStack Trash';
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      delBtn.addEventListener('click', async (e: any) => {
        e.stopPropagation();
        if (!confirm(`Move "${entry.name}" to RecallStack Trash?`)) return;
        try {
          await assetsDir.removeEntry(entry.name);
          const key = 'assets/' + entry.name;
          if (assetBlobUrls.has(key)) { URL.revokeObjectURL(assetBlobUrls.get(key)!); assetBlobUrls.delete(key); }
          card.remove();
          toast(`Moved to Trash: ${entry.name}`);
          if (!fileGrid.querySelector('.file-card')) {
            fileGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">No orphan assets — every file in <code>assets/</code> is referenced.</div></div>`;
          }
        } catch (err: any) { toast('Delete failed: ' + err.message, 'error'); }
      });
      actions.appendChild(delBtn);

      card.appendChild(actions);
      fileGrid.appendChild(card);
    }
  }

  // ── Workspace init ────────────────────────────────────────────────────────────

  function resetWorkspaceSessionState() {
    workspaceSessionGeneration++;
    listLoadGeneration++;
    nativeFileVersions.clear();
    removeExternalChangeBanner();
    for (const url of assetBlobUrls.values()) URL.revokeObjectURL(url);
    assetBlobUrls.clear();
    previewScheduler.cancel();
    clearTimeout(_autoSaveTimer);
    clearTimeout(_searchTimer);
    clearTimeout(_localDraftTimer);
    clearTimeout(_nativeDraftTimer);
    clearTimeout(_nativeRefreshTimer);
    clearTimeout(_themeReloadTimer);
    clearTimeout(_backlinksRefreshTimer);
    clearTimeout(_catalogRefreshTimer);

    currentWorkspace = null;
    activeWorkspace = null;
    notesHandle = null;
    l1Active = null;
    l2Active = null;
    currentPath = null;
    savedContent = null;
    isNew = false;
    archiveMode = false;
    allTasksMode = false;
    returnToAllTasks = false;
    outputsMode = false;
    outputsActiveFolder = null;
    returnToOutputs = false;
    isOutputsFile = false;
    currentOutputsFh = null;
    currentOutputsDirFh = null;
    isExternalFile = false;
    currentExternalPath = null;
    currentExternalFileHandle = null;
    preSearchView = null;
    searchIndex = [];
    lastSearchBuffer = null;
    currentBacklinks = [];

    // Tabs are workspace-scoped (Improvement 11) — switching workspaces closes them all.
    tabs = [];
    activeTabId = null;
    closedTabHistory = [];
    protectedDailyJournalPath = null;
    renderTabStrip();

    navRow1.replaceChildren();
    navRow2.replaceChildren();
    navRow2.classList.add('hidden');
    fileGrid.replaceChildren();
    searchGrid.replaceChildren();
    searchInput.value = '';
    listHeading.textContent = 'Loading workspace…';
    titleInput.value = '';
    mdEditor.openDocument('', '', 0);
    previewOut.replaceChildren();
    taskDateBar.classList.add('hidden');
    taskCountBar.classList.add('hidden');
    taskCountBar.replaceChildren();
    showView('list');
  }

  // Re-derives the live handle for the configured Outputs folder, which can
  // now be any directory on disk (see the outputsHandle declaration above).
  // Native mode: OUTPUTS_FOLDER_PATH_KEY holds an absolute OS path, so the
  // handle can always be rebuilt without user interaction — a listing probe
  // confirms the folder still exists/is reachable rather than assuming so
  // (unlike the old workspace-relative version, a missing external folder is
  // never auto-created). Browser mode: there is no path string to rebuild
  // from (File System Access API handles are opaque) and no existing
  // precedent in this codebase for persisting a directory handle across
  // reloads — not even the workspace root itself persists in browser mode,
  // see loadWorkspaceHandle() above — so the in-memory handle from
  // chooseOutputsFolder() is simply left as-is here.
  async function ensureConfiguredOutputsHandle() {
    if (!window.__recallstackNative?.active) return outputsHandle;
    const path = (localStorage.getItem(OUTPUTS_FOLDER_PATH_KEY) || '').trim();
    if (!path) return null;
    const handle = window.__recallstackNative!.externalDirectoryHandle(path);
    try {
      await listDirs(handle);
      return handle;
    } catch {
      return null;
    }
  }

  async function openWorkspace(handle: FileSystemDirectoryHandle, options: OpenWorkspaceOptions = {}) {
    const freshRoot = options.freshRoot === true;
    try {
      await ensureWorkspaceStructure(handle);
      if (freshRoot) resetWorkspaceSessionState();
      rootHandle  = handle;
      workspaces  = await buildWorkspaceList(rootHandle);
      await loadWorkspaceThemes();

      outputsHandle = await ensureConfiguredOutputsHandle();
      outputsAvailable = !!outputsHandle;

      if (!workspaces.length) {
        toast('No workspace folders found — create a Data/ subfolder or add system workspaces.', 'error');
        return;
      }

      welcomeEl.classList.add('hidden');
      appEl.classList.remove('hidden');

      // Pick the last-used workspace, or fall back to the first one
      const savedWsName = options.preferredWorkspaceName
        ?? (freshRoot ? null : localStorage.getItem('pkm-active-workspace'));
      const ws = selectInitialWorkspace(workspaces, savedWsName, showSystemFolders, SYSTEM_WORKSPACES);
      if (!ws) return false;
      await switchWorkspace(ws, { restoreView: !freshRoot });
      return true;
    } catch (e: any) {
      toast('Could not open workspace: ' + e.message, 'error');
      console.error(e);
      return false;
    }
  }

  async function canSwitchWorkspaceRoot() {
    if (!rootHandle) return true;
    if (!await checkUnsavedNewNote()) return false;
    return autoSaveIfDirty(true);
  }

  async function openChosenWorkspace(handle: any, leaveChecked = false) {
    if (!leaveChecked && !await canSwitchWorkspaceRoot()) return false;
    const opened = await openWorkspace(handle, { freshRoot: true });
    if (opened) await saveWorkspaceHandle(handle);
    return opened;
  }

  async function chooseAndOpenWorkspace() {
    if (!await canSwitchWorkspaceRoot()) return false;
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return openChosenWorkspace(handle, true);
  }

  async function switchWorkspace(ws: WorkspaceDirectory, options: NavigationOptions = {}) {
    if (!await checkUnsavedNewNote()) return;
    const changingWorkspace = !!currentWorkspace && currentWorkspace !== ws;
    if (changingWorkspace) {
      if (!await autoSaveIfDirty(true)) return;
      resetWorkspaceSessionState();
    }
    currentWorkspace = ws;
    activeWorkspace = ws.name;
    notesHandle     = ws.handle;
    DB_WS_PREFIX    = ws.dbPrefix || ('Data/' + ws.name + '/');
    await ensureWorkspaceSystemFolders();
    localStorage.setItem('pkm-active-workspace', ws.name);
    renderWorkspaceSwitcher(ws.name);

    // Apply per-workspace theme
    const savedTheme = localStorage.getItem('pkm-theme-' + ws.name) || defaultThemeId;
    const theme = THEMES[savedTheme] ? savedTheme : defaultThemeId;
    themeSelect.value = theme;
    applyTheme(theme, false);

    // Apply per-workspace nav modes
    const navigationPreferences = readWorkspaceNavigationPreferences(localStorage, ws.name);
    navRow1Mode = navigationPreferences.row1Mode;
    navRow2Mode = navigationPreferences.row2Mode;
    allTasksStatusMode = navigationPreferences.allTasksStatusMode;
    updateNavModeBtns();

    readmeLoaded    = false;
    changelogLoaded = false;
    const restoreView = options.restoreView ?? !changingWorkspace;
    await initNav({ restoreView });
    await ensureJournalWhenEmpty();
    await buildSearchIndex();
    if (window.__recallstackNative?.active) renderSavedSearches().catch(error => console.warn('Could not load saved searches', error));
    performance.mark('recallstack:workspace-ui-ready');
    if (performance.getEntriesByName('recallstack:workspace-native-ready').length) {
      performance.measure('recallstack:workspace-ui-open', 'recallstack:workspace-open-start', 'recallstack:workspace-ui-ready');
    }
  }

  function renderWorkspaceSwitcher(activeName: any) {
    const container = $id('workspace-switcher');
    if (!container) return;
    container.innerHTML = '';
    const visible = workspaces.filter(ws => showSystemFolders || !SYSTEM_WORKSPACES.has(ws.name));
    visible.forEach((ws, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className   = 'workspace-sep';
        sep.textContent = '|';
        container.appendChild(sep);
      }
      const chip = document.createElement('button');
      chip.className   = 'workspace-chip' + (ws.name === activeName ? ' active' : '');
      chip.textContent = ws.name;
      chip.addEventListener('click', async () => {
        try {
          await refreshAndSwitchWorkspace(ws.name);
        } catch (error: any) {
          toast('Could not open workspace listing: ' + (error.message || error), 'error');
        }
      });
      container.appendChild(chip);
    });
  }

  async function refreshAndSwitchWorkspace(workspaceName: any) {
    if (!await canSwitchWorkspaceRoot()) return;
    workspaces = await buildWorkspaceList(rootHandle);
    let workspace = workspaces.find(item => item.name === workspaceName);
    if (!workspace) {
      workspace = workspaces.find(item => !SYSTEM_WORKSPACES.has(item.name)) || workspaces[0];
      toast(`“${workspaceName}” is no longer available. Workspace folders were refreshed.`, 'error');
    }
    if (!workspace) return;
    await switchWorkspace(workspace, { restoreView: false });
  }

  async function ensureWorkspaceSystemFolders() {
    if (!notesHandle || isManagedSystemWorkspace()) return;
    await notesHandle.getDirectoryHandle(TASKS_ROOT, { create: true });
    await notesHandle.getDirectoryHandle(DAILYLOGS_ROOT, { create: true });
    if (currentWorkspace?.topLevelDirs) {
      currentWorkspace.topLevelDirs = await listDirs(notesHandle);
    }
  }

  async function refreshEverything() {
    if (!rootHandle || btnRefreshWorkspace.disabled) return;
    if (!await canSwitchWorkspaceRoot()) return;
    const handle = rootHandle;
    const preferredWorkspaceName = activeWorkspace;
    btnRefreshWorkspace.disabled = true;
    btnRefreshWorkspace.classList.add('refreshing');
    try {
      const opened = await openWorkspace(handle, { freshRoot: true, preferredWorkspaceName });
      if (opened) toast('Workspace refreshed');
    } finally {
      btnRefreshWorkspace.disabled = false;
      btnRefreshWorkspace.classList.remove('refreshing');
    }
  }

  function syncOutputsTopButton() {
    btnOutputsTop.classList.toggle('hidden', !outputsAvailable || isManagedSystemWorkspace());
    btnOutputsTop.classList.toggle('active', outputsMode);
  }

  btnRefreshWorkspace.addEventListener('click', () => {
    refreshEverything().catch(error => toast('Could not refresh workspace: ' + (error?.message || error), 'error'));
  });
  btnOutputsTop.addEventListener('click', () => selectOutputs());

  // ── Navigation ────────────────────────────────────────────────────────────────

  // Persists the last folder/subfolder + listing-or-file state so the next
  // session can reopen exactly where the user left off. Skipped while in
  // All Tasks / Outputs / search-derived contexts — those aren't plain
  // folder browsing and already have their own return-to behavior.
  function saveLastView(mode: any, path: any) {
    if (!activeWorkspace || !l1Active) return;
    if (allTasksMode || outputsMode || returnToAllTasks || returnToOutputs) return;
    const state = {
      l1:   l1Active!.name,
      l2:   l2Active ? l2Active!.name : null,
      mode: mode,
      path: mode === 'file' ? path : null,
    };
    try { localStorage.setItem('pkm-last-view-' + activeWorkspace, serializeLastFolderView(state)); } catch {}
  }

  // Restores the last saved folder/subfolder/file-or-listing state for the
  // active workspace, if any. Returns true if it restored something.
  async function restoreLastView(folders: any) {
    if (!activeWorkspace) return false;
    const raw = localStorage.getItem('pkm-last-view-' + activeWorkspace);
    if (!raw) return false;
    const saved = parseLastFolderView(raw);
    if (!saved) return false;
    const l1Folder = folders.find((f: any) => f.name === saved.l1);
    if (!l1Folder) return false;

    await selectL1(l1Folder);
    if (saved.l2) {
      if (!l2Active || l2Active!.name !== saved.l2) {
        const subs = await listDirs(l1Folder.handle);
        const l2Folder = subs.find(f => f.name === saved.l2);
        if (l2Folder) await selectL2(l2Folder);
      }
    } else if (l2Active) {
      await selectRootFolder();
    }

    if (saved.mode === 'file' && saved.path) {
      const restored = await openFile(saved.path.split('/').pop()!, saved.path, { restoringLastView: true });
      if (!restored) saveLastView('list', null);
    }
    return true;
  }

  async function initNav(options: NavigationOptions = {}) {
    const restoreView = options.restoreView !== false;
    const folders = await listWorkspaceTopDirs();
    navRow1.innerHTML = '';
    navRow1.appendChild(mkNavNewBtn(1));
    navRow1.appendChild(mkNavRenameBtn(1));
    // The Outputs entry lives in the app header as an icon button (btnOutputsTop) —
    // not duplicated here as a text button in the top-level folder navigation.
    // Keep the Journal and Tasks icon shortcuts beside each other before folder tabs.
    navRow1.appendChild(mkReturnToTabBtn());
    navRow1.appendChild(mkNavAllTasksBtn());
    navRow1.appendChild(mkNavWorkingTasksBtn());
    syncOutputsTopButton();
    navRow1.appendChild(mkNavSeparator());
    if (!folders.length) {
      const span = document.createElement('span');
      span.style.cssText = 'color:var(--overlay0);padding:5px 12px;font-size:13px';
      span.textContent   = 'No folders found';
      navRow1.appendChild(span);
    } else if (navRow1Mode === 'combo') {
      navRow1.appendChild(mkNav1Combo(folders));
    } else {
      folders.forEach(f => navRow1.appendChild(mkNavBtn(f.name, () => refreshFolderNavigation(f.name))));
    }

    if (options.preferredL1) {
      const preferred = folders.find(folder => folder.name === options.preferredL1);
      if (preferred) {
        await selectL1(preferred, {
          preferredL2: options.preferredL2,
          preferRoot: options.preferRoot === true,
        });
        return;
      }
      toast(`“${options.preferredL1}” is no longer available. Folders were refreshed.`, 'error');
    }

    if (isManagedSystemWorkspace()) {
      if (folders.length) {
        if (!restoreView || !await restoreLastView(folders)) await selectL1(folders[0]);
      } else {
        showView('list');
        listHeading.textContent = activeWorkspace;
        fileGrid.innerHTML = '';
      }
      return;
    }

    if (!restoreView || !await restoreLastView(folders)) {
      // Land on a folder for nav context; ensureJournalWhenEmpty() then shows
      // today's journal when nothing else is open.
      if (folders.length) await selectL1(folders[0]);
    }
  }

  async function refreshFolderNavigation(l1Name?: string, l2Name: string | null = null, preferRoot = false) {
    if (!await checkUnsavedNewNote()) return;
    if (!await autoSaveIfDirty(true)) return;
    await initNav({ restoreView: false, preferredL1: l1Name, preferredL2: l2Name, preferRoot });
    // Explicitly clicking a subfolder (or the root button) opens that folder's
    // notes as a modal; Inbox / Tasks stay inline. Selecting only a top-level
    // folder updates nav state but does not pop the modal — the user has to pick
    // a subfolder for that. Init / restore call initNav directly and never land here.
    const explicitSubfolder = l2Name !== null || preferRoot;
    if (explicitSubfolder && l1Active && !outputsMode && !folderUsesInlineList(activeFolderHeading(), l1Active.name)) {
      void openNotesListing().catch(e => toast('Could not load notes: ' + (e?.message || e), 'error'));
    }
  }

  async function selectL1(folder: NamedDirectory, options: NavigationOptions = {}) {
    if (!await checkUnsavedNewNote()) return;
    allTasksMode        = false;
    returnToAllTasks    = false;
    outputsMode         = false;
    outputsActiveFolder = null;
    returnToOutputs     = false;
    isOutputsFile       = false;
    currentOutputsFh    = null;
    currentOutputsDirFh = null;
    isExternalFile      = false;
    currentExternalPath = null;
    currentExternalFileHandle = null;
    updateAllTasksGroupingModeBtn();
    l1Active    = folder;
    l2Active    = null;
    archiveMode = false;
    const allTasksBtn = $maybe('btn-all-tasks');
    if (allTasksBtn) allTasksBtn.classList.remove('active');
    clearOutputsNavActive();
    navRow2.classList.remove('nav-row-disabled');
    btnNew.disabled = false;
    btnNew.classList.remove('hidden');
    setActive(navRow1, folder.name);

    const subs = await listDirs(folder.handle);
    navRow2.innerHTML = '';
    navRow2.appendChild(mkNavNewBtn(2));
    navRow2.appendChild(mkNavRenameBtn(2));
    navRow2.classList.remove('hidden');
    const r1 = $maybe('btn-rename-folder-1');
    if (r1) r1.disabled = isManagedSystemWorkspace();
    populateNavRow2Contents(subs);
    const preferredFolder = options.preferredL2
      ? subs.find(subfolder => subfolder.name === options.preferredL2)
      : null;
    if (options.preferredL2 && !preferredFolder) {
      toast(`“${options.preferredL2}” is no longer available. Subfolders were refreshed.`, 'error');
    }
    const firstFolder = preferredFolder || subs.find(f => !SYSTEM_FOLDER_NAMES.has(String(f.name).toLowerCase())) || subs[0];
    if (options.preferRoot) return selectRootFolder();
    if (firstFolder) await selectL2(firstFolder);
    else await selectRootFolder();
  }

  // Regular content folders now browse their notes in the Notes listing modal
  // (opened by refreshFolderNavigation / Ctrl+L), so selecting one only updates
  // nav state. Inbox (non-markdown) and a subfolder literally named `tasks`
  // keep the inline file-list grid.
  function folderUsesInlineList(...names: Array<string | null | undefined>) {
    return names.some(name => name === 'inbox' || name === 'tasks');
  }

  async function selectL2(folder: any) {
    if (!await checkUnsavedNewNote()) return;
    l2Active    = folder;
    archiveMode = false;
    btnNew.classList.remove('hidden');
    updateArchiveToggleBtn();
    setActive(navRow2, folder.name);
    const ob = $maybe('btn-orphan-assets');
    if (ob) ob.classList.remove('active');
    const r2 = $maybe('btn-rename-folder-2');
    if (r2) r2.disabled = isManagedSystemWorkspace() || folder.name === 'tasks';
    if (folderUsesInlineList(folder.name, l1Active?.name)) await loadFiles(folder.handle, folder.name);
    saveLastView('list', null);
  }

  async function selectRootFolder() {
    if (!l1Active) return;
    if (!await checkUnsavedNewNote()) return;
    l2Active    = null;
    archiveMode = false;
    btnNew.classList.remove('hidden');
    updateArchiveToggleBtn();
    setActive(navRow2, '__root__');
    const ob = $maybe('btn-orphan-assets');
    if (ob) ob.classList.remove('active');
    const r2 = $maybe('btn-rename-folder-2');
    if (r2) r2.disabled = true;
    if (folderUsesInlineList(l1Active!.name)) await loadFiles(l1Active!.handle, 'root');
    saveLastView('list', null);
  }

  // Syncs nav state (l1Active, l2Active, button highlights) to match a file path
  // without triggering a file list reload. Called when opening a file from search.
  async function syncNavToPath(notesRelPath: any) {
    const parts      = notesRelPath.split('/');
    if (SYSTEM_FOLDER_NAMES.has(String(parts[0] || '').toLowerCase())) {
      l1Active         = null;
      l2Active         = null;
      allTasksMode     = parts[0] === TASKS_ROOT;
      returnToAllTasks = false;
      outputsMode      = false;
      outputsActiveFolder = null;
      returnToOutputs  = false;
      isOutputsFile    = false;
      currentOutputsFh = null;
      currentOutputsDirFh = null;
      isExternalFile   = false;
      currentExternalPath = null;
      currentExternalFileHandle = null;
      archiveMode      = parts[1] === 'archived';
      updateAllTasksGroupingModeBtn();
      const allTasksBtn = $maybe('btn-all-tasks');
      if (allTasksBtn) allTasksBtn.classList.toggle('active', allTasksMode);
      clearOutputsNavActive();
      navRow1.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      navRow2.classList.add('nav-row-disabled');
      btnNew.disabled = true;
      return;
    }
    const l1Name     = parts[0];
    const inArchived = parts.at(-2) === 'archived';
    // L2 exists when there are ≥3 segments and the second segment isn't 'archived'
    const possibleL2 = parts.length >= 3 ? parts[1] : null;
    const l2Name     = (possibleL2 && possibleL2 !== 'archived') ? possibleL2 : null;

    if (!l1Active || l1Active!.name !== l1Name) {
      const l1Handle = await notesHandle!.getDirectoryHandle(l1Name);
      l1Active         = { name: l1Name, handle: l1Handle };
      l2Active         = null;
      allTasksMode        = false;
      returnToAllTasks    = false;
      outputsMode         = false;
      outputsActiveFolder = null;
      returnToOutputs     = false;
      isOutputsFile       = false;
      currentOutputsFh    = null;
      currentOutputsDirFh = null;
      isExternalFile      = false;
      currentExternalPath = null;
      currentExternalFileHandle = null;
      updateAllTasksGroupingModeBtn();
      archiveMode      = false;
      const allTasksBtn = $maybe('btn-all-tasks');
      if (allTasksBtn) allTasksBtn.classList.remove('active');
      clearOutputsNavActive();
      navRow2.classList.remove('nav-row-disabled');
      btnNew.disabled = false;
      btnNew.classList.remove('hidden');
      setActive(navRow1, l1Name);

      const subs = await listDirs(l1Handle);
      navRow2.innerHTML = '';
      navRow2.appendChild(mkNavNewBtn(2));
      navRow2.appendChild(mkNavRenameBtn(2));
      navRow2.classList.remove('hidden');
      populateNavRow2Contents(subs);
    } else {
      setActive(navRow1, l1Name);
    }

    if (l2Name) {
      if (!l2Active || l2Active!.name !== l2Name) {
        const l2Handle = await l1Active!.handle.getDirectoryHandle(l2Name);
        l2Active = { name: l2Name, handle: l2Handle };
      }
      archiveMode = inArchived;
      btnNew.classList.remove('hidden');
      setActive(navRow2, l2Name);
      updateArchiveToggleBtn();
    } else {
      l2Active    = null;
      archiveMode = inArchived;
      btnNew.classList.remove('hidden');
      setActive(navRow2, '__root__');
      updateArchiveToggleBtn();
      const r2 = $maybe('btn-rename-folder-2');
      if (r2) r2.disabled = true;
    }
  }

  function mkNavBtn(label: any, onClick: any) {
    return createNavButton(label, onClick);
  }

  function mkRootNavBtn() {
    const btn = mkNavBtn('root', () => refreshFolderNavigation(l1Active?.name, null, true));
    btn.classList.add('nav-root-btn');
    btn.dataset.navKey = '__root__';
    btn.title = 'Files directly inside the selected top-level folder';
    return btn;
  }

  function mkNavNewBtn(row: any) {
    const btn = document.createElement('button');
    btn.id        = `btn-new-folder-${row}`;
    btn.className = 'nav-new-btn';
    btn.title     = row === 1 ? 'New top-level folder' : 'New subfolder';
    btn.innerHTML = SVG_NEW_FOLDER;
    btn.disabled  = isManagedSystemWorkspace();
    btn.addEventListener('click', () => openNewFolderModal(row));
    return btn;
  }

  function mkNavRenameBtn(row: any) {
    const btn = document.createElement('button');
    btn.id        = `btn-rename-folder-${row}`;
    btn.className = 'nav-rename-btn';
    btn.title     = row === 1 ? 'Rename selected folder' : 'Rename selected subfolder';
    btn.innerHTML = SVG_EDIT;
    btn.disabled  = isManagedSystemWorkspace() || (row === 1 ? !l1Active : !l2Active);
    btn.addEventListener('click', () => openRenameFolderModal(row));
    return btn;
  }

  function mkNavAllTasksBtn() {
    const btn = document.createElement('button');
    btn.id        = 'btn-all-tasks';
    btn.className = 'nav-all-tasks-btn nav-icon-task-btn';
    btn.title = withShortcutHint('Task listing', 'tasks.list');
    btn.setAttribute('aria-label', 'Task listing');
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 13h6M9 18h4"/><path d="m6.5 8 1 1 2-2" stroke="var(--green)"/><path d="m6.5 13 1 1 2-2" stroke="var(--yellow)"/></svg>`;
    btn.disabled  = isManagedSystemWorkspace();
    btn.addEventListener('click', () => void openTaskListing().catch(e => toast('Could not load tasks: ' + (e?.message || e), 'error')));
    return btn;
  }

  function mkNavWorkingTasksBtn() {
    const btn = document.createElement('button');
    btn.id        = 'btn-working-tasks';
    btn.className = 'nav-working-tasks-btn nav-icon-task-btn';
    btn.title = withShortcutHint('Working Task listing', 'tasks.working-list');
    btn.setAttribute('aria-label', 'Working Task listing');
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v13H4z" fill="var(--surface1)"/><path d="M4 7h16v13H4z"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="var(--peach)"/><circle cx="12" cy="13" r="2.4" fill="var(--green)" stroke="none"/><path d="M4 12h5m6 0h5" stroke="var(--yellow)"/></svg>`;
    btn.disabled  = isManagedSystemWorkspace();
    btn.addEventListener('click', () => void openWorkingListing().catch(e => toast('Could not load working tasks: ' + (e?.message || e), 'error')));
    return btn;
  }

  function syncReturnToTabButton() {
    const btn = $maybe('btn-return-to-tab');
    if (!btn) return;
    const dailyPath = currentDailyJournalPath();
    const target = dailyPath ? findTabByPath(dailyPath) : null;
    btn.disabled = !notesHandle;
    btn.classList.toggle('active', !!target && target.id === activeTabId && !editorView.classList.contains('hidden'));
    btn.title = withShortcutHint('Daily Journal', 'navigation.today');
    btn.setAttribute('aria-label', 'Daily Journal');
    btn.setAttribute('aria-keyshortcuts', comboFor('navigation.today') || '');
  }

  async function returnToLastSelectedTab() {
    await openTodayJournal();
  }

  function mkReturnToTabBtn() {
    const btn = document.createElement('button');
    btn.id = 'btn-return-to-tab';
    btn.type = 'button';
    btn.className = 'nav-return-tab-btn nav-journal-btn--vivid';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2.25" fill="var(--surface1)"/>
      <rect x="3" y="4" width="18" height="17" rx="2.25"/>
      <path d="M3 9h18" stroke="var(--peach)"/>
      <path d="M8 2.5v3M16 2.5v3" stroke="var(--red)"/>
      <path d="m9 14 2 2 4-4" stroke="var(--green)"/>
    </svg>`;
    btn.addEventListener('click', () => void returnToLastSelectedTab());
    requestAnimationFrame(syncReturnToTabButton);
    return btn;
  }

  // The header icon button (btnOutputsTop) is the only Outputs nav control now
  // that Outputs-Shared is gone, and syncOutputsTopButton() already keeps its
  // own active/hidden state in sync with outputsMode/outputsAvailable — so
  // "clearing" outputs nav-active state is just re-syncing that one button.
  function clearOutputsNavActive() {
    syncOutputsTopButton();
  }

  // ── Outputs mode ─────────────────────────────────────────────────────────────

  async function selectOutputs() {
    if (!outputsAvailable || !outputsHandle) return;
    if (!await checkUnsavedNewNote()) return;
    if (!await autoSaveIfDirty()) return;

    outputsMode         = true;
    returnToOutputs     = false;
    allTasksMode        = false;
    isOutputsFile       = false;
    currentOutputsFh    = null;
    currentOutputsDirFh = null;
    isExternalFile      = false;
    currentExternalPath = null;
    currentExternalFileHandle = null;
    l1Active    = null;
    l2Active    = null;
    archiveMode = false;

    const allTasksBtn = $maybe('btn-all-tasks');
    if (allTasksBtn) allTasksBtn.classList.remove('active');
    updateAllTasksGroupingModeBtn();
    navRow1.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    syncOutputsTopButton();

    const r1Rename = $maybe('btn-rename-folder-1');
    if (r1Rename) r1Rename.disabled = true;

    navRow2.classList.remove('nav-row-disabled');
    btnNew.disabled = true;
    btnNew.classList.add('hidden');

    await populateOutputsNavRow2();
  }

  async function populateOutputsNavRow2() {
    navRow2.innerHTML = '';
    navRow2.classList.remove('hidden');

    try {
      const subs = await listDirs(outputsHandle!);
      subs.forEach(f => navRow2.appendChild(mkNavBtn(f.name, () => selectOutputsFolder(f))));
      if (subs.length) {
        await selectOutputsFolder(subs[0]);
      } else {
        showView('list');
        listHeading.textContent = 'Outputs';
        fileGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">No output folders found.</div></div>`;
      }
    } catch (e: any) {
      toast('Could not load Outputs: ' + e.message, 'error');
    }
  }

  async function selectOutputsFolder(folder: any) {
    if (!await checkUnsavedNewNote()) return;
    outputsActiveFolder = folder;
    setActive(navRow2, folder.name);
    await loadOutputsFiles(folder);
  }

  async function loadOutputsFiles(folder: any) {
    showView('list');
    updateAllTasksGroupingModeBtn();
    listHeading.textContent = folder.name;
    fileGrid.innerHTML = '';

    try {
      let raw;
      if (window.__recallstackNative?.active) {
        // folder.handle is a NativeExternalDirectoryHandle (see
        // externalDirectoryHandle() in desktop-bridge.ts) whose .path is
        // already the folder's absolute OS path — the Outputs folder can be
        // anywhere on disk now, so there's no workspace-relative path to
        // reconstruct here the way there used to be.
        const basePath = (folder.handle as { path: string }).path;
        const entries = await window.__recallstackNative!.listExternalFilesRecursive(basePath);
        raw = entries.map(entry => {
          const subPath = entry.path.slice(basePath.length).replace(/^\/+/, '');
          const parentPath = entry.path.split('/').slice(0, -1).join('/');
          return {
            name: entry.name,
            handle: window.__recallstackNative!.externalFileHandle(entry.path, entry),
            dirHandle: window.__recallstackNative!.externalDirectoryHandle(parentPath),
            mtime: entry.modifiedAt,
            subPath,
          };
        });
      } else {
        raw = await listOutputFiles(folder.handle);
      }
      if (!raw.length) {
        fileGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">No files here yet.</div></div>`;
        return;
      }

      renderOutputFiles(fileGrid, raw, sortMode, esc, {
        openMarkdown: openOutputsFile,
        openOther: openInboxNonMdFile,
      });
    } catch (e: any) {
      toast('Could not load outputs files: ' + e.message, 'error');
    }
  }

  async function openOutputsFile(f: any, event?: MouseEvent) {
    const outputsPath = outputDocumentPath(outputsActiveFolder!.name, f.subPath);
    return openOutputsFileInTab(outputsPath, f, isPinnedClick(event));
  }

  // Tab-aware entry point for Outputs-mode files — mirrors openFileInTab().
  async function openOutputsFileInTab(outputsPath: any, fileEntry: any, pinned = false) {
    const existing = findTabByPath(outputsPath);
    if (existing) {
      if (pinned && !existing.pinned) { existing.pinned = true; renderTabStrip(); }
      return activateTab(existing.id);
    }
    if (!await checkUnsavedNewNote()) return false;
    if (!await autoSaveIfDirty()) return false;
    syncActiveTabFromState();
    const { tab, previousActiveId, isNewTab } = claimTabSlot(pinned, {
      path: outputsPath, title: fileEntry.name.replace(/\.md$/i, ''), isNew: false, dirty: false,
      isOutputsFile: true, outputsFileHandle: fileEntry.handle, outputsDirHandle: fileEntry.dirHandle,
      returnToOutputs: true, returnToAllTasks: false,
      isExternalFile: false, externalPath: null, externalFileHandle: null,
    });
    const ok = await loadOutputsFileIntoEditor(tab, fileEntry);
    if (!ok) {
      if (isNewTab) tabs = tabs.filter(t => t.id !== tab.id);
      activeTabId = previousActiveId;
      renderTabStrip();
      return false;
    }
    syncActiveTabFromState();
    renderTabStrip();
    return true;
  }

  // Loads an Outputs-mode file into the shared editor/preview. fileEntry (with
  // its live FileSystemFileHandle/dirHandle) is only available on first open
  // from the file card; reactivating a backgrounded tab reuses the handles
  // already stored on the tab record instead of re-scanning the folder.
  async function loadOutputsFileIntoEditor(tab: any, fileEntry: any = null) {
    const handle       = fileEntry?.handle    || tab.outputsFileHandle;
    const dirHandle     = fileEntry?.dirHandle || tab.outputsDirHandle;
    const outputsPath  = tab.path;
    try {
      const file    = await handle.getFile();
      const content = await file.text();

      currentPath         = outputsPath;
      isNew               = false;
      isOutputsFile       = true;
      currentOutputsFh    = handle;
      currentOutputsDirFh = dirHandle;
      returnToOutputs     = true;

      titleInput.value = outputsPath.split('/').at(-1)!.replace(/\.md$/i, '');
      savedContent     = content;
      let editorContent = content;

      const draft = await recoveryDraftGet(outputsPath);
      if (draft !== null && draft !== content) {
        if (confirm('Unsaved draft found — restore changes?')) {
          editorContent = draft;
          savedContent   = content;
        } else {
          lsDraftClear(outputsPath);
        }
      }

      await mdEditor.openDocument(outputsPath, editorContent, 0);
      currentBacklinks = [];
      previewOut.innerHTML = '';
      previewOut.scrollTop = 0;
      previewScheduler.cancel();
      setPreviewMarkdown(content);
      postProcessPreview();

      btnDelete.classList.remove('hidden');
      btnMove.classList.remove('hidden');
      btnArchive.classList.add('hidden');
      btnMakeCopy.classList.add('hidden');
      btnConvertToNote.classList.add('hidden');
      btnNewFromEditor.classList.add('hidden');
      btnStampDate.classList.add('hidden');

      showView('editor');
      showTaskDateBar();
      applyJournalToolbarRestrictions();
      updateConvertToTaskBtn();
      return true;
    } catch (e: any) {
      if (e?.name === 'NotFoundError' && outputsActiveFolder) {
        toast('Output file no longer exists; refreshed Outputs.', 'error');
        await loadOutputsFiles(outputsActiveFolder);
        return false;
      }
      toast('Could not open file: ' + e.message, 'error');
      return false;
    }
  }

  // ── External / temporary files (Open / Import Files) ─────────────────────────
  // Mirrors the Outputs tab pattern above: a "special-source" tab whose file
  // lives outside the normal workspace-relative path model. The tab is keyed
  // by the absolute OS path (Tauri desktop mode) or a synthetic key derived
  // from the browser FileSystemFileHandle (browser mode, which has no path).
  function externalTabPathKey(selection: OpenImportSelection): string {
    return selection.nativePath || `external-handle:${selection.key}`;
  }

  async function openExternalFileInTab(selection: OpenImportSelection, pinned = true) {
    const pathKey = externalTabPathKey(selection);
    const existing = findTabByPath(pathKey);
    if (existing) {
      if (pinned && !existing.pinned) { existing.pinned = true; renderTabStrip(); }
      return activateTab(existing.id);
    }
    if (!await checkUnsavedNewNote()) return false;
    if (!await autoSaveIfDirty()) return false;
    syncActiveTabFromState();
    const { tab, previousActiveId, isNewTab } = claimTabSlot(pinned, {
      path: pathKey, title: selection.name.replace(/\.md$/i, ''), isNew: false, dirty: false,
      isOutputsFile: false, outputsFileHandle: null, outputsDirHandle: null, returnToOutputs: false, returnToAllTasks: false,
      isExternalFile: true, externalPath: selection.nativePath, externalFileHandle: selection.browserHandle,
    });
    const ok = await loadExternalFileIntoEditor(tab);
    if (!ok) {
      if (isNewTab) tabs = tabs.filter(t => t.id !== tab.id);
      activeTabId = previousActiveId;
      renderTabStrip();
      return false;
    }
    syncActiveTabFromState();
    renderTabStrip();
    return true;
  }

  // Loads a "Temporary" external file into the shared editor/preview. Content is
  // read fresh each time (fileEntry-equivalent handles/paths live on the tab
  // record itself, so re-activating a backgrounded tab just re-reads from there).
  async function loadExternalFileIntoEditor(tab: EditorTab) {
    const handle = tab.externalFileHandle;
    const path   = tab.externalPath;
    try {
      let content: string;
      if (handle) {
        const file = await handle.getFile();
        content = await file.text();
      } else if (path && window.__recallstackNative?.active) {
        content = await window.__recallstackNative!.externalReadText(path);
      } else {
        throw new Error('This external file is no longer available');
      }

      currentPath               = tab.path;
      isNew                     = false;
      isExternalFile            = true;
      currentExternalPath       = path;
      currentExternalFileHandle = handle;

      titleInput.value = tab.title;
      savedContent      = content;
      let editorContent = content;

      const draft = await recoveryDraftGet(tab.path!);
      if (draft !== null && draft !== content) {
        if (confirm('Unsaved draft found — restore changes?')) {
          editorContent = draft;
          savedContent   = content;
        } else {
          lsDraftClear(tab.path!);
        }
      }

      await mdEditor.openDocument(tab.path!, editorContent, 0);
      currentBacklinks = [];
      previewOut.innerHTML = '';
      previewOut.scrollTop = 0;
      previewScheduler.cancel();
      setPreviewMarkdown(content);
      postProcessPreview();

      // Temporary files are edited in place at their original OS location and
      // must never be archivable. Move behaves like Import instead of the
      // normal in-workspace move (see openMoveFileModal()/moveCurrentFile()).
      // Delete isn't offered either — RecallStack doesn't own this file.
      btnDelete.classList.add('hidden');
      btnMove.classList.remove('hidden');
      btnArchive.classList.add('hidden');
      btnMakeCopy.classList.add('hidden');
      btnConvertToNote.classList.add('hidden');
      btnNewFromEditor.classList.add('hidden');
      btnStampDate.classList.add('hidden');

      showView('editor');
      showTaskDateBar();
      applyJournalToolbarRestrictions();
      updateConvertToTaskBtn();
      return true;
    } catch (e: any) {
      toast('Could not open file: ' + e.message, 'error');
      return false;
    }
  }

  function mkNavSeparator() {
    return createNavSeparator();
  }

  function updateAllTasksGroupingModeBtn(btn = $maybe('btn-all-tasks-mode')) {
    if (!btn) return;
    btn.classList.toggle('hidden', !allTasksMode || archiveMode);
    btn.classList.toggle('active', allTasksStatusMode);
    btn.title = allTasksStatusMode
      ? 'All Tasks: grouped by status/priority'
      : 'All Tasks: grouped by folder';
    btn.innerHTML = allTasksStatusMode ? SVG_TASK_STATUS : SVG_TASK_FOLDER;
  }

  function toggleAllTasksGroupingMode() {
    allTasksStatusMode = !allTasksStatusMode;
    if (activeWorkspace) {
      localStorage.setItem('pkm-all-tasks-mode-' + activeWorkspace, allTasksStatusMode ? 'status' : 'folder');
    }
    updateAllTasksGroupingModeBtn();
    if (allTasksMode) loadAllTasks();
  }

  function mkNav1Combo(folders: any) {
    return createNavCombo(1, folders, l1Active?.name || null, selected => refreshFolderNavigation(selected.name));
  }

  function mkNav2Combo(folders: any) {
    return createNavCombo(2, folders, l2Active?.name || null, selected => refreshFolderNavigation(l1Active?.name, selected.name));
  }

  // Populates nav-row-2 subfolder section (archive toggle, orphan assets, tasks btn,
  // separator, then other folders as buttons or combobox based on navRow2Mode).
  // Does NOT trigger selectL2 — caller is responsible for that.
  function populateNavRow2Contents(subs: any) {
    navRow2.appendChild(mkArchiveToggleBtn());
    navRow2.appendChild(mkOrphanAssetsBtn());
    navRow2.appendChild(mkNavSeparator());
    navRow2.appendChild(mkRootNavBtn());
    navRow2.appendChild(mkNavSeparator());
    const visibleFolders = subs.filter((f: any) => !SYSTEM_FOLDER_NAMES.has(String(f.name).toLowerCase()));
    if (visibleFolders.length > 0) {
      if (navRow2Mode === 'combo') {
        navRow2.appendChild(mkNav2Combo(visibleFolders));
      } else {
        visibleFolders.forEach((f: any) => navRow2.appendChild(mkNavBtn(f.name, () => refreshFolderNavigation(l1Active?.name, f.name))));
      }
    }
  }

  function updateNavModeBtns() {
    syncNavModeButtons(btnNav1Mode, btnNav2Mode, navRow1Mode, navRow2Mode);
  }

  function selectAllTasks(preserveArchiveMode = false) {
    if (isManagedSystemWorkspace()) return;
    allTasksMode        = true;
    returnToAllTasks    = false;
    outputsMode         = false;
    outputsActiveFolder = null;
    returnToOutputs     = false;
    isOutputsFile       = false;
    currentOutputsFh    = null;
    currentOutputsDirFh = null;
    isExternalFile      = false;
    currentExternalPath = null;
    currentExternalFileHandle = null;
    l1Active         = null;
    l2Active         = null;
    archiveMode      = preserveArchiveMode === true;
    const allTasksBtn = $maybe('btn-all-tasks');
    if (allTasksBtn) allTasksBtn.classList.add('active');
    clearOutputsNavActive();
    updateAllTasksGroupingModeBtn();
    navRow1.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const _nav1Combo = $maybe('nav1-combo');
    if (_nav1Combo) _nav1Combo.value = '';
    const _r1Rename = $maybe('btn-rename-folder-1');
    if (_r1Rename) _r1Rename.disabled = true;
    navRow2.innerHTML = '';
    navRow2.appendChild(mkArchiveToggleBtn());
    navRow2.classList.remove('hidden', 'nav-row-disabled');
    updateArchiveToggleBtn();
    btnNew.disabled = false;
    btnNew.classList.toggle('hidden', archiveMode);
    loadAllTasks().catch(e => toast('Load failed: ' + e.message, 'error'));
  }

  async function loadAllTasks() {
    const loadGeneration = ++listLoadGeneration;
    if (!editorView.classList.contains('hidden') && !await checkUnsavedNewNote()) return;
    showView('list');
    btnViewJournal.classList.add('hidden');
    listHeading.textContent = archiveMode ? 'Archived Tasks' : 'All Tasks';
    updateAllTasksGroupingModeBtn();

    const entries: any[] = [];
    const workingEntries: any[] = [];
    let tasksHandle: FileSystemDirectoryHandle;

    try {
      tasksHandle = await notesHandle!.getDirectoryHandle(TASKS_ROOT, { create: true });
    } catch (error: any) {
      toast('Could not open workspace tasks folder: ' + (error?.message || error), 'error');
      return;
    }

    if (archiveMode) {
      try {
        const archivedHandle = await tasksHandle.getDirectoryHandle('archived', { create: true });
        const archivedFiles = await Promise.all((await listMdFiles(archivedHandle)).map(enrichFileContent));
        archivedFiles.forEach(file => entries.push({ tasksHandle, file, inArchived: true }));
      } catch (error: any) {
        toast('Could not open archived tasks folder: ' + (error?.message || error), 'error');
        return;
      }
    } else if (window.__recallstackNative?.active) {
      const prefix = DB_WS_PREFIX.startsWith('Data/') ? DB_WS_PREFIX.slice(5) : DB_WS_PREFIX;
      const nativeTasks = await window.__recallstackNative!.tasks(prefix);
      for (const item of nativeTasks) {
        const file = {
          name: item.name,
          mtime: item.modifiedAt,
          content: item.content,
          handle: window.__recallstackNative!.fileHandle(DB_WS_PREFIX + item.path, {
            name: item.name,
            modifiedAt: item.modifiedAt,
          }),
        };
        const target = { tasksHandle, file, inWorking: item.inWorking };
        if (item.inWorking) workingEntries.push(target);
        else entries.push(target);
      }
    } else {
      const raw = await listMdFiles(tasksHandle);
      const allEnriched = await Promise.all(raw.map(enrichFileContent));
      allEnriched.forEach(file => entries.push({ tasksHandle, file }));
      try {
        const workingHandle = await tasksHandle.getDirectoryHandle('working');
        const workingFiles = await Promise.all((await listMdFiles(workingHandle)).map(enrichFileContent));
        workingFiles.forEach(file => workingEntries.push({ tasksHandle, file, inWorking: true }));
      } catch {
        // The Working subfolder is created on demand.
      }
    }

    if (loadGeneration !== listLoadGeneration) return;
    if (!entries.length && !workingEntries.length) {
      fileGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${archiveMode ? '📦' : '✅'}</div>
          <div class="empty-text">${archiveMode ? 'No archived task files found.' : 'No task files found in the workspace tasks folder.'}</div>
        </div>`;
      return;
    }

    if (archiveMode) workingEntries.length = 0;

    const openTaskEntry = async (item: any, event?: MouseEvent) => {
      if (!await autoSaveIfDirty()) return;
      l1Active         = null;
      l2Active         = null;
      archiveMode      = !!item.inArchived;
      returnToAllTasks = true;
      openFile(item.file.name, `${TASKS_ROOT}/${item.inArchived ? 'archived/' : item.inWorking ? 'working/' : ''}${item.file.name}`, { pinned: isPinnedClick(event) });
    };
    const sourceLabel = (_item: any) => TASKS_ROOT;

    const taskBuckets = partitionTasksBySuffix(entries, (item: any) => item.file.name, (item: any) => item.file.content);
    const hasSpecialSections = !!(taskBuckets.deployment.length || taskBuckets.qaReview.length || taskBuckets.deployed.length || taskBuckets.completed.length || taskBuckets.backlog.length);

    fileGrid.innerHTML = '';
    renderTaskCountBar({
      rest:       taskBuckets.rest.map(i => i.file.name),
      completed:  taskBuckets.completed.map(i => i.file.name),
      qaReview:   taskBuckets.qaReview.map(i => i.file.name),
      deployment: taskBuckets.deployment.map(i => i.file.name),
      deployed:   taskBuckets.deployed.map(i => i.file.name),
      backlog:    taskBuckets.backlog.map(i => i.file.name),
    });

    if (!archiveMode) {
      appendTaskSection('Working Tasks', sortTaskEntries(workingEntries),
        (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), {
          rootParts: [TASKS_ROOT], inWorking: true, reload: loadAllTasks,
        }), 'tasks-section-working');
    }

    if (allTasksStatusMode) {
      const byStatus = new Map();
      taskBuckets.rest.forEach(item => {
        const status = normalizeTaskPriority(taskMetaFor(item.file.name, item.file.content || '').priority);
        if (!byStatus.has(status)) byStatus.set(status, []);
        byStatus.get(status).push(item);
      });

      const statuses = [...byStatus.keys()].sort((a, b) => {
        const pa = PRIORITY_ORDER[a] ?? 99;
        const pb = PRIORITY_ORDER[b] ?? 99;
        if (pa !== pb) return pa - pb;
        return taskPriorityLabel(a).localeCompare(taskPriorityLabel(b));
      });

      statuses.forEach(status => {
        const items = byStatus.get(status);
        const section = document.createElement('div');
        section.className = `tasks-section tasks-section-status tasks-section-status-${status}`;

        const header = document.createElement('div');
        header.className = 'tasks-section-header';
        header.innerHTML = `
          <span class="tasks-section-title">${esc(taskPriorityLabel(status))}</span>
          <span class="tasks-section-count">${items.length} task${items.length !== 1 ? 's' : ''}</span>`;
        section.appendChild(header);

        sortTaskFiles(items.map((item: any) => item.file)).forEach(file => {
          const item = items.find((candidate: any) => candidate.file === file);
          section.appendChild(buildTaskCard(file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), archiveMode ? null : {
            rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
          }));
        });

        fileGrid.appendChild(section);
      });
    } else {
      appendTaskSection('Tasks', sortTaskEntries(taskBuckets.rest),
        (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), '', archiveMode ? null : {
          rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
        }));
    }

    if (hasSpecialSections) appendSectionDivider();

    appendTaskSection('Completed', sortTaskEntries(taskBuckets.completed),
      (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), archiveMode ? null : {
        rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
      }));
    appendTaskSection('In QA Review', sortTaskEntries(taskBuckets.qaReview),
      (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), archiveMode ? null : {
        rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
      }));

    if (taskBuckets.deployment.length) {
      const deploymentDivider = document.createElement('div');
      deploymentDivider.className = 'tasks-section-deployment-divider';
      fileGrid.appendChild(deploymentDivider);
    }
    appendTaskSection('Marked for Deployment', sortTaskEntries(taskBuckets.deployment),
      (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), archiveMode ? null : {
        rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
      }));

    if (taskBuckets.deployed.length) {
      const deployedDivider = document.createElement('div');
      deployedDivider.className = 'tasks-section-deployed-divider';
      fileGrid.appendChild(deployedDivider);
    }
    appendTaskSection('Deployed', sortTaskEntries(taskBuckets.deployed),
      (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), archiveMode ? null : {
        rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
      }));

    if (taskBuckets.backlog.length) {
      const backlogDivider = document.createElement('div');
      backlogDivider.className = 'tasks-section-backlog-divider';
      fileGrid.appendChild(backlogDivider);
    }
    appendTaskSection('Backlog / Deferred', sortTaskEntries(taskBuckets.backlog),
      (item: any) => buildTaskCard(item.file, (event: MouseEvent) => openTaskEntry(item, event), sourceLabel(item), archiveMode ? null : {
        rootParts: [TASKS_ROOT], inWorking: false, reload: loadAllTasks,
      }));
  }

  function setActive(row: any, name: any) {
    setActiveNavigation(row, name);
  }

  // ── Task date helpers ─────────────────────────────────────────────────────────

  function buildTaskCard(f: any, onClickFn: (event: MouseEvent) => void, folderName = '', taskLocation: TaskLocation | null = null) {
    const { priority, startDate, completedDate, dueDate } = taskMetaFor(f.name, f.content || '');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── Filename colour + completed / elapsed annotation ──
    let nameStyle      = '';
    let annotationHtml = '';

    if (completedDate) {
      nameStyle = 'color:var(--overlay0)';
      const completedParsed = parseDateLocal(completedDate);
      if (completedParsed) {
        annotationHtml = `<span style="color:var(--overlay0);font-size:11px;white-space:nowrap;flex-shrink:0"> — completed on: ${esc(completedDate)}</span>`;
      } else {
        annotationHtml = `<span style="color:var(--red);font-size:11px;white-space:nowrap;flex-shrink:0"> — completed on: NOT VALID DATE</span>`;
      }
    } else if (startDate) {
      nameStyle = 'color:var(--green)';
      const start = parseDateLocal(startDate);
      if (start) {
        const elapsed = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
        annotationHtml = `<span style="color:var(--lavender);font-size:11px;white-space:nowrap;flex-shrink:0">(${elapsed} day${elapsed !== 1 ? 's' : ''} elapsed)</span>`;
      } else {
        annotationHtml = `<span style="color:var(--red);font-size:11px;white-space:nowrap;flex-shrink:0">(Start Date NOT VALID DATE)</span>`;
      }
    }

    // ── Due date badge ──
    let dueDateHtml = '';
    if (dueDate) {
      if (completedDate) {
        // Task done — gray out the due date (validity doesn't matter visually)
        const dueTxt = parseDateLocal(dueDate) ? esc(dueDate) : 'NOT VALID DATE';
        dueDateHtml = `<span style="color:var(--overlay0);font-size:11px;font-family:monospace;white-space:nowrap;flex-shrink:0">${dueTxt}</span>`;
      } else {
        const due = parseDateLocal(dueDate);
        if (due) {
          const daysUntil = Math.floor((due.getTime() - today.getTime()) / 86400000);
          let dueStyle;
          if (daysUntil < 0)       dueStyle = 'color:var(--red);font-weight:700';   // overdue
          else if (daysUntil <= 2) dueStyle = 'color:var(--pink)';                  // due soon
          else                     dueStyle = 'color:var(--sapphire)';              // future
          dueDateHtml = `<span style="${dueStyle};font-size:11px;font-family:monospace;white-space:nowrap;flex-shrink:0">${esc(dueDate)}</span>`;
        } else {
          dueDateHtml = `<span style="color:var(--red);font-size:11px;font-family:monospace;white-space:nowrap;flex-shrink:0">Due: NOT VALID DATE</span>`;
        }
      }
    }

    // ── Priority background + icon ──
    const prio = normalizeTaskPriority(priority);
    const card = document.createElement('div');
    card.className = 'file-card';
    if (prio === 'high')         card.classList.add('task-card-high');
    else if (prio === 'normal')  card.classList.add('task-card-normal');
    else if (prio === 'low')     card.classList.add('task-card-low');
    else if (prio === 'blocked') card.classList.add('task-card-blocked');
    else if (prio === 'onhold')  card.classList.add('task-card-onhold');

    const PRIO_ICON: Record<string, { color: string; svg: string; title: string }> = {
      high:    { color: 'var(--red)',      svg: '<path d="M17 11l-5-5-5 5"/><path d="M17 17l-5-5-5 5" opacity=".45"/>',                                                                                     title: 'High priority' },
      normal:  { color: 'var(--blue)',     svg: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',                                                                                        title: 'Normal priority' },
      low:     { color: 'var(--green)',    svg: '<path d="M7 7l5 5 5-5" opacity=".45"/><path d="M7 13l5 5 5-5"/>',                                                                                          title: 'Low priority' },
      blocked: { color: 'var(--overlay1)', svg: '<circle cx="12" cy="12" r="9"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',                                                                        title: 'Blocked' },
      onhold:  { color: 'var(--yellow)',   svg: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>', title: 'On hold' },
    };
    const pi = PRIO_ICON[prio] || PRIO_ICON.normal;
    const prioIconHtml = `<span class="file-icon" style="color:${pi.color};display:inline-flex;align-items:center;flex-shrink:0" title="${pi.title}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${pi.svg}</svg></span>`;

    const folderPrefixHtml = folderName ? `<span class="task-folder-prefix">${esc(folderName)}</span>` : '';
    const taskKindHtml = taskLocation && !completedDate
      ? `<button type="button" class="task-kind-indicator task-card-kind-toggle${taskLocation.inWorking ? ' working' : ''}" title="${taskLocation.inWorking ? 'Working task — click to return it to Tasks' : 'Task — click to move it to Working'}" aria-label="${taskLocation.inWorking ? 'Working task — click to return it to Tasks' : 'Task — click to move it to Working'}">${taskKindIndicatorMarkup(taskLocation.inWorking)}</button>`
      : '';

    card.innerHTML = `
      ${folderPrefixHtml}
      ${prioIconHtml}
      <span class="file-name" style="${nameStyle}">${esc(taskDisplayTitle(f.name))}</span>
      ${annotationHtml}
      ${dueDateHtml}
      <span class="file-meta">${formatMtime(f.mtime)}</span>
      <span class="file-ext">.md</span>
      ${taskKindHtml}`;
    card.addEventListener('click', onClickFn);
    const toggle = card.querySelector<HTMLButtonElement>('.task-card-kind-toggle');
    if (toggle) toggle.addEventListener('click', async (e: any) => {
      e.stopPropagation();
      toggle.disabled = true;
      try { await toggleWorkingTaskFromList(f, taskLocation); }
      catch (err: any) { toast('Could not move task: ' + err.message, 'error'); toggle.disabled = false; }
    });
    return card;
  }

  // Read file content into an enriched entry { name, mtime, handle, content }
  async function enrichFileContent(f: any) {
    try {
      const content = await (await f.handle.getFile()).text();
      return { ...f, content };
    } catch {
      return { ...f, content: '' };
    }
  }

  // ── File list ─────────────────────────────────────────────────────────────────

  async function loadFiles(dirHandle: any, heading: any) {
    const loadGeneration = ++listLoadGeneration;
    showView('list');
    btnViewJournal.classList.add('hidden');
    updateAllTasksGroupingModeBtn();
    let targetHandle  = dirHandle;
    let targetHeading = heading;
    const isInbox     = heading === 'inbox';
    const isTasksFolder = heading === 'tasks';
    btnViewJournal.classList.toggle('hidden', !isTasksFolder);

    if (archiveMode) {
      targetHeading = heading + ' / archived';
      try {
        targetHandle = await dirHandle.getDirectoryHandle('archived');
        if (loadGeneration !== listLoadGeneration) return;
      } catch {
        if (loadGeneration !== listLoadGeneration) return;
        listHeading.textContent = targetHeading;
        fileGrid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <div class="empty-text">No archived files here yet.</div>
          </div>`;
        return;
      }
    }

    listHeading.textContent = targetHeading;

    if (isInbox) {
      const raw = await listAllFiles(targetHandle);
      if (loadGeneration !== listLoadGeneration) return;
      if (!raw.length) {
        renderEmptyFileList(fileGrid, '📂', 'No files here yet.');
        return;
      }
      renderInboxFileGroups(fileGrid, raw, sortMode, esc, {
        openMarkdown: (file, event) => openFile(file.name, undefined, { pinned: isPinnedClick(event) }),
        openOther: file => openInboxNonMdFile(file),
        deleteOther: file => openInboxDeleteModal(file, targetHandle, () => loadFiles(dirHandle, heading)),
      });
      return;
    }

    const raw = await listMdFiles(targetHandle);
    let workingTasks: any[] = [];
    if (isTasksFolder && !archiveMode) {
      try {
        const workingHandle = await targetHandle.getDirectoryHandle('working');
        workingTasks = await Promise.all((await listMdFiles(workingHandle)).map(enrichFileContent));
      } catch {
        // A tasks folder does not need a working/ subfolder until its first working task.
      }
    }
    if (loadGeneration !== listLoadGeneration) return;
    if (!raw.length && !workingTasks.length) {
      renderEmptyFileList(fileGrid, '📂', 'No notes here yet. Hit <strong>+ New Note</strong> to create one.');
      return;
    }
    let enriched;
    let taskBuckets = partitionTasksBySuffix([], (file: any) => file.name, (file: any) => file.content);
    if (isTasksFolder) {
      const allEnriched = await Promise.all(raw.map(enrichFileContent));
      taskBuckets = partitionTasksBySuffix(allEnriched, (f: any) => f.name, (f: any) => f.content);
      enriched = sortTaskFiles(taskBuckets.rest);
    } else {
      enriched = sortFiles(raw);
    }
    if (loadGeneration !== listLoadGeneration) return;

    const hasTaskSections = isTasksFolder
      && (taskBuckets.deployment.length || taskBuckets.qaReview.length || taskBuckets.deployed.length || taskBuckets.completed.length || taskBuckets.backlog.length);

    if (!enriched.length && !hasTaskSections && !workingTasks.length) {
      renderEmptyFileList(fileGrid, '📂', 'No notes here yet. Hit <strong>+ New Note</strong> to create one.');
      return;
    }

    fileGrid.innerHTML = '';
    if (isTasksFolder) {
      if (!archiveMode) {
        renderTaskCountBar({
          rest:       enriched.map(f => f.name),
          completed:  taskBuckets.completed.map(f => f.name),
          qaReview:   taskBuckets.qaReview.map(f => f.name),
          deployment: taskBuckets.deployment.map(f => f.name),
          deployed:   taskBuckets.deployed.map(f => f.name),
          backlog:    taskBuckets.backlog.map(f => f.name),
        });
      }
      appendTaskSection('Working Tasks', sortTaskFiles(workingTasks),
      (f: any) => buildTaskCard(f, (event: MouseEvent) => openFile(f.name, `${activeFolderPath()}/working/${f.name}`, { pinned: isPinnedClick(event) }), '', {
        rootParts: activeFolderPath().split('/'), inWorking: true, reload: () => loadFiles(dirHandle, heading),
      }),
        'tasks-section-working');
      const mainTaskLocation = archiveMode ? null : {
        rootParts: activeFolderPath().split('/'), inWorking: false, reload: () => loadFiles(dirHandle, heading),
      };
      const mainTaskCard = (f: any) => buildTaskCard(f, (event: MouseEvent) => openFile(f.name, undefined, { pinned: isPinnedClick(event) }), '', mainTaskLocation);
      appendTaskSection('Tasks', enriched, mainTaskCard);
      appendTaskSection('Completed', sortTaskFiles(taskBuckets.completed), mainTaskCard);
      appendTaskSection('In QA Review', sortTaskFiles(taskBuckets.qaReview), mainTaskCard);
      if (taskBuckets.deployment.length) {
        const deploymentDivider = document.createElement('div');
        deploymentDivider.className = 'tasks-section-deployment-divider';
        fileGrid.appendChild(deploymentDivider);
      }
      appendTaskSection('Marked for Deployment', sortTaskFiles(taskBuckets.deployment), mainTaskCard);
      if (taskBuckets.deployed.length) {
        const deployedDivider = document.createElement('div');
        deployedDivider.className = 'tasks-section-deployed-divider';
        fileGrid.appendChild(deployedDivider);
      }
      appendTaskSection('Deployed', sortTaskFiles(taskBuckets.deployed), mainTaskCard);
      if (taskBuckets.backlog.length) {
        const backlogDivider = document.createElement('div');
        backlogDivider.className = 'tasks-section-backlog-divider';
        fileGrid.appendChild(backlogDivider);
      }
      appendTaskSection('Backlog / Deferred', sortTaskFiles(taskBuckets.backlog), mainTaskCard);
      return;
    }

    renderNoteCards(fileGrid, enriched, esc, (file, event) => openFile(file.name, undefined, { pinned: isPinnedClick(event) }));
  }

  function isRootLevelNotePath(path = currentPath) {
    const parts = path ? path.split('/') : [];
    return parts.length === 2 && !SYSTEM_FOLDER_NAMES.has(String(parts[0] || '').toLowerCase());
  }

  function isTaskNamespacePath(path = currentPath) {
    return (path?.split('/') ?? [])[0] === TASKS_ROOT;
  }

  function activeFolderPath() {
    const base = l2Active
      ? l1Active!.name + '/' + l2Active!.name
      : l1Active!.name;
    return archiveMode ? base + '/archived' : base;
  }

  function normalizeAppPath(path: any) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  }

  function isWindowsPlatform() {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    return /win/i.test(platform);
  }

  // Writes plain text to the clipboard. In the native desktop app this goes through
  // Tauri's clipboard-manager plugin (X11/Wayland directly) instead of
  // navigator.clipboard.writeText(), which on Linux routes through WebKitGTK's own
  // clipboard bridge and logs a harmless-looking but noisy "Gdk-WARNING: Error
  // writing selection data: Broken pipe" whenever a clipboard-history tool reads it.
  async function copyPlainText(text: any) {
    if (window.__recallstackNative?.active) return window.__recallstackNative!.writeClipboardText(text);
    return navigator.clipboard.writeText(text);
  }

  function normalizeWorkspaceRootPath(path: any) {
    return String(path || '').trim().replace(/[\\/]+$/, '');
  }

  function workspaceRootPathFromFileUrl() {
    if (location.protocol !== 'file:') return '';
    try {
      let path = decodeURIComponent(new URL(location.href).pathname || '');
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1); // Windows file URLs: /C:/...
      path = path.replace(/\\/g, '/');
      const appsIdx = path.toLowerCase().lastIndexOf('/apps/');
      path = appsIdx !== -1 ? path.slice(0, appsIdx) : path.replace(/\/[^/]*$/, '');
      if (/^[A-Za-z]:\//.test(path)) path = path.replace(/\//g, '\\');
      return normalizeWorkspaceRootPath(path);
    } catch {
      return '';
    }
  }

  function configuredWorkspaceRootPath() {
    return normalizeWorkspaceRootPath(localStorage.getItem(WORKSPACE_ROOT_PATH_KEY) || '');
  }

  function workspaceRootPathForClipboard() {
    if (window.__recallstackNative?.active) {
      const nativeRoot = normalizeWorkspaceRootPath(window.__recallstackNative!.workspaceRootPath() || '');
      if (nativeRoot) return nativeRoot;
    }
    let rootPath = configuredWorkspaceRootPath() || workspaceRootPathFromFileUrl();
    if (!rootPath) {
      rootPath = normalizeWorkspaceRootPath(prompt(
        'Enter the full path to the selected workspace root folder so RecallStack can copy full file paths.',
        isWindowsPlatform() ? (rootHandle?.name || 'C:\\path\\to\\workspace') : DEFAULT_WORKSPACE_ROOT_PATH
      ) || '');
      if (rootPath) localStorage.setItem(WORKSPACE_ROOT_PATH_KEY, rootPath);
    }
    return rootPath || '';
  }

  function nativePathJoin(rootPath: any, appPath: any) {
    const root = normalizeWorkspaceRootPath(rootPath);
    const relParts = normalizeAppPath(appPath).split('/').filter(Boolean);
    if (!root || !relParts.length) return root;
    const sep = (/^[A-Za-z]:[\\/]/.test(root) || /^\\\\/.test(root) || isWindowsPlatform()) ? '\\' : '/';
    return root + sep + relParts.join(sep);
  }

  function workspaceRootPrefixes() {
    return [configuredWorkspaceRootPath(), workspaceRootPathFromFileUrl(), DEFAULT_WORKSPACE_ROOT_PATH]
      .map(normalizeAppPath)
      .filter(Boolean);
  }

  function appLocalPathForCurrentFile() {
    if (!currentPath || isNew) return '';
    if (isOutputsFile || isExternalFile) return normalizeAppPath(currentPath);
    return normalizeAppPath((DB_WS_PREFIX || '') + currentPath);
  }

  function fullPathForCurrentFile() {
    // An external file's currentPath is already the real absolute OS path —
    // joining it with the workspace root again would double it up.
    if (isExternalFile) return currentPath || '';
    const appPath = appLocalPathForCurrentFile();
    return appPath ? nativePathJoin(workspaceRootPathForClipboard(), appPath) : '';
  }

  function markdownLinkLabelForCurrentFile() {
    const name = (titleInput.value || currentPath?.split('/').at(-1)! || 'Open in RecallStack')
      .replace(/\.md$/i, '');
    return name.replace(/([\\\[\]])/g, '\\$1');
  }

  function internalLinkForCurrentFile() {
    // #recallstack-open= links only resolve workspace-relative paths — an
    // external file has no such address to link to.
    if (isExternalFile) return '';
    const appPath = appLocalPathForCurrentFile();
    if (!appPath) return '';
    return `[${markdownLinkLabelForCurrentFile()}](#recallstack-open=${encodeURIComponent(appPath)})`;
  }

  async function openRecallStackPath(rawPath: any, pinned = false) {
    let appPath = normalizeAppPath(decodeURIComponent(String(rawPath || '')));
    for (const rootPrefix of workspaceRootPrefixes()) {
      if (appPath.startsWith(rootPrefix + '/')) {
        appPath = appPath.slice(rootPrefix.length + 1);
        break;
      }
    }
    if (!appPath || !appPath.toLowerCase().endsWith('.md')) {
      toast('RecallStack link is not a markdown file', 'error');
      return;
    }

    const parts = appPath.split('/').filter(Boolean);
    let wsName = '';
    let relPath = '';
    if (parts[0] === 'Data' && parts.length >= 3) {
      wsName = parts[1];
      relPath = parts.slice(2).join('/');
    } else if (SYSTEM_WORKSPACES.has(parts[0]) && parts.length >= 2) {
      wsName = parts[0];
      relPath = parts.slice(1).join('/');
    } else {
      wsName = activeWorkspace || '';
      relPath = appPath;
    }

    const ws = workspaces.find(w => w.name === wsName);
    if (!ws) {
      toast(`Workspace not available for link: ${wsName || appPath}`, 'error');
      return;
    }
    if (!await checkUnsavedNewNote()) return;
    if (!await autoSaveIfDirty()) return;
    if (activeWorkspace !== ws.name) await switchWorkspace(ws);
    await openFile(relPath.split('/').at(-1)!, relPath, { pinned });
  }

  function activeFolderHeading() {
    return l2Active ? l2Active!.name : 'root';
  }

  function isRootFolderActive() {
    return !!l1Active && !l2Active;
  }

  function activeDirHandle() {
    return l2Active ? l2Active!.handle : l1Active!.handle;
  }

  async function activeSaveDirHandle() {
    const base = activeDirHandle();
    return archiveMode ? base.getDirectoryHandle('archived', { create: true }) : base;
  }

  // ── Editor ────────────────────────────────────────────────────────────────────

  // Returns true (ok to navigate) or false (user wants to stay).
  // Call this before ANY action that leaves the editor.
  async function checkUnsavedNewNote() {
    if (!isNew) return true;
    if (!mdEditor.value.trim() || mdEditor.value === (savedContent ?? '')) return true;
    const save = confirm(
      'You have unsaved content in a new note.\n\n' +
      'OK — save it now (a title will be auto-generated if blank)\n' +
      'Cancel — go back and keep editing'
    );
    if (!save) return false;
    await saveNote();
    return true;
  }

  async function autoSaveIfDirty(silent = false) {
    if (isNew) return true;   // new notes are handled by checkUnsavedNewNote at navigation points
    if (!currentPath) return true;
    if (mdEditor.value === savedContent) return true;
    await saveNote(silent);
    return true;
  }

  // ── Tabs (Improvement 11, Phase 1) ──────────────────────────────────────────
  // One shared CodeMirror EditorView and one shared preview DOM node are reused
  // for every tab (Option A from the plan) — a tab switch re-runs the same
  // "load this file into the editor" logic that already ran for single-document
  // opens, just against a different path. Because every navigation away from a
  // tab is gated by checkUnsavedNewNote()/autoSaveIfDirty() below (exactly like
  // today's single-document flow), a *background* tab is always left in a clean,
  // saved-or-discarded state — so only the active tab can ever be "dirty".

  function findTabByPath(path: any) {
    return findTabForPath(tabs, path);
  }

  function activeTabRecord() {
    return findActiveTab(tabs, activeTabId);
  }

  // Today's journal file path, recomputed live from the current date. Only this
  // path is ever the locked/pinned "daily journal" — an older journal opened
  // for reference is an ordinary, closeable tab. protectedDailyJournalPath is
  // just a "the journal has been opened this session" marker and can hold a
  // stale date once the app has been left running past midnight, so protection
  // must not key off its value.
  function todaysDailyJournalPath(): string | null {
    return journalLocationForDate(currentTasksRootParts(), localTodayDateString())?.path || null;
  }

  function currentDailyJournalPath() {
    return todaysDailyJournalPath();
  }

  function isProtectedDailyJournalTab(tab: EditorTab | null | undefined) {
    return !!tab && !!protectedDailyJournalPath && !tab.isOutputsFile && !tab.isExternalFile
      && tab.path === todaysDailyJournalPath();
  }

  // Manual drag-to-reorder only applies to ordinary pinned tabs. The protected
  // daily journal (pinned=true internally, but position-locked) and the single
  // unpinned dynamic tab (position-locked right after the journal) both sit
  // outside that — see enforceDailyJournalTabPosition/enforceDynamicTabPosition.
  function isReorderableTab(tab: EditorTab | null | undefined) {
    return !!tab && tab.pinned && !isProtectedDailyJournalTab(tab);
  }

  function enforceDailyJournalTabPosition() {
    const dailyPath = protectedDailyJournalPath ? todaysDailyJournalPath() : null;
    if (!dailyPath) return;
    const index = tabs.findIndex(tab => !tab.isOutputsFile && !tab.isExternalFile && tab.path === dailyPath);
    if (index < 0) return;
    const [tab] = tabs.splice(index, 1);
    tab.pinned = true;
    tabs.unshift(tab);
  }

  // The single unpinned "dynamic" tab (if one exists) always sits immediately
  // after the daily journal tab (or at the very front, if no journal tab is
  // open) — never wherever it happened to be created or last land.
  function enforceDynamicTabPosition() {
    const dynamicIndex = tabs.findIndex(tab => !tab.pinned);
    if (dynamicIndex < 0) return;
    const targetIndex = tabs.some(isProtectedDailyJournalTab) ? 1 : 0;
    if (dynamicIndex === targetIndex) return;
    const [tab] = tabs.splice(dynamicIndex, 1);
    tabs.splice(targetIndex, 0, tab);
  }

  function enforceTabOrder() {
    enforceDailyJournalTabPosition();
    enforceDynamicTabPosition();
  }

  // Rewrites the paths of every open tab affected by a folder rename/move so
  // background tabs don't silently keep pointing at a location that no longer
  // exists. Workspace file paths only — outputs tabs are keyed by handle, not
  // by a workspace-relative path, so they're left untouched.
  function remapTabPaths(oldPrefix: any, newPrefix: any) {
    remapOpenTabPaths(tabs, oldPrefix, newPrefix, tabTitleForPath);
  }

  function tabTitleForPath(path: any, isOutputsFileFlag = false) {
    if (!path) return 'Untitled';
    const name = path.split('/').at(-1)!;
    if (isOutputsFileFlag) return name.replace(/\.md$/i, '');
    return isCurrentTaskPath(path) ? taskDisplayTitle(name) : name.replace(/\.md$/i, '');
  }

  // Writes the module-level "current document" state onto the active tab record.
  // Call this after loading a file into the editor, after saving, and right
  // before deactivating a tab. Returns true when the tab's dirty flag changed
  // (used to skip unnecessary tab-strip re-renders).
  function syncActiveTabFromState() {
    return syncTabFromDocument(activeTabRecord(), {
      path: currentPath, content: mdEditor.value, savedContent, isNew, isOutputsFile,
      outputsFileHandle: currentOutputsFh, outputsDirHandle: currentOutputsDirFh,
      returnToOutputs, returnToAllTasks,
      isExternalFile, externalPath: currentExternalPath, externalFileHandle: currentExternalFileHandle,
    }, tabTitleForPath);
  }

  // Moves `draggedId` in the `tabs` array to sit immediately before/after
  // `targetId` and re-renders. Ctrl+1-9 (jumpToTabIndex) and Ctrl+Tab
  // (switchToRelativeTab) both index straight into this same array, so they
  // automatically follow the new order — no separate bookkeeping needed.
  function reorderTabs(draggedId: any, targetId: any, placeAfter: any) {
    const dragged = tabs.find(tab => tab.id === draggedId);
    const target = tabs.find(tab => tab.id === targetId);
    // Only ordinary pinned tabs can be manually reordered — the journal tab is
    // position-locked first, and the dynamic tab is position-locked right after it.
    if (!isReorderableTab(dragged) || !isReorderableTab(target)) return;
    reorderOpenTabs(tabs, draggedId, targetId, placeAfter);
    enforceTabOrder();
  }

  // Small inline-SVG icon distinguishing a tab's file kind (task / journal /
  // regular note) at a glance in the tab strip. Reuses the same TASK and
  // JOURNAL glyphs as taskKindIndicatorMarkup() (minus its text label, which
  // is sized for the toolbar, not a compact tab chip). Outputs-mode tabs,
  // external/temporary tabs, and path-less (brand new, unsaved) tabs are
  // neither task nor note, so they get no icon rather than a misleading one.
  function tabKindIconMarkup(tab: any) {
    if (tab.isOutputsFile || tab.isExternalFile || !tab.path) return '';
    if (isCurrentTaskPath(tab.path)) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/></svg>';
    }
    if (isJournalNote(tab.path)) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2z"/><path d="M5 4v16a2 2 0 0 1 2-2h12M9 8h6M9 12h6"/></svg>';
    }
    // Plain note: minimal document-with-folded-corner glyph, distinct from the task checkmark-square.
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/></svg>';
  }

  // The pin-this-file button (where the Working Tasks toggle used to live, in
  // the editor pane's label row) only appears while the active tab is real and
  // not already pinned — clicking it pins the tab and the button disappears.
  function updatePinCurrentFileButton() {
    const tab = activeTabRecord();
    const pinnable = !!tab && !tab.pinned && !isProtectedDailyJournalTab(tab);
    btnPinCurrentFile.classList.toggle('hidden', !pinnable);
  }

  function renderTabStrip() {
    updatePinCurrentFileButton();
    if (!tabStripEl) return;
    tabStripEl.replaceChildren();
    syncReturnToTabButton();
    if (!tabs.length) { tabStripEl.classList.add('hidden'); return; }
    tabStripEl.classList.remove('hidden');
    tabs.forEach(tab => {
      const item = document.createElement('div');
      item.className = 'tab-strip-item'
        + (tab.id === activeTabId ? ' active' : '')
        + (tab.dirty ? ' dirty' : '')
        + (tab.pinned ? ' pinned' : '');
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab.id === activeTabId));
      item.tabIndex = 0;
      const protectedDailyJournal = isProtectedDailyJournalTab(tab);
      item.classList.toggle('protected-daily-journal', protectedDailyJournal);
      item.title = (tab.path || 'Untitled') + (protectedDailyJournal ? ' (today journal, pinned)' : tab.pinned ? ' (pinned)' : '');
      item.draggable = isReorderableTab(tab);
      const kindMarkup = tabKindIconMarkup(tab);
      const kindIcon = document.createElement('span');
      kindIcon.className = 'tab-kind-icon';
      kindIcon.innerHTML = kindMarkup;
      const dot = document.createElement('span');
      dot.className = 'tab-dirty-dot';
      dot.title = 'Unsaved changes';
      const label = document.createElement('span');
      label.className = 'tab-title';
      label.textContent = tab.title || 'Untitled';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close-btn';
      close.innerHTML = '&times;';
      close.title = protectedDailyJournal ? 'Today journal stays open' : 'Close tab';
      close.setAttribute('aria-label', protectedDailyJournal ? `${tab.title || 'Today journal'} is pinned and cannot be closed` : `Close ${tab.title || 'tab'}`);
      close.draggable = false; // don't let a mousedown on × start a tab drag instead of a click
      close.disabled = protectedDailyJournal;
      close.addEventListener('click', (e: any) => { e.stopPropagation(); closeTab(tab.id); });
      item.append(...(kindMarkup ? [kindIcon] : []), dot, label, close);
      item.addEventListener('click', () => activateTab(tab.id));
      item.addEventListener('keydown', (e: any) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(tab.id); }
      });
      // ── Drag-to-reorder (HTML5 DnD) ──────────────────────────────────────
      item.addEventListener('dragstart', (e: any) => {
        if (!isReorderableTab(tab)) { e.preventDefault(); return; }
        draggedTabId = tab.id;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(tab.id)); } catch { /* some hosts restrict setData; draggedTabId still tracks it */ }
      });
      item.addEventListener('dragend', () => {
        draggedTabId = null;
        tabStripEl.querySelectorAll('.tab-strip-item').forEach(el => el.classList.remove('dragging', 'drag-over-left', 'drag-over-right'));
      });
      item.addEventListener('dragover', (e: any) => {
        if (draggedTabId == null || draggedTabId === tab.id) return;
        if (!isReorderableTab(tab)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const placeAfter = (e.clientX - rect.left) > rect.width / 2;
        item.classList.toggle('drag-over-left', !placeAfter);
        item.classList.toggle('drag-over-right', placeAfter);
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over-left', 'drag-over-right'));
      item.addEventListener('drop', (e: any) => {
        e.preventDefault();
        item.classList.remove('drag-over-left', 'drag-over-right');
        if (draggedTabId == null || draggedTabId === tab.id) return;
        const rect = item.getBoundingClientRect();
        const placeAfter = (e.clientX - rect.left) > rect.width / 2;
        if (!isReorderableTab(tab)) return;
        reorderTabs(draggedTabId, tab.id, placeAfter);
        draggedTabId = null;
        renderTabStrip();
      });
      tabStripEl.appendChild(item);
    });
  }

  // Dropping past the last tab (empty strip space) moves the dragged tab to
  // the end. Bound once on the strip itself — renderTabStrip() only replaces
  // its children, so this container-level listener survives every re-render.
  tabStripEl?.addEventListener('dragover', (e: any) => {
    if (e.target !== tabStripEl || draggedTabId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  tabStripEl?.addEventListener('drop', (e: any) => {
    if (e.target !== tabStripEl || draggedTabId == null) return;
    e.preventDefault();
    const dragged = tabs.find(t => t.id === draggedTabId);
    const fromIdx = tabs.findIndex(t => t.id === draggedTabId);
    if (fromIdx !== -1 && isReorderableTab(dragged)) { const [moved] = tabs.splice(fromIdx, 1); tabs.push(moved); enforceTabOrder(); }
    draggedTabId = null;
    renderTabStrip();
  });

  // Marks the active tab dirty without serializing the whole editor document on
  // every keystroke. Save/open paths still call syncActiveTabFromState() to
  // recompute exact clean/dirty state when it matters.
  function updateActiveTabDirtyState() {
    const tab = activeTabRecord();
    if (!tab) return;
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabStrip();
    }
  }

  function removeTabRecord(tabId: any) {
    if (tabId == null) return;
    tabs = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) activeTabId = null;
    renderTabStrip();
  }

  // Clears the shared "current document" state and returns to the appropriate
  // list/search/outputs/all-tasks view — used when the last tab is closed.
  function showEmptyEditorState() {
    currentPath          = null;
    savedContent         = null;
    isNew                = false;
    isOutputsFile        = false;
    currentOutputsFh     = null;
    currentOutputsDirFh  = null;
    isExternalFile       = false;
    currentExternalPath  = null;
    currentExternalFileHandle = null;
    currentBacklinks     = [];
    mdEditor.openDocument('', '', 0);
    previewOut.replaceChildren();
    cancelEdit();
  }

  // Loads a regular workspace file's content into the shared editor/preview and
  // task chrome. Formerly the body of openFile(); now only responsible for the
  // "load" half — tab bookkeeping lives in openFileInTab()/activateTab().
  async function loadFileIntoEditor(notesRelPath: string, options: OpenFileOptions = {}) {
    try {
      const content = await readMdFile(notesRelPath);
      currentPath = notesRelPath;
      isNew       = false;
      // Unconditionally clear external-file state here rather than relying on
      // syncNavToPath()'s folder-change branches below — those only fire when
      // the navigation sidebar's active folder actually changes, which isn't
      // guaranteed (e.g. importing a temporary file into the folder that was
      // already active before it was opened).
      isExternalFile            = false;
      currentExternalPath       = null;
      currentExternalFileHandle = null;
      await syncNavToPath(notesRelPath);
      await loadAssetsForCurrentFile();
      titleInput.value = isCurrentTaskPath(notesRelPath) ? taskDisplayTitle(notesRelPath.split('/').at(-1)!) : notesRelPath.split('/').at(-1)!.replace(/\.md$/, '');
      savedContent     = content;
      let editorContent = content;
      const draft = await recoveryDraftGet(notesRelPath);
      if (draft !== null && draft !== content) {
        if (confirm('Unsaved draft found — restore changes?')) {
          editorContent = draft;
          savedContent = content; // keep restored draft dirty until explicitly saved
        } else {
          lsDraftClear(notesRelPath);
        }
      }
      const lastNewline = editorContent.lastIndexOf('\n', editorContent.length - 2);
      await mdEditor.openDocument(notesRelPath, editorContent, cursorAtEnd ? (lastNewline < 0 ? 0 : lastNewline + 1) : 0);
      currentBacklinks = [];
      // Immediately clear and render (don't debounce on file switch)
      previewOut.innerHTML = '';
      previewOut.scrollTop = 0;
      previewScheduler.cancel();
      setPreviewMarkdown(mdEditor.value);
      postProcessPreview();
      refreshBacklinks().then(appendBacklinks);
      // Show restore button when viewing a file inside an archived/ subfolder
      const inArchived = notesRelPath.split('/').at(-2) === 'archived';
      const archiveDisabledForRoot = !inArchived && isRootLevelNotePath(notesRelPath);
      btnArchive.innerHTML = inArchived ? SVG_RESTORE : SVG_ARCHIVE;
      btnArchive.title     = archiveDisabledForRoot ? 'Archive disabled for root notes' : (inArchived ? 'Restore to parent folder' : 'Archive');
      btnArchive.classList.remove('archive', 'restore');
      btnArchive.classList.add(inArchived ? 'restore' : 'archive');
      btnDelete.classList.remove('hidden');
      btnMove.classList.toggle('hidden', isTaskNamespacePath(notesRelPath));
      btnArchive.classList.toggle('hidden', archiveDisabledForRoot || isWorkingTask(notesRelPath));
      btnMakeCopy.classList.remove('hidden');
      btnNewFromEditor.classList.remove('hidden');
      btnStampDate.classList.remove('hidden');
      showView('editor');
      showTaskDateBar();
      updateConvertToTaskBtn();
      updateConvertToNoteBtn();
      applyJournalToolbarRestrictions();
      saveLastView('file', notesRelPath);
      return true;
    } catch (e: any) {
      const message = e?.message || String(e || 'Unknown file error');
      if (options.restoringLastView) {
        console.warn(`Skipped unavailable saved file "${notesRelPath}"`, e);
      } else {
        toast('Could not open file: ' + message, 'error');
      }
      return false;
    }
  }

  // Ctrl/Cmd+click pins the opened tab; a plain click opens (or retargets) the
  // single dynamic "preview" tab instead of accumulating a tab per click.
  function isPinnedClick(event?: { ctrlKey?: boolean; metaKey?: boolean } | null): boolean {
    return Boolean(event && (event.ctrlKey || event.metaKey));
  }

  // Shared by openFileInTab()/openOutputsFileInTab(): a pinned open always
  // adds a new tab. An unpinned open reuses the existing dynamic tab (there
  // is at most one) instead of creating another one.
  function claimTabSlot(pinned: boolean, fields: Omit<EditorTab, 'id' | 'pinned'>) {
    const previousActiveId = activeTabId;
    if (!pinned) {
      const dynamicTab = tabs.find(t => !t.pinned);
      if (dynamicTab) {
        Object.assign(dynamicTab, fields);
        activeTabId = dynamicTab.id;
        enforceTabOrder();
        return { tab: dynamicTab, previousActiveId, isNewTab: false };
      }
    }
    const tab: EditorTab = { id: nextTabId++, pinned, ...fields };
    tabs.push(tab);
    activeTabId = tab.id;
    enforceTabOrder();
    return { tab, previousActiveId, isNewTab: true };
  }

  // Tab-aware entry point: activates an already-open tab for this path instead
  // of duplicating it, otherwise settles the outgoing tab and opens a new one.
  async function openFileInTab(notesRelPath: string, options: OpenFileOptions = {}) {
    const pinned = options.pinned === true;
    const existing = findTabByPath(notesRelPath);
    if (existing) {
      if (pinned && !existing.pinned) { existing.pinned = true; renderTabStrip(); }
      return activateTab(existing.id);
    }
    if (!await checkUnsavedNewNote()) return false;
    if (!await autoSaveIfDirty()) return false;
    syncActiveTabFromState();
    const { tab, previousActiveId, isNewTab } = claimTabSlot(pinned, {
      path: notesRelPath, title: tabTitleForPath(notesRelPath), isNew: false, dirty: false,
      isOutputsFile: false, outputsFileHandle: null, outputsDirHandle: null, returnToOutputs: false, returnToAllTasks: false,
      isExternalFile: false, externalPath: null, externalFileHandle: null,
    });
    const ok = await loadFileIntoEditor(notesRelPath, options);
    if (!ok) {
      if (isNewTab) tabs = tabs.filter(t => t.id !== tab.id);
      activeTabId = previousActiveId;
      renderTabStrip();
      return false;
    }
    syncActiveTabFromState();
    enforceTabOrder();
    renderTabStrip();
    return true;
  }

  async function openFile(filename: string, fullNotesRelPath?: string, options: OpenFileOptions = {}) {
    const notesRelPath = fullNotesRelPath || (activeFolderPath() + '/' + filename);
    return openFileInTab(notesRelPath, options);
  }

  // Switches the shared editor/preview to another already-open tab, gated by
  // the same unsaved-changes flow as any other navigation away from a document.
  async function activateTab(tabId: any) {
    const target = tabs.find(t => t.id === tabId);
    if (!target) return false;
    // Lists, search, and calendar can be shown while the active tab remains
    // loaded in the shared editor. Selecting that same tab/file must reveal
    // the editor again even though no document reload is necessary.
    if (tabId === activeTabId) {
      showView('editor');
      return true;
    }
    if (!await checkUnsavedNewNote()) return false;
    if (!await autoSaveIfDirty()) return false;
    syncActiveTabFromState();
    activeTabId = tabId;
    const ok = target.isOutputsFile
      ? await loadOutputsFileIntoEditor(target)
      : target.isExternalFile
        ? await loadExternalFileIntoEditor(target)
        : await loadFileIntoEditor(target.path!, {});
    if (!ok) {
      // The file behind this tab is gone (e.g. deleted outside RecallStack) —
      // drop the tab and fall back to another one, or to an empty state.
      tabs = tabs.filter(t => t.id !== tabId);
      activeTabId = null;
      if (tabs.length) await activateTab(tabs[0].id);
      else showEmptyEditorState();
      renderTabStrip();
      return false;
    }
    syncActiveTabFromState();
    renderTabStrip();
    return true;
  }

  async function closeTab(tabId: any) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return false;
    if (isProtectedDailyJournalTab(tab)) {
      await activateTab(tab.id);
      toast('Today journal stays open', 'error');
      return false;
    }
    const wasActive = tabId === activeTabId;
    if (wasActive) {
      if (!await checkUnsavedNewNote()) return false;
      if (!await autoSaveIfDirty()) return false;
      syncActiveTabFromState();
    }
    const idx = tabs.findIndex(t => t.id === tabId);
    tabs.splice(idx, 1);
    rememberClosedTab(closedTabHistory, tab);
    if (wasActive) {
      activeTabId = null;
      if (tabs.length) {
        const nextIdx = Math.min(idx, tabs.length - 1);
        await activateTab(tabs[nextIdx].id);
      } else {
        showEmptyEditorState();
      }
    }
    renderTabStrip();
    await ensureJournalWhenEmpty();
    return true;
  }

  async function closeActiveTab() {
    if (activeTabId == null) return;
    await closeTab(activeTabId);
  }

  // Background tabs are always clean by construction (see note above), so
  // closing every tab but the active one needs no unsaved-changes prompts.
  function closeOtherTabs() {
    const keep = activeTabId;
    for (const tab of tabs.filter(t => t.id !== keep && !isProtectedDailyJournalTab(t))) {
      rememberClosedTab(closedTabHistory, tab);
    }
    tabs = tabs.filter(t => t.id === keep || isProtectedDailyJournalTab(t));
    enforceTabOrder();
    renderTabStrip();
  }

  async function switchToRelativeTab(delta: any) {
    const target = relativeTab(tabs, activeTabId, delta);
    if (target) await activateTab(target.id);
  }

  async function jumpToTabIndex(oneBasedIndex: any) {
    const tab = tabs[oneBasedIndex - 1];
    if (tab) await activateTab(tab.id);
  }

  async function reopenClosedTab() {
    const entry = closedTabHistory.pop()!;
    if (!entry) { toast('No recently closed tabs', 'error'); return; }
    await openFileInTab(entry.path);
  }

  // `+ New` and Ctrl+N both open the kind picker (Note / Task / Working Task).
  async function newNote() {
    openNewFileKindPicker();
  }

  async function createFileOfKind(kind: 'note' | 'task' | 'working') {
    if (kind === 'working') { await createWorkingTask(); return; }
    const createTask = kind === 'task';
    if (!createTask && !l1Active && !allTasksMode && !isJournalNote()) { toast('Select a folder first', 'error'); return; }
    // Save the current editor first, avoiding a later unsaved-changes prompt.
    if (!editorView.classList.contains('hidden') && (currentPath || isNew) && !await saveNote()) return;
    const dir = createTask ? await getDirHandle(notesHandle!, [TASKS_ROOT], true) : await activeSaveDirHandle();
    const folderPath = createTask ? TASKS_ROOT : activeFolderPath();
    const defaultFilename = await uniqueDatedTitleInDir(dir, kind);
    newFileModal.open({
      title: newMarkdownFileTitle(kind),
      defaultFilename,
      async create(value) {
        const filename = newMarkdownStoredFilename(value, kind);
        const nameError = portableNameError(filename);
        if (nameError) return nameError;
        if (await fileExistsInDir(dir, filename)) return `A file named "${filename}" already exists`;
        const path = folderPath + '/' + filename;
        await writeMdFile(path, '');
        updateSearchIndex(path, '');
        lsDraftClear(path);
        await openFile(filename, path);
        toast(createTask ? 'New task created' : 'New note created');
        return null;
      },
    });
  }

  async function saveNote(silent = false) {
    if (saveInProgress) {
      // An explicit save may arrive while the debounced silent autosave is
      // still writing. Reuse that write, but preserve the user's expectation
      // that clicking Save (or pressing Ctrl+S) produces success feedback.
      if (!silent) saveShouldNotify = true;
      return savePromise || false;
    }

    saveShouldNotify = !silent;

    // Temporary external file: save in place, back to its original OS location —
    // never into the workspace. Browser mode writes through the real
    // FileSystemFileHandle obtained at open time; Tauri desktop mode writes
    // through the external_fs_write_text command using the absolute path.
    if (isExternalFile) {
      saveInProgress = true;
      savePromise = (async () => {
        btnSave.textContent = 'Saving…';
        btnSave.disabled    = true;
        try {
          const content = mdEditor.value;
          if (currentExternalFileHandle) {
            const writable = await currentExternalFileHandle.createWritable();
            try { await writable.write(content); } finally { await writable.close(); }
          } else if (currentExternalPath && window.__recallstackNative?.active) {
            await window.__recallstackNative!.externalWriteText(currentExternalPath, content);
          } else {
            throw new Error('No writable location for this external file');
          }
          savedContent = content;
          syncActiveTabFromState();
          renderTabStrip();
          if (saveShouldNotify) toast('Saved ✓');
          return true;
        } catch (e: any) {
          toast('Save failed: ' + e.message, 'error');
          return false;
        } finally {
          saveInProgress      = false;
          savePromise         = null;
          saveShouldNotify    = false;
          btnSave.disabled    = false;
          btnSave.textContent = 'Save';
        }
      })();
      return savePromise;
    }

    // Outputs mode: save in-place directly to the outputs file handle
    if (isOutputsFile && currentOutputsFh) {
      saveInProgress = true;
      savePromise = (async () => {
        btnSave.textContent = 'Saving…';
        btnSave.disabled    = true;
        try {
          const content  = mdEditor.value;
          const writable = await currentOutputsFh.createWritable();
          try { await writable.write(content); } finally { await writable.close(); }
          savedContent = content;
          syncActiveTabFromState();
          renderTabStrip();
          lsDraftClear(currentPath);
          if (saveShouldNotify) toast('Saved ✓');
          return true;
        } catch (e: any) {
          toast('Save failed: ' + e.message, 'error');
          return false;
        } finally {
          saveInProgress      = false;
          savePromise         = null;
          saveShouldNotify    = false;
          btnSave.disabled    = false;
          btnSave.textContent = 'Save';
        }
      })();
      return savePromise;
    }

    saveInProgress = true;
    savePromise = (async () => {
      try {
        let title = titleInput.value.trim();
        // Journal filenames define their YYYY/MM daily-note identity and cannot be
        // renamed from the editor. Reassert the path-derived title at save time so
        // programmatic DOM changes cannot bypass the read-only control.
        const fixedJournalTitle = journalTitleFromPath(currentPath);
        if (fixedJournalTitle) {
          title = fixedJournalTitle;
          titleInput.value = fixedJournalTitle;
        }
        if (!title) {
          const now = new Date();
          const p = (n: any) => String(n).padStart(2, '0');
          title = `${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
          titleInput.value = title;
        }
        titleInput.classList.remove('error');

        const taskFile = isTasksEditor() || isCurrentTaskPath(currentPath);
        const taskMeta = taskMetaFor(currentPath?.split('/').at(-1)!, mdEditor.value);
        taskMeta.startDate = taskInputStart.value || null;
        taskMeta.completedDate = taskInputCompleted.value || null;
        taskMeta.dueDate = taskInputDue.value || null;
        taskMeta.priority = taskInputPriority.querySelector<HTMLElement>('.is-selected')?.dataset.priority || taskMeta.priority || 'normal';
        const filename = taskFile ? buildTaskFilename(title, {
          priority: taskMeta.priority ?? undefined,
          startDate: taskMeta.startDate ?? undefined,
          completedDate: taskMeta.completedDate ?? undefined,
          dueDate: taskMeta.dueDate ?? undefined,
        }) : (title.toLowerCase().endsWith('.md') ? title : title + '.md');
        const filenameError = portableNameError(filename);
        if (filenameError) {
          titleInput.classList.add('error');
          throw new Error(filenameError);
        }
        // An opened file (including a journal entry nested under tasks/journal)
        // always saves beside itself; only brand-new files use the active folder.
        const folderPath = currentPath ? currentPath!.split('/').slice(0, -1).join('/') : activeFolderPath();
        const dir = currentPath ? await getDirHandle(notesHandle!, folderPath.split('/'), true) : await activeSaveDirHandle();
        let   finalFilename = filename;
        let   notesRelPath = folderPath + '/' + finalFilename;
        const origPath     = isNew ? null : currentPath;
        const isRename     = !isNew && origPath !== notesRelPath;

        // Conflict: new file or rename collides with existing
        if (isNew || isRename) {
          finalFilename = await uniqueFilenameInDir(dir, filename);
          notesRelPath  = folderPath + '/' + finalFilename;
        }

        btnSave.textContent = 'Saving…';
        btnSave.disabled    = true;

        const content = taskFile ? removeLegacyTaskHeader(mdEditor.value) : mdEditor.value;
        await writeMdFile(notesRelPath, content);

        if (isRename && origPath) {
          await removeMdFile(origPath);
          removeFromSearchIndex(origPath);
        }

        updateSearchIndex(notesRelPath, content);

        // A completed working task immediately returns to its parent tasks folder.
        if (taskFile && taskMeta.completedDate && notesRelPath.split('/').includes('working')) {
          const parts = notesRelPath.split('/');
          const wi = parts.indexOf('working');
          const completedPath = await uniquePathInFolder(parts.slice(0, wi), parts.at(-1)!);
          await writeMdFile(completedPath, content);
          await removeMdFile(notesRelPath);
          removeFromSearchIndex(notesRelPath); updateSearchIndex(completedPath, content);
          notesRelPath = completedPath;
        }

        currentPath      = notesRelPath;
        isNew            = false;
        savedContent     = content;
        syncActiveTabFromState();
        renderTabStrip();
        removeExternalChangeBanner();
        lsDraftClear(notesRelPath);
        if (origPath && origPath !== notesRelPath) lsDraftClear(origPath);
        titleInput.value = taskFile ? taskDisplayTitle(notesRelPath.split('/').at(-1)!) : notesRelPath.split('/').at(-1)!.replace(/\.md$/i, '');
        const inArchived = notesRelPath.split('/').at(-2) === 'archived';
        const archiveDisabledForRoot = !inArchived && isRootLevelNotePath(notesRelPath);
        btnArchive.innerHTML = inArchived ? SVG_RESTORE : SVG_ARCHIVE;
        btnArchive.title     = archiveDisabledForRoot ? 'Archive disabled for root notes' : (inArchived ? 'Restore to parent folder' : 'Archive');
        btnArchive.classList.remove('archive', 'restore');
        btnArchive.classList.add(inArchived ? 'restore' : 'archive');
        btnDelete.classList.remove('hidden');
        btnMove.classList.toggle('hidden', isTaskNamespacePath(notesRelPath));
        btnArchive.classList.toggle('hidden', archiveDisabledForRoot || isWorkingTask(notesRelPath));
        btnMakeCopy.classList.remove('hidden');
        updateConvertToNoteBtn();
        applyJournalToolbarRestrictions();
        if (saveShouldNotify) toast('Saved ✓');
        if (isCurrentTaskFile()) refreshCalendarIfVisible();
        return true;
      } catch (e: any) {
        toast('Save failed: ' + e.message, 'error');
        return false;
      } finally {
        saveInProgress      = false;
        savePromise         = null;
        saveShouldNotify    = false;
        btnSave.disabled    = false;
        btnSave.textContent = 'Save';
      }
    })();
    return savePromise;
  }

  async function deleteNote() {
    if (!currentPath) return;
    // External/temporary files aren't owned by the workspace — there's no
    // RecallStack Trash to move them to, and deleting the user's original
    // file out from under them is out of scope for this editor-in-place mode.
    if (isExternalFile) {
      toast('External files can’t be deleted from RecallStack', 'error');
      return;
    }
    const name = currentPath!.split('/').at(-1)!;
    if (!confirm(`Move "${name}" to RecallStack Trash?`)) return;

    if (isOutputsFile && currentOutputsDirFh) {
      // Only the removal itself is essential — everything after it is either
      // in-memory state reset (can't throw) or the unconditional finishing
      // steps, so a caught failure here can only mean the removal failed.
      try {
        await currentOutputsDirFh.removeEntry(name);
      } catch (e: any) {
        toast('Delete failed: ' + e.message, 'error');
        return;
      }
      isOutputsFile       = false;
      currentOutputsFh    = null;
      currentOutputsDirFh = null;
      toast('Moved to Trash');
      removeTabRecord(activeTabId);
      await returnToDailyJournalAfterRemoval();
      return;
    }

    // Only removeMdFile() is essential to "did the delete succeed" — a
    // failure there, and only there, should produce "Delete failed" and skip
    // the rest. removeFromSearchIndex()/refreshCalendarIfVisible() are
    // best-effort housekeeping that must never mask an already-successful
    // removal or block cancelEdit() (the actual list refresh) from running —
    // see runBestEffort()'s doc comment for why this was previously broken.
    try {
      await removeMdFile(currentPath);
    } catch (e: any) {
      toast('Delete failed: ' + e.message, 'error');
      return;
    }
    runBestEffort([() => removeFromSearchIndex(currentPath!), refreshCalendarIfVisible]);
    toast('Moved to Trash');
    removeTabRecord(activeTabId);
    await returnToDailyJournalAfterRemoval();
  }

  async function archiveNote() {
    if (isWorkingTask()) return;
    if (!currentPath) return;
    // Temporary/external files must never be archivable (the button is hidden
    // while one is active — this guard covers the command palette too).
    if (isExternalFile) {
      toast('External files can’t be archived', 'error');
      return;
    }
    if (isRootLevelNotePath()) {
      toast('Archive is disabled for root notes', 'error');
      return;
    }
    const name = currentPath!.split('/').at(-1)!;
    if (!isTasksEditor() && !confirm(`Archive "${name}"?\n\nThe file will be moved to the archived/ subfolder.`)) return;
    // Only the write-then-remove pair is essential ("did the archive really
    // happen") — the search-index/calendar housekeeping after it is
    // best-effort and must not mask a successful archive or block
    // cancelEdit() (the list refresh). See runBestEffort()'s doc comment.
    let archivedRelPath: string;
    let content: string;
    try {
      if (!await saveNote()) return;
      const rawContent = mdEditor.value;
      // Rewrite asset links: assets/ → ../assets/ so they remain valid one level deeper
      content = rewriteAssetLinks(rawContent, '](assets/', '](../assets/');
      const parts = currentPath!.split('/');
      archivedRelPath = await uniquePathInFolder([...parts.slice(0, -1), 'archived'], parts.at(-1)!);
      await writeMdFile(archivedRelPath, content);
      await removeMdFile(currentPath);
    } catch (e: any) {
      toast('Archive failed: ' + e.message, 'error');
      return;
    }
    runBestEffort([
      () => removeFromSearchIndex(currentPath!),
      () => updateSearchIndex(archivedRelPath, content),
      refreshCalendarIfVisible,
    ]);
    toast('Archived ✓');
    if (isTaskNamespacePath(archivedRelPath)) archiveMode = false;
    removeTabRecord(activeTabId);
    await returnToDailyJournalAfterRemoval();
  }

  async function restoreNote() {
    if (isWorkingTask()) return;
    if (!currentPath) return;
    if (isExternalFile) return;
    // Same shape as archiveNote(): only the write-then-remove pair is
    // essential; search-index/calendar housekeeping is best-effort and must
    // not mask a successful restore or block cancelEdit(). See
    // runBestEffort()'s doc comment.
    let restoredPath: string;
    let content: string;
    try {
      if (!await saveNote()) return;
      const rawContent = mdEditor.value;
      // Rewrite asset links back: ../assets/ → assets/ so they remain valid one level up
      content = rewriteAssetLinks(rawContent, '](../assets/', '](assets/');
      const parts = currentPath!.split('/');
      // Remove the 'archived' segment: [...parent, filename]
      restoredPath = await uniquePathInFolder(parts.slice(0, -2), parts.at(-1)!);
      await writeMdFile(restoredPath, content);
      await removeMdFile(currentPath);
    } catch (e: any) {
      toast('Restore failed: ' + e.message, 'error');
      return;
    }
    runBestEffort([
      () => removeFromSearchIndex(currentPath!),
      () => updateSearchIndex(restoredPath, content),
      refreshCalendarIfVisible,
    ]);
    toast('Restored ✓');
    if (isTaskNamespacePath(restoredPath)) returnToAllTasks = true;
    archiveMode = false;
    btnNew.classList.remove('hidden');
    updateArchiveToggleBtn();
    removeTabRecord(activeTabId);
    cancelEdit();
  }

  function refreshCalendarIfVisible() {
    if (!calViewEl.classList.contains('hidden')) {
      buildCalTaskMap();
      renderCalendar();
    }
  }

  // ── Move File ────────────────────────────────────────────────────────────────

  function isCurrentTaskFile() {
    const parts = currentPath?.split('/') ?? [];
    return parts.includes('tasks');
  }

  function isTaskSpecificMove() {
    // An external/temporary file's absolute OS path may incidentally contain a
    // "tasks" path segment (e.g. .../Documents/tasks/todo.md) — that must never
    // be mistaken for a workspace task move.
    return !isExternalFile && isCurrentTaskFile() && !moveAsNonTaskInput.checked;
  }

  function closeMoveFileModal() {
    moveFileModal.classList.add('hidden');
    moveL1Select.innerHTML = '';
    moveL2Select.innerHTML = '';
    moveAsNonTaskInput.checked = false;
    moveAsNonTaskWrap.classList.add('hidden');
    moveFileApplyBtn.disabled = true;
    moveFileApplyBtn.textContent = 'Move';
  }

  function addMoveOption(select: any, value: any, label: any, disabled = false, className = '') {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.disabled = disabled;
    if (className) opt.className = className;
    select.appendChild(opt);
  }

  function selectedMoveDestination() {
    if (!currentPath) return null;
    const topName = moveL1Select.value;
    if (!topName) return null;
    if (isTaskSpecificMove()) {
      if (topName === currentPath!.split('/')[0]) return null;
      return [topName, 'tasks'];
    }
    const subName = moveL2Select.value;
    // Moving to a workspace root is never supported, even if a stale or injected
    // option value reaches this guard.
    if (!subName || subName === '__root__') return null;
    const destParts = [topName, subName];
    return destParts.join('/') === currentPath!.split('/').slice(0, -1).join('/') ? null : destParts;
  }

  function updateMoveApplyBtn() {
    moveFileApplyBtn.disabled = !selectedMoveDestination();
  }

  async function populateMoveSubfolders() {
    moveL2Select.innerHTML = '';
    addMoveOption(moveL2Select, '', 'Select destination…');

    const topName = moveL1Select.value;
    if (!topName) { updateMoveApplyBtn(); return; }

    try {
      const topHandle = await notesHandle!.getDirectoryHandle(topName);
      const subs = await listDirs(topHandle);
      const eligibleSubs = isTaskSpecificMove()
        ? subs
        : subs.filter(sub => sub.name !== 'tasks' && sub.name !== 'archived' && sub.name !== 'assets');
      const currentFolder = currentPath!.split('/').slice(0, -1).join('/');
      eligibleSubs.forEach(sub => {
        const destPath = `${topName}/${sub.name}`;
        addMoveOption(moveL2Select, sub.name, sub.name, destPath === currentFolder);
      });
    } catch (e: any) {
      toast('Could not load subfolders: ' + e.message, 'error');
    }
    updateMoveApplyBtn();
  }

  function updateMoveTopFolderOptions() {
    const currentTop = (isOutputsFile || isExternalFile) ? null : currentPath?.split('/')[0];
    for (const option of moveL1Select.options) {
      option.disabled = !!currentTop && isTaskSpecificMove() && option.value === currentTop;
    }
    if (moveL1Select.selectedOptions[0]?.disabled) moveL1Select.value = '';
  }

  async function updateMoveMode() {
    const taskSpecificMove = isTaskSpecificMove();
    moveL2Wrap.classList.toggle('hidden', taskSpecificMove);
    updateMoveTopFolderOptions();
    if (taskSpecificMove) updateMoveApplyBtn();
    else await populateMoveSubfolders();
  }

  // For a normal workspace file this moves it between folders. For a
  // "Temporary" external file (isExternalFile) it instead drives the same
  // Top-Level Folder / Subfolder destination picker to *import* that file
  // into the workspace — see moveCurrentFile()'s isExternalFile branch below,
  // and the "Clicking the Move button on a temporary file behaves like
  // Import" requirement this satisfies.
  async function openMoveFileModal() {
    if (isWorkingTask() || isTaskNamespacePath()) return;
    if (!currentPath || isNew) return;

    const filename   = currentPath!.split('/').at(-1)!;
    const taskFile   = isCurrentTaskFile() && !isExternalFile;
    const currentTop = (isOutputsFile || isExternalFile) ? null : currentPath!.split('/')[0];

    moveFileTitle.textContent = isExternalFile ? `Import "${filename}" into Workspace` : `Move "${filename}"`;
    moveL1Select.innerHTML = '';
    moveL2Select.innerHTML = '';
    moveAsNonTaskInput.checked = false;
    moveAsNonTaskWrap.classList.toggle('hidden', !taskFile);
    moveL2Wrap.classList.toggle('hidden', isTaskSpecificMove());
    moveFileApplyBtn.disabled = true;
    moveFileApplyBtn.textContent = isExternalFile ? 'Import' : 'Move';
    addMoveOption(moveL1Select, '', 'Select a top-level folder…');

    try {
      const folders = await listWorkspaceTopDirs();
      // Never include 'outputs' as a move destination (Outputs is read-only as target)
      const moveableFolders = folders.filter(f => f.name !== 'outputs');
      moveableFolders.forEach(folder => {
        addMoveOption(moveL1Select, folder.name, folder.name, !isOutputsFile && isTaskSpecificMove() && folder.name === currentTop);
      });
      if (!isOutputsFile && !isTaskSpecificMove() && moveableFolders.some(folder => folder.name === currentTop)) {
        moveL1Select.value = currentTop || '';
        await populateMoveSubfolders();
      } else {
        updateMoveApplyBtn();
      }
      moveFileModal.classList.remove('hidden');
      setTimeout(() => moveL1Select.focus(), 0);
    } catch (e: any) {
      toast('Could not load folders: ' + e.message, 'error');
    }
  }

  // Copies the active external/temporary file's current editor content into the
  // chosen workspace folder, then swaps the temporary tab for a normal workspace
  // tab pointed at the new copy. The original file at its OS location is left
  // untouched — this is a copy-in, not a move, since RecallStack never owns
  // files outside the workspace.
  async function importActiveExternalFile(destParts: [string, string]) {
    const content = mdEditor.value;
    const destDir = await getDirHandle(notesHandle!, destParts, true);
    const sourceName = currentPath!.split(/[\\/]/).pop() || 'untitled.md';
    const baseFilename = sourceName.toLowerCase().endsWith('.md') ? sourceName : sourceName + '.md';
    const finalFilename = await uniqueFilenameInDir(destDir, baseFilename);
    const finalPath = buildImportedFilePath(destParts, finalFilename);
    await writeMdFile(finalPath, content);
    updateSearchIndex(finalPath, content);
    removeTabRecord(activeTabId);
    // Mark the shared editor state clean before handing off to openFile()
    // below — otherwise its internal autoSaveIfDirty() would try to write
    // this same content back into the external source file one more time
    // (harmless, but an unnecessary and surprising extra native write).
    savedContent              = content;
    isExternalFile            = false;
    currentExternalPath       = null;
    currentExternalFileHandle = null;
    await openFile(finalFilename, finalPath, { pinned: true });
  }

  async function moveCurrentFile() {
    const destParts = selectedMoveDestination();
    if (!destParts || !currentPath) return;

    moveFileApplyBtn.disabled = true;
    moveFileApplyBtn.textContent = isExternalFile ? 'Importing…' : 'Moving…';

    try {
      if (isExternalFile) {
        await importActiveExternalFile(destParts as [string, string]);
        closeMoveFileModal();
        toast('Imported ✓');
        return;
      }

      const oldPath = currentPath;
      const filename = oldPath.split('/').at(-1)!;
      const destDir = await getDirHandle(notesHandle!, destParts, true);
      const movingTaskAsNote = isCurrentTaskFile() && moveAsNonTaskInput.checked;
      let finalFilename = movingTaskAsNote ? regularNoteFilename(filename) : filename;
      if (await fileExistsInDir(destDir, finalFilename)) {
        finalFilename = await nextDuplicateFilename(finalFilename, candidate => fileExistsInDir(destDir, candidate));
      }
      const finalPath = [...destParts, finalFilename].join('/');
      const content = mdEditor.value;
      const srcFolderParts = oldPath.split('/').slice(0, -1);
      const srcIsArchived  = !isOutputsFile && srcFolderParts.at(-1)! === 'archived';
      const destIsArchived = destParts.at(-1)! === 'archived';
      let adjustedContent = content;
      if (srcIsArchived && !destIsArchived) {
        adjustedContent = content.replaceAll('](../assets/', '](assets/');
      } else if (!srcIsArchived && destIsArchived) {
        adjustedContent = content.replaceAll('](assets/', '](../assets/');
      }
      // Moving a task as a regular note changes its location semantics only. Its
      // leading metadata stays with the note so it can be recognized if restored.
      await writeMdFile(finalPath, adjustedContent);

      if (isOutputsFile && currentOutputsDirFh) {
        // Delete source directly from outputs via the stored dir handle
        await currentOutputsDirFh.removeEntry(filename);
      } else {
        await moveAssetsWithFile(oldPath, destParts, adjustedContent);
        await removeMdFile(oldPath);
        removeFromSearchIndex(oldPath);
      }

      updateSearchIndex(finalPath, adjustedContent);

      closeMoveFileModal();

      // Clear outputs state if moving out of Outputs
      if (isOutputsFile) {
        isOutputsFile       = false;
        currentOutputsFh    = null;
        currentOutputsDirFh = null;
        outputsMode         = false;
        returnToOutputs     = false;
        clearOutputsNavActive();
      }

      allTasksMode = false;
      returnToAllTasks = false;
      const allTasksBtn = $maybe('btn-all-tasks');
      if (allTasksBtn) allTasksBtn.classList.remove('active');
      navRow2.classList.remove('nav-row-disabled');
      refreshCalendarIfVisible();
      await openFile(finalFilename, finalPath);
      toast(movingTaskAsNote ? 'Converted to Note ✓' : 'Moved ✓');
    } catch (e: any) {
      toast((isExternalFile ? 'Import failed: ' : 'Move failed: ') + e.message, 'error');
    } finally {
      if (!moveFileModal.classList.contains('hidden')) {
        moveFileApplyBtn.disabled = false;
        moveFileApplyBtn.textContent = isExternalFile ? 'Import' : 'Move';
      }
    }
  }

  // ── Make Copy ─────────────────────────────────────────────────────────────────

  async function makeCopy() {
    if (isWorkingTask()) return;
    btnMakeCopy.disabled = true;
    try {
      // Save the current file first (no-op if already saved and unchanged is fine too)
      const saved = await saveNote();
      if (!saved) { toast('Save failed — cannot make copy', 'error'); return; }

      const parts        = currentPath!.split('/');
      const origFilename = parts.at(-1)!;
      const folderParts = parts.slice(0, -1);
      const dirHandle   = await getDirHandle(notesHandle!, folderParts);
      const copyFilename = await nextDuplicateFilename(origFilename, candidate => fileExistsInDir(dirHandle, candidate));

      const content     = mdEditor.value;
      const copyRelPath = [...folderParts, copyFilename].join('/');

      await writeMdFile(copyRelPath, content);
      updateSearchIndex(copyRelPath, content);
      await openFile(copyFilename, copyRelPath);
      toast('Copy created ✓');
    } catch (e: any) {
      toast('Copy failed: ' + e.message, 'error');
    } finally {
      btnMakeCopy.disabled = false;
    }
  }

  // ── Convert note to task ──────────────────────────────────────────────────────

  function updateConvertToTaskBtn() {
    const show = !isNew && !isTasksEditor() && !isWorkingTask() && !archiveMode && !!l1Active && !!currentPath;
    btnConvertToTask.classList.toggle('hidden', !show);
  }

  function updateConvertToNoteBtn() {
    const show = !isNew && !isExternalFile && !isOutputsFile && !isWorkingTask() && isTaskNamespacePath() && !!currentPath;
    btnConvertToNote.classList.toggle('hidden', !show);
  }

  // Reuses the Move File modal/flow: preselects "move as a regular file" and
  // hides that checkbox since the decision is implicit for this action, then
  // lets moveCurrentFile() do the actual move + metadata-suffix stripping via
  // regularNoteFilename().
  async function openConvertTaskToNoteModal() {
    if (isWorkingTask() || !isTaskNamespacePath() || isExternalFile) return;
    if (!currentPath || isNew) return;

    const filename = currentPath!.split('/').at(-1)!;
    moveFileTitle.textContent = `Convert "${taskDisplayTitle(filename)}" to Note`;
    moveL1Select.innerHTML = '';
    moveL2Select.innerHTML = '';
    moveAsNonTaskInput.checked = true;
    moveAsNonTaskWrap.classList.add('hidden');
    moveL2Wrap.classList.remove('hidden');
    moveFileApplyBtn.disabled = true;
    moveFileApplyBtn.textContent = 'Convert to Note';
    addMoveOption(moveL1Select, '', 'Select a top-level folder…');

    try {
      const folders = await listWorkspaceTopDirs();
      folders.forEach(folder => addMoveOption(moveL1Select, folder.name, folder.name));
      updateMoveApplyBtn();
      moveFileModal.classList.remove('hidden');
      setTimeout(() => moveL1Select.focus(), 0);
    } catch (e: any) {
      toast('Could not load folders: ' + e.message, 'error');
    }
  }

  async function convertNoteToTask() {
    if (isWorkingTask()) return;
    if (!currentPath || !l1Active) return;

    let tasksHandle;
    try {
      tasksHandle = await l1Active!.handle.getDirectoryHandle('tasks', { create: true });
    } catch (e: any) {
      toast('Could not access tasks folder: ' + e.message, 'error');
      return;
    }

    if (!await saveNote()) return;

    // Saving may rename the source from the title field, so derive the task name
    // only after that save completes. A converted task must immediately use the
    // metadata filename format; otherwise it presents as a task but changes name
    // on its next save.
    const sourcePath = currentPath;
    const filename = sourcePath.split('/').at(-1)!;
    const desiredFilename = buildTaskFilename(filename.replace(/\.md$/i, ''), { priority: 'normal' });
    const finalFilename = await fileExistsInDir(tasksHandle, desiredFilename)
      ? await nextDuplicateFilename(desiredFilename, candidate => fileExistsInDir(tasksHandle, candidate))
      : desiredFilename;
    const finalRelPath = l1Active!.name + '/tasks/' + finalFilename;

    const newContent  = removeLegacyTaskHeader(mdEditor.value);

    await writeMdFile(finalRelPath, newContent);
    await moveAssetsWithFile(sourcePath, [l1Active!.name, 'tasks'], newContent);
    await removeMdFile(sourcePath);
    removeFromSearchIndex(sourcePath);
    updateSearchIndex(finalRelPath, newContent);

    l2Active     = { name: 'tasks', handle: tasksHandle };
    currentPath  = finalRelPath;
    isNew        = false;
    savedContent = newContent;
    syncActiveTabFromState();
    renderTabStrip();

    titleInput.value = taskDisplayTitle(finalFilename);
    await mdEditor.openDocument(finalRelPath, newContent, 0);
    previewOut.innerHTML = '';
    previewOut.scrollTop = 0;
    previewScheduler.cancel();
    setPreviewMarkdown(newContent);
    postProcessPreview();

    btnArchive.innerHTML = SVG_ARCHIVE;
    btnArchive.title     = 'Archive';
    btnArchive.classList.remove('restore');
    btnArchive.classList.add('archive');
    btnArchive.classList.remove('hidden');
    btnDelete.classList.remove('hidden');
    btnMove.classList.add('hidden');
    btnMakeCopy.classList.remove('hidden');
    updateConvertToTaskBtn();
    updateConvertToNoteBtn();
    showTaskDateBar();
    setActive(navRow2, 'tasks');
    refreshCalendarIfVisible();
    toast('Converted to task ✓');
  }

  // ── Nav archive toggle ────────────────────────────────────────────────────────

  function mkArchiveToggleBtn() {
    return createArchiveToggle(archiveMode, isRootFolderActive() && !archiveMode, {
      archive: SVG_ARCHIVE,
      folder: SVG_FOLDER,
    }, toggleArchiveMode);
  }

  function updateArchiveToggleBtn() {
    const btn = $maybe('btn-archive-mode');
    if (!btn) return;
    const hideForRoot = isRootFolderActive() && !archiveMode;
    btn.classList.toggle('hidden', hideForRoot);
    if (hideForRoot) return;
    btn.innerHTML = archiveMode ? SVG_FOLDER : SVG_ARCHIVE;
    btn.title     = archiveMode ? 'Show current folder' : 'Show archived files';
    btn.classList.toggle('active', archiveMode);
  }

  // ── Task date bar ─────────────────────────────────────────────────────────────

  function isTasksEditor() {
    return currentPath ? isCurrentTaskPath(currentPath) : allTasksMode;
  }
  function isTasksAreaEditor() {
    return currentPath ? (isCurrentTaskPath(currentPath) || isJournalPath(currentPath)) : allTasksMode;
  }
  function isJournalNote(path = currentPath) {
    return isJournalPath(path);
  }
  function applyJournalToolbarRestrictions() {
    const journal = isJournalNote();
    titleInput.readOnly = journal;
    titleInput.classList.toggle('journal-filename-locked', journal);
    titleInput.setAttribute('aria-readonly', String(journal));
    titleInput.title = journal
      ? 'Journal filenames are fixed by their daily-note date'
      : '';
    if (!journal && !isWorkingTask()) return;
    const restricted = [btnStampDate, btnConvertToTask, btnConvertToNote, btnMakeCopy, btnMove, btnArchive, btnDelete];
    for (const btn of restricted) {
      // A working task can still be trashed straight from the editor; only a
      // journal keeps its delete button hidden.
      if (btn === btnDelete && !journal) continue;
      btn.classList.add('hidden');
    }
  }
  function isCurrentTaskPath(path = currentPath) {
    return isWorkspaceTaskPath(path);
  }
  function isWorkingTask(path = currentPath) {
    return isWorkspaceWorkingTaskPath(path);
  }

  function syncDateInputsFromEditor() {
    const { priority, startDate, completedDate, dueDate } = taskMetaFor(currentPath?.split('/').at(-1)!, mdEditor.value);
    taskInputStart.value     = parseDateLocal(startDate)     ? startDate!     : '';
    taskInputCompleted.value = parseDateLocal(completedDate) ? completedDate! : '';
    taskInputDue.value       = parseDateLocal(dueDate)       ? dueDate!       : '';
    syncDateInputBorders();
    const prioNorm = (priority || 'Normal');
    const selectedPriority = ['High', 'Normal', 'Low', 'Blocked', 'OnHold'].find(
      v => v.toLowerCase() === prioNorm.toLowerCase()
    ) ?? 'Normal';
    setChoiceSelection(taskInputPriority, 'priority', selectedPriority);
    updateTaskMetaSummary({ priority: selectedPriority, startDate, completedDate, dueDate });
  }

  function syncDateInputBorders() {
    syncTaskDateInputBorders([taskInputStart, taskInputCompleted, taskInputDue]);
  }

  function syncStatusInputFromFilename() {
    setChoiceSelection(taskInputStatus, 'status', detectStatusTag(titleInput.value.trim()));
  }

  function setChoiceSelection(container: any, kind: any, value: any) {
    syncChoiceSelection(container, kind, value);
  }

  function updateTaskStatus(choice: any) {
    let val = titleInput.value.trim();
    const hasMd = val.toLowerCase().endsWith('.md');
    let base = stripStatusTags(hasMd ? val.slice(0, -3) : val);
    if (choice === 'QA') base += QA_REVIEW_TAG;
    else if (choice === 'Deployment') base += DEPLOYMENT_TAG;
    else if (choice === 'Deployed') base += buildDeployedTag();
    else if (choice === 'Backlog') base += BACKLOG_TAG;
    else if (choice === 'Waiting') base += WAITING_TAG;
    titleInput.value = hasMd ? base + '.md' : base;
    setChoiceSelection(taskInputStatus, 'status', choice);
  }

  function setDateInEditor(fieldName: any, dateValue: any) {
    // Task metadata is encoded in the filename on save, not injected into content.
    if (fieldName === 'Start Date') taskInputStart.value = dateValue;
    if (fieldName === 'Completed Date') taskInputCompleted.value = dateValue;
    if (fieldName === 'Due Date') taskInputDue.value = dateValue;
    updateTaskMetaSummary({ priority: taskInputPriority.querySelector<HTMLElement>('.is-selected')?.dataset.priority || 'Normal', startDate: taskInputStart.value, completedDate: taskInputCompleted.value, dueDate: taskInputDue.value });
  }

  function updateTaskMetaSummary(meta: any) {
    taskMetaSummary.innerHTML = taskMetaSummaryHtml(meta, normalizeTaskPriority, taskPriorityLabel, esc);
  }

  function taskKindIndicatorMarkup(working: any, journal = false) {
    return renderTaskKindIndicator(working, journal);
  }

  function updateTaskKindIndicator() {
    const journal = isJournalNote();
    const working = currentPath?.split('/').includes('working');
    taskKindIndicator.classList.toggle('hidden', !isTasksAreaEditor());
    taskKindIndicator.classList.toggle('working', !!working && !journal);
    taskKindIndicator.classList.toggle('journal', journal);
    taskKindIndicator.disabled = journal;
    taskKindIndicator.title = journal ? 'Journal note' : (working ? 'Working task — click to return it to Tasks' : 'Task — click to move it to Working');
    taskKindIndicator.setAttribute('aria-label', taskKindIndicator.title);
    taskKindIndicator.innerHTML = taskKindIndicatorMarkup(working, journal);
  }

  function showTaskDateBar() {
    if (isTasksEditor()) {
      taskDateBar.classList.remove('hidden');
      taskMetaSummary.classList.remove('hidden');
      syncDateInputsFromEditor();
      syncStatusInputFromFilename();
      updateTaskKindIndicator();
      taskEditorLayout.classList.add('is-task-editor');
    } else if (isTasksAreaEditor()) {
      // Journal notes are regular markdown under tasks: no task filename
      // metadata controls, but the kind indicator still applies.
      taskDateBar.classList.add('hidden');
      taskEditorLayout.classList.add('is-task-editor');
      updateTaskKindIndicator();
      taskMetaSummary.classList.add('hidden');
    } else {
      taskDateBar.classList.add('hidden');
      taskEditorLayout.classList.remove('is-task-editor');
      taskEditorTop.style.flex = '1';
      taskKindIndicator.classList.add('hidden');
      taskMetaSummary.classList.add('hidden');
    }
  }

  function localDateKey(date: any) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function currentTasksRootParts() {
    return [TASKS_ROOT];
  }

  async function createWorkingTask() {
    if (!editorView.classList.contains('hidden') && (currentPath || isNew) && !await saveNote()) return;
    const rootParts = currentTasksRootParts();
    if (!rootParts.length) return;
    const dir = await getDirHandle(notesHandle!, [...rootParts, 'working'], true);
    const defaultFilename = await uniqueDatedTitleInDir(dir, 'working-task');
    newFileModal.open({
      title: newMarkdownFileTitle('working-task'),
      defaultFilename,
      async create(value) {
        const filename = newMarkdownStoredFilename(value, 'working-task');
        const nameError = portableNameError(filename);
        if (nameError) return nameError;
        if (await fileExistsInDir(dir, filename)) return `A file named "${filename}" already exists`;
        const path = [...rootParts, 'working', filename].join('/');
        await writeMdFile(path, '');
        updateSearchIndex(path, '');
        lsDraftClear(path);
        await openFile(filename, path);
        toast('New working task created');
        return null;
      },
    });
  }

  async function openJournalForDate(date: any, rootParts: string[] = [], pinned = false) {
    const selected = typeof date === 'string' ? parseDateLocal(date) : new Date(date);
    if (!selected) throw new Error('Invalid journal date');
    selected.setHours(0,0,0,0);
    const location = journalLocationForDate(rootParts, localDateKey(selected));
    if (!location) throw new Error('Invalid journal date');
    const { filename, path } = location;
    let content = '';
    try { content = await readMdFile(path); } catch {
      const priorPath = latestJournalPathBefore(searchIndex.map(entry => entry.notesRelPath), rootParts, localDateKey(selected));
      if (priorPath) {
        try { content = await readMdFile(priorPath); } catch {}
      }
      await writeMdFile(path, content); updateSearchIndex(path, content);
    }
    await openFile(filename, path, { pinned });
  }

  async function resolveTodayJournalRootParts() {
    return [];
  }

  async function openTodayJournal() {
    const rootParts = await resolveTodayJournalRootParts();
    const location = journalLocationForDate(rootParts, localTodayDateString());
    if (!location) throw new Error('Invalid journal date');
    protectedDailyJournalPath = location.path;
    await openJournalForDate(new Date(), rootParts, true);
    enforceTabOrder();
    renderTabStrip();
  }

  // When nothing but the (protected) daily journal is open, land on the journal
  // instead of the file list — there is no "dynamic" file to show.
  async function ensureJournalWhenEmpty() {
    if (!notesHandle || isManagedSystemWorkspace()) return;
    const hasDynamicTab = tabs.some(tab => !tab.pinned);
    const hasOtherPinned = tabs.some(tab => tab.pinned && !isProtectedDailyJournalTab(tab));
    if (hasDynamicTab || hasOtherPinned) return;
    const showingFile = !editorView.classList.contains('hidden');
    if (showingFile) return; // already on the journal (the only non-dynamic file)
    try { await openTodayJournal(); }
    catch (error) { console.warn('Could not open journal', error); }
  }

  // The editor's open file was just deleted / archived out from under it. Land
  // on today's daily journal — the always-open pinned tab — instead of dropping
  // back to a file list or the notes modal. Falls back to cancelEdit()'s routing
  // when there is no journal to show (managed system workspace / no workspace).
  async function returnToDailyJournalAfterRemoval() {
    returnToOutputs           = false;
    returnToAllTasks          = false;
    outputsMode               = false;
    outputsActiveFolder       = null;
    isOutputsFile             = false;
    currentOutputsFh          = null;
    currentOutputsDirFh       = null;
    isExternalFile            = false;
    currentExternalPath       = null;
    currentExternalFileHandle = null;
    if (!notesHandle || isManagedSystemWorkspace()) { cancelEdit(); return; }
    try {
      await openTodayJournal();
    } catch (error) {
      console.warn('Could not open journal after removal', error);
      cancelEdit();
    }
  }

  async function toggleWorkingTask() {
    if (!currentPath || !isCurrentTaskPath()) return;
    const wasWorking = currentPath!.split('/').includes('working');
    if (!await saveNote(true)) return;
    const parts = currentPath!.split('/'); const workingIndex = parts.indexOf('working'); const inWorking = workingIndex >= 0;
    const meta = taskMetaFor(parts.at(-1)!, mdEditor.value);
    if (wasWorking && !inWorking && meta.completedDate) { toast('Completed tasks leave Working automatically'); return; }
    const destination = inWorking ? [...parts.slice(0, workingIndex), parts.at(-1)!] : [...parts.slice(0,-1), 'working', parts.at(-1)!];
    const destPath = await uniquePathInFolder(destination.slice(0,-1), destination.at(-1)!);
    await writeMdFile(destPath, mdEditor.value); await removeMdFile(currentPath); removeFromSearchIndex(currentPath); updateSearchIndex(destPath, mdEditor.value);
    await openFile(destPath.split('/').at(-1)!, destPath);
    toast(inWorking ? 'Task returned to Tasks' : 'Task moved to Working');
  }

  async function toggleWorkingTaskFromList(file: any, location: any) {
    const meta = taskMetaFor(file.name, file.content || '');
    if (meta.completedDate) return;
    const sourcePath = [...location.rootParts, ...(location.inWorking ? ['working'] : []), file.name].join('/');
    const destinationFolder = location.inWorking ? location.rootParts : [...location.rootParts, 'working'];
    const destinationPath = await uniquePathInFolder(destinationFolder, file.name);
    await writeMdFile(destinationPath, file.content || '');
    await removeMdFile(sourcePath);
    removeFromSearchIndex(sourcePath); updateSearchIndex(destinationPath, file.content || '');
    await location.reload();
    toast(location.inWorking ? 'Task returned to Tasks' : 'Task moved to Working');
  }

  // ── New Folder Modal ──────────────────────────────────────────────────────────

  function openNewFolderModal(row: any) {
    if (isManagedSystemWorkspace()) return;
    newFolderRow = row;
    newFolderTitle.textContent = row === 1 ? 'New Top-Level Folder' : 'New Subfolder';
    newFolderInput.value = '';
    newFolderInput.classList.remove('error');
    newFolderModal.classList.remove('hidden');
    setTimeout(() => newFolderInput.focus(), 0);
  }

  function closeNewFolderModal() {
    newFolderModal.classList.add('hidden');
    newFolderInput.value = '';
    newFolderInput.classList.remove('error');
  }

  async function createFolder() {
    if (isManagedSystemWorkspace()) return;
    const name = newFolderInput.value.trim();
    const nameError = portableNameError(name);
    if (nameError) {
      newFolderInput.classList.add('error');
      newFolderInput.focus();
      toast(nameError, 'error');
      return;
    }
    newFolderInput.classList.remove('error');
    modalCreateBtn.disabled    = true;
    modalCreateBtn.textContent = 'Creating…';
    try {
      if (newFolderRow === 1) {
        if (SYSTEM_FOLDER_NAMES.has(name.toLowerCase())) throw new Error(`"${name}" is a protected system folder name`);
        // Create Data/notes/{name} with the default notes/ subfolder. Workspace tasks live in Data/notes/tasks.
        if (await dirExists(notesHandle!, name)) throw new Error(`Folder "${name}" already exists`);
        const baseDir = await notesHandle!.getDirectoryHandle(name, { create: true });
        await baseDir.getDirectoryHandle('notes', { create: true });
        closeNewFolderModal();
        toast(`Folder "${name}" created ✓`);
        // Rebuild navRow1 and select the new folder
        const folders = await listWorkspaceTopDirs();
        navRow1.innerHTML = '';
        navRow1.appendChild(mkNavNewBtn(1));
        navRow1.appendChild(mkNavRenameBtn(1));
        if (allTasksEnabled) navRow1.appendChild(mkNavAllTasksBtn());
        if (allTasksEnabled) navRow1.appendChild(mkNavWorkingTasksBtn());
        navRow1.appendChild(mkNavSeparator());
        if (navRow1Mode === 'combo') {
          navRow1.appendChild(mkNav1Combo(folders));
        } else {
          folders.forEach(f => navRow1.appendChild(mkNavBtn(f.name, () => refreshFolderNavigation(f.name))));
        }
        const newFolder = folders.find(f => f.name === name);
        await selectL1(newFolder || folders[0]);
      } else {
        // Create Data/notes/{l1Active!.name}/{name}
        if (!l1Active) { toast('No top-level folder selected', 'error'); return; }
        if (await dirExists(l1Active!.handle, name)) throw new Error(`Folder "${name}" already exists`);
        await l1Active!.handle.getDirectoryHandle(name, { create: true });
        closeNewFolderModal();
        toast(`Subfolder "${name}" created ✓`);
        // Rebuild navRow2 and select the new subfolder
        const subs = await listDirs(l1Active!.handle);
        navRow2.innerHTML = '';
        navRow2.appendChild(mkNavNewBtn(2));
        navRow2.appendChild(mkNavRenameBtn(2));
        populateNavRow2Contents(subs);
        navRow2.classList.remove('hidden');
        const newSub = subs.find(f => f.name === name);
        if (newSub) await selectL2(newSub);
      }
    } catch (e: any) {
      toast('Could not create folder: ' + e.message, 'error');
    } finally {
      modalCreateBtn.disabled    = false;
      modalCreateBtn.textContent = 'Create';
    }
  }

  // ── Rename Folder Modal ───────────────────────────────────────────────────────

  function openRenameFolderModal(row: any) {
    if (isManagedSystemWorkspace()) return;
    const currentName = row === 1 ? l1Active?.name : l2Active?.name;
    if (!currentName) return;
    if (row === 2 && currentName === 'tasks') return;
    renameFolderRow = row;
    renameFolderTitle.textContent = row === 1 ? 'Rename Folder' : 'Rename Subfolder';
    renameFolderInput.value = currentName;
    renameFolderInput.classList.remove('error');
    renameFolderModal.classList.remove('hidden');
    setTimeout(() => { renameFolderInput.focus(); renameFolderInput.select(); }, 0);
  }

  function closeRenameFolderModal() {
    renameFolderModal.classList.add('hidden');
    renameFolderInput.value = '';
    renameFolderInput.classList.remove('error');
  }

  async function applyRenameFolder() {
    if (isManagedSystemWorkspace()) return;
    const newName = renameFolderInput.value.trim();
    const nameError = portableNameError(newName);
    if (nameError) {
      renameFolderInput.classList.add('error');
      renameFolderInput.focus();
      toast(nameError, 'error');
      return;
    }
    const currentName = renameFolderRow === 1 ? l1Active?.name : l2Active?.name;
    if (!currentName) { closeRenameFolderModal(); return; }
    if (newName === currentName) { closeRenameFolderModal(); return; }
    if (renameFolderRow === 1 && SYSTEM_FOLDER_NAMES.has(newName.toLowerCase())) {
      renameFolderInput.classList.add('error');
      toast(`"${newName}" is a protected system folder name`, 'error');
      return;
    }
    renameFolderInput.classList.remove('error');
    renameFolderApplyBtn.disabled    = true;
    renameFolderApplyBtn.textContent = 'Applying…';

    // Detect whether the editor is currently showing a file inside the folder being renamed
    const editorVisible   = !editorView.classList.contains('hidden') && !isNew && !!currentPath;
    const oldL1Prefix     = currentName + '/';                                    // for row 1
    const oldL2Prefix     = l1Active?.name + '/' + (l2Active?.name ?? '') + '/'; // for row 2

    const fileInRenamedL1 = renameFolderRow === 1 && editorVisible && currentPath!.startsWith(oldL1Prefix);
    const fileInRenamedL2 = renameFolderRow === 2 && editorVisible && currentPath!.startsWith(oldL2Prefix);

    try {
      // Save open file before renaming so no content is lost
      if (fileInRenamedL1 || fileInRenamedL2) {
        await writeMdFile(currentPath!, mdEditor.value);
      }

      if (renameFolderRow === 1) {
        const oldL1Name = l1Active!.name;
        if (await dirExists(notesHandle!, newName)) {
          throw new Error(`Folder "${newName}" already exists`);
        }
        await window.__recallstackNative!.renamePath(`${DB_WS_PREFIX}${oldL1Name}`, `${DB_WS_PREFIX}${newName}`);
        l1Active!.handle = await notesHandle!.getDirectoryHandle(newName);
        l1Active!.name   = newName;

        const oldPrefix = oldL1Name + '/';
        const newPrefix = newName + '/';
        for (const entry of searchIndex) {
          if (entry.notesRelPath.startsWith(oldPrefix)) {
            entry.notesRelPath = newPrefix + entry.notesRelPath.slice(oldPrefix.length);
          }
        }
        remapTabPaths(oldPrefix, newPrefix);

        // Rebuild nav row 1
        const folders = await listWorkspaceTopDirs();
        navRow1.innerHTML = '';
        navRow1.appendChild(mkNavNewBtn(1));
        navRow1.appendChild(mkNavRenameBtn(1));
        if (allTasksEnabled) navRow1.appendChild(mkNavAllTasksBtn());
        if (allTasksEnabled) navRow1.appendChild(mkNavWorkingTasksBtn());
        navRow1.appendChild(mkNavSeparator());
        if (navRow1Mode === 'combo') {
          navRow1.appendChild(mkNav1Combo(folders));
        } else {
          folders.forEach(f => navRow1.appendChild(mkNavBtn(f.name, () => refreshFolderNavigation(f.name))));
        }
        setActive(navRow1, newName);
        const r1 = $maybe('btn-rename-folder-1');
        if (r1) r1.disabled = false;

        // Rebuild nav row 2, re-acquiring handles under the renamed folder
        const subs = await listDirs(l1Active!.handle);
        navRow2.innerHTML = '';
        navRow2.appendChild(mkNavNewBtn(2));
        navRow2.appendChild(mkNavRenameBtn(2));
        if (subs.length) {
          populateNavRow2Contents(subs);
          if (l2Active) {
            const freshL2 = subs.find(f => f.name === l2Active!.name);
            if (freshL2) {
              l2Active = freshL2;
              setActive(navRow2, l2Active!.name);
              const r2 = $maybe('btn-rename-folder-2');
              if (r2) r2.disabled = l2Active!.name === 'tasks';
            } else {
              l2Active = null;
            }
          }
        } else {
          l2Active = null;
        }

        closeRenameFolderModal();
        toast(`Renamed to "${newName}" ✓`);

        // Reload the open file at its new path, or refresh the file list
        if (fileInRenamedL1) {
          const newFilePath = newName + currentPath!.slice(oldL1Name.length);
          // remapTabPaths() above already relocated the active tab's path; just
          // refresh the editor's content at the new location (same tab, no dup).
          await loadFileIntoEditor(newFilePath, {});
          syncActiveTabFromState();
          renderTabStrip();
        } else if (!editorVisible) {
          const dir     = l2Active ? l2Active!.handle : l1Active!.handle;
          const heading = activeFolderHeading();
          await loadFiles(dir, heading);
        }

      } else {
        // Row 2 rename
        const oldL2Name = l2Active!.name;
        if (await dirExists(l1Active!.handle, newName)) {
          throw new Error(`Subfolder "${newName}" already exists`);
        }
        await window.__recallstackNative!.renamePath(
          `${DB_WS_PREFIX}${l1Active!.name}/${oldL2Name}`,
          `${DB_WS_PREFIX}${l1Active!.name}/${newName}`,
        );
        l2Active!.handle = await l1Active!.handle.getDirectoryHandle(newName);
        l2Active!.name   = newName;

        const oldPrefix = l1Active!.name + '/' + oldL2Name + '/';
        const newPrefix = l1Active!.name + '/' + newName + '/';
        for (const entry of searchIndex) {
          if (entry.notesRelPath.startsWith(oldPrefix)) {
            entry.notesRelPath = newPrefix + entry.notesRelPath.slice(oldPrefix.length);
          }
        }
        remapTabPaths(oldPrefix, newPrefix);

        const subs = await listDirs(l1Active!.handle);
        navRow2.innerHTML = '';
        navRow2.appendChild(mkNavNewBtn(2));
        navRow2.appendChild(mkNavRenameBtn(2));
        populateNavRow2Contents(subs);
        setActive(navRow2, newName);
        const r2 = $maybe('btn-rename-folder-2');
        if (r2) r2.disabled = false;

        closeRenameFolderModal();
        toast(`Renamed to "${newName}" ✓`);

        // Reload the open file at its new path, or refresh the file list
        if (fileInRenamedL2) {
          const newFilePath = l1Active!.name + '/' + newName + currentPath!.slice((l1Active!.name + '/' + oldL2Name).length);
          // remapTabPaths() above already relocated the active tab's path; just
          // refresh the editor's content at the new location (same tab, no dup).
          await loadFileIntoEditor(newFilePath, {});
          syncActiveTabFromState();
          renderTabStrip();
        } else if (!editorVisible) {
          await loadFiles(l2Active!.handle, newName);
        }
      }
    } catch (e: any) {
      toast('Could not rename folder: ' + e.message, 'error');
    } finally {
      renameFolderApplyBtn.disabled    = false;
      renameFolderApplyBtn.textContent = 'Apply';
    }
  }

  async function toggleArchiveMode() {
    archiveMode = !archiveMode;
    btnNew.classList.toggle('hidden', archiveMode); // no New Note while browsing archived
    updateArchiveToggleBtn();
    if (allTasksMode) {
      await loadAllTasks();
    } else if (l2Active || l1Active) {
      await loadFiles(activeDirHandle(), activeFolderHeading());
    }
  }

  function cancelEdit() {
    if (isNew) { isNew = false; savedContent = null; }
    taskDateBar.classList.add('hidden');
    const q = searchInput.value.trim();
    if (q.length >= 3) {
      showView('search');
    } else if (returnToOutputs) {
      returnToOutputs     = false;
      outputsMode         = true;
      isOutputsFile       = false;
      currentOutputsFh    = null;
      currentOutputsDirFh = null;
      isExternalFile      = false;
      currentExternalPath = null;
      currentExternalFileHandle = null;
      clearOutputsNavActive();
      if (outputsActiveFolder) {
        setActive(navRow2, outputsActiveFolder!.name);
        loadOutputsFiles(outputsActiveFolder).catch(e => toast('Load failed: ' + e.message, 'error'));
      } else {
        populateOutputsNavRow2().catch(e => toast('Load failed: ' + e.message, 'error'));
      }
    } else if (returnToAllTasks) {
      const restoreArchiveMode = archiveMode;
      returnToAllTasks = false;
      selectAllTasks(restoreArchiveMode);
    } else if (l1Active && !folderUsesInlineList(activeFolderHeading(), l1Active.name)) {
      // Content folder: cancelling a note reopens that folder's notes modal.
      void openNotesListing().catch(e => toast('Could not load notes: ' + (e?.message || e), 'error'));
    } else {
      showView('list');
      if (l1Active) {
        const heading = activeFolderHeading();
        loadFiles(activeDirHandle(), heading).catch(e => toast('Load failed: ' + e.message, 'error'));
        saveLastView('list', null);
      }
    }
  }

  // ── Preview ───────────────────────────────────────────────────────────────────

  let _autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let _hljsFullLoaded  = false;
  let _hljsFullPromise: Promise<void> | null = null;
  const previewScheduler = new PreviewScheduler();
  const _hljsTried     = new Set();

  function loadHljsLang(lang: any) {
    if (_hljsFullLoaded || _hljsTried.has(lang)) return;
    _hljsTried.add(lang);

    const loadFullBundle = () => {
      if (_hljsFullLoaded) { renderPreview(); return; }
      if (_hljsFullPromise) { _hljsFullPromise.then(renderPreview); return; }
      setDependencyStatus('hljsFull', { state: 'loading', source: 'local', detail: 'Loading local full syntax bundle', errorText: '' });
      _hljsFullPromise = new Promise<void>(resolve => {
        const s = document.createElement('script');
        s.src = 'lib/highlight.full.min.js';
        s.onload = () => {
          _hljsFullLoaded = true;
          setDependencyStatus('hljsFull', { state: 'loaded', source: 'local', detail: 'Local full syntax bundle ready', errorText: '' });
          resolve();
        };
        s.onerror = () => {
          setDependencyStatus('hljsFull', { state: 'missing', source: 'local', detail: 'Local full syntax bundle unavailable', errorText: 'Local full syntax bundle unavailable' });
          resolve();
        };
        document.head.appendChild(s);
      });
      _hljsFullPromise.then(renderPreview);
    };

    loadFullBundle();
  }

  function draftKey(path: any) {
    const ws = activeWorkspace || '__no_workspace__';
    return 'pkm-draft:' + ws + ':' + (path || '__new__');
  }
  function nativeDraftPath(path: any) {
    return resolveNativeDraftPath(path, DB_WS_PREFIX);
  }
  let _nativeDraftTimer: ReturnType<typeof setTimeout> | undefined;
  let _localDraftTimer: ReturnType<typeof setTimeout> | undefined;
  function lsDraftSave(content?: string) {
    const key = draftKey(currentPath);
    const path = nativeDraftPath(currentPath);
    const writeDraft = (text: string) => {
      try { localStorage.setItem(key, text); } catch (_) {}
      if (path && window.__recallstackNative?.saveDraft) {
        window.__recallstackNative!.saveDraft(path, text).catch(error => console.warn('Could not persist recovery draft', error));
      }
    };
    clearTimeout(_localDraftTimer);
    clearTimeout(_nativeDraftTimer);
    if (content !== undefined) {
      _localDraftTimer = setTimeout(() => writeDraft(content), 300);
      return;
    }
    // Reading the full editor document can be expensive for large notes. Defer
    // both the read and storage write until typing pauses so input events stay
    // responsive instead of blocking on document serialization/localStorage.
    _localDraftTimer = setTimeout(() => writeDraft(mdEditor.value), 300);
  }
  function lsDraftClear(path: any) {
    clearTimeout(_localDraftTimer);
    clearTimeout(_nativeDraftTimer);
    try { localStorage.removeItem(draftKey(path)); } catch (_) {}
    try { localStorage.removeItem(draftKey(null)); } catch (_) {}
    const nativePath = nativeDraftPath(path);
    if (nativePath && window.__recallstackNative?.clearDraft) {
      window.__recallstackNative!.clearDraft(nativePath).catch(error => console.warn('Could not clear recovery draft', error));
    }
  }
  function lsDraftGet(path: any) {
    try { return localStorage.getItem(draftKey(path)); } catch (_) { return null; }
  }
  async function recoveryDraftGet(path: any) {
    const local = lsDraftGet(path);
    if (local !== null) return local;
    const nativePath = nativeDraftPath(path);
    if (!nativePath || !window.__recallstackNative?.loadDraft) return null;
    try { return await window.__recallstackNative!.loadDraft(nativePath); }
    catch (error: any) { console.warn('Could not load recovery draft', error); return null; }
  }

  function renderPreview() {
    previewScheduler.schedule(mdEditor.length, !editorView.classList.contains('hidden'), () => {
      setPreviewMarkdown(mdEditor.value);
      postProcessPreview();
      if (isTasksEditor()) syncDateInputsFromEditor();
    });
  }

  // ── Block-level render caching ────────────────────────────────────────────────
  // The expensive parts of a preview render are per-block: hljs.highlight() for
  // each fenced code block and Mermaid's dagre layout for each diagram (see the
  // 2026-08-12 freeze diagnosis). Both are cached here keyed by a hash of the
  // block's own source text, not its position in the document — so caching is
  // correct by construction across reordering/inserting/deleting other blocks:
  // a block's cache key only changes when that block's own content changes.
  // Re-opening a previously-rendered, unchanged note hits these caches for every
  // block and skips the expensive work entirely, even though the surrounding
  // marked.parse() + innerHTML rebuild still runs in full every time.
  function hashBlockSource(s: string): string {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  function cacheGet<V>(map: Map<string, V>, key: string): V | undefined {
    if (!map.has(key)) return undefined;
    const value = map.get(key)!;
    map.delete(key);
    map.set(key, value); // refresh recency (simple LRU)
    return value;
  }
  function cacheSet<V>(map: Map<string, V>, key: string, value: V, maxSize: number) {
    map.delete(key);
    map.set(key, value);
    if (map.size > maxSize) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }
  const codeBlockRenderCache = new Map<string, string>();
  const CODE_BLOCK_CACHE_MAX = 1000;
  const mermaidRenderCache = new Map<string, string>();
  const MERMAID_CACHE_MAX = 300;
  const pendingMermaidCacheKeys = new WeakMap<HTMLElement, string>();

  // Safe marked.parse wrapper — falls back to plain <pre> if the renderer throws
  function renderMarkdown(text: any) {
    const preprocessed = preserveExtraBlankLines(preprocessMarkdown(text));
    if (typeof marked === 'undefined') return '<pre>' + esc(text) + '</pre>';
    try {
      return sanitizeRenderedHtml(marked.parse(preprocessed));
    } catch {
      return '<pre>' + esc(text) + '</pre>';
    }
  }

  function setPreviewMarkdown(text: any) {
    previewOut.innerHTML = `<div class="preview-zoom-surface">${renderMarkdown(text)}</div>`;
  }

  // Allow [ ] / [x] at line-start without the `- ` list prefix
  // Skips lines inside fenced code blocks so code content is never modified
  function preprocessMarkdown(text: any) {
    let inCode = false;
    return text.split('\n').map((line: any) => {
      if (/^(`{3,}|~{3,})/.test(line)) { inCode = !inCode; return line; }
      if (inCode) return line;
      // Collapsible heading: #### Title #### (matching # count on both sides)
      const collMatch = line.match(/^(#{1,6})\s+(.+?)\s+\1\s*$/);
      if (collMatch) {
        const level = collMatch[1].length;
        const headText = collMatch[2];
        // Escape HTML in heading text; inline markdown won't render but keeps it safe
        const safeText = headText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<h${level} data-collapsible="${level}">${safeText}</h${level}>`;
      }
      // Fix bare task checkbox syntax (no leading `- `)
      line = line.replace(/^(\s*)\[([xX ])\](\s)/, (_: any, indent: any, state: any, space: any) =>
        `${indent}- [${state}]${space}`
      );
      // Fix bracketed bare URLs like [https://example.com].
      // Marked otherwise treats "[" as plain text and includes "]" in the autolink href.
      // Render as one link whose visible label preserves the literal brackets.
      line = line.replace(/(^|[^\]])\[(https?:\/\/[^\]\s<]+)\](?!\()/gi, (match: any, prefix: any, url: any) =>
        `${prefix}[\\[${url}\\]](${url})`
      );
      // Encode spaces in markdown link URLs so marked.js (CommonMark) parses them correctly.
      // CommonMark disallows unencoded spaces in link destinations.
      line = line.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match: any, linkText: any, url: any) => {
        if (!url.includes(' ')) return match;
        return `[${linkText}](${url.replace(/ /g, '%20')})`;
      });
      return line;
    }).join('\n');
  }

  function applyCollapsibleHeadings(container: any, defaultOpen: any) {
    const collapsible: HTMLElement[] = [];
    const headings = container.querySelectorAll('h1[data-collapsible],h2[data-collapsible],h3[data-collapsible],h4[data-collapsible],h5[data-collapsible],h6[data-collapsible]') as NodeListOf<HTMLElement>;
    Array.from(headings).forEach(el => {
      if (el.parentNode === container) collapsible.push(el);
    });
    // Process bottom-up so nesting is handled correctly
    collapsible.reverse().forEach(el => {
      const level = parseInt(el.dataset.collapsible || '1');
      const siblings: Element[] = [];
      let next = el.nextElementSibling;
      while (next) {
        const hm = next.tagName.match(/^H([1-6])$/);
        if (hm && parseInt(hm[1]!) <= level) break;
        const stopLevel = next instanceof HTMLElement ? next.dataset.collapsibleStopLevel : undefined;
        if (stopLevel && parseInt(stopLevel) <= level) break;
        siblings.push(next);
        next = next.nextElementSibling;
      }
      const details = document.createElement('details');
      details.className = 'md-collapsible';
      details.dataset.collapsibleStopLevel = String(level);
      if (defaultOpen) details.setAttribute('open', '');
      const summary = document.createElement('summary');
      summary.className = `md-collapsible-summary md-collapsible-h${level}`;
      const indicator = document.createElement('span');
      indicator.className = 'md-collapsible-indicator';
      indicator.textContent = '▶';
      summary.appendChild(indicator);
      const textSpan = document.createElement('span');
      textSpan.innerHTML = el.innerHTML;
      summary.appendChild(textSpan);
      details.appendChild(summary);
      siblings.forEach(sib => details.appendChild(sib));
      el.parentNode?.insertBefore(details, el);
      el.remove();
    });
  }

  async function refreshBacklinks() {
    currentBacklinks = [];
    if (!window.__recallstackNative?.active || !currentPath || isOutputsFile || isExternalFile) return;
    const generation = workspaceSessionGeneration;
    const path = currentPath;
    const prefix = DB_WS_PREFIX.startsWith('Data/') ? DB_WS_PREFIX.slice(5) : DB_WS_PREFIX;
    try {
      const backlinks = await window.__recallstackNative!.backlinks((prefix + path).replace(/\/{2,}/g, '/'));
      if (generation === workspaceSessionGeneration && path === currentPath) currentBacklinks = backlinks;
    }
    catch (error: any) { console.warn('Could not load backlinks', error); }
  }

  function appendBacklinks() {
    if (!currentBacklinks.length || previewOut.querySelector('.preview-backlinks')) return;
    const prefix = DB_WS_PREFIX.startsWith('Data/') ? DB_WS_PREFIX.slice(5) : DB_WS_PREFIX;
    const prefixPattern = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?');
    const section = document.createElement('section'); section.className = 'preview-backlinks';
    const heading = document.createElement('h3'); heading.textContent = `Backlinks (${currentBacklinks.length})`; section.appendChild(heading);
    currentBacklinks.forEach(link => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = link.sourceTitle; button.title = link.sourcePath;
      button.addEventListener('click', () => { const relative = link.sourcePath.replace(prefixPattern, ''); openFile(relative.split('/').at(-1)!, relative); });
      section.appendChild(button);
    });
    (previewOut.querySelector('.preview-zoom-surface') || previewOut).appendChild(section);
  }

  function postProcessPreview() {
    // ── Mermaid diagrams ──
    // Every full preview rebuild wipes mermaid's data-processed markers, making
    // every diagram look "new" even when its source didn't change. Short-circuit
    // that: diagrams whose source hashes to a previously-rendered SVG are painted
    // straight from cache (skipping mermaid's dagre layout entirely); only
    // genuinely new/changed diagrams go through renderer.run().
    const diagrams = Array.from(previewOut.querySelectorAll<HTMLElement>('div.mermaid:not([data-processed])'));
    if (diagrams.length) {
      const pending: HTMLElement[] = [];
      for (const el of diagrams) {
        const key = hashBlockSource(el.textContent || '');
        const cached = cacheGet(mermaidRenderCache, key);
        if (cached !== undefined) {
          el.innerHTML = cached;
          el.setAttribute('data-processed', 'true');
        } else {
          pendingMermaidCacheKeys.set(el, key);
          pending.push(el);
        }
      }
      if (pending.length) {
        ensureMermaidReady()
          .then(renderer => {
            const currentDiagrams = pending.filter(el => previewOut.contains(el) && !el.hasAttribute('data-processed'));
            if (!currentDiagrams.length) return;
            return renderer.run({ nodes: currentDiagrams }).then(() => {
              currentDiagrams.forEach(el => {
                const key = pendingMermaidCacheKeys.get(el);
                if (key !== undefined) cacheSet(mermaidRenderCache, key, el.innerHTML, MERMAID_CACHE_MAX);
                pendingMermaidCacheKeys.delete(el);
              });
            });
          })
          .then(() => requestAnimationFrame(updateScaledImages))
          .catch(error => console.warn('Mermaid rendering unavailable', error));
      } else {
        requestAnimationFrame(updateScaledImages);
      }
    }
    // ── Collapsible headings ──
    applyCollapsibleHeadings(previewOut, !collapseDefaultOn);
    // ── Copy buttons on code blocks ──
    previewOut.querySelectorAll<HTMLElement>('pre > code').forEach(codeEl => {
      const pre = codeEl.parentElement;
      if (!pre) return;
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className   = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', (e: any) => {
        e.stopPropagation();
        copyPlainText(codeEl.textContent).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1600);
        });
      });
      pre.appendChild(btn);
    });

    // ── Copy buttons on inline code ──
    const copyIcon = () => '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const checkIcon = () => '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    previewOut.querySelectorAll<HTMLElement>('code').forEach(codeEl => {
      if (codeEl.closest('pre')) return;
      if (codeEl.parentElement?.classList.contains('inline-code-wrap')) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'inline-code-wrap';
      codeEl.parentNode?.insertBefore(wrapper, codeEl);
      wrapper.appendChild(codeEl);
      const btn = document.createElement('button');
      btn.className = 'inline-copy-btn';
      btn.title = 'Copy';
      btn.innerHTML = copyIcon();
      btn.addEventListener('click', (e: any) => {
        e.stopPropagation();
        copyPlainText(codeEl.textContent).then(() => {
          btn.innerHTML = checkIcon();
          btn.classList.add('copied');
          setTimeout(() => { btn.innerHTML = copyIcon(); btn.classList.remove('copied'); }, 1600);
        });
      });
      wrapper.appendChild(btn);
    });

    // ── Copy buttons on blockquotes ──
    function extractBqText(node: any, depth: number): string {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent;
        // skip HTML structural whitespace (newline-containing whitespace-only nodes between block elements)
        return (/^\s*$/.test(t) && t.includes('\n')) ? '' : t;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.classList && node.classList.contains('copy-btn')) return '';
      const tag  = node.tagName.toLowerCase();
      const kids = (): string => Array.from<Node>(node.childNodes).map(c => extractBqText(c, depth)).join('');
      if (tag === 'blockquote') {
        return Array.from(node.childNodes).map(c => extractBqText(c, depth + 1)).join('');
      }
      if (tag === 'p') {
        const raw = kids().replace(/[\n\s]+$/, '');
        if (!raw.trim()) return '';
        const prefix = '  '.repeat(depth);
        return raw.split('\n').map((line: any) => line ? prefix + line : '').join('\n') + '\n';
      }
      if (tag === 'br') return '\n';
      if (tag === 'li') {
        const t = kids().trim();
        return t ? '  '.repeat(depth) + '- ' + t + '\n' : '';
      }
      return kids();
    }

    previewOut.querySelectorAll('blockquote').forEach(bq => {
      if (bq.querySelector(':scope > .copy-btn')) return;
      const btn = document.createElement('button');
      btn.className   = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', (e: any) => {
        e.stopPropagation();
        const text = Array.from(bq.childNodes).map(c => extractBqText(c, 0)).join('').trim();
        copyPlainText(text).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1600);
        });
      });
      bq.appendChild(btn);
    });

    // ── Interactive task checkboxes ──
    previewOut.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb, idx) => {
      cb.removeAttribute('disabled');
      cb.addEventListener('change', () => toggleCheckbox(idx, cb.checked));
    });

    // ── Wrap checkbox li text content so long lines don't push below the checkbox ──
    previewOut.querySelectorAll('li:has(> input[type="checkbox"])').forEach(li => {
      const toWrap = Array.from(li.childNodes).filter(
        n => n.nodeName !== 'INPUT' && n.nodeName !== 'UL' && n.nodeName !== 'OL'
      );
      if (!toWrap.length) return;
      const span = document.createElement('span');
      span.className = 'cb-label';
      toWrap[0].before(span);
      toWrap.forEach(n => span.appendChild(n));
    });

    // ── Resolve assets/ image paths to blob URLs, then wrap with open button ──
    previewOut.querySelectorAll<HTMLImageElement>('img').forEach(img => {
      const blockedSrc = img.getAttribute('data-blocked-src');
      if (blockedSrc && !externalMediaAllowed()) {
        const box = document.createElement('span');
        box.className = 'remote-media-block';
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost';
        btn.type = 'button';
        btn.textContent = 'Load external image';
        btn.addEventListener('click', () => {
          remoteMediaSessionAllowed = true;
          renderPreview();
        });
        box.textContent = 'External image blocked for privacy. ';
        box.appendChild(btn);
        img.replaceWith(box);
        return;
      } else if (blockedSrc && externalMediaAllowed()) {
        img.setAttribute('src', blockedSrc);
        img.removeAttribute('data-blocked-src');
      }
      const src = img.getAttribute('src');
      if (src && isRemoteUrl(src) && !externalMediaAllowed()) {
        const box = document.createElement('span');
        box.className = 'remote-media-block';
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost';
        btn.type = 'button';
        btn.textContent = 'Load external image';
        btn.addEventListener('click', () => {
          remoteMediaSessionAllowed = true;
          renderPreview();
        });
        box.textContent = 'External image blocked for privacy. ';
        box.appendChild(btn);
        img.replaceWith(box);
        return;
      }
      if (src && (src.startsWith('assets/') || src.startsWith('../assets/')) && assetBlobUrls.has(src)) {
        img.src = assetBlobUrls.get(src)!;
      }

      // Wrap each image (once) in a relative container and add the open button
      if (img.parentElement?.classList.contains('img-wrap')) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'img-wrap';
      img.parentNode?.insertBefore(wrapper, img);
      wrapper.appendChild(img);

      const openBtn = document.createElement('button');
      openBtn.className = 'img-open-btn';
      openBtn.title     = 'Open full size in new tab';
      openBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
      openBtn.addEventListener('click', (e: any) => {
        e.stopPropagation();
        e.preventDefault();
        if (img.src) window.open(img.src, '_blank', 'noopener');
      });
      wrapper.appendChild(openBtn);

      const checkScale = () => {
        updateScaledImages();
      };
      img.addEventListener('load', checkScale);
      // For already-cached images that fire load synchronously
      if (img.complete && img.naturalWidth > 0) checkScale();
      // Fallback: recheck on next frame in case layout isn't settled yet
      requestAnimationFrame(checkScale);
    });

    // ── Resolve assets/ file links to blob URLs ──
    previewOut.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      // Decode percent-encoding (e.g. %20 → space) before looking up in assetBlobUrls
      let decoded;
      try { decoded = decodeURIComponent(href); } catch { decoded = href; }
      if ((decoded.startsWith('assets/') || decoded.startsWith('../assets/')) && assetBlobUrls.has(decoded)) {
        a.href   = assetBlobUrls.get(decoded)!;
        a.target = '_blank';
        a.rel    = 'noopener';
      }
    });
    requestAnimationFrame(updateScaledImages);
    appendBacklinks();
  }

  // Toggle the idx-th checkbox in the editor source and re-render
  function toggleCheckbox(idx: any, checked: any) {
    const start = mdEditor.selectionStart;
    mdEditor.applyUserEdit(toggleMarkdownCheckbox(mdEditor.value, idx, checked), start, mdEditor.selectionEnd);
    renderPreview();
  }

  // ── View switching ────────────────────────────────────────────────────────────

  function showView(which: any, options: { focus?: boolean } = {}) {
    const { focus = true } = options;
    renderAppView({
      welcome: welcomeEl, app: appEl, fileList: fileListView, search: searchView,
      editor: editorView, calendar: calViewEl, taskCountBar,
    }, which);
    currentView.update({
      view: which,
      mode: which === 'search' ? 'search'
        : which === 'calendar' ? 'calendar'
        : outputsMode ? 'outputs'
        : allTasksMode ? 'all-tasks'
        : 'folder',
      workspace: activeWorkspace,
      level1: l1Active?.name || null,
      level2: l2Active?.name || null,
      archive: archiveMode,
      path: which === 'editor' ? currentPath : null,
    });
    syncReturnToTabButton();
    if (which === 'editor') {
      previewScheduler.flush();
      if (focus) setTimeout(() => mdEditor.focus(), 0);
    }
  }

  // ── Resizable split pane ──────────────────────────────────────────────────────

  (() => {
    let dragging = false;
    resizerEl.addEventListener('mousedown', (e: any) => {
      dragging = true;
      resizerEl.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e: any) => {
      if (!dragging) return;
      const rect = splitPane.getBoundingClientRect();
      const pct  = Math.min(Math.max((e.clientX - rect.left) / rect.width * 100, 15), 85);
      editorPane.style.flex  = 'none';
      editorPane.style.width = pct + '%';
      previewPane.style.flex  = '1';
      previewPane.style.width = '';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizerEl.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    });
  })();

  // ── Presentation mode toggle ──────────────────────────────────────────────────
  (() => {
    const btnPresentation     = $id('btn-presentation');
    const btnExitPresentation = $id('btn-exit-presentation');
    const headerEl            = document.querySelector('header');
    const editorToolbarEl     = $id('editor-toolbar');
    const presentationExitBar = $id('presentation-exit-bar');
    const presentationTitle   = $id('presentation-title');
    let presentationOn = false;

    function setPresentation(on: any) {
      presentationOn = on;

      if (presentationOn) {
        // Hide editor pane and resizer; expand preview to full width
        editorPane.style.display  = 'none';
        resizerEl.style.display   = 'none';
        previewPane.style.flex    = '1';
        previewPane.style.width   = '';
        // Hide the top header, editor toolbar, and task metadata bar
        if (headerEl) headerEl.style.display = 'none';
        editorToolbarEl.style.display = 'none';
        taskDateBar.style.display = 'none';
        // Show the presentation-only exit bar and populate the title
        presentationTitle.textContent = (titleInput.value || '').trim().replace(/\.md$/, '');
        presentationExitBar.classList.remove('hidden');
        btnPresentation.classList.add('btn-primary');
        btnPresentation.classList.remove('btn-ghost');
      } else {
        // Restore default two-panel layout
        editorPane.style.display  = '';
        resizerEl.style.display   = '';
        // Reset any manually dragged widths so both panes go back to flex:1 equal split
        editorPane.style.flex     = '1';
        editorPane.style.width    = '';
        previewPane.style.flex    = '1';
        previewPane.style.width   = '';
        // Restore header, editor toolbar, and task metadata bar
        // (task-date-bar's .hidden class still governs whether it appears)
        if (headerEl) headerEl.style.display = '';
        editorToolbarEl.style.display = '';
        taskDateBar.style.display = '';
        // Hide the presentation-only exit bar
        presentationExitBar.classList.add('hidden');
        btnPresentation.classList.remove('btn-primary');
        btnPresentation.classList.add('btn-ghost');
      }

      // Force a layout reflow so the preview pane recalculates its scroll area
      previewPane.style.overflow = 'hidden';
      requestAnimationFrame(() => { previewPane.style.overflow = ''; });
    }

    btnPresentation.addEventListener('click', () => setPresentation(!presentationOn));
    btnExitPresentation.addEventListener('click', () => setPresentation(false));
  })();

  // ── Editor → Preview scroll sync ─────────────────────────────────────────────
  mdEditor.addEventListener('scroll', () => {
    const editorMax = mdEditor.scrollHeight - mdEditor.clientHeight;
    if (editorMax <= 0) return;
    const pct = mdEditor.scrollTop / editorMax;
    previewOut.scrollTop = pct * (previewOut.scrollHeight - previewOut.clientHeight);
  });

  // ── Search index ──────────────────────────────────────────────────────────────

  async function buildSearchIndex() {
    const generation = workspaceSessionGeneration;
    const nextIndex: SearchIndexEntry[] = [];
    if (window.__recallstackNative?.active) {
      const prefix = DB_WS_PREFIX.startsWith('Data/') ? DB_WS_PREFIX.slice(5) : DB_WS_PREFIX;
      const notes = await window.__recallstackNative!.indexedNotes(prefix);
      if (generation !== workspaceSessionGeneration) return;
      searchIndex = mapNativeIndex(notes, prefix);
      return;
    }
    const isCurrent = () => generation === workspaceSessionGeneration;
    const topDirs = currentWorkspace?.topLevelDirs;
    if (topDirs) {
      for (const dir of topDirs) {
        await indexMarkdownDirectory(dir.handle, dir.name + '/', isCurrent, nextIndex);
      }
      if (generation === workspaceSessionGeneration) searchIndex = nextIndex;
      return;
    }
    await indexMarkdownDirectory(notesHandle!, '', isCurrent, nextIndex);
    if (generation === workspaceSessionGeneration) searchIndex = nextIndex;
  }

  function updateSearchIndex(notesRelPath: any, content: any) {
    searchIndex = upsertSearchEntry(searchIndex, notesRelPath, content);
  }

  function removeFromSearchIndex(notesRelPath: any) {
    searchIndex = removeSearchEntry(searchIndex, notesRelPath);
  }

  // ── Search query / render ─────────────────────────────────────────────────────

  async function runSearch(query: any) {
    if (window.__recallstackNative?.active) {
      const prefix = DB_WS_PREFIX.startsWith('Data/') ? DB_WS_PREFIX.slice(5) : DB_WS_PREFIX;
      const page = await window.__recallstackNative!.knowledgeSearch(query, prefix, 80, 0);
      return mapNativeSearchResults(page.results as NativeSearchResult[], prefix, query);
    }
    return searchLocalIndex(searchIndex, query);
  }

  const savedSearchBar = document.createElement('div');
  savedSearchBar.className = 'saved-search-bar';
  searchView.querySelector('.list-header')?.after(savedSearchBar);
  async function renderSavedSearches() {
    if (!window.__recallstackNative?.active) { savedSearchBar.replaceChildren(); return; }
    const generation = workspaceSessionGeneration;
    const searches = await window.__recallstackNative!.listSavedSearches();
    if (generation !== workspaceSessionGeneration) return;
    savedSearchBar.replaceChildren();
    const save = document.createElement('button');
    save.className = 'btn btn-ghost'; save.textContent = 'Save Search'; save.disabled = !searchInput.value.trim();
    save.addEventListener('click', async () => {
      const query = searchInput.value.trim(); if (!query) return;
      const name = prompt('Name this saved search:', query); if (!name?.trim()) return;
      await window.__recallstackNative!.saveSearch(name.trim(), query);
      await renderSavedSearches(); toast('Search saved');
    });
    savedSearchBar.appendChild(save);
    const recentDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    for (const [name, query] of [['Recent Notes', `modified:>=${recentDate}`], ['Overdue Tasks', 'is:task due:overdue'], ['Working Tasks', 'is:working']]) {
      const builtIn = document.createElement('button'); builtIn.className = 'saved-search-built-in'; builtIn.textContent = name;
      builtIn.addEventListener('click', async () => { searchInput.value = query; renderSearchResults(await runSearch(query), query); enterSearchView(); });
      savedSearchBar.appendChild(builtIn);
    }
    for (const saved of searches) {
      const chip = document.createElement('span'); chip.className = 'saved-search-chip';
      const run = document.createElement('button'); run.type = 'button'; run.textContent = saved.name; run.title = saved.query;
      run.addEventListener('click', async () => { searchInput.value = saved.query; renderSearchResults(await runSearch(saved.query), saved.query); enterSearchView(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = `Delete saved search ${saved.name}`;
      remove.addEventListener('click', async () => { await window.__recallstackNative!.deleteSavedSearch(saved.id); await renderSavedSearches(); });
      chip.append(run, remove); savedSearchBar.appendChild(chip);
    }
  }

  function renderSearchResults(results: any, query: any) {
    lastSearchBuffer = { query, results };
    searchSelectedIndex = 0;
    searchTypedCode = "";
    renderSearchResultsInto(searchHeading, searchGrid, results, query, esc, (result, event) => openFile(result.name, result.notesRelPath, { pinned: isPinnedClick(event) }));
    const jumpCodes = tabJumpCodes(results.length);
    searchGrid.querySelectorAll<HTMLElement>('.search-result-card').forEach((card, index) => {
      const result = results[index];
      card.tabIndex = -1;
      card.setAttribute('role', 'option');
      card.dataset.searchIndex = String(index);
      const code = jumpCodes[index];
      if (code) {
        const codeEl = document.createElement('kbd');
        codeEl.className = 'search-result-code';
        codeEl.textContent = code;
        card.prepend(codeEl);
      }
      if (result && findTabByPath(result.notesRelPath)) card.classList.add('already-open');
    });
    updateSearchResultSelection();
  }

  function searchResultCards() {
    return Array.from(searchGrid.querySelectorAll<HTMLElement>('.search-result-card'));
  }

  function updateSearchResultSelection() {
    const cards = searchResultCards();
    if (!cards.length) return;
    searchSelectedIndex = Math.min(Math.max(searchSelectedIndex, 0), cards.length - 1);
    cards.forEach((card, index) => {
      card.classList.toggle('selected', index === searchSelectedIndex);
      card.setAttribute('aria-selected', String(index === searchSelectedIndex));
    });
    cards[searchSelectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function openSelectedSearchResult(event?: { ctrlKey?: boolean; metaKey?: boolean }) {
    const result = lastSearchBuffer?.results?.[searchSelectedIndex];
    if (!result) return;
    openFile(result.name, result.notesRelPath, { pinned: isPinnedClick(event) });
  }

  // Entering/exiting search preserves whatever was showing underneath (the
  // editor, a folder listing, etc. are never touched while search is active),
  // so exiting just needs to flip back to that same view — no reload needed.
  function enterSearchView(focusResults = true) {
    if (searchView.classList.contains('hidden')) {
      preSearchView = !editorView.classList.contains('hidden')   ? 'editor'
                    : !fileListView.classList.contains('hidden') ? 'list'
                    : !calViewEl.classList.contains('hidden')    ? 'calendar'
                    : 'welcome';
    }
    showView('search');
    if (focusResults) requestAnimationFrame(() => searchGrid.focus());
  }

  function exitSearchView(focusPrevious = true) {
    if (searchView.classList.contains('hidden')) return;
    showView(preSearchView || 'list', { focus: focusPrevious });
    preSearchView = null;
  }

  let _searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearchInput() {
    clearTimeout(_searchTimer);
    const saveButton = savedSearchBar.querySelector<HTMLButtonElement>('.btn'); if (saveButton) saveButton.disabled = !searchInput.value.trim();
    _searchTimer = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (query.length < 3) {
        exitSearchView(false);
        return;
      }
      try {
        const generation = workspaceSessionGeneration;
        const results = await runSearch(query);
        if (generation !== workspaceSessionGeneration || query !== searchInput.value.trim()) return;
        renderSearchResults(results, query);
        enterSearchView(false);
      } catch (error: any) {
        toast('Search failed: ' + error.message, 'error');
      }
    }, 200);
  }

  async function executeSearch(query: any) {
    try {
      const generation = workspaceSessionGeneration;
      const results = await runSearch(query);
      if (generation !== workspaceSessionGeneration || searchInput.value.trim() !== query) return;
      renderSearchResults(results, query);
      enterSearchView();
    } catch (error: any) {
      toast('Search failed: ' + (error?.message || error), 'error');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function esc(s: any) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function isSafeUrl(value: any, attrName = '') {
    const raw = String(value || '').trim();
    if (!raw) return true;
    if (raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) return true;
    if (/^(assets|lib)\//i.test(raw)) return true;
    try {
      const u = new URL(raw, location.href);
      const p = u.protocol.toLowerCase();
      if (['http:', 'https:', 'mailto:', 'tel:', 'blob:'].includes(p)) return true;
      if (p === 'data:') return attrName === 'src' && /^data:image\//i.test(raw);
      return false;
    } catch {
      return false;
    }
  }

  function sanitizeRenderedHtml(html: any) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const blocked = new Set(['script','style','iframe','object','embed','link','meta','base','form','svg','math']);
    const remoteMediaTags = new Set(['audio','video','source','track','picture']);
    const walk = (node: any) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (blocked.has(tag)) { node.remove(); return; }
      if (tag === 'img' && !externalMediaAllowed()) {
        const src = node.getAttribute('src');
        if (src && isRemoteUrl(src)) {
          node.setAttribute('data-blocked-src', src);
          node.removeAttribute('src');
        }
        const srcset = node.getAttribute('srcset');
        if (srcset && srcset.split(',').some((part: any) => isRemoteUrl(part.trim().split(/\s+/)[0]))) {
          node.removeAttribute('srcset');
        }
      }
      if (remoteMediaTags.has(tag) && !externalMediaAllowed()) {
        const srcAttrs = ['src', 'poster', 'srcset'];
        if (srcAttrs.some(a => {
          const v = node.getAttribute(a);
          if (!v) return false;
          return a === 'srcset'
            ? v.split(',').some((part: any) => isRemoteUrl(part.trim().split(/\s+/)[0]))
            : isRemoteUrl(v);
        })) {
          node.replaceWith(document.createTextNode('[external media blocked]'));
          return;
        }
      }
      if (tag === 'input') {
        const type = (node.getAttribute('type') || '').toLowerCase();
        if (type !== 'checkbox') { node.remove(); return; }
      }
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
          node.removeAttribute(attr.name);
          continue;
        }
        if (name === 'srcset' && !externalMediaAllowed() && value.split(',').some((part: any) => isRemoteUrl(part.trim().split(/\s+/)[0]))) {
          node.removeAttribute(attr.name);
          continue;
        }
        if (['href','src','cite','xlink:href','formaction','action'].includes(name) && !isSafeUrl(value, name === 'xlink:href' ? 'href' : name)) {
          node.removeAttribute(attr.name);
          continue;
        }
        if (name === 'target' && value !== '_blank') node.removeAttribute(attr.name);
      }
      if (tag === 'a' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
      [...node.children].forEach(walk);
    };
    [...template.content.children].forEach(walk);
    return template.innerHTML;
  }

  function isRemoteUrl(value: any) {
    try {
      const u = new URL(value, location.href);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function externalMediaAllowed() {
    return remoteMediaSessionAllowed || localStorage.getItem('pkm-load-remote-media') === 'on';
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  $id('btn-open-workspace').addEventListener('click', async () => {
    try {
      await chooseAndOpenWorkspace();
    } catch (e: any) {
      if (e.name !== 'AbortError') toast('Could not open folder: ' + e.message, 'error');
    }
  });

  async function reloadActiveList() {
    // The open listing modal, if any, owns the refresh — rebuild it in place
    // while keeping its current sort / archived toggle state.
    const openListing = taskListing.isOpen() ? taskListing : workingListing.isOpen() ? workingListing : notesListing.isOpen() ? notesListing : null;
    if (openListing && activeListingRebuild) {
      try { openListing.refresh(await activeListingRebuild()); } catch { /* best effort */ }
      return;
    }
    switch (listReloadMode({ allTasksMode, outputsMode, outputsActiveFolder, l1Active, l2Active })) {
      case "all-tasks": await loadAllTasks(); break;
      case "outputs": await loadOutputsFiles(outputsActiveFolder); break;
      case "folder":
        if (l1Active && !folderUsesInlineList(activeFolderHeading(), l1Active.name)) break; // notes modal owns it
        await loadFiles(activeDirHandle(), activeFolderHeading());
        break;
      case "none": break;
    }
  }

  let externalConflict: any = null;

  function removeExternalChangeBanner() {
    $maybe('external-change-banner')?.remove();
    externalConflict = null;
  }

  function showExternalCompare(localText: any, diskText: any) {
    $maybe('external-compare-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'external-compare-modal';
    overlay.className = 'modal-overlay external-compare-modal';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog-wide';
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'External change comparison';
    const grid = document.createElement('div');
    grid.className = 'external-compare-grid';
    for (const [heading, text] of [['Your editor', localText], ['On disk', diskText]]) {
      const section = document.createElement('section');
      const label = document.createElement('h3');
      const pre = document.createElement('pre');
      label.textContent = heading;
      pre.textContent = text;
      section.append(label, pre);
      grid.appendChild(section);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const close = document.createElement('button');
    close.className = 'btn btn-ghost';
    close.textContent = 'Close';
    close.addEventListener('click', () => overlay.remove());
    actions.appendChild(close);
    dialog.append(title, grid, actions);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (event: any) => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function showExternalChangeBanner(conflict: any) {
    externalConflict = conflict;
    let banner = $maybe('external-change-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'external-change-banner';
      banner.className = 'external-change-banner';
      editorView.prepend(banner);
    }
    banner.replaceChildren();
    const message = document.createElement('span');
    message.textContent = conflict.removed
      ? 'This note was removed outside RecallStack. Your unsaved editor content is safe.'
      : 'This note changed outside RecallStack. Your unsaved editor content has not been replaced.';
    const compare = document.createElement('button');
    compare.className = 'btn btn-ghost';
    compare.textContent = 'Compare';
    compare.disabled = conflict.removed;
    compare.addEventListener('click', () => showExternalCompare(mdEditor.value, conflict.text || ''));
    const reload = document.createElement('button');
    reload.className = 'btn btn-ghost';
    reload.textContent = 'Reload from disk';
    reload.disabled = conflict.removed;
    reload.addEventListener('click', () => {
      if (!externalConflict || externalConflict.removed) return;
      mdEditor.value = externalConflict.text;
      savedContent = externalConflict.text;
      syncActiveTabFromState();
      renderTabStrip();
      nativeFileVersions.set(externalConflict.nativePath, externalConflict.version);
      lsDraftClear(currentPath);
      renderPreview();
      removeExternalChangeBanner();
      toast('Reloaded external changes');
    });
    const keep = document.createElement('button');
    keep.className = 'btn btn-primary';
    keep.textContent = 'Keep my version';
    keep.addEventListener('click', () => {
      if (externalConflict?.version) nativeFileVersions.set(externalConflict.nativePath, externalConflict.version);
      removeExternalChangeBanner();
      toast('Your editor version is retained; Save to write it to disk');
    });
    banner.append(message, compare, reload, keep);
  }

  async function handleExternalEditorChange(change: any, precomputedNativePath?: string) {
    if (!currentPath || change.internal || change.entity !== 'markdown') return;
    const currentNativePath = precomputedNativePath ?? normalizeAppPath(DB_WS_PREFIX + currentPath);
    const changedPath = normalizeAppPath(change.path);
    const priorPath = change.previousPath ? normalizeAppPath(change.previousPath) : '';
    if (changedPath !== currentNativePath && priorPath !== currentNativePath) return;

    if (change.kind === 'remove') {
      if (mdEditor.value !== savedContent) showExternalChangeBanner({ nativePath: currentNativePath, removed: true });
      else toast('The open note was removed outside RecallStack', 'error');
      return;
    }

    let nativePath = changedPath;
    if (change.kind === 'rename' && priorPath === currentNativePath) {
      const prefix = normalizeAppPath(DB_WS_PREFIX).replace(/\/+$/, '') + '/';
      currentPath = changedPath.startsWith(prefix) ? changedPath.slice(prefix.length) : currentPath;
      syncActiveTabFromState();
      renderTabStrip();
    }
    try {
      const disk = await window.__recallstackNative!.readText(nativePath);
      if (mdEditor.value === savedContent) {
        const selectionStart = mdEditor.selectionStart;
        const selectionEnd = mdEditor.selectionEnd;
        const scrollTop = mdEditor.scrollTop;
        mdEditor.value = disk.text;
        savedContent = disk.text;
        syncActiveTabFromState();
        renderTabStrip();
        nativeFileVersions.set(nativePath, disk.version);
        mdEditor.setSelectionRange(Math.min(selectionStart, disk.text.length), Math.min(selectionEnd, disk.text.length));
        mdEditor.scrollTop = scrollTop;
        renderPreview();
        removeExternalChangeBanner();
      } else {
        showExternalChangeBanner({ nativePath, text: disk.text, version: disk.version, removed: false });
      }
    } catch (error: any) {
      console.warn('Could not inspect external editor change', error);
    }
  }

  function changeAffectsActiveList(change: any) {
    const path = normalizeAppPath(change?.path);
    const workspacePrefix = normalizeAppPath(DB_WS_PREFIX).replace(/\/+$/, '');
    if (!path || !workspacePrefix || !path.startsWith(workspacePrefix + '/')) return false;

    const workspacePath = path.slice(workspacePrefix.length + 1);
    if (allTasksMode) {
      return change.entity === 'markdown'
        && /^[^/]+\/tasks(?:\/working)?(?:\/[^/]+\.md)?$/i.test(workspacePath);
    }
    if (!l1Active) return false;

    const visibleFolder = normalizeAppPath(DB_WS_PREFIX + activeFolderPath()).replace(/\/+$/, '');
    if (path === visibleFolder) return true;
    if (!path.startsWith(visibleFolder + '/')) return false;
    const childPath = path.slice(visibleFolder.length + 1);
    if (!childPath.includes('/')) return true;
    return !archiveMode
      && activeFolderHeading() === 'tasks'
      && /^working\/[^/]+$/i.test(childPath);
  }

  let _nativeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let _themeReloadTimer: ReturnType<typeof setTimeout> | undefined;
  let _backlinksRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let _catalogRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleBacklinksRefresh(delayMs = 250) {
    clearTimeout(_backlinksRefreshTimer);
    _backlinksRefreshTimer = setTimeout(() => {
      void refreshBacklinks().then(() => {
        previewOut.querySelector('.preview-backlinks')?.remove();
        appendBacklinks();
      });
    }, delayMs);
  }
  function scheduleActiveListRefresh(delayMs: number, editorMustBeHidden = false) {
    clearTimeout(_nativeRefreshTimer);
    _nativeRefreshTimer = setTimeout(() => {
      if (editorMustBeHidden && !editorView.classList.contains('hidden')) return;
      reloadActiveList().catch(e => toast(e.message, 'error'));
    }, delayMs);
  }
  function scheduleCatalogRefresh(delayMs = 400) {
    clearTimeout(_catalogRefreshTimer);
    _catalogRefreshTimer = setTimeout(() => {
      buildSearchIndex().catch(error => console.warn('Could not refresh note catalog', error));
    }, delayMs);
  }

  // Above this many distinct changed paths in one (already-coalesced) batch,
  // stop inspecting individual entries — a single full list refresh is both
  // cheaper and more correct than replaying hundreds of them. This is the path
  // that used to stall the UI when returning after a long idle with a large
  // backlog of background file writes.
  const BULK_CHANGE_THRESHOLD = 400;

  window.addEventListener('recallstack-workspace-changes', (event: any) => {
    const changes: any[] = Array.isArray(event.detail?.changes) ? event.detail.changes : [];
    const overflowed = event.detail?.overflowed === true;
    const bulk = overflowed || changes.length > BULK_CHANGE_THRESHOLD;

    // One pass: derive every flag we need instead of re-scanning the array.
    let themeChanged = false;
    let affectsActiveList = false;
    let hasMarkdown = false;
    const currentNativePath = currentPath ? normalizeAppPath(DB_WS_PREFIX + currentPath) : null;
    for (const change of changes) {
      if (change.entity === 'markdown') hasMarkdown = true;
      if (!change.internal && change.path === 'Apps/themes.json') themeChanged = true;
      if (!bulk) {
        if (currentNativePath) void handleExternalEditorChange(change, currentNativePath);
        if (!affectsActiveList && !change.internal && changeAffectsActiveList(change)) affectsActiveList = true;
      }
    }

    if (bulk || event.detail?.sequenceGap) {
      scheduleActiveListRefresh(150);
      scheduleCatalogRefresh(150);
    } else if (affectsActiveList) {
      scheduleActiveListRefresh(100, true);
    }

    if (themeChanged) {
      clearTimeout(_themeReloadTimer);
      _themeReloadTimer = setTimeout(async () => {
        const loaded = await loadWorkspaceThemes();
        const savedTheme = activeWorkspace ? localStorage.getItem('pkm-theme-' + activeWorkspace) : null;
        const theme = savedTheme && THEMES[savedTheme] ? savedTheme : defaultThemeId;
        themeSelect.value = theme;
        applyTheme(theme, false);
        if (loaded) toast('Themes reloaded');
      }, 250);
    }

    if (hasMarkdown && currentPath) scheduleBacklinksRefresh();
  });
  window.addEventListener('recallstack-index-status', (event: any) => {
    if (event.detail?.state === 'ready' && searchInput.value.trim().length >= 3) {
      onSearchInput();
    } else if (event.detail?.state === 'error') {
      toast('Search index failed: ' + (event.detail.message || 'unknown error'), 'error');
    }
    if (event.detail?.state === 'ready') {
      // Debounced: a catch-up after idle can emit "ready" several times in a row.
      scheduleCatalogRefresh();
      scheduleBacklinksRefresh(0);
    }
  });

  function setSortMode(mode: any) {
    sortMode = mode;
    btnSortMtime.classList.toggle('active', mode === 'mtime');
    btnSortAlpha.classList.toggle('active', mode === 'alpha');
    reloadActiveList().catch(e => toast(e.message, 'error'));
  }

  // ── Keyboard-first open-tab switcher ───────────────────────────────────────
  const quickTabOverlay = document.createElement('div');
  quickTabOverlay.id = 'quick-tab-switcher';
  quickTabOverlay.className = 'quick-tab-switcher hidden';
  quickTabOverlay.innerHTML = `<div id="quick-tab-switcher-dialog" class="quick-tab-switcher-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-tab-switcher-title"><div class="quick-tab-switcher-header"><div><div id="quick-tab-switcher-title" class="quick-tab-switcher-title">Open Tabs</div><div class="quick-tab-switcher-subtitle">Switch to an open note, task, or output file</div></div><div id="quick-tab-typed-code" class="quick-tab-typed-code" aria-live="polite"></div></div><div id="quick-tab-results" class="quick-tab-results" role="listbox" aria-label="Open tabs" tabindex="0"></div><div class="quick-tab-switcher-footer"><span>↓ / J Down</span><span>↑ / K Up</span><span>Enter Open</span><span>X Close</span><span>Letter Code Jump</span><span>Esc Cancel</span></div></div>`;
  document.body.appendChild(quickTabOverlay);
  const quickTaskOverlay = document.createElement('div');
  quickTaskOverlay.id = 'quick-task-switcher';
  quickTaskOverlay.className = 'quick-tab-switcher hidden quick-task-switcher';
  quickTaskOverlay.innerHTML = `<div id="quick-task-switcher-dialog" class="quick-tab-switcher-dialog quick-task-switcher-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-task-switcher-title"><div class="quick-tab-switcher-header"><div><div id="quick-task-switcher-title" class="quick-tab-switcher-title">Tasks</div><div class="quick-tab-switcher-subtitle">Open a workspace task. Ctrl+Enter pins the selected task.</div></div><div id="quick-task-typed-code" class="quick-tab-typed-code" aria-live="polite"></div></div><div id="quick-task-results" class="quick-tab-results" role="listbox" aria-label="Tasks" tabindex="0"></div><div class="quick-tab-switcher-footer"><span>↓ / J Down</span><span>↑ / K Up</span><span>Enter Open</span><span>Ctrl+Enter Pin</span><span>Letter Code Jump</span><span>Esc Cancel</span></div></div>`;
  document.body.appendChild(quickTaskOverlay);
  const quickTabSwitcher = new QuickTabSwitcherController({
    overlay: quickTabOverlay,
    dialog: $id('quick-tab-switcher-dialog'),
    list: $id('quick-tab-results'),
    typedCode: $id('quick-tab-typed-code'),
  });
  const quickTaskSwitcher = new QuickTabSwitcherController({
    overlay: quickTaskOverlay,
    dialog: $id('quick-task-switcher-dialog'),
    list: $id('quick-task-results'),
    typedCode: $id('quick-task-typed-code'),
  });

  function quickTabKind(tab: any) {
    if (tab.isOutputsFile) return 'Output';
    if (tab.isExternalFile) return 'External';
    if (isJournalNote(tab.path)) return 'Journal';
    if (tab.path?.split('/').includes('working')) return 'Working Task';
    if (isCurrentTaskPath(tab.path)) return 'Task';
    return 'Note';
  }

  function quickTabItems() {
    return tabs.map(tab => ({
      id: tab.id,
      title: tab.title || 'Untitled',
      path: tab.path || 'Unsaved file',
      kind: quickTabKind(tab),
      dirty: Boolean(tab.dirty),
    }));
  }

  function openQuickTabSwitcher() {
    if (!tabs.length) { toast('No open tabs'); return false; }
    syncActiveTabFromState();
    return quickTabSwitcher.open({
      items: quickTabItems(),
      activeId: activeTabId,
      async activate(tabId) {
        const activated = await activateTab(tabId);
        if (activated) mdEditor.focus();
        return activated;
      },
      async closeItem(tabId) {
        if (!await closeTab(tabId)) return null;
        return { items: quickTabItems(), activeId: activeTabId };
      },
    });
  }

  async function collectQuickTaskItems() {
    const tasksDir = await getDirHandle(notesHandle!, [TASKS_ROOT], true);
    const entries: any[] = [];
    const raw = await Promise.all((await listMdFiles(tasksDir)).map(enrichFileContent));
    raw.forEach(file => entries.push({ file, path: `${TASKS_ROOT}/${file.name}`, inWorking: false }));
    try {
      const workingDir = await tasksDir.getDirectoryHandle('working');
      const working = await Promise.all((await listMdFiles(workingDir)).map(enrichFileContent));
      working.forEach(file => entries.push({ file, path: `${TASKS_ROOT}/working/${file.name}`, inWorking: true }));
    } catch {}
    return sortTaskEntries(entries).map((entry, index) => ({
      id: index + 1,
      title: taskDisplayTitle(entry.file.name),
      path: entry.path,
      kind: entry.inWorking ? 'Working Task' : 'Task',
      dirty: Boolean(findTabByPath(entry.path)?.dirty),
    }));
  }

  async function openQuickTaskSwitcher() {
    if (!notesHandle) return false;
    const items = await collectQuickTaskItems();
    if (!items.length) { toast('No tasks found'); return false; }
    return quickTaskSwitcher.open({
      items,
      activeId: null,
      async activate(itemId, pinned = false) {
        const item = items.find(candidate => candidate.id === itemId);
        if (!item) return false;
        const opened = await openFile(item.path.split('/').at(-1)!, item.path, { pinned });
        if (opened) mdEditor.focus();
        return Boolean(opened);
      },
      async closeItem() { return null; },
    });
  }

  // ── Shared command registry and keyboard-first palette ──────────────────────
  const commandRegistry = new CommandRegistry();
  const commandUsageKey = 'recallstack-command-usage-v1';
  let commandUsage: Record<string, number> = {};
  try { commandUsage = JSON.parse(localStorage.getItem(commandUsageKey) || '{}'); } catch { commandUsage = {}; }
  const commandState = () => ({
    workspaceOpen: Boolean(rootHandle),
    editorOpen: !editorView.classList.contains('hidden'),
    nativeDesktop: Boolean(window.__recallstackNative?.active),
  });
  const commandContext = () => ({
    state: commandState(),
    reportError(error: any, command: any) { toast(`${command.title} failed: ${error?.message || error}`, 'error'); },
  });
  const needsWorkspace = (state: any) => state.workspaceOpen;
  const needsEditor = (state: any) => state.editorOpen;
  const desktopOnly = (state: any) => state.nativeDesktop && state.workspaceOpen;
  const registerCommand = (command: any) => commandRegistry.register(command);
  [
    { id:'workspace.open', title:'Open or Switch Workspace', category:'Workspace', keywords:['folder'], run:() => $id('btn-open-workspace').click() },
    { id:'workspace.recent', title:'Open Recent Workspace', category:'Workspace', keywords:['switch pinned'], isVisible:(state: any) =>state.nativeDesktop, run:() => {} },
    { id:'file.new', title:'Create Note, Task, or Working Task', category:'File', keywords:['new'], shortcut:'Ctrl+N', isEnabled:needsWorkspace, disabledReason:()=>'Open a workspace first', run:newNote },
    { id:'file.save', title:'Save Note', category:'File', shortcut:'Ctrl+S', isEnabled:needsEditor, disabledReason:()=>'Open a note first', run:() => saveNote() },
    { id:'file.move', title:'Move or Rename Note', category:'File', isEnabled:needsEditor, disabledReason:()=>'Open a note first', run:openMoveFileModal },
    { id:'file.archive', title:'Archive or Restore Note', category:'File', isEnabled:needsEditor, disabledReason:()=>'Open a note first', run:() => btnArchive.classList.contains('restore') ? restoreNote() : archiveNote() },
    { id:'file.trash', title:'Move Note to Trash', category:'File', keywords:['delete'], isEnabled:needsEditor, disabledReason:()=>'Open a note first', run:deleteNote },
    { id:'tabs.close', title:'Close Tab', category:'File', keywords:['tab'], shortcut:'Ctrl+Q', isEnabled:()=>activeTabId != null, disabledReason:()=>'No tab open', run:closeActiveTab },
    { id:'tabs.close-others', title:'Close Other Tabs', category:'File', keywords:['tab'], isEnabled:()=>tabs.length > 1, disabledReason:()=>'Only one tab open', run:() => closeOtherTabs() },
    { id:'tabs.reopen-closed', title:'Reopen Closed Tab', category:'File', keywords:['tab', 'undo'], isEnabled:()=>closedTabHistory.length > 0, disabledReason:()=>'No recently closed tabs', run:reopenClosedTab },
    { id:'navigation.search', title:'Search Notes', category:'Navigation', keywords:['find'], shortcut:'Ctrl+/', isEnabled:needsWorkspace, run:() => searchInput.focus() },
    { id:'navigation.today', title:'Open Today Journal', category:'Navigation', keywords:['journal daily'], shortcut:'Ctrl+J', isEnabled:needsWorkspace, run:openTodayJournal },
    { id:'navigation.next-tab', title:'Next Tab', category:'Navigation', keywords:['tab'], shortcut:'Ctrl+Tab', isEnabled:()=>tabs.length > 1, disabledReason:()=>'Only one tab open', run:() => switchToRelativeTab(1) },
    { id:'navigation.previous-tab', title:'Previous Tab', category:'Navigation', keywords:['tab'], shortcut:'Ctrl+Shift+Tab', isEnabled:()=>tabs.length > 1, disabledReason:()=>'Only one tab open', run:() => switchToRelativeTab(-1) },
    { id:'tasks.new-working', title:'Create Working Task', category:'Tasks', isEnabled:needsWorkspace, run:createWorkingTask },
    { id:'tasks.quick-open', title:'Open Task', category:'Tasks', keywords:['tasks quick'], isEnabled:needsWorkspace, run:openQuickTaskSwitcher },
    { id:'tasks.list', title:'Show Task Listing', category:'Tasks', keywords:['tasks all list'], shortcut:'Ctrl+T', isEnabled:needsWorkspace, run:openTaskListing },
    { id:'tasks.working-list', title:'Show Working Task Listing', category:'Tasks', keywords:['working tasks list'], shortcut:'Ctrl+W', isEnabled:needsWorkspace, run:openWorkingListing },
    { id:'navigation.notes-list', title:'Show Notes Listing', category:'Navigation', keywords:['notes folder list'], shortcut:'Ctrl+L', isEnabled:needsWorkspace, run:openNotesListing },
    { id:'view.theme-switcher', title:'Open Theme Switcher', category:'View', keywords:['appearance color preview'], shortcut:'Ctrl+Shift+T', isEnabled:needsWorkspace, run:openThemeSwitcher },
    { id:'view.presentation', title:'Toggle Presentation Mode', category:'View', shortcut:'F12', isEnabled:needsEditor, run:() => $id('btn-presentation').click() },
    { id:'view.zoom-in', title:'Zoom In', category:'View', shortcut:'Ctrl++', isEnabled:needsWorkspace, run:() => stepContentZoom(1) },
    { id:'view.zoom-out', title:'Zoom Out', category:'View', shortcut:'Ctrl+-', isEnabled:needsWorkspace, run:() => stepContentZoom(-1) },
    { id:'view.zoom-reset', title:'Reset Zoom', category:'View', shortcut:'Ctrl+0', isEnabled:needsWorkspace, run:() => setContentZoom(0) },
    { id:'view.line-numbers', title:'Toggle Editor Line Numbers', category:'View', isEnabled:needsEditor, run:() => $id('btn-line-numbers').click() },
    { id:'editor.insert-link', title:'Insert Markdown Link', category:'Editor', isEnabled:needsEditor, run:() => insertAtCursor('[link text](url)') },
    { id:'editor.insert-code', title:'Insert Code Block', category:'Editor', isEnabled:needsEditor, run:() => insertAtCursor('```\n\n```') },
    { id:'editor.insert-mermaid', title:'Insert Mermaid Block', category:'Editor', isEnabled:needsEditor, run:() => insertAtCursor('```mermaid\ngraph TD\n  A --> B\n```') },
    { id:'view.theme', title:'Change Theme', category:'View', keywords:['appearance color'], run:(_context: any, argument: any) => { if (argument && THEMES[argument]) { themeSelect.value = argument; applyTheme(argument); } } },
    { id:'tools.validate', title:'Validate Workspace', category:'Tools', isVisible:(state: any) =>state.nativeDesktop, isEnabled:desktopOnly, run:() => { openSafetyTools(); return runSafetyAction('validate'); } },
    { id:'tools.rebuild-index', title:'Rebuild Search Index', category:'Tools', isVisible:(state: any) =>state.nativeDesktop, isEnabled:desktopOnly, run:() => { openSafetyTools(); return runSafetyAction('rebuild'); } },
    { id:'tools.backup', title:'Backup Workspace', category:'Tools', isVisible:(state: any) =>state.nativeDesktop, isEnabled:desktopOnly, run:() => { openSafetyTools(); return runSafetyAction('backup'); } },
    { id:'tools.git-status', title:'Show Git Status', category:'Tools', isVisible:(state: any) =>state.nativeDesktop, isEnabled:desktopOnly, run:() => { openSafetyTools(); return runSafetyAction('git'); } },
    { id:'workspace.reveal-file', title:'Reveal Current File', category:'Workspace', isVisible:(state: any) =>state.nativeDesktop, isEnabled:(state: any) => needsEditor(state) && !isExternalFile, disabledReason:()=>isExternalFile ? 'Not available for external files' : 'Open a note first', run:() => window.__recallstackNative!.revealPath(appLocalPathForCurrentFile()) },
    { id:'workspace.reveal-folder', title:'Reveal Workspace Folder', category:'Workspace', isVisible:(state: any) =>state.nativeDesktop, isEnabled:needsWorkspace, run:() => window.__recallstackNative!.revealWorkspace() },
    { id:'workspace.close-app', title:'Close RecallStack', category:'Workspace', isVisible:(state: any) =>state.nativeDesktop, run:() => window.__recallstackNative!.closeApp() },
  ].forEach(registerCommand);

  const palette = document.createElement('div');
  palette.id = 'command-palette';
  palette.className = 'command-palette hidden';
  palette.innerHTML = `<div class="command-palette-dialog" role="dialog" aria-modal="true" aria-label="Command palette"><label class="sr-only" for="command-palette-input">Search commands</label><input id="command-palette-input" class="command-palette-input" role="combobox" aria-autocomplete="list" aria-controls="command-palette-results" aria-expanded="true" autocomplete="off" spellcheck="false" placeholder="Type a command…  @ notes  # tags  ? help"><div id="command-palette-results" class="command-palette-results" role="listbox"></div><div class="command-palette-footer">↑↓ Navigate · Enter Run · Esc Back/Close · Ctrl+K Commands</div></div>`;
  document.body.appendChild(palette);
  const paletteInput = $id('command-palette-input');
  const paletteResults = $id('command-palette-results');
  let paletteItems: any[] = [];
  let paletteIndex = 0;
  let palettePreviousFocus: HTMLElement | null = null;
  let paletteArgumentCommand: any = null;

  function paletteEntries() {
    if (paletteArgumentCommand?.id === 'view.theme') {
      return Object.keys(THEMES).map(id => ({ id:`theme:${id}`, title:themeDetails[id]?.name || id, meta:'Theme', run:() => executeCommand('view.theme', id) }));
    }
    if (paletteArgumentCommand?.id === 'workspace.recent') {
      return (paletteArgumentCommand.arguments || []).map((workspace: any) => ({
        id:`workspace:${workspace.id}`,
        title:workspace.name,
        meta:workspace.path,
        run:async()=>reopenWorkspaceChoice({ ...workspace, native:true }),
      }));
    }
    const parsed = paletteMode(paletteInput.value);
    if (parsed.mode === 'notes') return searchIndex
      .filter(note => !parsed.query || `${note.name} ${note.notesRelPath}`.toLowerCase().includes(parsed.query.toLowerCase()))
      .slice(0, 100).map(note => ({ id:`note:${note.notesRelPath}`, title:taskDisplayTitle(note.name), meta:note.notesRelPath, run:() => openFile(note.name, note.notesRelPath) }));
    if (parsed.mode === 'tags') {
      const tags = new Set<string>();
      searchIndex.forEach(note => (note.tags || []).forEach(tag => tags.add(`#${tag}`)));
      return [...tags].filter(tag => !parsed.query || tag.toLowerCase().includes(parsed.query.toLowerCase())).sort().map(tag => ({ id:`tag:${tag}`, title:tag, meta:'Search tag', run:async() => { searchInput.value=tag; await executeSearch(tag); } }));
    }
    if (parsed.mode === 'help') return [
      { id:'help:commands', title:'> commands', meta:'Search every application command' },
      { id:'help:notes', title:'@ notes', meta:'Open an indexed note' },
      { id:'help:tags', title:'# tags', meta:'Search notes by tag' },
      { id:'help:keys', title:'Ctrl+K · arrows · Enter · Escape', meta:'Keyboard controls' },
    ];
    return rankCommands(commandRegistry.list(commandState()), parsed.query, commandUsage).map(({command}) => ({
      id:command.id, title:command.title, meta:command.category, shortcut:command.shortcut,
      disabled:!commandRegistry.enabled(command, commandState()),
      reason:commandRegistry.disabledReason(command, commandState()),
      run:() => command.id === 'view.theme' ? openPaletteArgument(command) : command.id === 'workspace.recent' ? openRecentWorkspaceArgument(command) : executeCommand(command.id),
    }));
  }

  function renderPalette() {
    paletteItems = paletteEntries();
    paletteIndex = Math.max(0, Math.min(paletteIndex, paletteItems.length - 1));
    paletteResults.replaceChildren();
    paletteItems.forEach((item: any, index: any) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'command-palette-item'; row.id = `command-option-${index}`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === paletteIndex));
      row.disabled = Boolean(item.disabled);
      row.innerHTML = `<span><strong>${esc(item.title)}</strong><small>${esc(item.reason || item.meta || '')}</small></span>${item.shortcut ? `<kbd>${esc(item.shortcut)}</kbd>` : ''}`;
      row.addEventListener('mouseenter', () => { paletteIndex = index; renderPaletteSelection(); });
      row.addEventListener('click', () => runPaletteItem(index));
      paletteResults.appendChild(row);
    });
    paletteInput.setAttribute('aria-activedescendant', paletteItems.length ? `command-option-${paletteIndex}` : '');
  }
  function renderPaletteSelection() {
    paletteResults.querySelectorAll('[role="option"]').forEach((row, index) => row.setAttribute('aria-selected', String(index === paletteIndex)));
    paletteInput.setAttribute('aria-activedescendant', paletteItems.length ? `command-option-${paletteIndex}` : '');
    paletteResults.children[paletteIndex]?.scrollIntoView({block:'nearest'});
  }
  function openPaletteArgument(command: any) { paletteArgumentCommand = command; paletteInput.value=''; paletteInput.placeholder=`${command.title}…`; renderPalette(); }
  async function openRecentWorkspaceArgument(command: any) { command.arguments = await window.__recallstackNative!.recentWorkspaces(); openPaletteArgument(command); }
  function openCommandPalette(initial='') {
    palettePreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; paletteArgumentCommand = null; paletteInput.value=initial;
    palette.classList.remove('hidden'); paletteIndex=0; renderPalette(); requestAnimationFrame(() => paletteInput.focus());
  }
  function closeCommandPalette() {
    palette.classList.add('hidden'); paletteArgumentCommand=null; paletteInput.placeholder='Type a command…  @ notes  # tags  ? help';
    if (palettePreviousFocus?.focus) palettePreviousFocus.focus();
  }
  async function executeCommand(id: string, argument?: unknown) {
    const succeeded = await commandRegistry.execute(id, commandContext(), argument);
    if (succeeded) { commandUsage[id]=(commandUsage[id] || 0)+1; localStorage.setItem(commandUsageKey, JSON.stringify(commandUsage)); }
    return succeeded;
  }
  async function runPaletteItem(index=paletteIndex) {
    const item = paletteItems[index]; if (!item || item.disabled || !item.run) return;
    const keepOpen = item.id === 'view.theme' || item.id === 'workspace.recent'; await item.run(); if (!keepOpen) closeCommandPalette();
  }
  paletteInput.addEventListener('input', () => { paletteIndex=0; renderPalette(); });
  paletteInput.addEventListener('keydown', (event: any) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); paletteIndex = (paletteIndex + (event.key==='ArrowDown'?1:-1) + paletteItems.length) % Math.max(1,paletteItems.length); renderPaletteSelection(); }
    else if (event.key === 'PageDown' || event.key === 'PageUp') { event.preventDefault(); paletteIndex=Math.max(0,Math.min(paletteItems.length-1,paletteIndex+(event.key==='PageDown'?8:-8))); renderPaletteSelection(); }
    else if (event.key === 'Enter') { event.preventDefault(); runPaletteItem(); }
    else if (event.key === 'Escape') { event.preventDefault(); if (paletteArgumentCommand) { paletteArgumentCommand=null; paletteInput.value=''; renderPalette(); } else closeCommandPalette(); }
    else if (event.key === 'Tab') { event.preventDefault(); }
  });
  palette.addEventListener('click', (event: any) => { if (event.target === palette) closeCommandPalette(); });

  btnSortMtime.addEventListener('click', () => setSortMode('mtime'));
  btnSortAlpha.addEventListener('click', () => setSortMode('alpha'));
  if (btnAllTasksMode) btnAllTasksMode.addEventListener('click', toggleAllTasksGroupingMode);

  // Set default active state to match initial sortMode
  btnSortMtime.classList.add('active');

  btnNew.addEventListener('click', () => executeCommand('file.new'));
  btnSave.addEventListener('click', () => executeCommand('file.save'));

  // Reflect keybindings in control tooltips (single source: keymap.ts).
  applyShortcutHint(btnNew, 'file.new', 'New file');
  applyShortcutHint(btnNewFromEditor, 'file.new', 'New file');
  applyShortcutHint(btnSave, 'file.save', 'Save');
  applyShortcutHint(btnOpenImport, 'tools.import', 'Open / Import Files');
  applyShortcutHint($id('btn-presentation'), 'view.presentation', 'Toggle presentation mode');
  applyShortcutHint($id('btn-search'), 'navigation.search', 'Search');
  btnStampDate.addEventListener('click', async () => {
    if (isWorkingTask()) return;
    const dateStr = localIsoDate(new Date());
    const datePattern = / \d{4}-\d{2}-\d{2}(?=\.md$|$)/;
    let val = titleInput.value.trim();
    const hasMd = val.toLowerCase().endsWith('.md');
    const base = hasMd ? val.slice(0, -3) : val;
    const newBase = datePattern.test(base) ? base.replace(datePattern, ' ' + dateStr) : base + ' ' + dateStr;
    titleInput.value = hasMd ? newBase + '.md' : newBase;
    await saveNote();
  });
  taskInputStatus.addEventListener('click', async (e: any) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    updateTaskStatus(btn.dataset.status);
    await saveNote();
  });
  btnMakeCopy.addEventListener('click', makeCopy);
  btnCopyMd.addEventListener('click', async () => {
    await copyPlainText(mdEditor.value);
    toast('Copied to clipboard');
  });
  btnCopyHtml.addEventListener('click', async () => {
    const rootCs = getComputedStyle(document.documentElement);
    const v = (name: any) => rootCs.getPropertyValue(name).trim();

    const clone = previewOut.cloneNode(true) as HTMLElement;
    // Force-open all collapsible sections so their content is included in the copy
    clone.querySelectorAll('details.md-collapsible').forEach((d: any) => d.setAttribute('open', ''));
    const liveEls  = [...previewOut.querySelectorAll('*')];
    const cloneEls = [...clone.querySelectorAll('*')];

    const PROPS = [
      'color', 'background-color',
      'font-family', 'font-size', 'font-weight', 'font-style',
      'line-height', 'letter-spacing',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-top-style', 'border-top-color',
      'border-right-width', 'border-right-style', 'border-right-color',
      'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
      'border-left-width', 'border-left-style', 'border-left-color',
      'border-top-left-radius', 'border-top-right-radius',
      'border-bottom-left-radius', 'border-bottom-right-radius',
      'border-collapse',
      'text-align', 'text-decoration-line', 'text-decoration-color',
      'text-underline-offset', 'text-transform',
      'display', 'list-style-type', 'list-style-position',
      'white-space', 'overflow-x', 'vertical-align',
      'max-width', 'width',
      'flex-direction', 'flex-wrap', 'align-items', 'gap',
      'flex-basis', 'flex-shrink',
    ];

    liveEls.forEach((liveEl, i) => {
      const cloneEl = cloneEls[i];
      const cs = getComputedStyle(liveEl);
      const parts: string[] = [];
      PROPS.forEach(prop => {
        const val = cs.getPropertyValue(prop);
        // Suppress display:none that leaks from closed collapsible sections — the clone has them forced open
        if (prop === 'display' && val === 'none' && liveEl.closest('details.md-collapsible:not([open])')) return;
        if (val && val !== '' && !(prop.includes('border') && prop.includes('style') && val === 'none'))
          parts.push(`${prop}:${val}`);
      });
      if (parts.length) cloneEl.setAttribute('style', parts.join(';'));
    });

    clone.querySelectorAll('.copy-btn, .code-lang, button, .md-collapsible-indicator').forEach((el: any) => el.remove());
    clone.querySelectorAll('.inline-code-wrap').forEach((wrap: any) => {
      while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });

    // Replace <details>/<summary> with plain <h{n}> + unwrapped content so headings
    // paste as block elements in any rich-text editor that ignores details/summary semantics
    clone.querySelectorAll('details.md-collapsible').forEach((details: any) => {
      const level  = details.dataset.collapsibleStopLevel;
      const summary = details.querySelector(':scope > summary');
      if (!summary || !level) return;
      const heading = document.createElement('h' + level);
      heading.setAttribute('style', summary.getAttribute('style') || '');
      const textSpan = summary.querySelector('span');
      heading.innerHTML = textSpan ? textSpan.innerHTML : summary.textContent.trim();
      const parent = details.parentNode;
      parent.insertBefore(heading, details);
      Array.from(details.children).forEach(child => {
        if (child !== summary) parent.insertBefore(child, details);
      });
      details.remove();
    });

    const bodyStyle = `font-family:'Segoe UI',system-ui,sans-serif;font-size:15px;` +
                      `line-height:1.7;color:${v('--text')};background-color:${v('--base')};` +
                      `max-width:800px;margin:0 auto;padding:24px;`;

    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
                     `<body style="${bodyStyle}">${clone.innerHTML}</body></html>`;

    const succeed = () => toast('HTML copied — paste into a rich editor (email, Notion, Docs)');
    const fail    = (msg: any) => toast('Copy failed: ' + msg, 'error');

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html':  new Blob([fullHtml], { type: 'text/html' }),
          'text/plain': new Blob([fullHtml], { type: 'text/plain' }),
        })
      ]);
      succeed();
    } catch {
      try {
        await copyPlainText(fullHtml);
        succeed();
      } catch (e: any) {
        fail(e.message || e);
      }
    }
  });
  btnCopyPath.addEventListener('click', async () => {
    const path = fullPathForCurrentFile();
    if (!path) { toast('Save or open a markdown file first', 'error'); return; }
    await copyPlainText(`\`${path}\``);
    toast('Full file path copied as inline code');
  });
  btnCopyInternalLink.addEventListener('click', async () => {
    const link = internalLinkForCurrentFile();
    if (!link) { toast('Save or open a markdown file first', 'error'); return; }
    await copyPlainText(link);
    toast('RecallStack link copied');
  });
  previewOut.addEventListener('click', (e: any) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#recallstack-open="]') : null;
    if (!a || !previewOut.contains(a)) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    openRecallStackPath(href.slice('#recallstack-open='.length), isPinnedClick(e)).catch(err => {
      toast('Could not open RecallStack link: ' + (err.message || err), 'error');
    });
  });
  btnConvertToTask.addEventListener('click', convertNoteToTask);
  btnConvertToNote.addEventListener('click', openConvertTaskToNoteModal);
  btnMove.addEventListener('click', () => executeCommand('file.move'));
  btnArchive.addEventListener('click', () => executeCommand('file.archive'));
  btnDelete.addEventListener('click', () => executeCommand('file.trash'));
  btnCancel.addEventListener('click', cancelEdit);
  btnNewFromEditor.addEventListener('click', () => executeCommand('file.new'));
  mdEditor.addEventListener('input', () => {
    renderPreview();
    lsDraftSave();
    updateActiveTabDirtyState();
    clearTimeout(_autoSaveTimer);
    if (currentPath && !isNew) {
      _autoSaveTimer = setTimeout(() => autoSaveIfDirty(true), 1500);
    }
  });

  mdEditor.addEventListener('keydown', (e: any) => {
    if (e.key === 'Enter') {
      // In nowrap mode, reset horizontal scroll after the newline is rendered
      if (mdEditor.classList.contains('nowrap')) {
        requestAnimationFrame(() => { mdEditor.scrollLeft = 0; });
      }
      const val   = mdEditor.value;
      const start = mdEditor.selectionStart;
      // Find start of current line
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineText  = val.slice(lineStart, start);

      // Match indentation + list prefix
      const todoMatch    = lineText.match(/^(\s*)(\[[ xX]\] )(.*)/);
      const bulletMatch  = lineText.match(/^(\s*)([-*+] )(.*)/);
      const numberedMatch = lineText.match(/^(\s*)(\d+)\. (.*)/);

      let prefix = null;
      let content = null;
      let indent = '';
      let nextPrefix = null;

      if (todoMatch) {
        indent   = todoMatch[1];
        prefix   = todoMatch[2];
        content  = todoMatch[3];
        nextPrefix = indent + '[ ] ';
      } else if (bulletMatch) {
        indent   = bulletMatch[1];
        prefix   = bulletMatch[2];
        content  = bulletMatch[3];
        nextPrefix = indent + prefix;
      } else if (numberedMatch) {
        indent   = numberedMatch[1];
        const num = parseInt(numberedMatch[2], 10);
        prefix   = numberedMatch[2] + '. ';
        content  = numberedMatch[3];
        nextPrefix = indent + (num + 1) + '. ';
      }

      if (nextPrefix !== null) {
        e.preventDefault();
        e.stopPropagation();
        if (content === '') {
          // Empty list item — exit the list by removing the prefix
          const pos = lineStart + indent.length;
          mdEditor.applyUserEdit(val.slice(0, lineStart) + indent + val.slice(start), pos, pos);
        } else {
          // Insert newline + next prefix
          const insert = '\n' + nextPrefix;
          const pos = start + insert.length;
          mdEditor.applyUserEdit(val.slice(0, start) + insert + val.slice(mdEditor.selectionEnd), pos, pos);
        }
        renderPreview();
        return;
      }
    }

    // ── Ctrl+D — delete the entire current line in the markdown editor ─────────
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      e.stopPropagation();
      const val = mdEditor.value;
      const start = mdEditor.selectionStart;
      const end = mdEditor.selectionEnd;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineEndRaw = val.indexOf('\n', end);
      const lineEnd = lineEndRaw === -1 ? val.length : lineEndRaw + 1;
      const newValue = val.slice(0, lineStart) + val.slice(lineEnd);
      const pos = Math.min(lineStart, newValue.length);
      mdEditor.applyUserEdit(newValue, pos, pos);
      renderPreview();
      return;
    }

    // ── Ctrl+' — toggle blockquote on selected lines ────────────────────────
    if ((e.ctrlKey || e.metaKey) && e.key === "'") {
      e.preventDefault();
      e.stopPropagation();
      const val   = mdEditor.value;
      const start = mdEditor.selectionStart;
      const end   = mdEditor.selectionEnd;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const rawEnd    = val.indexOf('\n', end > lineStart ? end - 1 : end);
      const blockEnd  = rawEnd === -1 ? val.length : rawEnd;
      const lines     = val.slice(lineStart, blockEnd).split('\n');
      const allQuoted = lines.every(l => l === '>' || l.startsWith('> '));
      const newLines  = allQuoted
        ? lines.map(l => l === '>' ? '' : l.startsWith('> ') ? l.slice(2) : l)
        : lines.map(l => '> ' + l);
      const newBlock  = newLines.join('\n');
      mdEditor.applyUserEdit(val.slice(0, lineStart) + newBlock + val.slice(blockEnd), lineStart, lineStart + newBlock.length);
      renderPreview();
      return;
    }

    if (e.key !== 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    const TAB   = '  '; // 2 spaces
    const val   = mdEditor.value;
    const start = mdEditor.selectionStart;
    const end   = mdEditor.selectionEnd;

    if (start === end && !e.shiftKey) {
      // If on a list/todo line, indent the whole line instead of inserting at cursor
      const lineStart  = val.lastIndexOf('\n', start - 1) + 1;
      const lineEndRaw = val.indexOf('\n', start);
      const lineEndIdx = lineEndRaw === -1 ? val.length : lineEndRaw;
      const line       = val.slice(lineStart, lineEndIdx);
      if (/^\s*([-*+](\s*\[[ xX]\])?\s|\[[ xX]\]\s|\d+\.\s)/.test(line)) {
        mdEditor.applyUserEdit(val.slice(0, lineStart) + TAB + line + val.slice(lineEndIdx), start + 2, start + 2);
        renderPreview();
        return;
      }
      // Plain cursor: insert 2 spaces at cursor position
      mdEditor.applyUserEdit(val.slice(0, start) + TAB + val.slice(end), start + 2, start + 2);
      renderPreview();
      return;
    }

    // Selection present or Shift+Tab: operate on all lines in the range
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const rawEnd    = val.indexOf('\n', end);
    const blockEnd  = rawEnd === -1 ? val.length : rawEnd;
    const lines     = val.slice(lineStart, blockEnd).split('\n');
    const newLines  = e.shiftKey
      ? lines.map(l => l.startsWith(TAB) ? l.slice(2) : l.startsWith(' ') ? l.slice(1) : l)
      : lines.map(l => TAB + l);
    const newBlock  = newLines.join('\n');
    const newText   = val.slice(0, lineStart) + newBlock + val.slice(blockEnd);

    if (e.shiftKey) {
      // Place a single caret at the start of content (past bullet/todo marker)
      // on the line that contained the original cursor end — no auto-selection.
      const origLineIndex = val.slice(lineStart, end).split('\n').length - 1;
      let absLineStart = lineStart;
      for (let i = 0; i < origLineIndex && i < newLines.length; i++) {
        absLineStart += newLines[i].length + 1; // +1 for the newline separator
      }
      const targetLine = newLines[origLineIndex] ?? newLines[newLines.length - 1] ?? '';
      const m = targetLine.match(/^\s*([-*+](\s*\[[ xX]\])?\s|\[[ xX]\]\s|\d+\.\s)/);
      const offset = m ? m[0].length : (targetLine.match(/^\s*/)?.[0].length || 0);
      mdEditor.applyUserEdit(newText, absLineStart + offset, absLineStart + offset);
    } else {
      mdEditor.applyUserEdit(newText, lineStart, lineStart + newBlock.length);
    }
    renderPreview();
  });

  // ── Asset paste / drop into editor ───────────────────────────────────────────

  mdEditor.addEventListener('paste', async (e: any) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    // Only intercept if at least one file item is present
    let hasFile = false;
    for (const item of items) { if (item.kind === 'file') { hasFile = true; break; } }
    if (!hasFile) return;
    e.preventDefault();
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const buf      = await file.arrayBuffer();
        const isImage  = file.type.startsWith('image/');
        const filename = isImage && isScreenshotItem(file) ? clipFilename() : (file.name || clipFilename());
        const relPath  = await saveAsset(filename, buf, file.type || undefined);
        insertAtCursor(assetMarkdownLink(filename, relPath, isImage));
        toast(`Asset saved: ${filename}`);
      } catch (err: any) {
        toast('Failed to save asset: ' + err.message, 'error');
      }
    }
  });

  // A plain Ctrl+C/right-click-Copy text selection inside the editor is
  // handled entirely natively by the webview (never touches copyPlainText()
  // above) — on Linux that means it still routes through WebKitGTK's own
  // clipboard bridge and can log the same "Gdk-WARNING: Error writing
  // selection data: Broken pipe" a clipboard-history tool triggers. Intercept
  // the copy event and write the selected text through the native plugin
  // instead, same as every other explicit copy action in the app.
  mdEditor.addEventListener('copy', (e: any) => {
    if (!window.__recallstackNative?.active) return;
    const text = mdEditor.value.slice(mdEditor.selectionStart, mdEditor.selectionEnd);
    if (!text) return;
    e.preventDefault();
    void copyPlainText(text);
  });

  // Browser (non-Tauri) mode only: real OS files dragged into a Tauri desktop
  // window are intercepted at the native webview layer once dragDropEnabled
  // is true (see tauri.conf.json and the onDragDropEvent routing below) and
  // never reach these HTML5 dataTransfer/File-object listeners on desktop —
  // Tauri hands them to onDragDropEvent as real absolute paths instead, with
  // no in-memory bytes. In an actual browser, none of that applies (no
  // dragDropEnabled, no onDragDropEvent) so this remains the only path there.
  mdEditor.addEventListener('dragover', (e: any) => {
    if (window.__recallstackNative?.active) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  mdEditor.addEventListener('drop', async (e: any) => {
    if (window.__recallstackNative?.active) return;
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    const links = [];
    for (const file of files) {
      try {
        const buf      = await file.arrayBuffer();
        const isImage  = file.type.startsWith('image/');
        const filename = file.name || clipFilename();
        const relPath  = await saveAsset(filename, buf, file.type || undefined);
        links.push(assetMarkdownLink(filename, relPath, isImage));
        toast(`Asset saved: ${filename}`);
      } catch (err: any) {
        toast('Failed to save asset: ' + err.message, 'error');
      }
    }
    if (!links.length) return;
    if (links.length === 1) {
      insertAtCursor(links[0]);
    } else {
      const cursorPos = mdEditor.selectionStart;
      const needsLeadingNewline = cursorPos > 0 && mdEditor.value[cursorPos - 1] !== '\n';
      insertAtCursor(joinDroppedAssetLinks(links, needsLeadingNewline));
    }
  });

  // Tauri desktop counterpart to the browser-mode handler above: real OS
  // files dropped on the editor arrive via onDragDropEvent (see below) as
  // absolute paths with no in-memory bytes, so pull the bytes explicitly via
  // external_fs_read (the binary counterpart to external_fs_read_text) before
  // writing them into assets/ through the same saveAsset() path native and
  // browser asset drops already share.
  function basenameFromNativePath(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  }

  async function insertNativeDroppedAssets(paths: string[]) {
    const links: string[] = [];
    for (const path of paths) {
      const name = basenameFromNativePath(path);
      try {
        const bytes    = await window.__recallstackNative!.externalRead(path);
        const buf      = new Uint8Array(bytes).buffer;
        const isImage  = isImageFilename(name);
        const filename = isImage && isScreenshotItem({ name }) ? clipFilename() : (name || clipFilename());
        const relPath  = await saveAsset(filename, buf, undefined);
        links.push(assetMarkdownLink(filename, relPath, isImage));
        toast(`Asset saved: ${filename}`);
      } catch (err: any) {
        toast('Failed to save asset: ' + err.message, 'error');
      }
    }
    if (!links.length) return;
    if (links.length === 1) {
      insertAtCursor(links[0]);
    } else {
      const cursorPos = mdEditor.selectionStart;
      const needsLeadingNewline = cursorPos > 0 && mdEditor.value[cursorPos - 1] !== '\n';
      insertAtCursor(joinDroppedAssetLinks(links, needsLeadingNewline));
    }
  }

  // On focus: clear input when the file field is empty so that selecting today registers
  // as a value change (browser only fires 'change' when the value actually differs from
  // what it was when the picker opened).
  const taskDateDialog = document.createElement('div');
  taskDateDialog.className = 'task-date-dialog-backdrop hidden';
  taskDateDialog.innerHTML = `<section class="task-date-dialog" role="dialog" aria-modal="true" aria-labelledby="task-date-dialog-title">
    <div class="task-date-dialog-header">
      <button type="button" class="btn-icon" data-date-action="previous" title="Previous month" aria-label="Previous month">‹</button>
      <div class="task-date-dialog-title" id="task-date-dialog-title"></div>
      <button type="button" class="btn-icon" data-date-action="next" title="Next month" aria-label="Next month">›</button>
      <button type="button" class="btn-icon" data-date-action="close" title="Close date picker" aria-label="Close date picker">×</button>
    </div>
    <div class="task-date-dialog-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
    <div class="task-date-dialog-grid"></div>
    <div class="task-date-dialog-actions">
      <button type="button" class="btn btn-ghost" data-date-action="clear">Clear</button>
      <button type="button" class="btn btn-ghost" data-date-action="today">Today</button>
      <button type="button" class="btn btn-primary" data-date-action="close">Close</button>
    </div>
  </section>`;
  document.body.appendChild(taskDateDialog);
  const taskDateDialogTitle = taskDateDialog.querySelector<HTMLElement>('.task-date-dialog-title')!;
  const taskDateDialogGrid = taskDateDialog.querySelector<HTMLElement>('.task-date-dialog-grid')!;
  let activeTaskDateInput: HTMLInputElement | null = null;
  let taskDateDialogMonth = new Date();

  function renderTaskDateDialog() {
    const year = taskDateDialogMonth.getFullYear();
    const month = taskDateDialogMonth.getMonth();
    const today = localIsoDate(new Date());
    taskDateDialogTitle.textContent = taskDateDialogMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    taskDateDialogGrid.innerHTML = calendarMonth(year, month).map(cell => {
      if (!cell) return '<span></span>';
      const classes = ['task-date-dialog-day'];
      if (cell.iso === today) classes.push('today');
      if (cell.iso === activeTaskDateInput?.value) classes.push('selected');
      return `<button type="button" class="${classes.join(' ')}" data-date-value="${cell.iso}" aria-label="${cell.iso}">${cell.day}</button>`;
    }).join('');
  }

  function closeTaskDateDialog() {
    const input = activeTaskDateInput;
    activeTaskDateInput = null;
    taskDateDialog.classList.add('hidden');
    document.querySelector<HTMLElement>(`[data-task-date-input="${input?.id || ''}"]`)?.focus();
  }

  function commitTaskDateDialog(value: any) {
    if (!activeTaskDateInput) return;
    activeTaskDateInput.value = value;
    activeTaskDateInput.dispatchEvent(new Event('change', { bubbles: true }));
    closeTaskDateDialog();
  }

  function openTaskDateDialog(input: HTMLInputElement) {
    activeTaskDateInput = input;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value);
    taskDateDialogMonth = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date();
    renderTaskDateDialog();
    taskDateDialog.classList.remove('hidden');
    taskDateDialog.querySelector<HTMLElement>('[data-date-action="close"]')?.focus();
  }

  document.querySelectorAll<HTMLElement>('[data-task-date-input]').forEach(button => {
    button.addEventListener('click', () => openTaskDateDialog($id<HTMLInputElement>(button.dataset.taskDateInput!)));
  });
  taskDateDialog.addEventListener('click', (event: any) => {
    const day = event.target.closest('[data-date-value]');
    if (day) { commitTaskDateDialog(day.dataset.dateValue); return; }
    const action = event.target.closest('[data-date-action]')?.dataset.dateAction;
    if (action === 'previous' || action === 'next') {
      taskDateDialogMonth = new Date(taskDateDialogMonth.getFullYear(), taskDateDialogMonth.getMonth() + (action === 'next' ? 1 : -1), 1);
      renderTaskDateDialog();
    } else if (action === 'today') commitTaskDateDialog(localIsoDate(new Date()));
    else if (action === 'clear') commitTaskDateDialog('');
    else if (action === 'close' || event.target === taskDateDialog) closeTaskDateDialog();
  });
  document.addEventListener('keydown', (event: any) => {
    if (event.key === 'Escape' && !taskDateDialog.classList.contains('hidden')) closeTaskDateDialog();
  });

  taskInputStart.addEventListener('change',     () => {
    setDateInEditor('Start Date', taskInputStart.value);
    syncDateInputBorders();
    saveNote(true);
    requestAnimationFrame(() => taskInputStart.blur());
  });
  taskInputCompleted.addEventListener('change', () => {
    setDateInEditor('Completed Date', taskInputCompleted.value);
    if (taskInputCompleted.value && !taskMetaFor(currentPath?.split('/').at(-1)!, mdEditor.value).startDate) {
      setDateInEditor('Start Date', taskInputCompleted.value);
    }
    syncDateInputBorders();
    saveNote(true);
    requestAnimationFrame(() => taskInputCompleted.blur());
  });
  function localTodayDateString() {
    return localIsoDate(new Date());
  }
  async function uniqueDatedTitleInDir(dirHandle: any, kind: any) {
    const date = localTodayDateString();
    let title = date;
    let n = 2;
    while (await fileExistsInDir(dirHandle, newMarkdownStoredFilename(title, kind))) {
      title = `${date}-${String(n++).padStart(2, '0')}`;
    }
    return title;
  }
  taskSetStartToday.addEventListener('click', () => {
    taskInputStart.value = localTodayDateString();
    setDateInEditor('Start Date', taskInputStart.value);
    syncDateInputBorders();
    saveNote(true);
  });
  taskSetCompletedToday.addEventListener('click', () => {
    taskInputCompleted.value = localTodayDateString();
    setDateInEditor('Completed Date', taskInputCompleted.value);
    if (!taskMetaFor(currentPath?.split('/').at(-1)!, mdEditor.value).startDate) {
      setDateInEditor('Start Date', taskInputCompleted.value);
    }
    syncDateInputBorders();
    saveNote(true);
  });
  function clearTaskDate(input: any, fieldName: any) {
    input.value = '';
    setDateInEditor(fieldName, '');
    syncDateInputBorders();
    saveNote(true);
  }
  taskClearStart.addEventListener('click', () => clearTaskDate(taskInputStart, 'Start Date'));
  taskClearCompleted.addEventListener('click', () => clearTaskDate(taskInputCompleted, 'Completed Date'));
  taskClearDue.addEventListener('click', () => clearTaskDate(taskInputDue, 'Due Date'));
  taskInputDue.addEventListener('change',       () => {
    setDateInEditor('Due Date', taskInputDue.value);
    syncDateInputBorders();
    saveNote(true);
    requestAnimationFrame(() => taskInputDue.blur());
  });
  taskInputPriority.addEventListener('click', (e: any) => {
    const btn = e.target.closest('[data-priority]');
    if (!btn) return;
    const choice = btn.dataset.priority;
    setChoiceSelection(taskInputPriority, 'priority', choice);
    updateTaskMetaSummary({ priority: choice, startDate: taskInputStart.value, completedDate: taskInputCompleted.value, dueDate: taskInputDue.value });
    saveNote(true);
  });
  taskKindIndicator.addEventListener('click', () => toggleWorkingTask().catch(e => toast('Could not move task: ' + e.message, 'error')));
  btnPinCurrentFile.addEventListener('click', () => {
    const tab = activeTabRecord();
    if (!tab || tab.pinned) return;
    tab.pinned = true;
    renderTabStrip();
  });
  btnViewJournal.addEventListener('click', () => openTodayJournal().catch(e => toast('Could not open journal: ' + e.message, 'error')));
  // On blur: re-sync display (restores today hint if user dismissed without selecting,
  // or shows the committed date if they did select one).
  taskInputStart.addEventListener('blur',     () => syncDateInputsFromEditor());
  taskInputCompleted.addEventListener('blur', () => syncDateInputsFromEditor());
  taskInputDue.addEventListener('blur',       () => syncDateInputsFromEditor());


  modalCancelBtn.addEventListener('click', closeNewFolderModal);
  modalCreateBtn.addEventListener('click', createFolder);
  newFolderInput.addEventListener('keydown', (e: any) => {
    if (e.key === 'Enter')  createFolder();
    if (e.key === 'Escape') closeNewFolderModal();
  });
  newFolderModal.addEventListener('click', (e: any) => {
    if (e.target === newFolderModal) closeNewFolderModal();
  });

  renameFolderCancelBtn.addEventListener('click', closeRenameFolderModal);
  renameFolderApplyBtn.addEventListener('click', applyRenameFolder);
  renameFolderInput.addEventListener('keydown', (e: any) => {
    if (e.key === 'Enter')  applyRenameFolder();
    if (e.key === 'Escape') closeRenameFolderModal();
  });
  renameFolderModal.addEventListener('click', (e: any) => {
    if (e.target === renameFolderModal) closeRenameFolderModal();
  });

  moveFileCancelBtn.addEventListener('click', closeMoveFileModal);
  moveFileApplyBtn.addEventListener('click', moveCurrentFile);
  moveAsNonTaskInput.addEventListener('change', updateMoveMode);
  moveL1Select.addEventListener('change', () => {
    if (isTaskSpecificMove()) updateMoveApplyBtn();
    else populateMoveSubfolders();
  });
  moveL2Select.addEventListener('change', updateMoveApplyBtn);
  moveFileModal.addEventListener('click', (e: any) => {
    if (e.target === moveFileModal) closeMoveFileModal();
  });
  moveFileModal.addEventListener('keydown', (e: any) => {
    if (e.key === 'Escape') closeMoveFileModal();
    if (e.key === 'Enter' && !moveFileApplyBtn.disabled) moveCurrentFile();
  });

  // ── Open / Import Files modal ─────────────────────────────────────────────
  // Browse and drag-and-drop both feed openImportSelectedFiles; the
  // Temporary/Import radio group decides whether "Open/Import" opens each
  // file in place or copies it into a chosen workspace folder first — see
  // performOpenImportAction() below. Destination selects reuse the exact
  // two-select (Top-Level Folder → Subfolder) pattern as the Move File modal
  // above, including its addMoveOption()/listWorkspaceTopDirs() helpers.

  function openImportSelectedMode(): OpenImportMode {
    return openImportModeImport.checked ? 'import' : 'temporary';
  }

  function openImportDestinationParts(): [string, string] | null {
    return resolveImportDestination(openImportL1Select.value, openImportL2Select.value);
  }

  function updateOpenImportApplyBtn() {
    const mode = openImportSelectedMode();
    const destination = mode === 'import' ? openImportDestinationParts() : null;
    openImportApplyBtn.disabled = !openImportActionEnabled(openImportSelectedFiles.length, mode, destination);
    openImportApplyBtn.textContent = mode === 'import' ? 'Import' : 'Open';
  }

  function updateOpenImportModeUi() {
    openImportDestination.classList.toggle('hidden', openImportSelectedMode() !== 'import');
    updateOpenImportApplyBtn();
  }

  function renderOpenImportFileList() {
    openImportFileListEl.replaceChildren();
    openImportSelectedFiles.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'open-import-file-row' + (index === 0 ? ' first-file' : '');
      const name = document.createElement('span');
      name.className = 'open-import-file-name';
      name.textContent = file.name;
      name.title = file.nativePath || file.name;
      row.appendChild(name);
      if (index === 0 && openImportSelectedFiles.length > 1) {
        const hint = document.createElement('span');
        hint.className = 'open-import-file-hint';
        hint.title = 'This file becomes the active tab once opened';
        hint.textContent = 'Opens first';
        row.appendChild(hint);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'open-import-file-remove';
      remove.innerHTML = '&times;';
      remove.title = `Remove ${file.name}`;
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.addEventListener('click', () => {
        openImportSelectedFiles = removeSelectedFile(openImportSelectedFiles, file.key);
        renderOpenImportFileList();
      });
      row.appendChild(remove);
      openImportFileListEl.appendChild(row);
    });
    updateOpenImportApplyBtn();
  }

  // Filters a freshly picked/dropped batch to .md only (toasting anything
  // rejected), verifies native-mode paths still point at a real file (a stale
  // dialog result, or a folder rather than a file), merges the rest into the
  // existing selection, and re-renders.
  async function addOpenImportSelections(entries: OpenImportSelection[]) {
    if (!entries.length) return;
    const { accepted, rejected } = partitionMarkdownFilenames(entries.map(entry => entry.name));
    if (rejected.length) {
      toast(`Only .md files are supported — ignored: ${rejected.join(', ')}`, 'error');
    }
    const acceptedNames = new Set(accepted);
    const acceptedEntries = entries.filter(entry => acceptedNames.has(entry.name));
    if (!acceptedEntries.length) return;

    const verified: OpenImportSelection[] = [];
    const unreadable: string[] = [];
    for (const entry of acceptedEntries) {
      if (entry.nativePath && window.__recallstackNative?.active) {
        try {
          await window.__recallstackNative!.externalStat(entry.nativePath);
          verified.push(entry);
        } catch {
          unreadable.push(entry.name);
        }
      } else {
        verified.push(entry);
      }
    }
    if (unreadable.length) {
      toast(`Could not read: ${unreadable.join(', ')}`, 'error');
    }
    if (!verified.length) return;
    openImportSelectedFiles = mergeSelectedFiles(openImportSelectedFiles, verified);
    renderOpenImportFileList();
  }

  // Header full-bar drop shortcut: dropping file(s) straight onto the header
  // opens them exactly like the Open/Import modal's Temporary mode, without
  // requiring the modal to be opened at all — but only when EVERY dropped
  // file is Markdown. Unlike addOpenImportSelections() above (which accepts
  // the valid .md subset of a modal drop and just toasts about the rest),
  // this shortcut is all-or-nothing: a mixed or non-.md drop is rejected in
  // full so the user isn't surprised by only some of their files opening.
  async function openHeaderDroppedFiles(entries: OpenImportSelection[]) {
    if (!entries.length) return;
    if (!allFilesAreMarkdown(entries.map(entry => entry.name))) {
      toast('Only Markdown (.md) files can be opened this way from the header — drop images onto the editor, or use Browse / Open-Import for other files.', 'error');
      return;
    }

    const verified: OpenImportSelection[] = [];
    const unreadable: string[] = [];
    for (const entry of entries) {
      if (entry.nativePath && window.__recallstackNative?.active) {
        try {
          await window.__recallstackNative!.externalStat(entry.nativePath);
          verified.push(entry);
        } catch {
          unreadable.push(entry.name);
        }
      } else {
        verified.push(entry);
      }
    }
    if (unreadable.length) {
      toast(`Could not read: ${unreadable.join(', ')}`, 'error');
    }
    if (!verified.length) return;

    await openExternalFilesAsTemporary(verified);
    toast(`Opened ${verified.length} file${verified.length === 1 ? '' : 's'} ✓`);
  }

  async function populateOpenImportTopFolders() {
    openImportL1Select.innerHTML = '';
    addMoveOption(openImportL1Select, '', 'Select a top-level folder…');
    try {
      const folders = await listWorkspaceTopDirs();
      // Never include 'outputs' as an import destination (Outputs is read-only as a target)
      folders.filter(f => f.name !== 'outputs').forEach(folder => addMoveOption(openImportL1Select, folder.name, folder.name));
    } catch (e: any) {
      toast('Could not load folders: ' + e.message, 'error');
    }
  }

  async function populateOpenImportSubfolders() {
    openImportL2Select.innerHTML = '';
    addMoveOption(openImportL2Select, '', 'Select destination…');
    const topName = openImportL1Select.value;
    if (topName) {
      try {
        const topHandle = await notesHandle!.getDirectoryHandle(topName);
        const subs = await listDirs(topHandle);
        subs.filter(sub => sub.name !== 'tasks' && sub.name !== 'archived' && sub.name !== 'assets')
          .forEach(sub => addMoveOption(openImportL2Select, sub.name, sub.name));
      } catch (e: any) {
        toast('Could not load subfolders: ' + e.message, 'error');
      }
    }
    updateOpenImportApplyBtn();
  }

  function resetOpenImportModal() {
    openImportSelectedFiles = [];
    openImportModeTemp.checked = true;
    openImportModeImport.checked = false;
    openImportDestination.classList.add('hidden');
    openImportL1Select.innerHTML = '';
    openImportL2Select.innerHTML = '';
    openImportDropzone.classList.remove('drag-active');
    renderOpenImportFileList();
  }

  async function openOpenImportModal() {
    resetOpenImportModal();
    openImportModal.classList.remove('hidden');
    await populateOpenImportTopFolders();
    setTimeout(() => openImportBrowseBtn.focus(), 0);
  }

  function closeOpenImportModal() {
    openImportModal.classList.add('hidden');
    resetOpenImportModal();
  }

  async function browseOpenImportFiles() {
    if (window.__recallstackNative?.active) {
      const paths = await window.__recallstackNative.chooseExternalMarkdownFiles();
      await addOpenImportSelections(paths.map(path => ({
        key: path, name: path.split(/[\\/]/).pop() || path, nativePath: path, browserHandle: null,
      })));
      return;
    }
    if (typeof window.showOpenFilePicker !== 'function') {
      toast('File picking is not available in this environment', 'error');
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        excludeAcceptAllOption: true,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      });
      await addOpenImportSelections(handles.map(handle => ({
        key: `browser-handle:${handle.name}`, name: handle.name, nativePath: null, browserHandle: handle,
      })));
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      toast('Could not open file picker: ' + e.message, 'error');
    }
  }

  // Writes one selected external file's current content into the chosen
  // workspace folder (a copy-in — the external source is left untouched) and
  // returns the new workspace-relative path.
  async function importExternalSelectionIntoWorkspace(file: OpenImportSelection, destParts: [string, string]): Promise<string> {
    const destDir = await getDirHandle(notesHandle!, destParts, true);
    const baseFilename = file.name.toLowerCase().endsWith('.md') ? file.name : file.name + '.md';
    const finalFilename = await uniqueFilenameInDir(destDir, baseFilename);
    const finalPath = buildImportedFilePath(destParts, finalFilename);
    const content = file.nativePath
      ? await window.__recallstackNative!.externalReadText(file.nativePath)
      : await (await file.browserHandle!.getFile()).text();
    await writeMdFile(finalPath, content);
    updateSearchIndex(finalPath, content);
    return finalPath;
  }

  // Opens each external file as a temporary (unsaved-source) tab, in the
  // given order, then re-activates the first file's tab so it ends up
  // focused — the exact "Temporary" mode behavior of the Open/Import modal.
  // Shared by performOpenImportAction() below and the header full-bar drop
  // shortcut, so this "open N as temp, focus the first" rule lives in one
  // place.
  async function openExternalFilesAsTemporary(files: OpenImportSelection[]): Promise<void> {
    for (const file of files) {
      await openExternalFileInTab(file, true);
    }
    // Multiple files each get their own tab; the first one on the list
    // becomes the active/focused document, per spec.
    if (files.length) await openExternalFileInTab(files[0], true);
  }

  async function performOpenImportAction() {
    const mode = openImportSelectedMode();
    const files = openImportSelectedFiles.slice();
    if (!files.length) return;

    let destParts: [string, string] | null = null;
    if (mode === 'import') {
      destParts = openImportDestinationParts();
      if (!destParts) return;
    }

    openImportApplyBtn.disabled = true;
    openImportApplyBtn.textContent = mode === 'import' ? 'Importing…' : 'Opening…';

    try {
      const openedPaths: string[] = [];
      if (mode === 'import') {
        for (const file of files) {
          const finalPath = await importExternalSelectionIntoWorkspace(file, destParts!);
          await openFile(finalPath.split('/').at(-1)!, finalPath, { pinned: true });
          openedPaths.push(finalPath);
        }
      } else {
        await openExternalFilesAsTemporary(files);
      }
      closeOpenImportModal();
      if (mode === 'import') {
        // Multiple files each get their own tab; the first one on the list
        // becomes the active/focused document, per spec.
        await openFile(openedPaths[0].split('/').at(-1)!, openedPaths[0], { pinned: true });
      }
      toast(mode === 'import'
        ? `Imported ${files.length} file${files.length === 1 ? '' : 's'} ✓`
        : `Opened ${files.length} file${files.length === 1 ? '' : 's'} ✓`);
    } catch (e: any) {
      toast((mode === 'import' ? 'Import failed: ' : 'Open failed: ') + e.message, 'error');
    } finally {
      if (!openImportModal.classList.contains('hidden')) {
        openImportApplyBtn.disabled = false;
        updateOpenImportApplyBtn();
      }
    }
  }

  btnOpenImport.addEventListener('click', openOpenImportModal);
  openImportCancelBtn.addEventListener('click', closeOpenImportModal);
  openImportApplyBtn.addEventListener('click', performOpenImportAction);
  openImportBrowseBtn.addEventListener('click', browseOpenImportFiles);
  openImportModeTemp.addEventListener('change', updateOpenImportModeUi);
  openImportModeImport.addEventListener('change', updateOpenImportModeUi);
  openImportL1Select.addEventListener('change', populateOpenImportSubfolders);
  openImportL2Select.addEventListener('change', updateOpenImportApplyBtn);
  openImportModal.addEventListener('click', (e: any) => {
    if (e.target === openImportModal) closeOpenImportModal();
  });
  openImportModal.addEventListener('keydown', (e: any) => {
    if (e.key === 'Escape') closeOpenImportModal();
  });

  // Browser (non-Tauri) mode only — see the note above the mdEditor listeners.
  // On Tauri desktop, real OS file drags never reach these HTML5 listeners
  // once dragDropEnabled is true; onDragDropEvent below handles that case.
  openImportDropzone.addEventListener('dragover', (e: DragEvent) => {
    if (window.__recallstackNative?.active) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      openImportDropzone.classList.add('drag-active');
    }
  });
  openImportDropzone.addEventListener('dragleave', () => {
    if (window.__recallstackNative?.active) return;
    openImportDropzone.classList.remove('drag-active');
  });
  openImportDropzone.addEventListener('drop', async (e: DragEvent) => {
    if (window.__recallstackNative?.active) return;
    e.preventDefault();
    openImportDropzone.classList.remove('drag-active');
    const items = e.dataTransfer?.items;
    const files = e.dataTransfer?.files;
    if (!items?.length && !files?.length) return;

    const entries: OpenImportSelection[] = [];
    const unreadable: string[] = [];

    if (items?.length && typeof items[0]?.getAsFileSystemHandle === 'function') {
      // Browser mode: the standard Chromium API gives a real, writable handle.
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        try {
          const handle = await item.getAsFileSystemHandle?.();
          if (handle && handle.kind === 'file') {
            entries.push({ key: `browser-handle:${handle.name}`, name: handle.name, nativePath: null, browserHandle: handle as FileSystemFileHandle });
          }
        } catch {
          unreadable.push(item.type || 'dropped file');
        }
      }
    } else {
      for (const file of Array.from(files || [])) unreadable.push(file.name);
    }

    if (entries.length) await addOpenImportSelections(entries);
    if (unreadable.length) {
      toast(`Could not read dropped file location — use Browse instead: ${unreadable.join(', ')}`, 'error');
    }
  });

  // Header full-bar drop shortcut, browser (non-Tauri) mode. Same guard
  // pattern as the modal dropzone listeners just above: only intercept
  // genuine OS file drags (dataTransfer.types includes 'Files'), so in-page
  // dragging within the header (e.g. selecting/dragging search input text)
  // is left completely alone. On Tauri desktop this never fires once
  // dragDropEnabled is true; the onDragDropEvent routing below handles that
  // case instead. Building entries and the purity/open logic itself lives in
  // openHeaderDroppedFiles() so both this and the native branch share it.
  appHeader.addEventListener('dragover', (e: DragEvent) => {
    if (window.__recallstackNative?.active) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      appHeader.classList.add('drag-active');
    }
  });
  appHeader.addEventListener('dragleave', () => {
    if (window.__recallstackNative?.active) return;
    appHeader.classList.remove('drag-active');
  });
  appHeader.addEventListener('drop', async (e: DragEvent) => {
    if (window.__recallstackNative?.active) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    appHeader.classList.remove('drag-active');
    const items = e.dataTransfer?.items;
    const files = e.dataTransfer?.files;
    if (!items?.length && !files?.length) return;

    const entries: OpenImportSelection[] = [];
    const unreadable: string[] = [];

    if (items?.length && typeof items[0]?.getAsFileSystemHandle === 'function') {
      // Browser mode: the standard Chromium API gives a real, writable handle.
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        try {
          const handle = await item.getAsFileSystemHandle?.();
          if (handle && handle.kind === 'file') {
            entries.push({ key: `browser-handle:${handle.name}`, name: handle.name, nativePath: null, browserHandle: handle as FileSystemFileHandle });
          }
        } catch {
          unreadable.push(item.type || 'dropped file');
        }
      }
    } else {
      for (const file of Array.from(files || [])) unreadable.push(file.name);
    }

    if (unreadable.length) {
      toast(`Could not read dropped file location — use Browse or the Open/Import modal instead: ${unreadable.join(', ')}`, 'error');
    }
    if (entries.length) await openHeaderDroppedFiles(entries);
  });

  // ── Native (Tauri) drag-and-drop routing ────────────────────────────────
  // dragDropEnabled is a window-level setting (tauri.conf.json), not scoped to
  // any one element: when true, real OS file drags are intercepted by the
  // native webview layer before they ever reach the DOM as HTML5
  // dataTransfer/File objects — confirmed for all three desktop backends
  // (WebView2's own IDropTarget on Windows, WebKitGTK's drag-drop signals on
  // Linux, WKWebView's drag session on macOS), not just a Windows quirk. It
  // has to be true globally to get real paths at all on Windows (WebView2
  // never exposes a real filesystem path through the standard HTML5 File
  // object's non-standard `.path`, unlike some other webviews). Tauri's own
  // documented, cross-platform replacement is the webview-level
  // onDragDropEvent API, which delivers real absolute OS paths via
  // event.payload.paths. Since that API is webview-scoped rather than
  // element-scoped, route each event by hand to whichever drop target the
  // cursor is physically over at the moment of the event — the Open/Import
  // modal's dropzone (only while that modal is open), else the header's
  // full-bar "open as temporary" shortcut when the cursor is over the header,
  // else the Markdown editor's asset-drop zone. The modal's dropzone always
  // wins when the modal is open (drawn on top of everything, including the
  // header behind it); the header shortcut only ever applies while the modal
  // is closed. Pure in-page DOM dragging (tab-strip reorder, browser-mode
  // DnD) is untouched: this handler only ever fires for genuine OS-level
  // file drags.
  if (window.__recallstackNative?.active) {
    const dragDropPoint = (position: { x: number; y: number }) => ({
      x: position.x / (window.devicePixelRatio || 1),
      y: position.y / (window.devicePixelRatio || 1),
    });
    const pointInRect = (rect: DOMRect, point: { x: number; y: number }) =>
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

    void getCurrentWebview().onDragDropEvent((event: { payload: DragDropEvent }) => {
      const payload = event.payload;
      if (payload.type === 'leave') {
        openImportDropzone.classList.remove('drag-active');
        appHeader.classList.remove('drag-active');
        return;
      }
      const point = dragDropPoint(payload.position);
      const modalOpen = !openImportModal.classList.contains('hidden');
      const overDropzone = modalOpen && pointInRect(openImportDropzone.getBoundingClientRect(), point);
      // The modal dropzone (when the modal is open) always wins; the header
      // shortcut only ever applies while the modal is closed.
      const overHeader = !modalOpen && pointInRect(appHeader.getBoundingClientRect(), point);

      if (payload.type === 'enter' || payload.type === 'over') {
        openImportDropzone.classList.toggle('drag-active', overDropzone);
        appHeader.classList.toggle('drag-active', overHeader);
        return;
      }

      // payload.type === 'drop'
      openImportDropzone.classList.remove('drag-active');
      appHeader.classList.remove('drag-active');
      if (overDropzone) {
        const entries: OpenImportSelection[] = payload.paths.map(nativePath => ({
          key: nativePath,
          name: basenameFromNativePath(nativePath),
          nativePath,
          browserHandle: null,
        }));
        void addOpenImportSelections(entries);
      } else if (overHeader) {
        const entries: OpenImportSelection[] = payload.paths.map(nativePath => ({
          key: nativePath,
          name: basenameFromNativePath(nativePath),
          nativePath,
          browserHandle: null,
        }));
        void openHeaderDroppedFiles(entries);
      } else if (!modalOpen && pointInRect(editorPane.getBoundingClientRect(), point)) {
        // editorPane (not mdEditor itself) — mdEditor is a LazyMarkdownEditorAdapter
        // wrapping either a plain div or CodeMirror once loaded, and exposes no
        // getBoundingClientRect() of its own; editorPane is the DOM element that
        // actually bounds the editor's drop target area (excludes previewPane).
        void insertNativeDroppedAssets(payload.paths);
      }
    }).catch(err => console.warn('Could not attach native drag-and-drop listener', err));
  }

  inboxDeleteCancelBtn.addEventListener('click', closeInboxDeleteModal);
  inboxDeleteConfirmBtn.addEventListener('click', async () => {
    if (!_pendingInboxDelete) return;
    const { f, dirHandle, onDeleted } = _pendingInboxDelete;
    closeInboxDeleteModal();
    try {
      await dirHandle.removeEntry(f.name);
      toast(`Moved to Trash: "${f.name}"`);
      onDeleted();
    } catch (e: any) {
      toast('Delete failed: ' + e.message, 'error');
    }
  });
  inboxDeleteModal.addEventListener('click', (e: any) => {
    if (e.target === inboxDeleteModal) closeInboxDeleteModal();
  });
  inboxDeleteModal.addEventListener('keydown', (e: any) => {
    if (e.key === 'Escape') closeInboxDeleteModal();
  });

  titleInput.addEventListener('keydown', (e: any) => {
    if (e.key === 'Enter') { e.preventDefault(); mdEditor.focus(); }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      mdEditor.focus();
      mdEditor.setSelectionRange(0, 0);
      mdEditor.scrollTop = 0;
    }
  });

  searchInput.addEventListener('input', onSearchInput);
  searchInput.addEventListener('keydown', (e: any) => {
    if (e.key === 'Escape') {
      clearTimeout(_searchTimer);
      lastSearchBuffer = null;
      searchInput.value = '';
      exitSearchView();
      searchInput.blur();
    }
    if (e.key === 'Enter') {
      clearTimeout(_searchTimer);
      const query = searchInput.value.trim();
      if (query.length >= 3) executeSearch(query);
    }
  });
  btnSearch.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (query.length >= 3) {
      clearTimeout(_searchTimer);
      await executeSearch(query);
    } else {
      searchInput.focus();
    }
  });
  btnSearchClear.addEventListener('click', () => {
    clearTimeout(_searchTimer);
    lastSearchBuffer = null;
    searchInput.value = '';
    exitSearchView(false);
    searchInput.focus();
  });
  searchInput.addEventListener('focus', () => {
    if (lastSearchBuffer?.results.length) {
      renderSearchResults(lastSearchBuffer.results, lastSearchBuffer.query);
      enterSearchView(false);
    }
  });

  async function openSearchBufferOrPrompt() {
    if (lastSearchBuffer?.results.length) {
      searchInput.value = lastSearchBuffer.query;
      renderSearchResults(lastSearchBuffer.results, lastSearchBuffer.query);
      enterSearchView();
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay quick-search-overlay';
    overlay.innerHTML = `<div class="modal-dialog quick-search-dialog" role="dialog" aria-modal="true" aria-label="Quick search"><div class="modal-title">Search Notes</div><input class="modal-input" id="quick-search-input" type="text" autocomplete="off" spellcheck="false" placeholder="Type search text…"/><div class="modal-actions"><button class="btn btn-ghost" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="search">Search</button></div></div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector<HTMLInputElement>('#quick-search-input')!;
    const close = () => overlay.remove();
    const run = async () => {
      const query = input.value.trim();
      if (query.length < 3) { toast('Search needs at least 3 characters', 'error'); return; }
      searchInput.value = query;
      close();
      await executeSearch(query);
    };
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    overlay.querySelector('[data-action="search"]')?.addEventListener('click', () => void run());
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter') { event.preventDefault(); void run(); }
    });
    requestAnimationFrame(() => input.focus());
  }

  // ── Grouped listing modals (Task / Working Task / Notes) ────────────────────
  const ARCHIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/></svg>';

  function mkListingModal(id: string, title: string) {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'listing-modal hidden';
    overlay.innerHTML = `<div class="listing-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}-title">`
      + `<div class="listing-modal-header">`
      + `<span id="${id}-title" class="listing-modal-title">${esc(title)}</span>`
      + `<div class="listing-search">`
      + `<input type="text" id="${id}-filter" class="listing-search-input" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Filter (2+ characters)…" aria-label="Filter ${esc(title)}"/>`
      + `<button type="button" id="${id}-filter-clear" class="listing-search-clear hidden" title="Clear filter" aria-label="Clear filter">&times;</button>`
      + `</div>`
      + `<span id="${id}-typed" class="listing-modal-typed" aria-live="polite"></span>`
      + `<button type="button" id="${id}-sort" class="listing-sort-btn" title="Toggle sort order"><span>Sort</span></button>`
      + `<button type="button" id="${id}-archived" class="listing-archived-btn hidden" title="Show archived files">${ARCHIVE_SVG}<span>Show archived</span></button>`
      + `</div>`
      + `<div id="${id}-results" class="listing-modal-results" role="listbox" aria-label="${esc(title)}" tabindex="0"></div>`
      + `<div class="listing-modal-footer"><span>Type to filter</span><span>↓/J ↑/K move</span><span>Enter open</span><span>Ctrl+Enter pin</span><span>letter code jump</span><span>Esc close</span></div>`
      + `</div>`;
    document.body.appendChild(overlay);
    return new ListingModalController({
      overlay,
      dialog: overlay.firstElementChild as HTMLElement,
      titleEl: $id(`${id}-title`),
      filterInput: $id<HTMLInputElement>(`${id}-filter`),
      filterClearBtn: $id<HTMLButtonElement>(`${id}-filter-clear`),
      sortBtn: $id<HTMLButtonElement>(`${id}-sort`),
      archivedBtn: $id<HTMLButtonElement>(`${id}-archived`),
      results: $id(`${id}-results`),
      typed: $id(`${id}-typed`),
    });
  }

  const taskListing = mkListingModal('modal-task-listing', 'Tasks');
  const workingListing = mkListingModal('modal-working-listing', 'Working Tasks');
  const notesListing = mkListingModal('modal-notes-listing', 'Notes');

  // Row id → what the row points at, so activate / archive / restore know what
  // to do. One shared map: only one listing modal is open at a time.
  interface ListingRowMeta {
    file: { name: string; mtime: number; handle: any };
    folderParts: string[];   // folder the file currently lives in
    archived: boolean;       // file is in an archived/ subfolder
    inWorking: boolean;      // task under tasks/working/
    hasStatus: boolean;      // task carries a status tag (→ Archive) vs plain (→ Working)
  }
  let listingRowMeta = new Map<number, ListingRowMeta>();
  let listingRowSeq = 0;

  const TASK_SECTION_ORDER: Array<['deployment' | 'qaReview' | 'deployed' | 'completed' | 'backlog' | 'rest', string, boolean]> = [
    ['rest', 'Tasks', false],
    ['completed', 'Completed', true],
    ['qaReview', 'In QA Review', true],
    ['deployment', 'Marked for Deployment', true],
    ['deployed', 'Deployed', true],
    ['backlog', 'Backlog / Deferred', true],
  ];

  function sortListingFiles(files: any[], sort: ListingSort, byPriority: boolean, displayName: (name: string) => string) {
    return [...files].sort((a, b) => {
      if (byPriority) {
        const pa = PRIORITY_ORDER[normalizeTaskPriority(taskMetaFor(a.name, '').priority)] ?? 1;
        const pb = PRIORITY_ORDER[normalizeTaskPriority(taskMetaFor(b.name, '').priority)] ?? 1;
        if (pa !== pb) return pa - pb;
      }
      if (sort === 'alpha') return displayName(a.name).localeCompare(displayName(b.name));
      return b.mtime - a.mtime;
    });
  }

  function taskRow(file: any, folderParts: string[], opts: { archived: boolean; inWorking: boolean; hasStatus: boolean }) {
    const id = ++listingRowSeq;
    listingRowMeta.set(id, { file, folderParts, ...opts });
    const actionLabel = opts.archived ? 'Restore' : opts.inWorking ? '← Task' : opts.hasStatus ? 'Archive' : '→ Working';
    const actionKind = opts.archived ? 'restore' : opts.inWorking ? 'task' : opts.hasStatus ? 'archive' : 'working';
    return {
      id,
      title: taskDisplayTitle(file.name),
      priorityClass: `priority-${normalizeTaskPriority(taskMetaFor(file.name, '').priority)}`,
      actionLabel,
      actionKind: actionKind as 'working' | 'task' | 'archive' | 'restore',
    };
  }

  async function buildTaskSections(archived: boolean, sort: ListingSort): Promise<ListingSection[]> {
    const tasksDir = await getDirHandle(notesHandle!, [TASKS_ROOT], true);
    const folderParts = archived ? [TASKS_ROOT, 'archived'] : [TASKS_ROOT];
    let dir: FileSystemDirectoryHandle = tasksDir;
    if (archived) {
      try { dir = await tasksDir.getDirectoryHandle('archived'); } catch { return []; }
    }
    const files = await listMdFiles(dir);
    listingRowMeta = new Map(); listingRowSeq = 0;
    const buckets = partitionTasksBySuffix(files, (f: any) => f.name, () => '');
    return TASK_SECTION_ORDER
      .map(([key, title, hasStatus]) => ({
        title,
        rows: sortListingFiles(buckets[key], sort, true, taskDisplayTitle)
          .map((file: any) => taskRow(file, folderParts, { archived, inWorking: false, hasStatus })),
      }))
      .filter(section => section.rows.length);
  }

  async function buildWorkingSections(sort: ListingSort): Promise<ListingSection[]> {
    const tasksDir = await getDirHandle(notesHandle!, [TASKS_ROOT], true);
    let dir: FileSystemDirectoryHandle;
    try { dir = await tasksDir.getDirectoryHandle('working'); } catch { return []; }
    const files = await listMdFiles(dir);
    listingRowMeta = new Map(); listingRowSeq = 0;
    return [{
      title: null,
      rows: sortListingFiles(files, sort, true, taskDisplayTitle)
        .map((file: any) => taskRow(file, [TASKS_ROOT, 'working'], { archived: false, inWorking: true, hasStatus: false })),
    }];
  }

  async function buildNotesSections(dirHandle: any, baseParts: string[], archived: boolean, sort: ListingSort): Promise<ListingSection[]> {
    let dir = dirHandle;
    const folderParts = archived ? [...baseParts, 'archived'] : baseParts;
    if (archived) {
      try { dir = await dirHandle.getDirectoryHandle('archived'); } catch { return []; }
    }
    const files = await listMdFiles(dir);
    listingRowMeta = new Map(); listingRowSeq = 0;
    const noteName = (name: string) => name.replace(/\.md$/i, '');
    return [{
      title: null,
      rows: sortListingFiles(files, sort, false, noteName).map((file: any) => {
        const id = ++listingRowSeq;
        listingRowMeta.set(id, { file, folderParts, archived, inWorking: false, hasStatus: false });
        return {
          id,
          title: noteName(file.name),
          actionLabel: archived ? 'Restore' : 'Archive',
          actionKind: (archived ? 'restore' : 'archive') as 'archive' | 'restore',
        };
      }),
    }];
  }

  async function activateListingRow(id: number, pinned: boolean) {
    const meta = listingRowMeta.get(id);
    if (!meta) return false;
    const path = [...meta.folderParts, meta.file.name].join('/');
    const opened = await openFile(meta.file.name, path, { pinned });
    if (opened) mdEditor.focus();
    return Boolean(opened);
  }

  async function moveListingFileToArchive(meta: ListingRowMeta) {
    const content = rewriteAssetLinks((await enrichFileContent(meta.file)).content || '', '](assets/', '](../assets/');
    const from = [...meta.folderParts, meta.file.name].join('/');
    const to = await uniquePathInFolder([...meta.folderParts, 'archived'], meta.file.name);
    await writeMdFile(to, content);
    await removeMdFile(from);
    removeFromSearchIndex(from); updateSearchIndex(to, content);
    toast('Archived ✓');
  }

  async function restoreListingFileFromArchive(meta: ListingRowMeta) {
    const content = rewriteAssetLinks((await enrichFileContent(meta.file)).content || '', '](../assets/', '](assets/');
    const from = [...meta.folderParts, meta.file.name].join('/');
    const to = await uniquePathInFolder(meta.folderParts.slice(0, -1), meta.file.name);
    await writeMdFile(to, content);
    await removeMdFile(from);
    removeFromSearchIndex(from); updateSearchIndex(to, content);
    toast('Restored ✓');
  }

  function listingRowAction(rebuild: () => Promise<ListingSection[]>) {
    return async (id: number): Promise<ListingSection[] | null> => {
      const meta = listingRowMeta.get(id);
      if (!meta) return null;
      try {
        if (meta.archived) {
          await restoreListingFileFromArchive(meta);
        } else if (meta.inWorking || (!meta.hasStatus && meta.folderParts.at(-1) === TASKS_ROOT)) {
          const enriched = await enrichFileContent(meta.file);
          // toggleWorkingTaskFromList appends `working/` itself, so rootParts is
          // always the base tasks folder regardless of the row's current spot.
          await toggleWorkingTaskFromList(enriched, { rootParts: [TASKS_ROOT], inWorking: meta.inWorking, reload: async () => {} });
        } else {
          await moveListingFileToArchive(meta);
        }
      } catch (error: any) {
        toast('Could not move file: ' + (error?.message || error), 'error');
        return null;
      }
      return rebuild();
    };
  }

  const TASK_LISTING_SORT_KEY = PREFERENCE_KEYS.taskListingSort;
  const WORKING_LISTING_SORT_KEY = PREFERENCE_KEYS.workingListingSort;
  const NOTES_LISTING_SORT_KEY = PREFERENCE_KEYS.notesListingSort;
  function readListingSort(key: string): ListingSort {
    return localStorage.getItem(key) === 'alpha' ? 'alpha' : 'mtime';
  }
  let activeListingRebuild: (() => Promise<ListingSection[]>) | null = null;

  async function openTaskListing() {
    if (!notesHandle) return false;
    let archived = false;
    let sort = readListingSort(TASK_LISTING_SORT_KEY);
    const rebuild = () => buildTaskSections(archived, sort);
    activeListingRebuild = rebuild;
    const sections = await rebuild();
    if (!sections.length && !archived) { toast('No tasks found'); return false; }
    return taskListing.open({
      title: 'Tasks', sections, sort, archived,
      onActivate: activateListingRow,
      onSortChange: async next => { sort = next; localStorage.setItem(TASK_LISTING_SORT_KEY, next); return rebuild(); },
      onArchivedToggle: async next => { archived = next; return rebuild(); },
      onRowAction: listingRowAction(rebuild),
    });
  }

  async function openWorkingListing() {
    if (!notesHandle) return false;
    let sort = readListingSort(WORKING_LISTING_SORT_KEY);
    const rebuild = () => buildWorkingSections(sort);
    activeListingRebuild = rebuild;
    const sections = await rebuild();
    if (!sections.some(s => s.rows.length)) { toast('No working tasks found'); return false; }
    return workingListing.open({
      title: 'Working Tasks', sections, sort,
      onActivate: activateListingRow,
      onSortChange: async next => { sort = next; localStorage.setItem(WORKING_LISTING_SORT_KEY, next); return rebuild(); },
      onRowAction: listingRowAction(rebuild),
    });
  }

  async function openNotesListing() {
    if (!notesHandle || !l1Active) { toast('Select a folder first', 'error'); return false; }
    const heading = activeFolderHeading();
    if (folderUsesInlineList(heading, l1Active.name)) return false; // these stay inline
    const dirHandle = activeDirHandle();
    const baseParts = l2Active ? [l1Active.name, l2Active.name] : [l1Active.name];
    let archived = false;
    let sort = readListingSort(NOTES_LISTING_SORT_KEY);
    const rebuild = () => buildNotesSections(dirHandle, baseParts, archived, sort);
    activeListingRebuild = rebuild;
    const sections = await rebuild();
    return notesListing.open({
      title: `Notes · ${heading}`, sections, sort, archived,
      onActivate: activateListingRow,
      onSortChange: async next => { sort = next; localStorage.setItem(NOTES_LISTING_SORT_KEY, next); return rebuild(); },
      onArchivedToggle: async next => { archived = next; return rebuild(); },
      onRowAction: listingRowAction(rebuild),
    });
  }

  const anyListingOpen = () => taskListing.isOpen() || workingListing.isOpen() || notesListing.isOpen();
  function closeAllListings() { taskListing.close(); workingListing.close(); notesListing.close(); activeListingRebuild = null; }

  function toggleTaskListing() {
    if (taskListing.isOpen()) { taskListing.close(); return; }
    closeAllListings();
    if (!palette.classList.contains('hidden')) closeCommandPalette();
    void openTaskListing().catch(e => toast('Could not load tasks: ' + (e?.message || e), 'error'));
  }
  function toggleWorkingListing() {
    if (workingListing.isOpen()) { workingListing.close(); return; }
    closeAllListings();
    if (!palette.classList.contains('hidden')) closeCommandPalette();
    void openWorkingListing().catch(e => toast('Could not load working tasks: ' + (e?.message || e), 'error'));
  }
  function toggleNotesListing() {
    if (notesListing.isOpen()) { notesListing.close(); return; }
    closeAllListings();
    if (!palette.classList.contains('hidden')) closeCommandPalette();
    void openNotesListing().catch(e => toast('Could not load notes: ' + (e?.message || e), 'error'));
  }

  // ── Keybinding help modal (Ctrl+K) ─────────────────────────────────────────
  const keybindingsModal = document.createElement('div');
  keybindingsModal.id = 'modal-keybindings';
  keybindingsModal.className = 'hidden';
  keybindingsModal.innerHTML = `<div class="md-ref-dialog keybind-dialog" role="dialog" aria-modal="true" aria-labelledby="keybind-title"><div class="md-ref-header"><span class="md-ref-title" id="keybind-title">⌨️ Keyboard Shortcuts</span><button class="md-ref-close" id="btn-keybind-close" title="Close" aria-label="Close keyboard shortcuts"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="md-ref-body keybind-body" id="keybind-body"></div></div>`;
  document.body.appendChild(keybindingsModal);
  {
    const body = keybindingsModal.querySelector<HTMLElement>('#keybind-body')!;
    for (const group of bindingsByCategory()) {
      const section = document.createElement('section');
      section.className = 'keybind-section';
      const heading = document.createElement('h3');
      heading.textContent = group.category;
      section.appendChild(heading);
      for (const binding of group.bindings) {
        const row = document.createElement('div');
        row.className = 'keybind-row';
        row.innerHTML = `<div class="keybind-row-text"><span class="keybind-label">${esc(binding.label)}</span><span class="keybind-desc">${esc(binding.description)}</span></div><kbd>${esc(binding.combo)}</kbd>`;
        section.appendChild(row);
      }
      body.appendChild(section);
    }
    keybindingsModal.querySelector('#btn-keybind-close')!.addEventListener('click', () => closeKeybindingsModal());
    keybindingsModal.addEventListener('click', event => { if (event.target === keybindingsModal) closeKeybindingsModal(); });
    keybindingsModal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeKeybindingsModal(); }
    });
  }
  let keybindPreviousFocus: HTMLElement | null = null;
  function openKeybindingsModal() {
    keybindPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keybindingsModal.classList.remove('hidden');
    requestAnimationFrame(() => keybindingsModal.querySelector<HTMLElement>('#btn-keybind-close')?.focus());
  }
  function closeKeybindingsModal() {
    keybindingsModal.classList.add('hidden');
    keybindPreviousFocus?.focus();
    keybindPreviousFocus = null;
  }
  function toggleKeybindingsModal() {
    if (keybindingsModal.classList.contains('hidden')) openKeybindingsModal();
    else closeKeybindingsModal();
  }

  // ── Theme switcher modal (Ctrl+L, live preview) ────────────────────────────
  const themeSwitcherModal = document.createElement('div');
  themeSwitcherModal.id = 'modal-theme-switcher';
  themeSwitcherModal.className = 'quick-tab-switcher hidden theme-switcher';
  themeSwitcherModal.innerHTML = `<div class="quick-tab-switcher-dialog theme-switcher-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-switcher-title"><div class="quick-tab-switcher-header"><div><div id="theme-switcher-title" class="quick-tab-switcher-title">Theme</div><div class="quick-tab-switcher-subtitle">↑ ↓ preview live · Enter apply · Esc cancel</div></div></div><div id="theme-switcher-results" class="quick-tab-results" role="listbox" aria-label="Themes" tabindex="0"></div></div>`;
  document.body.appendChild(themeSwitcherModal);
  const themeSwitcherResults = themeSwitcherModal.querySelector<HTMLElement>('#theme-switcher-results')!;
  let themeSwitcherIds: string[] = [];
  let themeSwitcherIndex = 0;
  let themeSwitcherOpeningTheme = '';
  let themeSwitcherPreviousFocus: HTMLElement | null = null;

  function currentThemeId() {
    return themeSelect.value && THEMES[themeSelect.value] ? themeSelect.value : defaultThemeId;
  }

  function renderThemeSwitcher() {
    themeSwitcherResults.replaceChildren();
    themeSwitcherIds.forEach((id, index) => {
      const detail = themeDetails[id];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'quick-tab-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === themeSwitcherIndex));
      row.innerHTML = `<span class="quick-tab-details"><span class="quick-tab-title">${esc(detail?.name || id)}</span><small>${esc(detail?.group || '')}</small></span><span class="quick-tab-kind">${esc(detail?.mode || '')}</span>`;
      row.addEventListener('mouseenter', () => { themeSwitcherIndex = index; previewThemeAtIndex(); });
      row.addEventListener('click', () => commitThemeSwitcher());
      themeSwitcherResults.appendChild(row);
    });
    updateThemeSwitcherSelection();
  }
  function updateThemeSwitcherSelection() {
    themeSwitcherResults.querySelectorAll<HTMLElement>('[role="option"]').forEach((row, index) => {
      row.setAttribute('aria-selected', String(index === themeSwitcherIndex));
    });
    themeSwitcherResults.children[themeSwitcherIndex]?.scrollIntoView({ block: 'nearest' });
  }
  function previewThemeAtIndex() {
    updateThemeSwitcherSelection();
    const id = themeSwitcherIds[themeSwitcherIndex];
    if (id) applyTheme(id, false);
  }
  function openThemeSwitcher() {
    themeSwitcherIds = Object.keys(themeDetails);
    if (!themeSwitcherIds.length) { toast('No themes available'); return; }
    themeSwitcherOpeningTheme = currentThemeId();
    themeSwitcherPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    themeSwitcherIndex = Math.max(0, themeSwitcherIds.indexOf(themeSwitcherOpeningTheme));
    themeSwitcherModal.classList.remove('hidden');
    renderThemeSwitcher();
    requestAnimationFrame(() => themeSwitcherResults.focus());
  }
  function closeThemeSwitcher(revert: boolean) {
    if (themeSwitcherModal.classList.contains('hidden')) return;
    if (revert) applyTheme(themeSwitcherOpeningTheme, false);
    themeSwitcherModal.classList.add('hidden');
    themeSwitcherPreviousFocus?.focus();
    themeSwitcherPreviousFocus = null;
  }
  function commitThemeSwitcher() {
    const id = themeSwitcherIds[themeSwitcherIndex];
    if (id) { themeSelect.value = id; applyTheme(id, true); }
    closeThemeSwitcher(false);
  }
  function toggleThemeSwitcher() {
    if (themeSwitcherModal.classList.contains('hidden')) openThemeSwitcher();
    else closeThemeSwitcher(true);
  }
  themeSwitcherModal.addEventListener('click', event => { if (event.target === themeSwitcherModal) closeThemeSwitcher(true); });
  themeSwitcherResults.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'k') {
      event.preventDefault(); event.stopPropagation();
      const delta = event.key === 'ArrowDown' || event.key.toLowerCase() === 'j' ? 1 : -1;
      themeSwitcherIndex = (themeSwitcherIndex + delta + themeSwitcherIds.length) % themeSwitcherIds.length;
      previewThemeAtIndex();
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitThemeSwitcher(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeThemeSwitcher(true); return; }
  });

  // ── New-file kind picker (Ctrl+N) ─────────────────────────────────────────
  const NEW_FILE_KINDS: Array<{ kind: 'note' | 'task' | 'working'; label: string; code: string }> = [
    { kind: 'note', label: 'New Note', code: 'N' },
    { kind: 'task', label: 'New Task', code: 'T' },
    { kind: 'working', label: 'New Working Task', code: 'W' },
  ];
  const newFileKindModal = document.createElement('div');
  newFileKindModal.id = 'modal-new-file-kind';
  newFileKindModal.className = 'quick-tab-switcher hidden new-file-kind';
  newFileKindModal.innerHTML = `<div class="quick-tab-switcher-dialog new-file-kind-dialog" role="dialog" aria-modal="true" aria-labelledby="new-file-kind-title"><div class="quick-tab-switcher-header"><div><div id="new-file-kind-title" class="quick-tab-switcher-title">Create…</div><div class="quick-tab-switcher-subtitle">↑ ↓ select · Enter create · N / T / W jump</div></div></div><div id="new-file-kind-results" class="quick-tab-results" role="listbox" aria-label="New file kind" tabindex="0"></div></div>`;
  document.body.appendChild(newFileKindModal);
  const newFileKindResults = newFileKindModal.querySelector<HTMLElement>('#new-file-kind-results')!;
  let newFileKindIndex = 0;
  let newFileKindPreviousFocus: HTMLElement | null = null;

  function renderNewFileKind() {
    newFileKindResults.replaceChildren();
    NEW_FILE_KINDS.forEach((entry, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'quick-tab-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === newFileKindIndex));
      row.innerHTML = `<kbd class="quick-tab-code">${entry.code}</kbd><span class="quick-tab-details"><span class="quick-tab-title">${esc(entry.label)}</span></span>`;
      row.addEventListener('mouseenter', () => { newFileKindIndex = index; updateNewFileKindSelection(); });
      row.addEventListener('click', () => chooseNewFileKind(index));
      newFileKindResults.appendChild(row);
    });
    updateNewFileKindSelection();
  }
  function updateNewFileKindSelection() {
    newFileKindResults.querySelectorAll<HTMLElement>('[role="option"]').forEach((row, index) => {
      row.setAttribute('aria-selected', String(index === newFileKindIndex));
    });
  }
  function openNewFileKindPicker() {
    if (!rootHandle) { toast('Open a workspace first', 'error'); return; }
    newFileKindPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    newFileKindIndex = (allTasksMode || isJournalNote()) ? 1 : 0;
    newFileKindModal.classList.remove('hidden');
    renderNewFileKind();
    requestAnimationFrame(() => newFileKindResults.focus());
  }
  function closeNewFileKindPicker() {
    newFileKindModal.classList.add('hidden');
    newFileKindPreviousFocus?.focus();
    newFileKindPreviousFocus = null;
  }
  function chooseNewFileKind(index: number) {
    const entry = NEW_FILE_KINDS[index];
    if (!entry) return;
    closeNewFileKindPicker();
    void createFileOfKind(entry.kind).catch(e => toast('Could not create file: ' + (e?.message || e), 'error'));
  }
  newFileKindModal.addEventListener('click', event => { if (event.target === newFileKindModal) closeNewFileKindPicker(); });
  newFileKindResults.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) { event.preventDefault(); event.stopPropagation(); return; }
    const navKey = event.key.toLowerCase();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || navKey === 'j' || navKey === 'k') {
      event.preventDefault(); event.stopPropagation();
      const delta = event.key === 'ArrowDown' || navKey === 'j' ? 1 : -1;
      newFileKindIndex = (newFileKindIndex + delta + NEW_FILE_KINDS.length) % NEW_FILE_KINDS.length;
      updateNewFileKindSelection();
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); chooseNewFileKind(newFileKindIndex); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeNewFileKindPicker(); return; }
    const match = NEW_FILE_KINDS.findIndex(entry => entry.code.toLowerCase() === event.key.toLowerCase());
    if (match >= 0) { event.preventDefault(); event.stopPropagation(); newFileKindIndex = match; updateNewFileKindSelection(); chooseNewFileKind(match); }
  });

  // ── Global Escape + overlay helpers ───────────────────────────────────────
  function anyOverlayOpen() {
    return anyListingOpen() || !!document.querySelector(
      '.modal-overlay:not(.hidden), .settings-overlay:not(.hidden), .command-palette:not(.hidden), ' +
      '.quick-tab-switcher:not(.hidden), .listing-modal:not(.hidden), #modal-md-ref:not(.hidden), #modal-readme:not(.hidden), ' +
      '#modal-changelog:not(.hidden), #modal-safety-tools:not(.hidden), #modal-keybindings:not(.hidden)',
    );
  }
  function closeTopmostOverlay() {
    if (anyListingOpen()) return closeAllListings();
    if (quickTabSwitcher.isOpen()) return quickTabSwitcher.close();
    if (quickTaskSwitcher.isOpen()) return quickTaskSwitcher.close();
    if (!palette.classList.contains('hidden')) return closeCommandPalette();
    if (!keybindingsModal.classList.contains('hidden')) return closeKeybindingsModal();
    if (!themeSwitcherModal.classList.contains('hidden')) return closeThemeSwitcher(true);
    if (!newFileKindModal.classList.contains('hidden')) return closeNewFileKindPicker();
    const generic = document.querySelector<HTMLElement>(
      '.modal-overlay:not(.hidden), .settings-overlay:not(.hidden), #modal-md-ref:not(.hidden), ' +
      '#modal-readme:not(.hidden), #modal-changelog:not(.hidden), #modal-safety-tools:not(.hidden)',
    );
    if (generic) generic.classList.add('hidden');
  }
  async function handleGlobalEscape() {
    if (!editorView.classList.contains('hidden')) {
      try { await autoSaveIfDirty(true); } catch { /* fall through to journal */ }
    }
    try { await openTodayJournal(); }
    catch (error: any) { toast('Could not open journal: ' + (error?.message || error), 'error'); }
  }
  let escapeOverlayWasOpen = false;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') escapeOverlayWasOpen = anyOverlayOpen();
  }, true);

  document.addEventListener('keydown', (e: any) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === ' ' || e.code === 'Space')) {
      e.preventDefault();
      if (quickTabSwitcher.isOpen()) quickTabSwitcher.close();
      else {
        if (!palette.classList.contains('hidden')) closeCommandPalette();
        openQuickTabSwitcher();
      }
      return;
    }
    if (!newFileModalEl.classList.contains('hidden')) {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      return;
    }
    if (!searchView.classList.contains('hidden') && document.activeElement !== searchInput) {
      const cards = searchResultCards();
      if (cards.length) {
        const key = e.key.toLowerCase();
        if (e.key === 'ArrowDown' || key === 'j' || e.key === 'ArrowUp' || key === 'k') {
          e.preventDefault();
          const delta = e.key === 'ArrowDown' || key === 'j' ? 1 : -1;
          searchSelectedIndex = (searchSelectedIndex + delta + cards.length) % cards.length;
          searchTypedCode = "";
          updateSearchResultSelection();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          openSelectedSearchResult(e);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          exitSearchView();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/i.test(e.key)) {
          e.preventDefault();
          const codes = tabJumpCodes(cards.length);
          const letter = e.key.toUpperCase();
          const appended = searchTypedCode + letter;
          searchTypedCode = codes.some(code => code.startsWith(appended)) ? appended : letter;
          const match = codes.findIndex(code => code === searchTypedCode);
          if (match >= 0) {
            searchSelectedIndex = match;
            updateSearchResultSelection();
            openSelectedSearchResult(e);
            searchTypedCode = "";
            return;
          }
          const prefix = codes.findIndex(code => code.startsWith(searchTypedCode));
          if (prefix >= 0) searchSelectedIndex = prefix;
          else searchTypedCode = "";
          updateSearchResultSelection();
          return;
        }
      }
    }
    const mod = e.ctrlKey || e.metaKey;
    const plain = !e.shiftKey && !e.altKey;
    const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';

    if (e.key === 'Escape') {
      if (anyOverlayOpen()) { e.preventDefault(); closeTopmostOverlay(); return; }
      if (escapeOverlayWasOpen) return; // an overlay's own handler already closed it
      if (!searchView.classList.contains('hidden') && document.activeElement !== searchInput) {
        e.preventDefault();
        clearTimeout(_searchTimer);
        lastSearchBuffer = null;
        searchInput.value = '';
        exitSearchView();
        return;
      }
      e.preventDefault();
      void handleGlobalEscape();
      return;
    }

    if (mod && plain && key === 'l') { e.preventDefault(); toggleNotesListing(); return; }
    if (mod && e.shiftKey && !e.altKey && key === 't') { e.preventDefault(); toggleThemeSwitcher(); return; }
    if (mod && plain && key === 'k') { e.preventDefault(); toggleKeybindingsModal(); return; }
    if (mod && plain && key === 'p') {
      e.preventDefault();
      if (palette.classList.contains('hidden')) openCommandPalette('>'); else closeCommandPalette();
      return;
    }
    if (mod && plain && key === 'j') { e.preventDefault(); executeCommand('navigation.today'); return; }
    if (mod && plain && key === 't') { e.preventDefault(); toggleTaskListing(); return; }
    if (mod && plain && key === 'w') { e.preventDefault(); toggleWorkingListing(); return; }
    if (mod && e.shiftKey && !e.altKey && key === 'w') { e.preventDefault(); executeCommand('tabs.close'); return; }
    if (mod && plain && key === 'q') { e.preventDefault(); executeCommand('tabs.close'); return; }
    if (mod && plain && key === 'i') { e.preventDefault(); $id('btn-open-import').click(); return; }
    if (mod && plain && key === 'n') { e.preventDefault(); executeCommand('file.new'); return; }
    if (!mod && plain && e.key === 'F12') { e.preventDefault(); executeCommand('view.presentation'); return; }
    if (mod && plain && (e.key === '+' || e.key === '=')) { e.preventDefault(); executeCommand('view.zoom-in'); return; }
    if (mod && plain && e.key === '-') { e.preventDefault(); executeCommand('view.zoom-out'); return; }
    if (mod && plain && e.key === '0') { e.preventDefault(); executeCommand('view.zoom-reset'); return; }
    if (mod && plain && e.key === '/') { e.preventDefault(); executeCommand('navigation.search'); return; }
    if (mod && plain && key === 'f') { e.preventDefault(); void openSearchBufferOrPrompt(); return; }
    if (mod && e.shiftKey && !e.altKey && key === 'f') { e.preventDefault(); executeCommand('navigation.search'); return; }
    if (mod && e.key === 'Tab') {
      e.preventDefault(); executeCommand(e.shiftKey ? 'navigation.previous-tab' : 'navigation.next-tab'); return;
    }
    if (mod && plain && e.key >= '1' && e.key <= '9') { e.preventDefault(); jumpToTabIndex(Number(e.key)); return; }
    const editing = !editorView.classList.contains('hidden');
    if (mod && key === 's' && editing) { e.preventDefault(); executeCommand('file.save'); }
  });

  // ── Marked + highlight.js setup ───────────────────────────────────────────────

  function setupMarked() {
    if (typeof marked === 'undefined' || typeof hljs === 'undefined') return;
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      mermaidInitialized = true;
    }
    const aliases: Record<string, string> = { cs: 'csharp', 'c#': 'csharp', sh: 'bash', shell: 'bash', zsh: 'bash', py: 'python' };
    marked.use({
      gfm: true,
      breaks: true,
      renderer: {
        code(codeOrToken: any, infostring: any) {
          // marked 9.x calls renderer.code(code, infostring, escaped) with positional args
          // Guard for both APIs: positional string args (v9) and token object (v5+)
          const safeText = typeof codeOrToken === 'string' ? codeOrToken
            : (codeOrToken && typeof codeOrToken.text === 'string' ? codeOrToken.text : '');
          const rawLang  = typeof infostring === 'string' ? infostring
            : (codeOrToken && typeof codeOrToken.lang === 'string' ? codeOrToken.lang : '');
          const safeLang = rawLang.trim();
          if (safeLang.toLowerCase() === 'mermaid') {
            return `<div class="mermaid">${esc(safeText)}</div>`;
          }
          const raw   = safeLang ? (aliases[safeLang.toLowerCase()] || safeLang.toLowerCase()) : null;
          const lang_ = raw && hljs.getLanguage(raw) ? raw : null;
          if (raw && !lang_) loadHljsLang(raw);
          // Cache by source text + resolved highlight state (not position), so
          // reordering/inserting/deleting other blocks can't produce a stale hit.
          // A block that fell back to plain text because its hljs grammar hadn't
          // loaded yet gets a different key than one rendered with the grammar
          // present, so it re-highlights on its own once the grammar arrives
          // (loadHljsLang's completion callback triggers a fresh renderPreview()).
          const highlightState = lang_ ? `hl:${lang_}` : (raw ? `pending:${raw}` : 'plain');
          const cacheKey = `${hashBlockSource(safeText)}|${safeLang.toLowerCase()}|${highlightState}`;
          const cachedHtml = cacheGet(codeBlockRenderCache, cacheKey);
          if (cachedHtml !== undefined) return cachedHtml;
          let body;
          try {
            body = lang_
              ? hljs.highlight(safeText, { language: lang_ }).value
              : esc(safeText);
          } catch {
            body = esc(safeText);
          }
          const label = safeLang ? `<span class="code-lang">${esc(safeLang)}</span>` : '';
          const html = `<pre class="code-block">${label}<code class="hljs${lang_ ? ' language-' + lang_ : ''}">${body}</code></pre>`;
          cacheSet(codeBlockRenderCache, cacheKey, html, CODE_BLOCK_CACHE_MAX);
          return html;
        }
      } as any
    });
  }

  // ── Themes ────────────────────────────────────────────────────────────────────

  const FALLBACK_THEME = FALLBACK_THEME_VARIABLES;
  const FALLBACK_THEME_CONFIG = FALLBACK_THEME_CATALOG;
  let THEMES: Record<string, Record<string, string>> = { catppuccin: FALLBACK_THEME_VARIABLES };
  let themeDetails: Record<string, { id: string; name: string; group: string; mode: string }> = {
    catppuccin: { id: 'catppuccin', name: 'Catppuccin', group: 'Classics', mode: 'dark' },
  };
  let defaultThemeId = 'catppuccin';
  const appliedThemeVariables = new Set<string>();

  const EXTERNAL_THEME_PATH_KEY = PREFERENCE_KEYS.externalThemePath;
  const SAMPLE_EXTERNAL_THEMES = '__bundled-sample__';
  let builtinThemeCatalog: ThemeCatalog = FALLBACK_THEME_CATALOG;
  let externalThemeDefs: ThemeDefinition[] = [];

  function rebuildThemeRuntime() {
    const merged: ThemeCatalog = {
      version: 1,
      defaultTheme: builtinThemeCatalog.defaultTheme,
      themes: [
        ...builtinThemeCatalog.themes,
        ...externalThemeDefs.filter(theme => !builtinThemeCatalog.themes.some(builtin => builtin.id === theme.id)),
      ],
    };
    const state = themeRuntimeState(merged);
    THEMES = state.variables;
    themeDetails = state.details;
    defaultThemeId = state.defaultTheme;
    installThemeOptions(themeSelect, merged);
  }

  function installThemeConfig(config: ThemeCatalog) {
    builtinThemeCatalog = config;
    rebuildThemeRuntime();
  }

  async function bundledPortableText(name: any, maxBytes = 1024 * 1024) {
    const response = await fetch(new URL(name, window.location.href), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Bundled ${name} returned HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > maxBytes) throw new Error(`Bundled ${name} exceeds ${Math.round(maxBytes / 1024)} KB`);
    return text;
  }

  async function portableSidecarText(name: any, maxBytes = 1024 * 1024) {
    if (!window.__recallstackNative?.readPortableText) return null;
    const text = await window.__recallstackNative!.readPortableText(name);
    if (text !== null && text.length > maxBytes) throw new Error(`${name} beside the executable exceeds ${Math.round(maxBytes / 1024)} KB`);
    return text;
  }

  async function workspaceAppText(name: any, maxBytes = 1024 * 1024) {
    const appsDir = await rootHandle!.getDirectoryHandle('Apps');
    const fileHandle = await appsDir.getFileHandle(name);
    const file = await fileHandle.getFile();
    if (file.size > maxBytes) throw new Error(`Apps/${name} exceeds ${Math.round(maxBytes / 1024)} KB`);
    return file.text();
  }

  async function loadBuiltinThemes() {
    let text = null;
    let source = 'portable';
    try {
      text = await portableSidecarText('theme.json');
    } catch (portableError: any) {
      console.warn('Could not read theme.json beside the executable', portableError);
    }

    if (text === null) {
      source = 'workspace';
      try {
        text = await workspaceAppText('themes.json');
      } catch {
        source = 'bundled';
        try {
          text = await bundledPortableText('theme.json');
        } catch (bundledError: any) {
          installThemeConfig(FALLBACK_THEME_CONFIG);
          toast('Theme catalog unavailable: ' + bundledError.message, 'error');
          return false;
        }
      }
    }

    try {
      installThemeConfig(parseThemeConfig(text));
    } catch (externalError: any) {
      if (source !== 'bundled') {
        try {
          installThemeConfig(parseThemeConfig(await bundledPortableText('theme.json')));
          const label = source === 'portable' ? 'theme.json beside the executable' : 'Apps/themes.json';
          toast(label + ' is invalid; using bundled themes. ' + externalError.message, 'error');
          return false;
        } catch (bundledError: any) {
          console.error('Bundled theme fallback failed', bundledError);
        }
      }
      installThemeConfig(FALLBACK_THEME_CONFIG);
      toast('Could not load themes: ' + externalError.message, 'error');
      return false;
    }
    return true;
  }

  // ── External theme file (user-selected JSON of extra themes) ────────────────
  let externalThemeFileHandle: FileSystemFileHandle | null = null;

  function externalThemeSource(): string {
    return (localStorage.getItem(EXTERNAL_THEME_PATH_KEY) || '').trim();
  }

  async function readExternalThemeText(source: string): Promise<string | null> {
    if (source === SAMPLE_EXTERNAL_THEMES) {
      return bundledPortableText('external-themes.sample.json');
    }
    if (window.__recallstackNative?.active) {
      if (!source) return null;
      return window.__recallstackNative.externalReadText(source);
    }
    if (externalThemeFileHandle) {
      const file = await externalThemeFileHandle.getFile();
      return file.text();
    }
    return null;
  }

  async function loadExternalThemes(notifyOnError = false) {
    const source = externalThemeSource();
    if (!source) { externalThemeDefs = []; rebuildThemeRuntime(); return; }
    try {
      const text = await readExternalThemeText(source);
      if (text === null) { externalThemeDefs = []; rebuildThemeRuntime(); return; }
      const parsed = parseExternalThemeCatalog(text);
      const collisions = parsed.filter(theme => builtinThemeCatalog.themes.some(builtin => builtin.id === theme.id));
      externalThemeDefs = parsed.filter(theme => !collisions.some(c => c.id === theme.id));
      rebuildThemeRuntime();
      if (collisions.length) {
        toast(`Skipped ${collisions.length} external theme${collisions.length === 1 ? '' : 's'} that reuse a built-in id`, 'error');
      }
    } catch (error: any) {
      externalThemeDefs = [];
      rebuildThemeRuntime();
      if (notifyOnError) toast('External theme file: ' + (error?.message || error), 'error');
      else console.warn('Could not load external theme file', error);
    }
  }

  async function loadWorkspaceThemes() {
    const ok = await loadBuiltinThemes();
    await loadExternalThemes();
    return ok;
  }

  function applyTheme(name: any, save = true) {
    const resolvedName = THEMES[name] ? name : defaultThemeId;
    const vars = THEMES[resolvedName] || FALLBACK_THEME;
    const root = document.documentElement;
    const mode = themeDetails[resolvedName]?.mode === "light" ? "light" : "dark";
    applyThemeVariables(root, vars, mode, appliedThemeVariables);

    if (save && activeWorkspace) localStorage.setItem('pkm-theme-' + activeWorkspace, resolvedName);
  }

  const themeSelect = $id('theme-select');
  applyTheme('catppuccin', false); // default applied immediately; workspace theme set in switchWorkspace
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

  // ── Display and navigation settings modal ──────────────────────────────────
  const modalSettings = $id('modal-settings');
  const btnSettings = $id('btn-settings');
  const btnSettingsClose = $id('btn-settings-close');
  const outputsPathInput = $id('settings-outputs-path');
  const btnBrowseOutputsPath = $id('btn-browse-outputs-path');

  // Outputs folder can now be any directory on disk (native: an absolute OS
  // path chosen via window.__recallstackNative.chooseOutputsFolder(), which
  // opens the same Tauri dialog plugin used by chooseBackupDestination();
  // browser: any FileSystemDirectoryHandle chosen via showDirectoryPicker(),
  // which is not restricted to any parent folder either). There is nothing
  // to hand-type or "Save" — like choosing the workspace root itself
  // (chooseAndOpenWorkspace()), picking commits immediately, so the input is
  // a read-only display of the current choice, not an editable field.
  function syncOutputsPathInput() {
    outputsPathInput.value = window.__recallstackNative?.active
      ? (localStorage.getItem(OUTPUTS_FOLDER_PATH_KEY) || '')
      : (outputsHandle?.name || '');
  }

  async function chooseOutputsFolder() {
    if (window.__recallstackNative?.active) {
      const path = await window.__recallstackNative!.chooseOutputsFolder();
      if (!path) return;
      localStorage.setItem(OUTPUTS_FOLDER_PATH_KEY, path);
      outputsHandle    = await ensureConfiguredOutputsHandle();
      outputsAvailable = !!outputsHandle;
      if (!outputsAvailable) toast('Could not open that folder', 'error');
      else toast('Outputs folder set ✓');
    } else {
      try {
        outputsHandle    = await window.showDirectoryPicker({ mode: 'readwrite' });
        outputsAvailable = true;
        toast('Outputs folder set ✓');
      } catch (e: any) {
        if (e?.name !== 'AbortError') toast('Could not open that folder: ' + e.message, 'error');
        return;
      }
    }
    syncOutputsPathInput();
    await initNav({ restoreView: false });
  }

  btnBrowseOutputsPath.addEventListener('click', () => {
    chooseOutputsFolder().catch(e => toast('Could not open that folder: ' + (e?.message || e), 'error'));
  });

  // ── External theme file ───────────────────────────────────────────────────
  const externalThemePathInput = $id<HTMLInputElement>('settings-external-theme-path');
  const btnBrowseExternalTheme = $id('btn-browse-external-theme');
  const btnUseSampleThemes = $id('btn-use-sample-themes');
  const btnClearExternalTheme = $id('btn-clear-external-theme');

  function syncExternalThemeInput() {
    const source = externalThemeSource();
    externalThemePathInput.value = source === SAMPLE_EXTERNAL_THEMES
      ? 'Bundled sample (Lupine, Osaka Jade)'
      : (source || (externalThemeFileHandle?.name ?? ''));
    btnClearExternalTheme.disabled = !source;
  }

  async function setExternalThemeSource(source: string) {
    if (source) localStorage.setItem(EXTERNAL_THEME_PATH_KEY, source);
    else localStorage.removeItem(EXTERNAL_THEME_PATH_KEY);
    await loadExternalThemes(true);
    applyTheme(themeSelect.value || defaultThemeId, false);
    syncExternalThemeInput();
  }

  async function chooseExternalThemeFile() {
    if (window.__recallstackNative?.active) {
      const path = await window.__recallstackNative.chooseThemeFile();
      if (!path) return;
      await setExternalThemeSource(path);
    } else {
      const picker = (window as any).showOpenFilePicker as
        | ((options?: any) => Promise<FileSystemFileHandle[]>)
        | undefined;
      if (typeof picker !== 'function') { toast('File picker unavailable in this browser', 'error'); return; }
      try {
        const [handle] = await picker({
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        });
        externalThemeFileHandle = handle;
        await setExternalThemeSource(handle.name);
      } catch (e: any) {
        if (e?.name !== 'AbortError') toast('Could not open that file: ' + (e?.message || e), 'error');
      }
    }
  }

  btnBrowseExternalTheme.addEventListener('click', () => {
    chooseExternalThemeFile().catch(e => toast('Could not load theme file: ' + (e?.message || e), 'error'));
  });
  btnUseSampleThemes.addEventListener('click', () => {
    setExternalThemeSource(SAMPLE_EXTERNAL_THEMES).catch(e => toast('Could not load sample themes: ' + (e?.message || e), 'error'));
  });
  btnClearExternalTheme.addEventListener('click', () => {
    externalThemeFileHandle = null;
    setExternalThemeSource('').catch(e => toast('Could not clear external themes: ' + (e?.message || e), 'error'));
  });

  createModalController({
    overlay: modalSettings,
    closeButton: btnSettingsClose,
    trigger: btnSettings,
    beforeOpen: () => { syncOutputsPathInput(); syncExternalThemeInput(); },
  });

  // ── Nav row mode toggle buttons ───────────────────────────────────────────────
  if (btnNav1Mode) {
    btnNav1Mode.addEventListener('click', async () => {
      navRow1Mode = navRow1Mode === 'buttons' ? 'combo' : 'buttons';
      localStorage.setItem('pkm-nav1-mode-' + activeWorkspace, navRow1Mode);
      updateNavModeBtns();
      // Rebuild nav row 1 in-place (preserve current view)
      const folders = await listWorkspaceTopDirs();
      navRow1.innerHTML = '';
      navRow1.appendChild(mkNavNewBtn(1));
      navRow1.appendChild(mkNavRenameBtn(1));
      if (allTasksEnabled) navRow1.appendChild(mkNavAllTasksBtn());
      if (allTasksEnabled) navRow1.appendChild(mkNavWorkingTasksBtn());
      navRow1.appendChild(mkNavSeparator());
      if (folders.length) {
        if (navRow1Mode === 'combo') {
          navRow1.appendChild(mkNav1Combo(folders));
        } else {
          folders.forEach(f => navRow1.appendChild(mkNavBtn(f.name, () => refreshFolderNavigation(f.name))));
        }
      }
      // Restore active state
      if (allTasksMode) {
        const allTasksBtn = $maybe('btn-all-tasks');
        if (allTasksBtn) allTasksBtn.classList.add('active');
      } else if (l1Active) {
        setActive(navRow1, l1Active!.name);
      }
    });
  }

  if (btnNav2Mode) {
    btnNav2Mode.addEventListener('click', async () => {
      navRow2Mode = navRow2Mode === 'buttons' ? 'combo' : 'buttons';
      localStorage.setItem('pkm-nav2-mode-' + activeWorkspace, navRow2Mode);
      updateNavModeBtns();
      // Rebuild nav row 2 in-place (preserve current view) if a l1 folder is active
      if (l1Active) {
        const subs = await listDirs(l1Active!.handle);
        navRow2.innerHTML = '';
        navRow2.appendChild(mkNavNewBtn(2));
        navRow2.appendChild(mkNavRenameBtn(2));
        if (subs.length) {
          populateNavRow2Contents(subs);
          if (l2Active) setActive(navRow2, l2Active!.name);
          else updateArchiveToggleBtn();
        }
      }
    });
  }

  // ── Word Wrap toggle ──────────────────────────────────────────────────────────
  const WRAP_KEY     = PREFERENCE_KEYS.wordWrap;
  const btnWordWrap  = $id('btn-word-wrap');
  let   wordWrapOn   = localStorage.getItem(WRAP_KEY) === 'on'; // default OFF

  function applyWordWrap() {
    btnWordWrap.setAttribute('aria-pressed', String(wordWrapOn));
    if (wordWrapOn) {
      mdEditor.classList.remove('nowrap');
      mdEditor.setAttribute('wrap', 'soft');
      btnWordWrap.classList.add('wrap-active');
      btnWordWrap.title = 'Word Wrapping: On';
    } else {
      mdEditor.classList.add('nowrap');
      mdEditor.setAttribute('wrap', 'off');
      btnWordWrap.classList.remove('wrap-active');
      btnWordWrap.title = 'Word Wrapping: Off';
    }
  }
  applyWordWrap();

  btnWordWrap.addEventListener('click', () => {
    wordWrapOn = !wordWrapOn;
    localStorage.setItem(WRAP_KEY, wordWrapOn ? 'on' : 'off');
    applyWordWrap();
  });

  const LINE_NUMBERS_KEY = PREFERENCE_KEYS.lineNumbers;
  const btnLineNumbers = $id('btn-line-numbers');
  let lineNumbersOn = preferenceIsEnabled(localStorage.getItem(LINE_NUMBERS_KEY), true);
  function applyLineNumbers() {
    mdEditor.setLineNumbers(lineNumbersOn);
    btnLineNumbers.classList.toggle('wrap-active', lineNumbersOn);
    btnLineNumbers.setAttribute('aria-pressed', String(lineNumbersOn));
    btnLineNumbers.title = `Line Numbers: ${lineNumbersOn ? 'On' : 'Off'}`;
  }
  applyLineNumbers();
  btnLineNumbers.addEventListener('click', () => {
    lineNumbersOn = !lineNumbersOn;
    localStorage.setItem(LINE_NUMBERS_KEY, lineNumbersOn ? 'on' : 'off');
    applyLineNumbers();
  });

  // ── Cursor load-position toggle ───────────────────────────────────────────────
  const CURSOR_POS_KEY  = PREFERENCE_KEYS.cursorLoadPosition;
  const btnCursorPos    = $id('btn-cursor-pos');
  let   cursorAtEnd     = localStorage.getItem(CURSOR_POS_KEY) === 'end'; // default: first line

  function applyCursorPos() {
    btnCursorPos.setAttribute('aria-pressed', String(cursorAtEnd));
    if (cursorAtEnd) {
      btnCursorPos.classList.add('cursor-pos-active');
      btnCursorPos.title = 'Load Position: Last Line';
    } else {
      btnCursorPos.classList.remove('cursor-pos-active');
      btnCursorPos.title = 'Load Position: First Line';
    }
  }
  applyCursorPos();

  btnCursorPos.addEventListener('click', () => {
    cursorAtEnd = !cursorAtEnd;
    localStorage.setItem(CURSOR_POS_KEY, cursorAtEnd ? 'end' : 'start');
    applyCursorPos();
  });

  // ── Collapsible-headings default toggle ───────────────────────────────────────
  const COLLAPSE_KEY       = PREFERENCE_KEYS.collapseDefault;
  const btnCollapseDefault = $id('btn-collapse-default');
  let   collapseDefaultOn  = localStorage.getItem(COLLAPSE_KEY) === 'on'; // default: expanded

  function applyCollapseDefaultBtn() {
    btnCollapseDefault.setAttribute('aria-pressed', String(collapseDefaultOn));
    if (collapseDefaultOn) {
      btnCollapseDefault.classList.add('collapse-default-active');
      btnCollapseDefault.title = 'Preview headings: collapsed by default';
    } else {
      btnCollapseDefault.classList.remove('collapse-default-active');
      btnCollapseDefault.title = 'Preview headings: expanded by default';
    }
  }
  applyCollapseDefaultBtn();

  btnCollapseDefault.addEventListener('click', () => {
    collapseDefaultOn = !collapseDefaultOn;
    localStorage.setItem(COLLAPSE_KEY, collapseDefaultOn ? 'on' : 'off');
    applyCollapseDefaultBtn();
    // Apply immediately to all current collapsible sections
    previewOut.querySelectorAll('details.md-collapsible').forEach(d => {
      if (collapseDefaultOn) d.removeAttribute('open');
      else d.setAttribute('open', '');
    });
  });

  // ── System folder visibility toggle ──────────────────────────────────────────
  const SHOW_SYSTEM_KEY  = PREFERENCE_KEYS.showSystemFolders;
  const SYSTEM_WORKSPACES = new Set(['ai-team', 'openbrain', 'shared', 'openbrain-shared']);
  const SYSTEM_WORKSPACES_LABEL = 'ai-team, openbrain, shared, openbrain-shared';
  const btnToggleSystem  = $id('btn-toggle-system-folders');
  let   showSystemFolders = localStorage.getItem(SHOW_SYSTEM_KEY) === 'on';

  const EYE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function applyToggleSystemBtn() {
    btnToggleSystem.querySelector<HTMLElement>('.settings-tile-icon')!.innerHTML = showSystemFolders ? EYE_SVG : EYE_OFF_SVG;
    btnToggleSystem.setAttribute('aria-pressed', String(showSystemFolders));
    btnToggleSystem.title = showSystemFolders
      ? `Hide system folders (${SYSTEM_WORKSPACES_LABEL})`
      : `Show system folders (${SYSTEM_WORKSPACES_LABEL})`;
    btnToggleSystem.classList.toggle('system-folders-visible', showSystemFolders);
  }
  applyToggleSystemBtn();

  btnToggleSystem.addEventListener('click', async () => {
    showSystemFolders = !showSystemFolders;
    localStorage.setItem(SHOW_SYSTEM_KEY, showSystemFolders ? 'on' : 'off');
    applyToggleSystemBtn();
    if (!showSystemFolders && activeWorkspace && SYSTEM_WORKSPACES.has(activeWorkspace)) {
      const fallback = workspaces.find(w => !SYSTEM_WORKSPACES.has(w.name));
      if (fallback) {
        await switchWorkspace(fallback);
        return;
      }
    }
    renderWorkspaceSwitcher(activeWorkspace || '');
  });

  // ── All Tasks feature toggle ─────────────────────────────────────────────────
  const btnToggleAllTasks  = $id('btn-toggle-all-tasks');

  const LIST_CHECKS_SVG    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 18h8"/></svg>';
  const LIST_CHECKS_OFF_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 18h8"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

  function applyToggleAllTasksBtn() {
    btnToggleAllTasks.querySelector<HTMLElement>('.settings-tile-icon')!.innerHTML = allTasksEnabled ? LIST_CHECKS_SVG : LIST_CHECKS_OFF_SVG;
    btnToggleAllTasks.setAttribute('aria-pressed', String(allTasksEnabled));
    btnToggleAllTasks.title = allTasksEnabled
      ? 'Disable "All Tasks" view'
      : 'Enable "All Tasks" view';
    btnToggleAllTasks.classList.toggle('active', allTasksEnabled);
    btnToggleAllTasks.classList.toggle('all-tasks-disabled', !allTasksEnabled);
  }
  applyToggleAllTasksBtn();

  btnToggleAllTasks.addEventListener('click', async () => {
    allTasksEnabled = !allTasksEnabled;
    localStorage.setItem(ALL_TASKS_ENABLED_KEY, allTasksEnabled ? 'on' : 'off');
    applyToggleAllTasksBtn();
    if (!allTasksEnabled && allTasksMode) {
      // Currently viewing All Tasks but the feature was just disabled —
      // fall back to the first top-level folder (and its first subfolder).
      const folders = await listWorkspaceTopDirs();
      if (folders.length) await selectL1(folders[0]);
      return;
    }
    const allTasksBtn = $maybe('btn-all-tasks');
    if (allTasksEnabled && !allTasksBtn) {
      const btn = mkNavAllTasksBtn();
      const renameBtn = $maybe('btn-rename-folder-1');
      if (renameBtn) renameBtn.after(btn);
      else navRow1.appendChild(btn);
    } else if (!allTasksEnabled && allTasksBtn) {
      allTasksBtn.remove();
    }
  });

  // ── Markdown Reference ────────────────────────────────────────────────────────
  const MD_REF_SECTIONS = [
    {
      title: 'Headings',
      rows: [
        ['# Heading 1',       '<h1>Heading 1</h1>'],
        ['## Heading 2',      '<h2>Heading 2</h2>'],
        ['### Heading 3',     '<h3>Heading 3</h3>'],
        ['#### Heading 4',    '<h4>Heading 4</h4>'],
        ['##### Heading 5',   '<h5>Heading 5</h5>'],
        ['###### Heading 6',  '<h6>Heading 6</h6>'],
        ['#### Title ####',   '<details open><summary style="color:var(--sapphire);font-weight:600">▶ Title</summary><p><em>collapsible section</em></p></details>'],
        ['## Section ##\ncontent\n## Next',
         '<details open><summary style="color:var(--lavender);font-size:1.35em;font-weight:600">▶ Section</summary><p>content</p></details><h2>Next</h2>'],
      ]
    },
    {
      title: 'Emphasis',
      rows: [
        ['**bold text**',          '<p><strong>bold text</strong></p>'],
        ['*italic text*',          '<p><em>italic text</em></p>'],
        ['***bold and italic***',   '<p><strong><em>bold and italic</em></strong></p>'],
        ['~~strikethrough~~',      '<p><del>strikethrough</del></p>'],
        ['**bold** and *italic*',  '<p><strong>bold</strong> and <em>italic</em></p>'],
      ]
    },
    {
      title: 'Lists',
      rows: [
        ['- Item one\n- Item two\n- Item three',
         '<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>'],
        ['1. First\n2. Second\n3. Third',
         '<ol><li>First</li><li>Second</li><li>Third</li></ol>'],
        ['- Parent\n  - Child\n  - Child\n- Parent',
         '<ul><li>Parent<ul><li>Child</li><li>Child</li></ul></li><li>Parent</li></ul>'],
        ['- [x] Done task\n- [ ] Open task',
         '<ul><li><input type="checkbox" checked disabled> Done task</li><li><input type="checkbox" disabled> Open task</li></ul>'],
      ]
    },
    {
      title: 'Links & Images',
      rows: [
        ['[Link text](https://example.com)',
         '<p><a href="#">Link text</a></p>'],
        ['[Link with title](https://example.com "My title")',
         '<p><a href="#" title="My title">Link with title</a></p>'],
        ['![Alt text](image.png)',
         '<p><em>[image: Alt text]</em></p>'],
        ['<https://example.com>',
         '<p><a href="#">https://example.com</a></p>'],
      ]
    },
    {
      title: 'Code',
      rows: [
        ['`inline code`',
         '<p><code>inline code</code></p>'],
        ['```\ncode block\n```',
         '<pre><code>code block</code></pre>'],
        ['```javascript\nconst x = 42;\nconsole.log(x);\n```',
         '<pre><code class="language-javascript">const x = 42;\nconsole.log(x);</code></pre>'],
      ]
    },
    {
      title: 'Blockquotes',
      rows: [
        ['> A single-line blockquote.',
         '<blockquote><p>A single-line blockquote.</p></blockquote>'],
        ['> First line\n>\n> Second paragraph.',
         '<blockquote><p>First line</p><p>Second paragraph.</p></blockquote>'],
        ['> Outer\n>> Nested blockquote',
         '<blockquote><p>Outer</p><blockquote><p>Nested blockquote</p></blockquote></blockquote>'],
      ]
    },
    {
      title: 'Tables',
      rows: [
        ['| Col A | Col B | Col C |\n|-------|-------|-------|\n| one   | two   | three |\n| four  | five  | six   |',
         '<table><thead><tr><th>Col A</th><th>Col B</th><th>Col C</th></tr></thead><tbody><tr><td>one</td><td>two</td><td>three</td></tr><tr><td>four</td><td>five</td><td>six</td></tr></tbody></table>'],
        ['| Left  | Center | Right |\n|:------|:------:|------:|\n| L     |   C    |     R |',
         '<table><thead><tr><th style="text-align:left">Left</th><th style="text-align:center">Center</th><th style="text-align:right">Right</th></tr></thead><tbody><tr><td style="text-align:left">L</td><td style="text-align:center">C</td><td style="text-align:right">R</td></tr></tbody></table>'],
      ]
    },
    {
      title: 'Horizontal Rules',
      rows: [
        ['---',  '<hr>'],
        ['***',  '<hr>'],
        ['___',  '<hr>'],
      ]
    },
    {
      title: 'Escaping & Special',
      rows: [
        ['\\*literal asterisks\\*',     '<p>*literal asterisks*</p>'],
        ['&amp;amp;  &amp;lt;  &amp;gt;', '<p>&amp;  &lt;  &gt;</p>'],
        ['Line one  \nLine two (two spaces → line break)',
         '<p>Line one<br>Line two (two spaces → line break)</p>'],
      ]
    },
  ];

  function buildMdRefContent() {
    const body = $id('md-ref-body');
    body.innerHTML = '';
    MD_REF_SECTIONS.forEach(sec => {
      const secEl = document.createElement('div');
      const heading = document.createElement('div');
      heading.className = 'md-ref-section-title';
      heading.textContent = sec.title;
      secEl.appendChild(heading);

      const table = document.createElement('table');
      table.className = 'md-ref-table';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>Syntax</th><th>Preview</th></tr>';
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      sec.rows.forEach(([syntax, html]) => {
        const tr = document.createElement('tr');
        const tdSyntax = document.createElement('td');
        tdSyntax.textContent = syntax;
        const tdPreview = document.createElement('td');
        tdPreview.innerHTML = html;
        tr.appendChild(tdSyntax);
        tr.appendChild(tdPreview);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      secEl.appendChild(table);
      body.appendChild(secEl);
    });

    const note = document.createElement('div');
    note.className = 'md-ref-note';
    note.innerHTML = 'This app uses <strong>marked.js</strong> for Markdown rendering with support for GitHub Flavored Markdown (GFM): tables, task lists, strikethrough, and fenced code blocks with syntax highlighting via <strong>highlight.js</strong>.';
    body.appendChild(note);
  }

  const modalMdRef    = $id('modal-md-ref');
  const btnMdRef      = $id('btn-md-reference');
  const btnMdRefClose = $id('btn-md-ref-close');
  let   mdRefBuilt    = false;

  function openMdRef() {
    if (!mdRefBuilt) { buildMdRefContent(); mdRefBuilt = true; }
    modalMdRef.classList.remove('hidden');
    document.removeEventListener('keydown', closeMdRefOnEsc);
    document.addEventListener('keydown', closeMdRefOnEsc);
  }
  function closeMdRef() {
    modalMdRef.classList.add('hidden');
    document.removeEventListener('keydown', closeMdRefOnEsc);
  }
  function closeMdRefOnEsc(e: any) { if (e.key === 'Escape') closeMdRef(); }

  btnMdRef.addEventListener('click', () => { closeSafetyTools(); openMdRef(); });
  btnMdRefClose.addEventListener('click', closeMdRef);
  modalMdRef.addEventListener('click', (e: any) => { if (e.target === modalMdRef) closeMdRef(); });

  // ── README / User Guide modal ─────────────────────────────────────────────
  const modalReadme    = $id('modal-readme');
  const btnReadme      = $id('btn-readme');
  const btnReadmeClose = $id('btn-readme-close');
  const readmeContent = $id('readme-body').querySelector<HTMLElement>('.readme-content')!;
  let   readmeLoaded   = false;

  async function loadPortableDocument(portableName: any, workspaceName: any) {
    return loadDocumentWithFallback({
      portableName,
      workspaceName,
      readPortable: name => portableSidecarText(name, 512 * 1024),
      readWorkspace: name => workspaceAppText(name, 512 * 1024),
      readBundled: name => bundledPortableText(name, 512 * 1024),
      warn: (message, error) => console.warn(message, error),
    });
  }

  async function openReadme() {
    if (!readmeLoaded) {
      try {
        const text = await loadPortableDocument('readme.md', 'readme.md');
        readmeContent.innerHTML = renderMarkdown(text);
      } catch {
        readmeContent.innerHTML = '<p style="color:var(--overlay0)">Could not load <code>readme.md</code>. Keep it beside the RecallStack executable.</p>';
      }
      readmeLoaded = true;
    }
    modalReadme.classList.remove('hidden');
    document.removeEventListener('keydown', closeReadmeOnEsc);
    document.addEventListener('keydown', closeReadmeOnEsc);
  }
  function closeReadme() {
    modalReadme.classList.add('hidden');
    document.removeEventListener('keydown', closeReadmeOnEsc);
  }
  function closeReadmeOnEsc(e: any) { if (e.key === 'Escape') closeReadme(); }

  btnReadme.addEventListener('click', () => { closeSafetyTools(); openReadme(); });
  btnReadmeClose.addEventListener('click', closeReadme);
  modalReadme.addEventListener('click', (e: any) => { if (e.target === modalReadme) closeReadme(); });

  // ── What's New / Changelog modal ──────────────────────────────────────────────
  const modalChangelog    = $id('modal-changelog');
  const btnChangelog      = $id('btn-changelog');
  const btnChangelogClose = $id('btn-changelog-close');
  const changelogContent = $id('changelog-body').querySelector<HTMLElement>('.readme-content')!;
  let   changelogLoaded   = false;

  function postProcessChangelog() {
    changelogContent.querySelectorAll('h2').forEach(h2 => {
      const wrapper = document.createElement('div');
      wrapper.className = 'cl-version-header';
      h2.parentNode?.insertBefore(wrapper, h2);
      wrapper.appendChild(h2);

      const btn = document.createElement('button');
      btn.className = 'cl-copy-btn';
      btn.title = 'Copy this section as HTML';
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      wrapper.appendChild(btn);

      btn.addEventListener('click', async () => {
        const parts = [wrapper.outerHTML];
        let el = wrapper.nextElementSibling;
        while (el && !el.classList.contains('cl-version-header')) {
          parts.push(el.outerHTML);
          el = el.nextElementSibling;
        }
        const html = parts.join('\n');
        const plain = h2.textContent + '\n\n' + html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html':  new Blob([html],  { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          })]);
        } catch {
          await copyPlainText(html);
        }
        btn.classList.add('copied');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
        }, 2000);
      });
    });
  }

  async function openChangelog() {
    if (!changelogLoaded) {
      try {
        const text = await loadPortableDocument('changes.md', 'changes.md');
        changelogContent.innerHTML = renderMarkdown(text);
        postProcessChangelog();
      } catch {
        changelogContent.innerHTML = '<p style="color:var(--overlay0)">Could not load <code>changes.md</code>. Keep it beside the RecallStack executable.</p>';
      }
      changelogLoaded = true;
    }
    modalChangelog.classList.remove('hidden');
    document.removeEventListener('keydown', closeChangelogOnEsc);
    document.addEventListener('keydown', closeChangelogOnEsc);
  }
  function closeChangelog() {
    modalChangelog.classList.add('hidden');
    document.removeEventListener('keydown', closeChangelogOnEsc);
  }
  function closeChangelogOnEsc(e: any) { if (e.key === 'Escape') closeChangelog(); }

  btnChangelog.addEventListener('click', () => { closeSafetyTools(); openChangelog(); });
  btnChangelogClose.addEventListener('click', closeChangelog);
  modalChangelog.addEventListener('click', (e: any) => { if (e.target === modalChangelog) closeChangelog(); });

  // ── Safety and workspace tools ───────────────────────────────────────────────
  const modalSafetyTools = $id('modal-safety-tools');
  const btnSafetyToolsClose = $id('btn-safety-tools-close');
  const btnSwitchWorkspace = $id('btn-switch-workspace');
  const safetyToolsOutput = $id('safety-tools-output');

  function safetyText(value: any) {
    safetyToolsOutput.innerHTML = '';
    safetyToolsOutput.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  function downloadSafetyReport(filename: any, text: any, type: any) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function showHealthReport(report: any) {
    safetyText(report);
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const json = document.createElement('button'); json.className = 'btn btn-ghost'; json.textContent = 'Export JSON';
    json.addEventListener('click', () => downloadSafetyReport('recallstack-health.json', JSON.stringify(report, null, 2), 'application/json'));
    const markdown = document.createElement('button'); markdown.className = 'btn btn-ghost'; markdown.textContent = 'Export Markdown';
    markdown.addEventListener('click', () => {
      downloadSafetyReport('recallstack-health.md', healthReportMarkdown(report), 'text/markdown');
    });
    actions.append(json, markdown); safetyToolsOutput.appendChild(actions);
  }
  bindNativeProgressEvents(safetyToolsOutput);

  async function showTrashRecords() {
    const records = await window.__recallstackNative!.listTrash();
    safetyToolsOutput.innerHTML = '';
    if (!records.length) { safetyToolsOutput.textContent = 'RecallStack Trash is empty.'; return; }
    records.forEach(record => {
      const row = document.createElement('div'); row.className = 'safety-record';
      const path = document.createElement('span'); path.className = 'safety-record-path';
      path.textContent = `${record.originalPath}  •  ${record.deletedAt}`;
      const restore = document.createElement('button'); restore.className = 'btn btn-ghost'; restore.textContent = 'Restore';
      restore.addEventListener('click', async () => {
        try { await window.__recallstackNative!.restoreTrash(String(record.id)); await showTrashRecords(); await reloadActiveList(); }
        catch (error: any) { toast('Restore failed: ' + (error?.message || error), 'error'); }
      });
      row.append(path, restore); safetyToolsOutput.appendChild(row);
    });
    const empty = document.createElement('button'); empty.className = 'btn btn-danger'; empty.textContent = 'Empty Trash Permanently';
    empty.addEventListener('click', async () => {
      if (!confirm(`Permanently delete all ${records.length} Trash item(s)? This cannot be undone.`)) return;
      const count = await window.__recallstackNative!.emptyTrash();
      safetyText(`Permanently removed ${count} Trash item(s).`);
    });
    safetyToolsOutput.appendChild(empty);
  }

  async function showCurrentVersions() {
    const path = appLocalPathForCurrentFile();
    if (!path) { safetyText('Open a saved note to inspect its version history.'); return; }
    const versions = await window.__recallstackNative!.listVersions(path);
    safetyToolsOutput.innerHTML = '';
    if (!versions.length) { safetyToolsOutput.textContent = 'No earlier versions have been recorded for this note.'; return; }
    versions.forEach(version => {
      const row = document.createElement('div'); row.className = 'safety-record';
      const description = document.createElement('span'); description.className = 'safety-record-path';
      description.textContent = `${version.createdAt}  •  ${version.size} bytes`;
      const restore = document.createElement('button'); restore.className = 'btn btn-ghost'; restore.textContent = 'Restore';
      restore.addEventListener('click', async () => {
        if (!confirm('Restore this version? The current content will be retained as another recoverable version.')) return;
        await window.__recallstackNative!.restoreVersion(String(version.id));
        await openFile(currentPath!.split('/').at(-1)!, currentPath || undefined);
        await showCurrentVersions();
      });
      row.append(description, restore); safetyToolsOutput.appendChild(row);
    });
  }

  async function loadRecentWorkspaceChoices() {
    const entries = await window.__recallstackNative!.recentWorkspaces();
    return entries.slice(0, MAX_RECENT_WORKSPACES);
  }

  async function removeRecentWorkspaceChoice(entry: any) {
    await window.__recallstackNative!.removeRecentWorkspace(entry.path);
  }

  async function reopenWorkspaceChoice(entry: any) {
    if (!await canSwitchWorkspaceRoot()) return false;
    const handle = await window.__recallstackNative!.openWorkspacePath(entry.path);
    return openChosenWorkspace(handle, true);
  }

  async function showWorkspaceChoices() {
    safetyToolsOutput.replaceChildren();
    const panel = document.createElement('div'); panel.className = 'workspace-choice-panel';
    const heading = document.createElement('h3'); heading.className = 'workspace-choice-title'; heading.textContent = 'Switch Workspace';
    const copy = document.createElement('p'); copy.className = 'workspace-choice-copy';
    copy.textContent = 'Choose another folder or re-open one of your six most recent workspaces.';
    const choose = document.createElement('button'); choose.className = 'btn btn-primary workspace-choice-browse';
    choose.textContent = 'Choose a Different Workspace…';
    choose.addEventListener('click', async () => {
      choose.disabled = true;
      try {
        if (await chooseAndOpenWorkspace()) {
          closeSafetyTools();
          toast('Workspace switched');
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') toast('Could not switch workspace: ' + (error?.message || error), 'error');
      } finally { choose.disabled = false; }
    });
    const recentHeading = document.createElement('div'); recentHeading.className = 'workspace-recent-heading'; recentHeading.textContent = 'Recent workspaces';
    const list = document.createElement('div'); list.className = 'workspace-recent-list';
    panel.append(heading, copy, choose, recentHeading, list);
    safetyToolsOutput.appendChild(panel);

    const entries = await loadRecentWorkspaceChoices();
    if (!entries.length) {
      const empty = document.createElement('div'); empty.className = 'workspace-recent-empty'; empty.textContent = 'No recent workspaces yet.';
      list.appendChild(empty);
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement('div'); row.className = 'workspace-recent-row';
      const details = document.createElement('div'); details.className = 'workspace-recent-details';
      const name = document.createElement('strong'); name.className = 'workspace-recent-name'; name.textContent = entry.name;
      const location = document.createElement('span'); location.className = 'workspace-recent-path';
      location.textContent = entry.path || '';
      details.append(name, location);
      const reopen = document.createElement('button'); reopen.className = 'btn btn-ghost workspace-reopen'; reopen.textContent = 'Re-Open';
      reopen.addEventListener('click', async () => {
        reopen.disabled = true;
        try {
          if (await reopenWorkspaceChoice(entry)) {
            closeSafetyTools();
            toast(`Opened ${entry.name}`);
          }
        } catch (error: any) {
          toast('Could not re-open workspace: ' + (error?.message || error), 'error');
          reopen.disabled = false;
        }
      });
      const remove = document.createElement('button'); remove.className = 'workspace-recent-remove';
      remove.type = 'button'; remove.title = `Remove ${entry.name} from recent workspaces`; remove.setAttribute('aria-label', remove.title);
      remove.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try { await removeRecentWorkspaceChoice(entry); row.remove(); }
        catch (error: any) { remove.disabled = false; toast('Could not remove recent workspace: ' + (error?.message || error), 'error'); }
      });
      row.append(details, reopen, remove); list.appendChild(row);
    });
  }

  async function runSafetyAction(action: any) {
    if (!window.__recallstackNative?.active) { safetyText('Safety tools require the native desktop application.'); return; }
    safetyText('Working…');
    if (action === 'validate') showHealthReport(await window.__recallstackNative!.checkWorkspace());
    else if (action === 'backup') {
      const destination = await window.__recallstackNative!.chooseBackupDestination();
      if (!destination) { safetyText('Backup cancelled.'); return; }
      safetyToolsOutput.replaceChildren();
      const progress = document.createElement('div'); progress.dataset.backupProgress = 'true'; progress.textContent = 'Preparing backup…';
      const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel Backup';
      cancel.addEventListener('click', () => { cancel.disabled = true; window.__recallstackNative!.cancelBackup(); });
      safetyToolsOutput.append(progress, cancel);
      safetyText(await window.__recallstackNative!.backup(destination, false));
    } else if (action === 'verify-backup') {
      const source = await window.__recallstackNative!.chooseBackupFile();
      if (!source) { safetyText('Backup verification cancelled.'); return; }
      const verification = await window.__recallstackNative!.verifyBackup(source);
      const dryRun = verification.verified ? await window.__recallstackNative!.restoreBackupDryRun(source) : null;
      safetyText({ verification, restoreDryRun: dryRun });
    } else if (action === 'rebuild') {
      safetyToolsOutput.replaceChildren();
      const progress = document.createElement('div'); progress.dataset.indexProgress = 'true'; progress.textContent = 'Preparing search index…';
      const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel Rebuild';
      cancel.addEventListener('click', () => { cancel.disabled = true; window.__recallstackNative!.cancelIndex(); });
      safetyToolsOutput.append(progress, cancel);
      const count = await window.__recallstackNative!.rebuildIndex();
      const health = await window.__recallstackNative!.indexHealth();
      await buildSearchIndex();
      safetyText(`Search index rebuilt successfully.\n${count} Markdown file(s) indexed.\n\n${JSON.stringify(health, null, 2)}`);
    } else if (action === 'trash') await showTrashRecords();
    else if (action === 'versions') await showCurrentVersions();
    else if (action === 'git') safetyText(await window.__recallstackNative!.gitStatus());
  }

  function openSafetyTools() {
    modalSafetyTools.classList.remove('hidden');
    btnSwitchWorkspace?.focus();
    showWorkspaceChoices().catch(error => safetyText('Could not load recent workspaces: ' + (error?.message || error)));
  }
  function closeSafetyTools() { modalSafetyTools.classList.add('hidden'); }
  btnSafetyTools.addEventListener('click', openSafetyTools);
  btnSwitchWorkspace.addEventListener('click', () => {
    showWorkspaceChoices().catch(error => safetyText('Could not load recent workspaces: ' + (error?.message || error)));
  });
  btnSafetyToolsClose.addEventListener('click', closeSafetyTools);
  modalSafetyTools.addEventListener('click', (event: any) => {
    if (event.target === modalSafetyTools) closeSafetyTools();
    const action = event.target.closest('[data-safety-action]')?.dataset.safetyAction;
    if (action) runSafetyAction(action).catch(error => safetyText('Tool failed: ' + (error?.message || error)));
  });
  modalSafetyTools.addEventListener('keydown', (event: any) => { if (event.key === 'Escape') closeSafetyTools(); });

  // ── App title editing ─────────────────────────────────────────────────────────

  const TITLE_KEY    = PREFERENCE_KEYS.appTitle;
  const btnEditTitle = $id('btn-edit-title');

  (function initAppTitle() {
    const saved = localStorage.getItem(TITLE_KEY);
    const el = $id('app-title');
    if (saved && el) { el.textContent = saved; document.title = saved; }
  })();

  function startEditTitle() {
    const titleEl = $id('app-title');
    if (!titleEl) return;
    const current = titleEl.textContent;
    const input = document.createElement('input');
    input.type         = 'text';
    input.value        = current || '';
    input.className    = 'app-title-input';
    input.spellcheck   = false;
    input.autocomplete = 'off';
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    function commitEdit() {
      const val  = input.value.trim() || 'RecallStack';
      localStorage.setItem(TITLE_KEY, val);
      document.title = val;
      const span = document.createElement('span');
      span.className   = 'app-title';
      span.id          = 'app-title';
      span.textContent = val;
      input.replaceWith(span);
    }
    input.addEventListener('blur',    commitEdit);
    input.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = current || ''; input.blur(); }
    });
  }

  if (btnEditTitle) btnEditTitle.addEventListener('click', startEditTitle);

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    initDependencyStatusBar();
    setupMarked();
    refreshDependencyStatuses();
    setDependencyStatus('sql', { state: 'loaded', source: 'native', detail: 'Native SQLite ready', errorText: '' });

    const saved = await loadWorkspaceHandle();
    if (saved) {
      // Check if permission is still granted without needing a user gesture
      const alreadyGranted = await saved.queryPermission({ mode: 'readwrite' }) === 'granted';
      if (alreadyGranted) {
        if (await openWorkspace(saved)) await saveWorkspaceHandle(saved);
        return;
      }
      // Not auto-grantable — show a "Reopen" button the user must click
      const reopenBtn = $id('btn-reopen-workspace');
      reopenBtn.textContent = `↩ Reopen "${saved.name}"`;
      reopenBtn.classList.remove('hidden');
      reopenBtn.addEventListener('click', async () => {
        try {
          const ok = await verifyPermission(saved);
          if (!ok) {
            toast('Permission denied', 'error');
            return;
          }
          await openChosenWorkspace(saved);
        } catch (e: any) {
          toast('Could not reopen workspace: ' + (e.message || e), 'error');
        }
      });
    }

    // Fall through to welcome screen (already visible by default)
  }

  // ── Calendar ──────────────────────────────────────────────────────────────────

  let calYear          = new Date().getFullYear();
  let calMonth         = new Date().getMonth();
  let calTaskMap       = new Map();
  let calSelectedDay: string | null = null;
  let calShowStarted   = true;
  let calShowCompleted = true;
  let calShowDue       = true;
  let calViewMode: "month" | "week" = 'month';
  let calWeekDate      = new Date(); // anchor date for week view

  const calViewEl = $id('calendar-view');

  function buildCalTaskMap() {
    calTaskMap = buildCalendarTaskMap(searchIndex, taskMetaFor, parseDateLocal);
  }

  function calFilteredTasks(dateStr: any) {
    return filteredCalendarTasks(calTaskMap, dateStr, {
      due: calShowDue, started: calShowStarted, completed: calShowCompleted,
    });
  }

  function calendarRenderOptions() {
    const heading = $id('cal-heading');
    const grid    = $id('cal-grid');
    if (!heading || !grid) return null;
    return {
      heading, grid, panel: $id('cal-task-panel'), mode: calViewMode,
      year: calYear, month: calMonth, weekAnchor: calWeekDate,
      selectedDate: calSelectedDay, tasksFor: calFilteredTasks,
      taskTitle: taskDisplayTitle, escape: esc,
      onSelect: (dateStr: any) => {
        calSelectedDay = dateStr;
        grid.querySelectorAll<HTMLElement>('.cal-day').forEach(c => c.classList.toggle('selected', c.dataset.date === dateStr));
        renderCalTaskPanel(dateStr);
      },
      onOpen: (task: any, event: MouseEvent) => openFile(task.name, task.notesRelPath, { pinned: isPinnedClick(event) }),
      onOpenJournal: (dateStr: any, event: MouseEvent) => openJournalForDate(dateStr, [], isPinnedClick(event))
        .catch(error => toast('Could not open journal: ' + (error?.message || error), 'error')),
    };
  }

  function renderCalendar() {
    const options = calendarRenderOptions();
    if (options) renderCalendarInto(options);
  }

  function renderCalTaskPanel(dateStr: any) {
    const options = calendarRenderOptions();
    if (options) renderCalendarTaskPanelInto(options, dateStr);
  }

  function showCalendarView() {
    buildCalTaskMap();
    showView('calendar');
    const btnCal = $id('btn-calendar');
    if (btnCal) btnCal.classList.add('active');
    renderCalendar();
  }

  $id('cal-prev').addEventListener('click', () => {
    if (calViewMode === 'week') {
      calWeekDate = new Date(calWeekDate);
      calWeekDate.setDate(calWeekDate.getDate() - 7);
    } else {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
    }
    calSelectedDay = null;
    const panel = $id('cal-task-panel');
    if (panel) panel.classList.add('hidden');
    renderCalendar();
  });

  $id('cal-next').addEventListener('click', () => {
    if (calViewMode === 'week') {
      calWeekDate = new Date(calWeekDate);
      calWeekDate.setDate(calWeekDate.getDate() + 7);
    } else {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
    }
    calSelectedDay = null;
    const panel = $id('cal-task-panel');
    if (panel) panel.classList.add('hidden');
    renderCalendar();
  });

  $id('cal-today').addEventListener('click', () => {
    const now  = new Date();
    calYear    = now.getFullYear();
    calMonth   = now.getMonth();
    calWeekDate = new Date();
    calSelectedDay = null;
    const panel = $id('cal-task-panel');
    if (panel) panel.classList.add('hidden');
    renderCalendar();
  });

  // Calendar view toggle (month ↔ week)
  $id('cal-view-toggle').addEventListener('click', () => {
    calViewMode = calViewMode === 'month' ? 'week' : 'month';
    const btn = $id('cal-view-toggle');
    if (calViewMode === 'week') {
      calWeekDate = new Date();
      btn.textContent = 'Month';
      btn.classList.add('active');
    } else {
      btn.textContent = 'Week';
      btn.classList.remove('active');
    }
    calSelectedDay = null;
    const panel = $id('cal-task-panel');
    if (panel) panel.classList.add('hidden');
    renderCalendar();
  });

  // Calendar filter checkboxes
  $id('cal-filter-started').addEventListener('change', (e: any) => {
    calShowStarted = e.target.checked;
    renderCalendar();
  });
  $id('cal-filter-completed').addEventListener('change', (e: any) => {
    calShowCompleted = e.target.checked;
    renderCalendar();
  });
  $id('cal-filter-due').addEventListener('change', (e: any) => {
    calShowDue = e.target.checked;
    renderCalendar();
  });

  $id('btn-calendar').addEventListener('click', () => {
    const isCalendar = !calViewEl.classList.contains('hidden');
    if (isCalendar) {
      $id('btn-calendar').classList.remove('active');
      showView('list');
      reloadActiveList().catch(e => toast(e.message, 'error'));
    } else {
      showCalendarView();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autoSaveIfDirty(false);
  });
  window.addEventListener('pagehide', () => autoSaveIfDirty(false));

  // Warms the CodeMirror editor chunk (lazy-markdown-editor.ts's on-demand
  // `import("./markdown-editor")`, ~197 KB gzip across 5 chunks) once the app
  // shell has finished starting up and is interactive, so the *first* file a
  // user opens in a session doesn't pay that fetch/parse/eval cost
  // synchronously — it happens in the idle gap between startup finishing and
  // the user actually clicking a file. This is a plain runtime dynamic
  // `import()` triggered well after the module graph has loaded, not a
  // static import, so it does not affect scripts/verify-performance-build.mjs's
  // "editor chunk stays lazy" checks (no modulepreload link is added, and the
  // static import-graph walk never sees a call expression like this one).
  //
  // Deliberately scoped to just the editor chunk. Mermaid (~975 KB gzip,
  // public/lib/mermaid.min.js) and the highlight.js "full" language bundle
  // (~43 KB gzip) are lazy for a different reason than CodeMirror: they're
  // only needed for specific note *content* (an actual Mermaid diagram, or a
  // code fence in a language outside the core hljs bundle), not universally
  // on every file open the way the editor itself is. Warming CodeMirror
  // trades a bit of startup time for a universal first-open win, matching
  // Athy's decision; warming Mermaid unconditionally on every launch would
  // mean paying ~1 MB of extra network/parse cost on startup even for
  // sessions that never view a diagram, which is a materially different and
  // much larger tradeoff than the one Athy signed off on — left as on-demand.
  function warmEditorChunk(): void {
    const load = () => {
      void mdEditor.ready().catch(error => {
        // Non-fatal: the chunk will simply be fetched again (on demand, with
        // the usual soft-stall) the first time a document is actually opened.
        console.warn('Editor chunk warm-load failed; will retry on first file open', error);
      });
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(load, { timeout: 2000 });
    } else {
      setTimeout(load, 0);
    }
  }

  init()
    .catch(error => {
      console.error('RecallStack initialization failed', error);
      toast('RecallStack could not initialize: ' + (error?.message || error), 'error');
    })
    .finally(() => {
      performance.mark('recallstack:shell-ready');
      document.documentElement.classList.remove('app-booting');
      warmEditorChunk();
    });

})();

export {};
