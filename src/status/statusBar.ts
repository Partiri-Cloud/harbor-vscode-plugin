import * as vscode from 'vscode';
import { whoami } from '../commands/auth';

const DASHBOARD_URL = 'https://app.partiri.cloud';

/** Status bar item showing the signed-in user (or "Sign in"); click opens the auth QuickPick. */
export class PartiriStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly getBinaryPath: () => string | null) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'partiri.statusBarMenu';
    this.item.show();
    this.item.text = '$(cloud) Partiri';
  }

  async refresh(): Promise<void> {
    const binaryPath = this.getBinaryPath();
    if (!binaryPath) {
      this.item.text = '$(cloud) Partiri: CLI not found';
      return;
    }
    try {
      const data = await whoami(binaryPath);
      this.item.text = data?.key_configured
        ? `$(account) ${data.user_email ?? 'Signed in'}`
        : '$(sign-in) Partiri: Sign in';
    } catch {
      this.item.text = '$(warning) Partiri';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

export interface StatusBarMenuActions {
  login: () => Promise<void> | void;
  setApiKey: () => Promise<void> | void;
  doctor: () => Promise<void> | void;
}

export async function showStatusBarMenu(actions: StatusBarMenuActions): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(sign-in) Login', id: 'login' as const },
      { label: '$(key) Set API Key', id: 'setApiKey' as const },
      { label: '$(pulse) Doctor', id: 'doctor' as const },
      { label: '$(link-external) Open Dashboard', id: 'dashboard' as const },
    ],
    { placeHolder: 'Partiri' },
  );
  if (!picked) {
    return;
  }
  if (picked.id === 'login') {
    await actions.login();
  } else if (picked.id === 'setApiKey') {
    await actions.setApiKey();
  } else if (picked.id === 'doctor') {
    await actions.doctor();
  } else {
    await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
  }
}
