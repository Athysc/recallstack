import hljs from "highlight.js/lib/core";
import { marked } from "marked";

export interface RuntimeCapabilities {
  desktop: boolean;
  nativeFilesystem: boolean;
  nativeIndex: boolean;
}

declare global {
  interface Window {
    __depSources?: Record<string, string>;
    marked?: typeof marked;
    hljs?: typeof hljs;
  }
}

export function detectCapabilities(): RuntimeCapabilities {
  const desktop = Boolean(window.__TAURI_INTERNALS__);
  const nativeFilesystem = Boolean(window.__recallstackNative?.active);
  return { desktop, nativeFilesystem, nativeIndex: nativeFilesystem };
}

export function prepareRuntimeDependencies(): RuntimeCapabilities {
  const capabilities = detectCapabilities();
  window.__depSources = {
    sql: "native",
    marked: "local",
    hljs: "local",
    hljsFull: "local",
    mermaid: "local",
  };
  window.marked = marked;
  window.hljs = hljs;
  performance.mark("recallstack:typescript-bootstrap-ready");
  return capabilities;
}

export function reportBootstrapFailure(error: unknown): void {
  console.error("RecallStack bootstrap failed", error);
  document.documentElement.classList.remove("app-booting");
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<main id="welcome"><div class="welcome-card"><div class="welcome-icon">⚠️</div><h1>RecallStack could not start</h1><p>${escapeHtml(message)}</p><button class="btn btn-primary" id="bootstrap-retry">Retry</button></div></main>`;
  document.querySelector("#bootstrap-retry")?.addEventListener("click", () => location.reload());
}

function escapeHtml(value: string): string {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}
