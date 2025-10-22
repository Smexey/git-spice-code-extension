// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { StackViewProvider } from './stackView/StackViewProvider';
import { execBranchCreate, execUp, execDown, execTrunk, execStackRestack, execStackSubmit } from './utils/gitSpice';

export function activate(context: vscode.ExtensionContext): void {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const provider = new StackViewProvider(workspaceFolder, context.extensionUri);

	context.subscriptions.push(
		provider,
		vscode.window.registerWebviewViewProvider('gitSpice.branches', provider, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.commands.registerCommand('git-spice.syncRepo', () => provider.sync()),
		vscode.commands.registerCommand('git-spice.branchCreateFromCommitMessage', async () => {
			const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
			if (!gitExtension) {
				void vscode.window.showErrorMessage('Git extension not found');
				return;
			}

			const git = gitExtension.getAPI(1);
			if (!git || git.repositories.length === 0) {
				void vscode.window.showErrorMessage('No Git repository found');
				return;
			}

			const repository = git.repositories[0];
			const commitMessage = repository.inputBox.value;

			if (!commitMessage || commitMessage.trim() === '') {
				void vscode.window.showErrorMessage('Please enter a commit message first');
				return;
			}

			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			// Execute git-spice branch create with auto-staging
			const result = await execBranchCreate(folder, commitMessage);
			if ('error' in result) {
				void vscode.window.showErrorMessage(result.error);
			} else {
				void vscode.window.showInformationMessage(`Created branch with message: ${commitMessage}`);
				// Clear the commit message input box after successful branch creation
				repository.inputBox.value = '';
				
				// Multiple refresh strategies for faster UI updates
				void provider.refresh();
				void repository.status();
				
				// Force refresh the Source Control view
				void vscode.commands.executeCommand('workbench.scm.focus');
				void vscode.commands.executeCommand('workbench.view.scm');
				
				// Additional refresh after a short delay to ensure UI is updated
				setTimeout(() => {
					void repository.status();
					void provider.refresh();
				}, 100);
			}
		}),
		vscode.commands.registerCommand('git-spice.up', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			const result = await execUp(folder);
			if ('error' in result) {
				void vscode.window.showErrorMessage(`Failed to navigate up: ${result.error}`);
			} else {
				void vscode.window.showInformationMessage('Navigated up the stack');
			}
			void provider.refresh();
		}),
		vscode.commands.registerCommand('git-spice.down', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			const result = await execDown(folder);
			if ('error' in result) {
				void vscode.window.showErrorMessage(`Failed to navigate down: ${result.error}`);
			} else {
				void vscode.window.showInformationMessage('Navigated down the stack');
			}
			void provider.refresh();
		}),
		vscode.commands.registerCommand('git-spice.trunk', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			const result = await execTrunk(folder);
			if ('error' in result) {
				void vscode.window.showErrorMessage(`Failed to navigate to trunk: ${result.error}`);
			} else {
				void vscode.window.showInformationMessage('Navigated to trunk');
			}
			void provider.refresh();
		}),
		vscode.commands.registerCommand('git-spice.stackRestack', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Restacking current stack...',
				cancellable: false,
			}, async () => {
				const result = await execStackRestack(folder);
				if ('error' in result) {
					void vscode.window.showErrorMessage(`Failed to restack stack: ${result.error}`);
				} else {
					void vscode.window.showInformationMessage('Stack restacked successfully');
				}
				await provider.refresh();
			});
		}),
		vscode.commands.registerCommand('git-spice.stackSubmit', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Submitting current stack...',
				cancellable: false,
			}, async () => {
				const result = await execStackSubmit(folder);
				if ('error' in result) {
					void vscode.window.showErrorMessage(`Failed to submit stack: ${result.error}`);
				} else {
					void vscode.window.showInformationMessage('Stack submitted successfully');
				}
				await provider.refresh();
			});
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			provider.setWorkspaceFolder(vscode.workspace.workspaceFolders?.[0]);
			void provider.refresh();
		}),
	);
}

export function deactivate(): void {
	// No-op: disposables are registered via the extension context.
}