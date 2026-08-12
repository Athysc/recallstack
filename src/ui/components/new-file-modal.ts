export interface NewFileModalElements {
  overlay: HTMLElement;
  title: HTMLElement;
  input: HTMLInputElement;
  error: HTMLElement;
  cancelButton: HTMLButtonElement;
  createButton: HTMLButtonElement;
}

export interface NewFileModalOptions {
  title: string;
  defaultFilename: string;
  create(filename: string): Promise<string | null>;
}

export class NewFileModalController {
  private readonly elements: NewFileModalElements;
  private options: NewFileModalOptions | null = null;
  private submitting = false;
  private previousFocus: HTMLElement | null = null;

  constructor(elements: NewFileModalElements) {
    this.elements = elements;
    elements.cancelButton.addEventListener("click", () => this.close());
    elements.createButton.addEventListener("click", () => void this.submit());
    elements.input.addEventListener("input", () => this.clearError());
    elements.input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        void this.submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
    elements.overlay.addEventListener("click", event => {
      if (event.target === elements.overlay) this.close();
    });
    elements.overlay.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
  }

  open(options: NewFileModalOptions): void {
    if (this.submitting) return;
    this.previousFocus = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.options = options;
    this.elements.title.textContent = options.title;
    this.elements.input.value = options.defaultFilename;
    this.elements.createButton.textContent = "Create";
    this.elements.createButton.disabled = false;
    this.clearError();
    this.elements.overlay.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.elements.input.focus();
      this.elements.input.select();
    });
  }

  close(): void {
    if (this.submitting) return;
    const restoreFocus = this.previousFocus;
    this.options = null;
    this.previousFocus = null;
    this.elements.overlay.classList.add("hidden");
    this.elements.input.value = "";
    this.clearError();
    restoreFocus?.focus();
  }

  private clearError(): void {
    this.elements.input.classList.remove("error");
    this.elements.error.textContent = "";
  }

  private showError(message: string): void {
    this.elements.input.classList.add("error");
    this.elements.error.textContent = message;
    this.elements.input.focus();
  }

  private async submit(): Promise<void> {
    if (!this.options || this.submitting) return;
    this.submitting = true;
    this.elements.createButton.disabled = true;
    this.elements.createButton.textContent = "Creating…";
    try {
      const error = await this.options.create(this.elements.input.value);
      if (error) {
        this.showError(error);
        return;
      }
      this.options = null;
      this.previousFocus = null;
      this.elements.overlay.classList.add("hidden");
      this.elements.input.value = "";
      this.elements.input.blur();
      this.clearError();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    } finally {
      this.submitting = false;
      this.elements.createButton.disabled = false;
      this.elements.createButton.textContent = "Create";
    }
  }
}
