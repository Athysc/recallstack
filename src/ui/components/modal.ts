export interface ModalController {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createModalController(options: {
  overlay: HTMLElement;
  closeButton: HTMLElement;
  trigger?: HTMLElement | null;
  beforeOpen?: () => void | Promise<void>;
  focusOnOpen?: HTMLElement | null;
}): ModalController {
  const { overlay, closeButton, trigger, beforeOpen, focusOnOpen = closeButton } = options;

  const close = () => {
    if (overlay.classList.contains("hidden")) return;
    overlay.classList.add("hidden");
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.focus();
  };
  const open = () => {
    void Promise.resolve(beforeOpen?.()).finally(() => {
      overlay.classList.remove("hidden");
      trigger?.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => focusOnOpen?.focus());
    });
  };

  trigger?.setAttribute("aria-haspopup", "dialog");
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  });

  return { open, close, isOpen: () => !overlay.classList.contains("hidden") };
}
