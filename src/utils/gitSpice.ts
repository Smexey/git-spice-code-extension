import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

import { parseGitSpiceBranches, type GitSpiceBranch } from '../gitSpiceSchema';

const execFileAsync = promisify(execFile);

export type BranchLoadResult = { value: GitSpiceBranch[] } | { error: string };

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
