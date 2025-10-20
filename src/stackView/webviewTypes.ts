import type { DisplayState } from './types';

// Messages from webview to extension
export type WebviewMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'openChange'; url: string }
	| { type: 'openCommit'; sha: string }
	| { type: 'branchDrop'; source: string; target: string }
	| { type: 'branchReorder'; oldIndex: number; newIndex: number; branchName: string };

// Messages from extension to webview
export type ExtensionMessage =
	| { type: 'state'; payload: DisplayState };

// VSCode webview API type declaration
declare global {
	const acquireVsCodeApi: () => {
		postMessage(message: WebviewMessage): void;
		setState(state: any): void;
		getState(): any;
	};
}
