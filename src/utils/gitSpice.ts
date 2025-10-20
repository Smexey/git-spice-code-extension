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
export type BranchCommandResult = { value: void } | { error: string };

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
	reorderInfo: { oldIndex: number; newIndex: number; branchName: string }
): Promise<StackEditResult> {
	// Input validation
	if (!folder || !folder.uri || !folder.uri.fsPath) {
		return { error: 'Invalid workspace folder provided' };
	}

	if (typeof reorderInfo.oldIndex !== 'number' || typeof reorderInfo.newIndex !== 'number') {
		return { error: 'Invalid reorder indices: oldIndex and newIndex must be numbers' };
	}

	if (typeof reorderInfo.branchName !== 'string' || reorderInfo.branchName.trim() === '') {
		return { error: 'Invalid branch name: must be a non-empty string' };
	}

	if (reorderInfo.oldIndex < 0 || reorderInfo.newIndex < 0) {
		return { error: 'Invalid reorder indices: indices must be non-negative' };
	}

	console.log('🔄 execStackEdit called with reorder info:', reorderInfo);
	
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
	const oldIndex = ${reorderInfo.oldIndex};
	const newIndex = ${reorderInfo.newIndex};
	const branchName = '${reorderInfo.branchName}';

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
		const { stdout, stderr } = await execFileAsync('gs', ['stack', 'edit', '--editor', scriptPath], {
			cwd: folder.uri.fsPath,
			timeout: 30000, // 30 second timeout
		});

		console.log('🔄 gs stack edit stdout:', stdout);
		console.log('🔄 gs stack edit stderr:', stderr);

		// Check for git-spice errors
		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
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
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'untrack', branchName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch untrack: ${message}` };
	}
}

export async function execBranchCheckout(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'checkout', branchName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch checkout: ${message}` };
	}
}

export async function execBranchFold(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'fold', '--branch', branchName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch fold: ${message}` };
	}
}

export async function execBranchSquash(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'squash', branchName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch squash: ${message}` };
	}
}

export async function execBranchEdit(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'edit'], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch edit: ${message}` };
	}
}

export async function execBranchRename(folder: vscode.WorkspaceFolder, branchName: string, newName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'rename', branchName, newName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch rename: ${message}` };
	}
}

export async function execBranchRestack(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'restack', branchName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch restack: ${message}` };
	}
}

export async function execBranchSubmit(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync('gs', ['branch', 'submit', '--branch', branchName], {
			cwd: folder.uri.fsPath,
			timeout: 30000,
		});

		if (stderr && stderr.trim()) {
			return { error: `git-spice error: ${stderr.trim()}` };
		}

		return { value: undefined };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Failed to execute gs branch submit: ${message}` };
	}
}
