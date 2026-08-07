export type AppEventMap = {
  "workspace:changed": { workspaceId: string };
  "navigation:changed": { path: string };
  "editor:dirty": { dirty: boolean };
  "theme:changed": { id: string };
};

export class AppEvents {
  private readonly target = new EventTarget();

  emit<K extends keyof AppEventMap>(name: K, detail: AppEventMap[K]): void {
    this.target.dispatchEvent(new CustomEvent(String(name), { detail }));
  }

  on<K extends keyof AppEventMap>(name: K, listener: (detail: AppEventMap[K]) => void): () => void {
    const handler = (event: Event) => listener((event as CustomEvent<AppEventMap[K]>).detail);
    this.target.addEventListener(String(name), handler);
    return () => this.target.removeEventListener(String(name), handler);
  }
}

export const appEvents = new AppEvents();
