import * as vscode from 'vscode';

export async function readMediaFile(extensionUri: vscode.Uri, fileName: string): Promise<string> {
	const fileUri = vscode.Uri.joinPath(extensionUri, 'media', fileName);
	const buffer = await vscode.workspace.fs.readFile(fileUri);
	return Buffer.from(buffer).toString('utf8');
}

export async function readDistFile(extensionUri: vscode.Uri, fileName: string): Promise<string> {
	const fileUri = vscode.Uri.joinPath(extensionUri, 'dist', fileName);
	const buffer = await vscode.workspace.fs.readFile(fileUri);
	return Buffer.from(buffer).toString('utf8');
}
