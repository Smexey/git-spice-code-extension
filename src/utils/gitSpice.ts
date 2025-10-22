import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { parseGitSpiceBranches, type GitSpiceBranch } from '../gitSpiceSchema';

const execFileAsync = promisify(execFile);
const GIT_SPICE_BINARY = 'gs';
const DEFAULT_TIMEOUT_MS = 30_000;
const BRANCH_CREATE_TIMEOUT_MS = 10_000;

type NormalizedString = { value: string } | { error: string };
type GitSpiceArgs = ReadonlyArray<string>;

export type BranchLoadResult = { value: GitSpiceBranch[] } | { error: string };
export type StackEditResult = { value: void } | { error: string };
export type BranchCommandResult = { value: void } | { error: string };
export type BranchReorderInfo = Readonly<{ oldIndex: number; newIndex: number; branchName: string }>;
export type RepoSyncResult = { value: { deletedBranches: string[]; syncedBranches: number } } | { error: string };

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getWorkspaceFolderPath(folder: vscode.WorkspaceFolder): string | null {
	const fsPath = folder.uri.fsPath;
	return typeof fsPath === 'string' && fsPath.length > 0 ? fsPath : null;
}

function normalizeNonEmpty(value: string, field: string): NormalizedString {
	if (typeof value !== 'string') {
		return { error: `${field} must be a string` };
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return { error: `${field} cannot be empty` };
	}
	return { value: trimmed };
}

async function runGitSpiceCommand(
	folder: vscode.WorkspaceFolder,
	args: GitSpiceArgs,
	context: string,
	timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<BranchCommandResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: `${context}: Workspace folder path is unavailable.` };
	}
	try {
		await execFileAsync(GIT_SPICE_BINARY, args, { cwd, timeout });
		return { value: undefined };
	} catch (error) {
		return { error: `${context}: ${toErrorMessage(error)}` };
	}
}

export async function execGitSpice(folder: vscode.WorkspaceFolder): Promise<BranchLoadResult> {
	try {
		const cwd = getWorkspaceFolderPath(folder);
		if (!cwd) {
			return { error: 'Failed to load git-spice branches: Workspace folder path is unavailable.' };
		}
		const { stdout } = await execFileAsync(GIT_SPICE_BINARY, ['ll', '-a', '--json'], {
			cwd,
		});
		return { value: parseGitSpiceBranches(stdout) };
	} catch (error) {
		return { error: `Failed to load git-spice branches: ${toErrorMessage(error)}` };
	}
}

/**
 * Executes the `gs stack edit` command to reorder branches in the current stack.
 * 
 * This function creates a temporary Node.js script that acts as an editor for `gs stack edit`.
 * The script reads the original branch list provided by git-spice, applies the reorder operation,
 * and writes the new order back to the file.
 * 
 * @param folder - The workspace folder where the command should be executed
 * @param reorderInfo - The reorder operation details from SortableJS
 * @returns A promise that resolves with a success or error result
 */

export async function execStackEdit(
	folder: vscode.WorkspaceFolder,
	reorderInfo: BranchReorderInfo,
): Promise<StackEditResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: 'Invalid workspace folder provided' };
	}
	const branchValidation = normalizeNonEmpty(reorderInfo.branchName, 'Branch name');
	if ('error' in branchValidation) {
		return { error: branchValidation.error };
	}
	if (!Number.isInteger(reorderInfo.oldIndex) || !Number.isInteger(reorderInfo.newIndex)) {
		return { error: 'Invalid reorder indices: oldIndex and newIndex must be integers' };
	}
	if (reorderInfo.oldIndex < 0 || reorderInfo.newIndex < 0) {
		return { error: 'Invalid reorder indices: indices must be non-negative' };
	}
	const normalizedInfo: BranchReorderInfo = {
		oldIndex: reorderInfo.oldIndex,
		newIndex: reorderInfo.newIndex,
		branchName: branchValidation.value,
	};

	console.log('🔄 execStackEdit called with reorder info:', normalizedInfo);
	
	const tempDir = os.tmpdir();
	let scriptPath: string | null = null;

	try {
		// Validate temp directory exists and is writable
		const tempDirStats = await fs.promises.stat(tempDir);
		if (!tempDirStats.isDirectory()) {
			throw new Error(`Temp directory is not a directory: ${tempDir}`);
		}

		// Create a robust Node.js script that acts as an editor
		const editorScript = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Validate command line arguments
if (process.argv.length < 3) {
	console.error('❌ Editor script requires file path argument');
	process.exit(1);
}

const filePath = process.argv[2];
console.log('🔄 Editor received file:', filePath);

// Validate file path
if (!filePath || typeof filePath !== 'string') {
	console.error('❌ Invalid file path provided');
	process.exit(1);
}

try {
	// Read current content with error handling
	const currentContent = fs.readFileSync(filePath, 'utf8');
	console.log('🔄 Editor received content:');
	console.log(currentContent);

	// Parse the original content with validation
	const originalLines = currentContent.trim().split('\\n').filter(line => line.trim());
	console.log('🔄 Original lines from git-spice:', originalLines);
	console.log('🔄 Original line count:', originalLines.length);

	// Validate we have branches to work with
	if (originalLines.length === 0) {
		console.error('❌ No branches found in git-spice output');
		process.exit(1);
	}

	// Validate reorder indices are within bounds
	const oldIndex = ${normalizedInfo.oldIndex};
	const newIndex = ${normalizedInfo.newIndex};
	const branchName = ${JSON.stringify(normalizedInfo.branchName)};

	console.log('🔄 Reorder operation:', { oldIndex, newIndex, branchName });

	if (oldIndex < 0 || oldIndex >= originalLines.length) {
		console.error('❌ Invalid oldIndex:', oldIndex, 'for array length:', originalLines.length);
		process.exit(1);
	}

	if (newIndex < 0 || newIndex >= originalLines.length) {
		console.error('❌ Invalid newIndex:', newIndex, 'for array length:', originalLines.length);
		process.exit(1);
	}

	// Validate the branch name exists at the expected position
	const expectedBranch = originalLines[oldIndex];
	if (expectedBranch !== branchName) {
		console.error('❌ Branch name mismatch. Expected:', branchName, 'but found:', expectedBranch);
		process.exit(1);
	}

	// Apply the reorder to the original git-spice list
	const reorderedLines = [...originalLines];
	const movedBranch = reorderedLines.splice(oldIndex, 1)[0];
	reorderedLines.splice(newIndex, 0, movedBranch);

	console.log('🔄 Reordered lines:', reorderedLines);
	console.log('🔄 Moved branch:', movedBranch);

	// Validate the reorder was successful
	if (reorderedLines.length !== originalLines.length) {
		console.error('❌ Reorder failed: line count mismatch');
		process.exit(1);
	}

	if (reorderedLines[newIndex] !== branchName) {
		console.error('❌ Reorder failed: branch not at expected position');
		process.exit(1);
	}

	// Write new content
	const newContent = reorderedLines.join('\\n');
	console.log('🔄 Editor will write:');
	console.log(newContent);

	fs.writeFileSync(filePath, newContent);
	console.log('🔄 Editor wrote new content to file');

} catch (error) {
	console.error('❌ Editor script error:', error.message);
	process.exit(1);
}
`;
		
		scriptPath = path.join(tempDir, `git-spice-editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.js`);
		
		// Write script with proper error handling
		await fs.promises.writeFile(scriptPath, editorScript, { mode: 0o755 });
		
		// Verify script was written correctly
		const scriptStats = await fs.promises.stat(scriptPath);
		if (!scriptStats.isFile()) {
			throw new Error(`Failed to create editor script: ${scriptPath}`);
		}
		
		console.log('🔄 Executing: gs stack edit --editor', scriptPath);
		const { stdout, stderr } = await execFileAsync(GIT_SPICE_BINARY, ['stack', 'edit', '--editor', scriptPath], {
			cwd,
			timeout: DEFAULT_TIMEOUT_MS,
		});

		console.log('🔄 gs stack edit stdout:', stdout);
		console.log('🔄 gs stack edit stderr:', stderr);

		// Check for git-spice errors
		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = toErrorMessage(error);
		console.error('🔄 execStackEdit error:', message);
		return { error: `Failed to execute gs stack edit: ${message}` };
	} finally {
		// Clean up the editor script with error handling
		if (scriptPath) {
			try {
				await fs.promises.unlink(scriptPath);
			} catch (cleanupError) {
				console.error(`Failed to delete editor script: ${cleanupError}`);
			}
		}
	}
}

/**
 * Executes git-spice branch commands - each command implemented individually
 */

export async function execBranchUntrack(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch untrack: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'untrack', normalized.value], 'Branch untrack');
}

export async function execBranchCheckout(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch checkout: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'checkout', normalized.value], 'Branch checkout');
}

export async function execBranchFold(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch fold: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'fold', '--branch', normalized.value], 'Branch fold');
}

export async function execBranchSquash(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch squash: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'squash', '--branch', normalized.value, '--no-edit'], 'Branch squash');
}

export async function execBranchEdit(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch edit: ${normalized.error}` };
	}
	const result = await runGitSpiceCommand(folder, ['branch', 'edit'], 'Branch edit');
	if ('error' in result) {
		return result;
	}
	return { value: undefined };
}

export async function execBranchRename(folder: vscode.WorkspaceFolder, branchName: string, newName: string): Promise<BranchCommandResult> {
	const normalizedBranch = normalizeNonEmpty(branchName, 'Current branch name');
	if ('error' in normalizedBranch) {
		return { error: `Branch rename: ${normalizedBranch.error}` };
	}
	const normalizedNewName = normalizeNonEmpty(newName, 'New branch name');
	if ('error' in normalizedNewName) {
		return { error: `Branch rename: ${normalizedNewName.error}` };
	}
	return runGitSpiceCommand(
		folder,
		['branch', 'rename', normalizedBranch.value, normalizedNewName.value],
		'Branch rename',
	);
}

export async function execBranchRestack(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch restack: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'restack', '--branch', normalized.value], 'Branch restack');
}

export async function execBranchSubmit(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch submit: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'submit', '--branch', normalized.value], 'Branch submit');
}

export async function execBranchCreate(folder: vscode.WorkspaceFolder, message: string): Promise<BranchCommandResult> {
	const normalizedMessage = normalizeNonEmpty(message, 'Commit message');
	if ('error' in normalizedMessage) {
		return { error: `Branch create: ${normalizedMessage.error}` };
	}
	return runGitSpiceCommand(
		folder,
		['branch', 'create', '-m', normalizedMessage.value, '-a', '--no-prompt', '--no-verify'],
		'Branch create',
		BRANCH_CREATE_TIMEOUT_MS,
	);
}

export async function execCommitFixup(folder: vscode.WorkspaceFolder, sha: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(sha, 'Commit SHA');
	if ('error' in normalized) {
		return { error: `Commit fixup: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['commit', 'fixup', normalized.value], 'Commit fixup');
}

export async function execBranchSplit(folder: vscode.WorkspaceFolder, branchName: string, sha: string, newBranchName: string): Promise<BranchCommandResult> {
	const normalizedBranch = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalizedBranch) {
		return { error: `Branch split: ${normalizedBranch.error}` };
	}
	const normalizedSha = normalizeNonEmpty(sha, 'Commit SHA');
	if ('error' in normalizedSha) {
		return { error: `Branch split: ${normalizedSha.error}` };
	}
	const normalizedNewBranch = normalizeNonEmpty(newBranchName, 'New branch name');
	if ('error' in normalizedNewBranch) {
		return { error: `Branch split: ${normalizedNewBranch.error}` };
	}
	// Format: --at COMMIT:NAME as required by git-spice
	// Use COMMIT^ to split before the selected commit, so the commit is included in the new branch
	const atValue = `${normalizedSha.value}^:${normalizedNewBranch.value}`;
	return runGitSpiceCommand(
		folder,
		['branch', 'split', '--branch', normalizedBranch.value, '--at', atValue],
		'Branch split',
	);
}

/**
 * Navigation commands - simple wrappers around git-spice navigation
 */

export async function execUp(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['up'], 'Navigate up');
}

export async function execDown(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['down'], 'Navigate down');
}

export async function execTrunk(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['trunk'], 'Navigate to trunk');
}

export async function execStackRestack(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['stack', 'restack'], 'Stack restack');
}

export async function execStackSubmit(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['stack', 'submit', '--fill', '--no-draft'], 'Stack submit');
}

/**
 * Executes `gs repo sync` with interactive prompts for branch deletion.
 * When git-spice prompts to delete branches (due to closed PRs), shows VSCode prompts
 * to the user and handles their responses.
 *
 * @param folder - The workspace folder where the command should be executed
 * @param promptCallback - Async callback to prompt the user for confirmation
 * @returns A promise that resolves with sync results or an error
 */
export async function execRepoSync(
	folder: vscode.WorkspaceFolder,
	promptCallback: (branchName: string) => Promise<boolean>,
): Promise<RepoSyncResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: 'Invalid workspace folder provided' };
	}

	return new Promise<RepoSyncResult>((resolve) => {
		const deletedBranches: string[] = [];
		let outputBuffer = '';
		let errorBuffer = '';

		// Spawn the process with stdio access
		const process = spawn(GIT_SPICE_BINARY, ['repo', 'sync'], {
			cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let isResolved = false;
		const resolveOnce = (result: RepoSyncResult): void => {
			if (!isResolved) {
				isResolved = true;
				resolve(result);
			}
		};

		// Set timeout
		const timeout = setTimeout(() => {
			process.kill();
			resolveOnce({ error: 'Repository sync timed out after 30 seconds' });
		}, DEFAULT_TIMEOUT_MS);

		// Handle stdout data
		process.stdout.on('data', (data: Buffer) => {
			const text = data.toString();
			outputBuffer += text;

			// Look for branch deletion prompts in the output
			// git-spice typically outputs: "Delete branch 'branch-name'? [y/N]"
			const promptMatch = text.match(/Delete branch '([^']+)'\? \[y\/N\]/i);
			if (promptMatch) {
				const branchName = promptMatch[1];
				
				// Asynchronously prompt the user and send response
				void (async () => {
					try {
						const shouldDelete = await promptCallback(branchName);
						const response = shouldDelete ? 'y\n' : 'n\n';
						process.stdin.write(response);
						
						if (shouldDelete) {
							deletedBranches.push(branchName);
						}
					} catch (error) {
						// If user cancels or there's an error, default to 'n'
						process.stdin.write('n\n');
					}
				})();
			}
		});

		// Handle stderr data
		process.stderr.on('data', (data: Buffer) => {
			errorBuffer += data.toString();
		});

		// Handle process exit
		process.on('close', (code) => {
			clearTimeout(timeout);
			
			if (code === 0) {
				// Success - parse output to count synced branches
				const syncedBranchesMatch = outputBuffer.match(/(\d+) branch(?:es)? synced/i);
				const syncedBranches = syncedBranchesMatch ? Number.parseInt(syncedBranchesMatch[1], 10) : 0;
				
				resolveOnce({
					value: {
						deletedBranches,
						syncedBranches,
					},
				});
			} else {
				const errorMessage = errorBuffer.trim() || outputBuffer.trim() || `Process exited with code ${code}`;
				resolveOnce({ error: `Repository sync failed: ${errorMessage}` });
			}
		});

		// Handle process errors
		process.on('error', (error) => {
			clearTimeout(timeout);
			resolveOnce({ error: `Failed to execute gs repo sync: ${toErrorMessage(error)}` });
		});
	});
}
