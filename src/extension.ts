// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { StackViewProvider } from './stackView/StackViewProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const provider = new StackViewProvider(workspaceFolder, context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('gitSpice.branches', provider),
		vscode.commands.registerCommand('git-spice.refreshBranches', () => provider.refresh()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			provider.setWorkspaceFolder(vscode.workspace.workspaceFolders?.[0]);
			void provider.refresh();
		}),
	);

	await provider.refresh();
}

export function deactivate(): void {
	// No-op: disposables are registered via the extension context.
}
