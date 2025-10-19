import type { BranchChangeViewModel, BranchRecord, BranchViewModel, DisplayState } from './types';

export function buildDisplayState(branches: BranchRecord[], error?: string): DisplayState {
	const branchMap = new Map(branches.map((branch) => [branch.name, branch]));
	const current = branches.find((branch) => branch.current);
	const stackBranches = current
		? Array.from(computeFocusSet(current, branchMap))
			.map((name) => branchMap.get(name))
			.filter((branch): branch is BranchRecord => branch !== undefined)
		: [];

	const ordered = orderStack(stackBranches, branchMap);

	return {
		branches: ordered.map((branch) => createBranchViewModel(branch)),
		error,
	};
}

function computeFocusSet(current: BranchRecord, branchMap: Map<string, BranchRecord>): Set<string> {
	const set = new Set<string>();
	let node: BranchRecord | undefined = current;

	while (node) {
		if (set.has(node.name)) {
			break;
		}
		set.add(node.name);
		const downName = node.down?.name;
		if (!downName) {
			break;
		}
		node = branchMap.get(downName);
	}

	const queue: string[] = [current.name];
	while (queue.length > 0) {
		const name = queue.shift()!;
		const branch = branchMap.get(name);
		if (!branch) {
			continue;
		}

		for (const link of branch.ups ?? []) {
			const child = branchMap.get(link.name);
			if (!child) {
				continue;
			}
			if (!set.has(child.name)) {
				set.add(child.name);
				queue.push(child.name);
			}
		}
	}

	return set;
}

function orderStack(branches: BranchRecord[], branchMap: Map<string, BranchRecord>): BranchRecord[] {
	const ordered: BranchRecord[] = [];
	const visited = new Set<string>();

	const roots = branches
		.filter((branch) => !branch.down || !branchMap.has(branch.down.name))
		.sort((a, b) => a.name.localeCompare(b.name));

	const queue: BranchRecord[] = roots.length > 0 ? roots : branches;

	for (const branch of queue) {
		traverse(branch);
	}

	function traverse(branch: BranchRecord): void {
		if (visited.has(branch.name)) {
			return;
		}
		visited.add(branch.name);
		ordered.push(branch);

		const children = (branch.ups ?? [])
			.map((link) => branchMap.get(link.name))
			.filter((child): child is BranchRecord => child !== undefined && branches.includes(child))
			.sort((a, b) => a.name.localeCompare(b.name));

		for (const child of children) {
			traverse(child);
		}
	}

	return ordered;
}

function createBranchViewModel(branch: BranchRecord): BranchViewModel {
	const restack = branch.down?.needsRestack === true || (branch.ups ?? []).some((link) => link.needsRestack === true);

	const model: BranchViewModel = {
		name: branch.name,
		current: branch.current === true,
		restack,
	};

	if (branch.change) {
		model.change = toChangeViewModel(branch.change);
	}

	if (branch.commits && branch.commits.length > 0) {
		model.commits = branch.commits.map((commit) => ({
			sha: commit.sha,
			shortSha: commit.sha.slice(0, 8),
			subject: commit.subject,
		}));
	}

	return model;
}

function toChangeViewModel(change: NonNullable<BranchRecord['change']>): BranchChangeViewModel {
	return {
		id: change.id,
		url: change.url,
		status: change.status,
	};
}
