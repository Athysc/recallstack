export type CommandCategory = "File" | "Navigation" | "Editor" | "Tasks" | "View" | "Tools" | "Workspace";

export interface CommandState {
  workspaceOpen: boolean;
  editorOpen: boolean;
  nativeDesktop: boolean;
}

export interface CommandContext {
  state: CommandState;
  reportError(error: unknown, command: AppCommand): void;
}

export interface AppCommand {
  id: string;
  title: string;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  icon?: string;
  reentrant?: boolean;
  isVisible?(state: CommandState): boolean;
  isEnabled?(state: CommandState): boolean;
  disabledReason?(state: CommandState): string;
  run(context: CommandContext, argument?: unknown): Promise<void> | void;
}

export class CommandRegistry {
  readonly #commands = new Map<string, AppCommand>();
  readonly #running = new Set<string>();

  register(command: AppCommand): () => void {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9-]+)+$/.test(command.id)) {
      throw new Error(`Command id must be stable dot notation: ${command.id}`);
    }
    if (this.#commands.has(command.id)) throw new Error(`Duplicate command: ${command.id}`);
    this.#commands.set(command.id, command);
    return () => this.#commands.delete(command.id);
  }

  get(id: string): AppCommand | undefined { return this.#commands.get(id); }

  list(state: CommandState): AppCommand[] {
    return [...this.#commands.values()]
      .filter(command => command.isVisible?.(state) !== false)
      .sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title));
  }

  enabled(command: AppCommand, state: CommandState): boolean {
    return command.isEnabled?.(state) !== false && (command.reentrant === true || !this.#running.has(command.id));
  }

  disabledReason(command: AppCommand, state: CommandState): string | undefined {
    if (this.#running.has(command.id) && command.reentrant !== true) return "Already running";
    return this.enabled(command, state) ? undefined : command.disabledReason?.(state) || "Unavailable right now";
  }

  async execute(id: string, context: CommandContext, argument?: unknown): Promise<boolean> {
    const command = this.#commands.get(id);
    if (!command || command.isVisible?.(context.state) === false || !this.enabled(command, context.state)) return false;
    if (command.reentrant !== true) this.#running.add(id);
    try {
      await command.run(context, argument);
      return true;
    } catch (error) {
      context.reportError(error, command);
      return false;
    } finally {
      this.#running.delete(id);
    }
  }
}
