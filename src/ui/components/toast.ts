export type ToastType = "success" | "error";

export function createToastController(element: HTMLElement, durationMs = 2800): (message: string, type?: ToastType) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message, type = "success") => {
    element.textContent = message;
    element.className = `show toast-${type}`;
    clearTimeout(timer);
    timer = setTimeout(() => { element.className = ""; }, durationMs);
  };
}
