import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { parseGitSpiceBranches, type GitSpiceBranch } from '../gitSpiceSchema';

const execFileAsync = promisify(execFile);

export type BranchLoadResult = { value: GitSpiceBranch[] } | { error: string };
export type StackEditResult = { value: void } | { error: string };
export type BranchRestackResult = { value: void } | { error: string };

export async function execGitSpice(folder: vscode.WorkspaceFolder): Promise<BranchLoadResult> {
	try {
		const { stdout } = await execFileAsync('gs', ['ll', '-a', '--json'], {
			cwd: folder.uri.fsPath,
		});
		return { value: parseGitSpiceBranches(stdout) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to load git-spice branches: ${message}` };
	}
}

export async function execStackEdit(folder: vscode.WorkspaceFolder, branchNames: string[]): Promise<StackEditResult> {
	const tempDir = os.tmpdir();
	const tempFilePath = path.join(tempDir, `git-spice-stack-edit-${Date.now()}.txt`);

	try {
		// Write the branch names to a temporary file
		await fs.promises.writeFile(tempFilePath, branchNames.join('\n'));

		// Execute gs stack edit with the temporary file as editor input
		// We use 'cat' as a no-op editor that just reads the file content
		const { stdout, stderr } = await execFileAsync('gs', ['stack', 'edit', '--editor', `cat ${tempFilePath}`], {
			cwd: folder.uri.fsPath,
		});

		if (stderr) {
			return { error: stderr };
		}
		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs stack edit: ${message}` };
	} finally {
		// Clean up the temporary file
		await fs.promises.unlink(tempFilePath).catch(err => console.error(`Failed to delete temp file: ${err}`));
	}
}

export async function execBranchRestack(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchRestackResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'restack'], {
			cwd: folder.uri.fsPath,
		});

		if (stderr) {
			return { error: stderr };
		}
		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch restack: ${message}` };
	}
}
