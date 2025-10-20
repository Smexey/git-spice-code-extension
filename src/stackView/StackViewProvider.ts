import * as vscode from 'vscode';

import { buildDisplayState } from './state';
import type { BranchRecord, DisplayState } from './types';
import type { WebviewMessage } from './webviewTypes';
import { execGitSpice, execStackEdit, execBranchRestack } from '../utils/gitSpice';
import { readMediaFile, readDistFile } from '../utils/readFileSync';

export class StackViewProvider implements vscode.WebviewViewProvider {
	private view!: vscode.WebviewView; // definite assignment assertion - set in resolveWebviewView
	private branches: BranchRecord[] = [];
	private lastError: string | undefined;
	private fileWatcher: vscode.FileSystemWatcher | undefined;
	private pendingState: DisplayState | null = null;
	private pendingReorder: { branchName: string; oldIndex: number; newIndex: number } | null = null;

	constructor(private workspaceFolder: vscode.WorkspaceFolder | undefined, private readonly extensionUri: vscode.Uri) {
		// No initialization here - everything happens after resolveWebviewView
	}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media'),
				vscode.Uri.joinPath(this.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
			],
		};
		webviewView.webview.html = await this.renderHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
			switch (message.type) {
				case 'ready':
					this.pushState();
					return;
				case 'refresh':
					void this.refresh();
					return;
				case 'openChange':
					if (typeof message.url === 'string') {
						void vscode.env.openExternal(vscode.Uri.parse(message.url));
					}
					return;
				case 'openCommit':
					if (typeof message.sha === 'string') {
						void vscode.commands.executeCommand('git.openCommit', message.sha);
					}
					return;
				case 'branchDrop':
					if (typeof message.source === 'string' && typeof message.target === 'string') {
						void this.handleBranchDrop(message.source, message.target);
					}
					return;
				case 'branchReorder':
					if (typeof message.oldIndex === 'number' && typeof message.newIndex === 'number' && typeof message.branchName === 'string') {
						void this.handleBranchReorder(message.oldIndex, message.newIndex, message.branchName);
					}
					return;
				case 'confirmReorder':
					if (typeof message.branchName === 'string') {
						void this.handleConfirmReorder(message.branchName);
					}
					return;
				case 'cancelReorder':
					if (typeof message.branchName === 'string') {
						void this.handleCancelReorder(message.branchName);
					}
					return;
				default:
					return;
			}
		});

		this.setupFileWatcher();
		void this.refresh();
	}

	setWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): void {
		this.workspaceFolder = folder;
		this.setupFileWatcher();
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (!this.workspaceFolder) {
			this.branches = [];
			this.lastError = 'Open a workspace folder to view git-spice stacks.';
			this.pushState();
			return;
		}

		const result = await execGitSpice(this.workspaceFolder);
		if ('error' in result) {
			this.branches = [];
			this.lastError = result.error;
		} else {
			this.branches = result.value;
			this.lastError = undefined;
		}

		this.pushState();
	}

	private pushState(): void {
		// No undefined check needed - only called when view exists
		const state = buildDisplayState(this.branches, this.lastError, this.pendingReorder || undefined);
		void this.view.webview.postMessage({ type: 'state', payload: state });
	}

	private async handleBranchDrop(source: string, target: string): Promise<void> {
		// TODO: Implement branch drop functionality
		await vscode.window.showInformationMessage(
			`Drag-and-drop planned: move ${source} onto ${target}`,
		);
	}

	/**
	 * Handles a branch reorder operation from the webview.
	 * Sets the pending reorder state and updates the UI to show confirm/cancel buttons.
	 * 
	 * @param oldIndex - The original position of the branch (from SortableJS)
	 * @param newIndex - The new position of the branch (from SortableJS)
	 * @param branchName - The name of the branch that was moved
	 */
	private async handleBranchReorder(oldIndex: number, newIndex: number, branchName: string): Promise<void> {
		this.pendingReorder = { branchName, oldIndex, newIndex };
		this.pushState();
	}

	/**
	 * Handles confirmation of a branch reorder operation.
	 * Executes the git-spice restack command and refreshes the view.
	 * 
	 * @param branchName - The name of the branch to restack
	 */
	private async handleConfirmReorder(branchName: string): Promise<void> {
		if (!this.pendingReorder || this.pendingReorder.branchName !== branchName) {
			return;
		}

		const { oldIndex, newIndex } = this.pendingReorder;
		this.pendingReorder = null;

		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Restacking branch: ${branchName}`,
			cancellable: false,
		}, async (progress) => {
			// Execute branch restack
			const result = await execBranchRestack(this.workspaceFolder!, branchName);

			if ('error' in result) {
				void vscode.window.showErrorMessage(`Failed to restack branch: ${result.error}`);
			} else {
				void vscode.window.showInformationMessage(`Branch ${branchName} restacked successfully.`);
			}

			// Refresh state to reflect the new order
			await this.refresh();
		});
	}

	/**
	 * Handles cancellation of a branch reorder operation.
	 * Clears the pending state and refreshes the view to restore the original order.
	 * 
	 * @param branchName - The name of the branch that was being reordered
	 */
	private async handleCancelReorder(branchName: string): Promise<void> {
		if (!this.pendingReorder || this.pendingReorder.branchName !== branchName) {
			return;
		}

		// Clear pending reorder state and refresh to restore original order
		this.pendingReorder = null;
		await this.refresh();
	}

	private setupFileWatcher(): void {
		// Dispose existing watcher if any
		this.fileWatcher?.dispose();
		this.fileWatcher = undefined;

		if (!this.workspaceFolder || !this.view) {
			return;
		}

		// Watch for git-spice metadata changes and Git HEAD changes
		// git-spice stores its data in .git/refs/spice/data
		// HEAD changes indicate branch switches
		const gitDir = vscode.Uri.joinPath(this.workspaceFolder.uri, '.git');
		const pattern = new vscode.RelativePattern(gitDir, '{refs/spice/data,HEAD,refs/heads/**}');

		this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const refreshHandler = () => {
			void this.refresh();
		};

		this.fileWatcher.onDidChange(refreshHandler);
		this.fileWatcher.onDidCreate(refreshHandler);
		this.fileWatcher.onDidDelete(refreshHandler);
	}

	dispose(): void {
		this.fileWatcher?.dispose();
	}

	private async renderHtml(webview: vscode.Webview): Promise<string> {
		const nonce = getNonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} https:`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`font-src ${webview.cspSource}`,
		].join('; ');

		const mediaUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString();
		const distUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', name)).toString();
		const codiconStyleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
		).toString();
		const template = await readMediaFile(this.extensionUri, 'stackView.html');

		return template
			.replace('{{csp}}', csp)
			.replace('{{codiconStyleUri}}', codiconStyleUri)
			.replace('{{styleUri}}', mediaUri('stackView.css'))
			.replace('{{scriptUri}}', distUri('stackView.js'))
			.replace('{{nonce}}', nonce);
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i += 1) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
