/**
 * Minimal fake of the `vscode` module, used only under vitest (aliased in
 * vitest.config.ts) so cli/*, state/*, and command modules can be unit
 * tested without a real extension host. Implements just enough surface for
 * the modules covered by the mandated unit tests (invoke, envelope, queue,
 * exit-2, discovery, wizard state machine, confirm matrix) to load and run.
 */
import { EventEmitter as NodeEventEmitter } from 'node:events';

export class EventEmitter<T> {
  private readonly emitter = new NodeEventEmitter();
  private static nextId = 0;
  private readonly channel = `event-${EventEmitter.nextId++}`;

  event = (listener: (value: T) => void): { dispose: () => void } => {
    this.emitter.on(this.channel, listener);
    return { dispose: () => this.emitter.off(this.channel, listener) };
  };

  fire(value: T): void {
    this.emitter.emit(this.channel, value);
  }

  dispose(): void {
    this.emitter.removeAllListeners(this.channel);
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  id?: string;
  description?: string | boolean;
  contextValue?: string;
  collapsibleState?: TreeItemCollapsibleState;
  iconPath?: unknown;
  command?: unknown;
  tooltip?: string;

  constructor(label?: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class Uri {
  private constructor(public readonly fsPath: string) {}
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  toString(): string {
    return this.fsPath;
  }
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
  SourceControl = 1,
}

export interface MockTerminal {
  name: string;
  shown: boolean;
  sentTexts: string[];
  show(): void;
  sendText(text: string, addNewLine?: boolean): void;
  dispose(): void;
}

type ConfigValues = Record<string, unknown>;

const configStore: ConfigValues = {};

export function __setConfig(values: ConfigValues): void {
  for (const key of Object.keys(configStore)) {
    delete configStore[key];
  }
  Object.assign(configStore, values);
}

let defaultFindFilesResult: Uri[] = [];
const findFilesResultByPattern = new Map<string, Uri[]>();
const fileContents = new Map<string, string>();

/**
 * Sets the result returned for every glob pattern that has no
 * pattern-specific override — matches the old single-bucket behaviour so
 * existing callers (a single array meant to represent "these files exist")
 * keep working unchanged even though linkedServices.ts now issues two
 * findFiles calls.
 */
export function __setFindFilesResult(files: Uri[]): void {
  defaultFindFilesResult = files;
  findFilesResultByPattern.clear();
}

/** Answers a specific glob pattern distinctly from the default bucket. */
export function __setFindFilesResultFor(pattern: string, files: Uri[]): void {
  findFilesResultByPattern.set(pattern, files);
}

export function __setFileContents(contents: Record<string, string>): void {
  fileContents.clear();
  for (const [fsPath, content] of Object.entries(contents)) {
    fileContents.set(fsPath, content);
  }
}

export function __resetTerminals(): void {
  window.terminals.length = 0;
}

export function __terminals(): MockTerminal[] {
  return window.terminals;
}

export const workspace = {
  getConfiguration(section?: string) {
    const prefix = section ? `${section}.` : '';
    return {
      get<T>(key: string, fallback?: T): T {
        const full = `${prefix}${key}`;
        return full in configStore ? (configStore[full] as T) : (fallback as T);
      },
    };
  },
  workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,
  async findFiles(pattern: string): Promise<Uri[]> {
    return findFilesResultByPattern.get(pattern) ?? defaultFindFilesResult;
  },
  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      const content = fileContents.get(uri.fsPath);
      return content === undefined ? new Uint8Array() : new TextEncoder().encode(content);
    },
    async writeFile(): Promise<void> {
      return undefined;
    },
  },
  onDidChangeConfiguration: new EventEmitter<unknown>().event,
};

const activeEditorEmitter = new EventEmitter<
  { document: { uri: { fsPath: string } } } | undefined
>();

/** Drive window.onDidChangeActiveTextEditor from a test. */
export function __fireActiveEditor(fsPath: string | undefined): void {
  const editor = fsPath === undefined ? undefined : { document: { uri: { fsPath } } };
  window.activeTextEditor = editor;
  activeEditorEmitter.fire(editor);
}

export const window = {
  activeTextEditor: undefined as { document: { uri: Uri } } | undefined,
  async showWarningMessage(..._args: unknown[]): Promise<string | undefined> {
    return undefined;
  },
  async showErrorMessage(..._args: unknown[]): Promise<string | undefined> {
    return undefined;
  },
  async showInformationMessage(..._args: unknown[]): Promise<string | undefined> {
    return undefined;
  },
  async showQuickPick(..._args: unknown[]): Promise<unknown> {
    return undefined;
  },
  async showInputBox(..._args: unknown[]): Promise<string | undefined> {
    return undefined;
  },
  createOutputChannel(name: string) {
    return {
      name,
      appendLine(_line: string) {},
      append(_text: string) {},
      show() {},
      clear() {},
      dispose() {},
    };
  },
  terminals: [] as MockTerminal[],
  createTerminal(name?: string): MockTerminal {
    const terminal: MockTerminal = {
      name: name ?? '',
      shown: false,
      sentTexts: [],
      show() {
        terminal.shown = true;
      },
      sendText(text: string, _addNewLine?: boolean) {
        terminal.sentTexts.push(text);
      },
      dispose() {},
    };
    this.terminals.push(terminal);
    return terminal;
  },
  createStatusBarItem() {
    return {
      text: '',
      tooltip: '',
      command: undefined as string | undefined,
      show() {},
      hide() {},
      dispose() {},
    };
  },
  createTreeView() {
    return { dispose() {} };
  },
  onDidChangeActiveTextEditor: activeEditorEmitter.event,
  registerWebviewViewProvider(_id: string, _provider: unknown) {
    return { dispose() {} };
  },
  withProgress<T>(_options: unknown, task: (...args: unknown[]) => Promise<T>): Promise<T> {
    return task({ report() {} });
  },
};

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

/** Commands registered since the last __resetCommands(), for registration tests. */
export function __registeredCommands(): Map<string, (...args: unknown[]) => unknown> {
  return registeredCommands;
}

export function __resetCommands(): void {
  registeredCommands.clear();
}

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    registeredCommands.set(id, handler);
    return {
      dispose() {
        registeredCommands.delete(id);
      },
    };
  },
  async executeCommand(_id: string, ..._args: unknown[]): Promise<unknown> {
    return undefined;
  },
};

export interface MockWebviewView {
  webview: { options: Record<string, unknown>; html: string };
  visible: boolean;
  show(): void;
  onDidChangeVisibility: (listener: () => void) => { dispose: () => void };
  onDidDispose: (listener: () => void) => { dispose: () => void };
  __fireVisibility(visible: boolean): void;
  __fireDispose(): void;
}

/** Fake WebviewView for driving WebviewViewProvider implementations under vitest. */
export function __makeWebviewView(): MockWebviewView {
  const visibility = new EventEmitter<void>();
  const disposal = new EventEmitter<void>();
  const view: MockWebviewView = {
    webview: { options: {}, html: '' },
    visible: true,
    show() {},
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposal.event,
    __fireVisibility(visible: boolean) {
      view.visible = visible;
      visibility.fire();
    },
    __fireDispose() {
      disposal.fire();
    },
  };
  return view;
}

export default {
  workspace,
  window,
  commands,
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  Uri,
  ProgressLocation,
};
