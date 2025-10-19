import * as vscode from 'vscode';

import { buildDisplayState } from './state';
import type { BranchRecord } from './types';
import { execGitSpice } from '../utils/gitSpice';
import { readMediaFile } from '../utils/readFileSync';

export class StackViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	private branches: BranchRecord[] = [];
	private lastError: string | undefined;

	constructor(private workspaceFolder: vscode.WorkspaceFolder | undefined, private readonly extensionUri: vscode.Uri) {}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media'),
				vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
			],
		};
		webviewView.webview.html = await this.renderHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((message) => {
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
						void vscode.window.showInformationMessage(
							`Drag-and-drop planned: move ${message.source} onto ${message.target}`,
						);
					}
					return;
				default:
					return;
			}
		});
	}

	setWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): void {
		this.workspaceFolder = folder;
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
		if (!this.view) {
			return;
		}

		const state = buildDisplayState(this.branches, this.lastError);
		void this.view.webview.postMessage({ type: 'state', payload: state });
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
		const codiconStyleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
		).toString();
		const template = await readMediaFile(this.extensionUri, 'stackView.html');

		return template
			.replace('{{csp}}', csp)
			.replace('{{codiconStyleUri}}', codiconStyleUri)
			.replace('{{styleUri}}', mediaUri('stackView.css'))
			.replace('{{scriptUri}}', mediaUri('stackView.js'))
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
