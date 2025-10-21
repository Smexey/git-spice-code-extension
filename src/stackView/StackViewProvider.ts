import * as vscode from 'vscode';

import { buildDisplayState } from './state';
import type { BranchRecord, BranchReorderInfo } from './types';
import type { WebviewMessage } from './webviewTypes';
import {
	execGitSpice,
	execStackEdit,
	execBranchUntrack,
	execBranchCheckout,
	execBranchFold,
	execBranchSquash,
	execBranchEdit,
	execBranchRename,
	execBranchRestack,
	execBranchSubmit,
	type BranchCommandResult,
} from '../utils/gitSpice';
import { readMediaFile, readDistFile } from '../utils/readFileSync';

export class StackViewProvider implements vscode.WebviewViewProvider {
	private view!: vscode.WebviewView; // definite assignment assertion - set in resolveWebviewView
	private branches: BranchRecord[] = [];
	private lastError: string | undefined;
	private fileWatcher: vscode.FileSystemWatcher | undefined;
	private pendingReorder: BranchReorderInfo | null = null;

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
				case 'branchUntrack':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('untrack', message.branchName, execBranchUntrack);
					}
					return;
				case 'branchCheckout':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('checkout', message.branchName, execBranchCheckout);
					}
					return;
				case 'branchFold':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('fold', message.branchName, execBranchFold);
					}
					return;
				case 'branchSquash':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('squash', message.branchName, execBranchSquash);
					}
					return;
				case 'branchEdit':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('edit', message.branchName, execBranchEdit);
					}
					return;
				case 'branchRenamePrompt':
					if (typeof message.branchName === 'string') {
						void this.handleBranchRenamePrompt(message.branchName);
					}
					return;
				case 'branchRename':
					if (typeof message.branchName === 'string' && typeof message.newName === 'string') {
						void this.handleBranchRename(message.branchName, message.newName);
					}
					return;
				case 'branchRestack':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('restack', message.branchName, execBranchRestack);
					}
					return;
				case 'branchSubmit':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('submit', message.branchName, execBranchSubmit);
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
		// Validate input parameters
		if (typeof oldIndex !== 'number' || typeof newIndex !== 'number') {
			console.error('❌ Invalid reorder indices:', { oldIndex, newIndex });
			return;
		}

		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name:', branchName);
			return;
		}

		if (oldIndex < 0 || newIndex < 0) {
			console.error('❌ Negative reorder indices:', { oldIndex, newIndex });
			return;
		}

		// Check if this is actually a reorder (not just a drop in the same position)
		if (oldIndex === newIndex) {
			console.log('🔄 Branch dropped in same position, ignoring:', branchName);
			return;
		}

		const normalizedBranch = branchName.trim();
		const reorder: BranchReorderInfo = { branchName: normalizedBranch, oldIndex, newIndex };
		console.log('🔄 Setting pending reorder:', reorder);
		
		// Set pending reorder state
		this.pendingReorder = reorder;
		this.pushState();
	}

	/**
	 * Handles confirmation of a branch reorder operation.
	 * Executes the git-spice stack edit command and refreshes the view.
	 *
	 * @param branchName - The name of the branch to reorder
	 */
	private async handleConfirmReorder(branchName: string): Promise<void> {
		// Validate input
		const trimmed = typeof branchName === 'string' ? branchName.trim() : '';
		if (trimmed.length === 0) {
			console.error('❌ Invalid branch name provided to handleConfirmReorder:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided.');
			return;
		}

		// Validate pending reorder state
		if (!this.pendingReorder) {
			console.warn('⚠️ No pending reorder found when confirming reorder for:', trimmed);
			void vscode.window.showWarningMessage('No pending reorder operation found.');
			return;
		}

		const expectedBranch = this.pendingReorder.branchName;
		if (expectedBranch !== trimmed) {
			console.error('❌ Branch name mismatch in pending reorder. Expected:', trimmed, 'but found:', this.pendingReorder.branchName);
			void vscode.window.showErrorMessage('Branch name mismatch in pending reorder operation.');
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for branch reorder');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		const { oldIndex, newIndex, branchName: pendingBranch } = this.pendingReorder;
		
		// Validate reorder indices
		if (typeof oldIndex !== 'number' || typeof newIndex !== 'number') {
			console.error('❌ Invalid reorder indices:', { oldIndex, newIndex });
			void vscode.window.showErrorMessage('Invalid reorder indices.');
			return;
		}

		if (oldIndex < 0 || newIndex < 0) {
			console.error('❌ Negative reorder indices:', { oldIndex, newIndex });
			void vscode.window.showErrorMessage('Invalid reorder indices: indices must be non-negative.');
			return;
		}

		// Clear pending state before operation to prevent double-execution
		this.pendingReorder = null;

		console.log('🔄 Executing branch reorder for:', pendingBranch);
		console.log('🔄 Reorder details:', { oldIndex, newIndex, branchName: pendingBranch });

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Reordering branch: ${pendingBranch}`,
			cancellable: false,
		}, async (progress) => {
			try {
				// Execute branch reorder using gs stack edit
				const result = await execStackEdit(this.workspaceFolder!, { oldIndex, newIndex, branchName: pendingBranch });

				if ('error' in result) {
					console.error('🔄 Branch reorder failed:', result.error);
					void vscode.window.showErrorMessage(`Failed to reorder branch: ${result.error}`);
					
					// Restore pending state on failure so user can retry
					this.pendingReorder = { branchName: pendingBranch, oldIndex, newIndex };
					this.pushState();
				} else {
					console.log('🔄 Branch reorder successful');
					void vscode.window.showInformationMessage(`Branch ${pendingBranch} reordered successfully.`);
				}

				// Always refresh state to reflect current git-spice state
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('🔄 Unexpected error during branch reorder:', message);
				void vscode.window.showErrorMessage(`Unexpected error during branch reorder: ${message}`);
				
				// Restore pending state on unexpected error
				this.pendingReorder = { branchName: pendingBranch, oldIndex, newIndex };
				this.pushState();
			}
		});
	}

	/**
	 * Handles cancellation of a branch reorder operation.
	 * Clears the pending state and refreshes the view to restore the original order.
	 *
	 * @param branchName - The name of the branch that was being reordered
	 */
	private async handleCancelReorder(branchName: string): Promise<void> {
		// Validate input
		const trimmed = typeof branchName === 'string' ? branchName.trim() : '';
		if (trimmed.length === 0) {
			console.error('❌ Invalid branch name provided to handleCancelReorder:', branchName);
			return;
		}

		// Validate pending reorder state
		if (!this.pendingReorder) {
			console.warn('⚠️ No pending reorder found when canceling reorder for:', trimmed);
			return;
		}

		if (this.pendingReorder.branchName !== trimmed) {
			console.error('❌ Branch name mismatch in pending reorder. Expected:', trimmed, 'but found:', this.pendingReorder.branchName);
			return;
		}

		console.log('🔄 Canceling reorder for:', trimmed);
		
		// Clear pending reorder state and refresh to restore original order
		this.pendingReorder = null;
		await this.refresh();
	}

	/**
	 * Generic handler for branch commands from the context menu
	 */
	/**
	 * Public method to handle branch commands from VSCode commands
	 */
	public async handleBranchCommand(commandName: string, branchName: string): Promise<void> {
		// Map command names to their exec functions
		const commandMap: Record<string, (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>> = {
			untrack: execBranchUntrack,
			checkout: execBranchCheckout,
			fold: execBranchFold,
			squash: execBranchSquash,
			edit: execBranchEdit,
			restack: execBranchRestack,
			submit: execBranchSubmit,
		};

		const execFunction = commandMap[commandName];
		if (!execFunction) {
			console.error(`❌ Unknown command: ${commandName}`);
			void vscode.window.showErrorMessage(`Unknown command: ${commandName}`);
			return;
		}

		await this.handleBranchCommandInternal(commandName, branchName, execFunction);
	}

	/**
	 * Internal method to handle branch commands with exec function
	 */
	private async handleBranchCommandInternal(
		commandName: string,
		branchName: string,
		execFunction: (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>,
	): Promise<void> {
		// Validate input
		const trimmedName = typeof branchName === 'string' ? branchName.trim() : '';
		if (trimmedName.length === 0) {
			console.error(`❌ Invalid branch name provided to handleBranchCommand (${commandName}):`, branchName);
			void vscode.window.showErrorMessage(`Invalid branch name provided for ${commandName}.`);
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error(`❌ No workspace folder available for branch ${commandName}`);
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log(`🔄 Executing branch ${commandName} for:`, trimmedName);

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `${commandName.charAt(0).toUpperCase() + commandName.slice(1)}ing branch: ${trimmedName}`,
			cancellable: false,
		}, async (progress) => {
			try {
				// Execute the branch command
				const result = await execFunction(this.workspaceFolder!, trimmedName);

				if ('error' in result) {
					console.error(`🔄 Branch ${commandName} failed:`, result.error);
					void vscode.window.showErrorMessage(`Failed to ${commandName} branch: ${result.error}`);
				} else {
					console.log(`🔄 Branch ${commandName} successful`);
					void vscode.window.showInformationMessage(`Branch ${trimmedName} ${commandName}ed successfully.`);
				}

				// Always refresh state to reflect current git-spice state
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`🔄 Unexpected error during branch ${commandName}:`, message);
				void vscode.window.showErrorMessage(`Unexpected error during branch ${commandName}: ${message}`);
			}
		});
	}

	/**
	 * Public method to handle branch rename prompt from VSCode commands
	 */
	public async handleBranchRenamePrompt(branchName: string): Promise<void> {
		// Validate input
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleBranchRenamePrompt:', branchName);
			return;
		}

		try {
			const newName = await vscode.window.showInputBox({
				prompt: `Enter new name for branch '${branchName}':`,
				value: branchName,
				validateInput: (input) => {
					if (!input || !input.trim()) {
						return 'Branch name cannot be empty.';
					}
					if (input.trim() === branchName) {
						return 'New name must be different from current name.';
					}
					return null;
				}
			});

			if (newName && newName.trim() && newName !== branchName) {
				// Send the rename command with the new name back to webview
				this.view.webview.postMessage({
					type: 'branchRename',
					branchName: branchName,
					newName: newName.trim()
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error showing rename prompt:', message);
			void vscode.window.showErrorMessage(`Error showing rename prompt: ${message}`);
		}
	}

	/**
	 * Handles branch rename command with new name parameter
	 */
	private async handleBranchRename(branchName: string, newName: string): Promise<void> {
		// Validate input
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleBranchRename:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided for rename.');
			return;
		}

		if (typeof newName !== 'string' || newName.trim() === '') {
			console.error('❌ Invalid new name provided to handleBranchRename:', newName);
			void vscode.window.showErrorMessage('Invalid new name provided for rename.');
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for branch rename');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log('🔄 Executing branch rename for:', branchName, 'to:', newName);

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Renaming branch: ${branchName} → ${newName}`,
			cancellable: false,
		}, async (progress) => {
			try {
				// Execute the branch rename command
				const result = await execBranchRename(this.workspaceFolder!, branchName, newName);

				if ('error' in result) {
					console.error('🔄 Branch rename failed:', result.error);
					void vscode.window.showErrorMessage(`Failed to rename branch: ${result.error}`);
				} else {
					console.log('🔄 Branch rename successful');
					void vscode.window.showInformationMessage(`Branch renamed from ${branchName} to ${newName} successfully.`);
				}

				// Always refresh state to reflect current git-spice state
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('🔄 Unexpected error during branch rename:', message);
				void vscode.window.showErrorMessage(`Unexpected error during branch rename: ${message}`);
			}
		});
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
