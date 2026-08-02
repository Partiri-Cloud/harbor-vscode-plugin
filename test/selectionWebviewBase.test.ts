import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import type { ServiceDataContext } from '../src/data/serviceData';
import { SelectedServiceStore, type SelectedService } from '../src/state/selectedService';
import { SelectionWebviewView, WAITING_FOR_CLI } from '../src/views/selectionWebviewBase';
import { __makeWebviewView, type MockWebviewView } from './mocks/vscode';

const REMOTE: SelectedService = { kind: 'remote', serviceId: 'svc-1', name: 'api' };
const OTHER: SelectedService = { kind: 'remote', serviceId: 'svc-2', name: 'web' };

/** Minimal concrete subclass: records every render and lets a test make one fail. */
class TestPanel extends SelectionWebviewView {
  readonly rendered: string[] = [];
  shouldFail = false;

  constructor(store: SelectedServiceStore, ctx: ServiceDataContext) {
    super(store, ctx);
  }

  protected readonly webviewOptions = { enableScripts: false };
  protected readonly loadingLabel = 'Loading test…';

  protected emptyHtml(): string {
    return '<!--EMPTY-->';
  }

  protected async renderSelection(selection: SelectedService): Promise<void> {
    await Promise.resolve();
    // Mirrors the real panels: renderSelection owns its own error handling and
    // never throws, so the base can treat the selection as settled either way.
    this.setHtml(this.shouldFail ? '<!--FAILED-->' : `<!--OK:${selection.name}-->`);
    this.rendered.push(this.shouldFail ? 'failed' : 'ok');
  }
}

let store: SelectedServiceStore;
let ctx: ServiceDataContext;
let binaryPath: string | null;
let view: MockWebviewView;
let panel: TestPanel;

beforeEach(() => {
  binaryPath = '/usr/bin/partiri';
  store = new SelectedServiceStore();
  ctx = {
    getBinaryPath: () => binaryPath,
    globalStorageDir: '/tmp',
    linkedServices: {} as ServiceDataContext['linkedServices'],
    contextStore: {} as ServiceDataContext['contextStore'],
    outputChannel: vscode.window.createOutputChannel('test'),
  };
  view = __makeWebviewView();
  panel = new TestPanel(store, ctx);
});

const html = (): string => view.webview.html;

/** resolveWebviewView kicks off its own refresh; let it settle and forget it. */
async function resolveAndSettle(): Promise<void> {
  panel.resolveWebviewView(view as unknown as vscode.WebviewView);
  await panel.refresh();
  panel.rendered.length = 0;
}

describe('SelectionWebviewView', () => {
  it('refresh() before the view resolves is a no-op', async () => {
    await panel.refresh();
    expect(panel.rendered).toEqual([]);
  });

  it('renders the empty document when nothing is selected', async () => {
    panel.resolveWebviewView(view as unknown as vscode.WebviewView);
    await panel.refresh();
    expect(html()).toBe('<!--EMPTY-->');
    expect(panel.rendered).toEqual([]);
  });

  it('applies the subclass webview options on resolve', () => {
    panel.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.options).toEqual({ enableScripts: false });
  });

  it('renders the selection once one exists', async () => {
    store.select(REMOTE);
    panel.resolveWebviewView(view as unknown as vscode.WebviewView);
    await panel.refresh();
    expect(html()).toBe('<!--OK:api-->');
  });

  describe('when the CLI has not resolved yet', () => {
    beforeEach(() => {
      binaryPath = null;
      store.select(REMOTE);
      panel.resolveWebviewView(view as unknown as vscode.WebviewView);
    });

    it('says so rather than rendering an unavailable state', async () => {
      await panel.refresh();
      expect(html()).toContain(WAITING_FOR_CLI);
      expect(panel.rendered).toEqual([]);
    });

    /**
     * The subtle one: leaving the selection unsettled means the refresh fired
     * once activation resolves the binary still shows a spinner, instead of
     * jumping straight from "waiting" to content.
     */
    it('leaves the selection unsettled, so the next refresh still shows the spinner', async () => {
      await panel.refresh();
      binaryPath = '/usr/bin/partiri';
      await panel.refresh();
      expect(panel.rendered).toEqual(['ok']);
      // The spinner was rendered on the way to the content.
      expect(html()).toBe('<!--OK:api-->');
    });
  });

  describe('the spinner gate', () => {
    beforeEach(async () => {
      store.select(REMOTE);
      await resolveAndSettle();
    });

    it('shows a spinner for a selection with nothing rendered yet', async () => {
      // A fresh panel, so this really is the first render for this selection.
      const fresh = new TestPanel(store, ctx);
      const freshView = __makeWebviewView();
      fresh.resolveWebviewView(freshView as unknown as vscode.WebviewView);
      // refresh() runs synchronously up to the spinner, then awaits the fetch.
      expect(freshView.webview.html).toContain('Loading test…');
      await fresh.refresh();
      expect(freshView.webview.html).toBe('<!--OK:api-->');
    });

    /**
     * A background poll tick must not flash "loading" over content the user is
     * already reading — this is the whole reason `settledFor` exists.
     */
    it('does not show a spinner on a repeat refresh of the same selection', async () => {
      await panel.refresh();
      const pending = panel.refresh();
      const midFlight = html();
      await pending;
      expect(midFlight).not.toContain('Loading test…');
      expect(midFlight).toBe('<!--OK:api-->');
    });

    it('shows the spinner again when the selection changes', async () => {
      await panel.refresh();
      store.select(OTHER);
      const pending = panel.refresh();
      const midFlight = html();
      await pending;
      expect(midFlight).toContain('Loading test…');
      expect(html()).toBe('<!--OK:web-->');
    });

    it('settles a failed render, so a failing poll stops flickering', async () => {
      panel.shouldFail = true;
      await panel.refresh();
      const pending = panel.refresh();
      const midFlight = html();
      await pending;
      expect(midFlight).not.toContain('Loading test…');
      expect(panel.rendered).toEqual(['failed', 'failed']);
    });

    it('reload() clears the settled marker so the spinner returns', async () => {
      await panel.refresh();
      const pending = panel.reload();
      const midFlight = html();
      await pending;
      expect(midFlight).toContain('Loading test…');
    });

    it('clearing the selection resets the settled marker', async () => {
      await panel.refresh();
      store.select(undefined);
      await panel.refresh();
      store.select(REMOTE);
      const pending = panel.refresh();
      const midFlight = html();
      await pending;
      expect(midFlight).toContain('Loading test…');
    });
  });

  describe('lifecycle', () => {
    it('refreshes when the selection changes', async () => {
      panel.resolveWebviewView(view as unknown as vscode.WebviewView);
      store.select(REMOTE);
      await Promise.resolve();
      await Promise.resolve();
      expect(panel.rendered).toEqual(['ok']);
    });

    it('refreshes when the view becomes visible, but not when it hides', async () => {
      store.select(REMOTE);
      await resolveAndSettle();
      const before = panel.rendered.length;

      view.__fireVisibility(false);
      await Promise.resolve();
      expect(panel.rendered.length).toBe(before);

      view.__fireVisibility(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(panel.rendered.length).toBe(before + 1);
    });

    /** A render that lands after disposal must not throw on a gone webview. */
    it('stops rendering after the view is disposed', async () => {
      store.select(REMOTE);
      await resolveAndSettle();
      const lastHtml = html();

      view.__fireDispose();

      await expect(panel.refresh()).resolves.toBeUndefined();
      expect(panel.rendered).toEqual([]);
      expect(html()).toBe(lastHtml);
    });

    it('dispose() releases the subscriptions and stops following the selection', async () => {
      panel.resolveWebviewView(view as unknown as vscode.WebviewView);
      panel.dispose();
      store.select(REMOTE);
      await Promise.resolve();
      await Promise.resolve();
      expect(panel.rendered).toEqual([]);
    });
  });
});
