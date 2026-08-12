const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_FORBIDDEN_CHARACTERS = /[\u0000-\u001f<>:"/\\|?*]/u;

/**
 * Return a user-facing error when a single file or directory name cannot be
 * represented consistently on RecallStack's supported Windows and Linux builds.
 */
export function portableNameError(name: unknown): string | null {
  const value = String(name ?? "");
  if (!value || value === "." || value === "..") return "A name is required";
  if (WINDOWS_FORBIDDEN_CHARACTERS.test(value)) {
    return 'Names cannot contain control characters or any of < > : " / \\ | ? *';
  }
  if (/[. ]$/u.test(value)) return "Names cannot end with a period or space";
  if (WINDOWS_RESERVED_NAME.test(value)) return `"${value}" is a reserved Windows name`;
  return null;
}

export function assertPortableName(name: unknown): void {
  const error = portableNameError(name);
  if (error) throw new TypeError(error);
}
