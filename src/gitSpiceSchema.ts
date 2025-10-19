export type GitSpiceChangeStatus = 'open' | 'closed' | 'merged';

export type GitSpiceBranchLink = Readonly<{
	name: string;
	needsRestack?: boolean;
}>;

export type GitSpiceCommit = Readonly<{
	sha: string;
	subject: string;
}>;

export type GitSpiceChange = Readonly<{
	id: string;
	url: string;
	status?: GitSpiceChangeStatus;
}>;

export type GitSpicePush = Readonly<{
	ahead: number;
	behind: number;
	needsPush?: boolean;
}>;

export type GitSpiceBranch = Readonly<{
	name: string;
	current?: boolean;
	down?: GitSpiceBranchLink;
	ups?: ReadonlyArray<GitSpiceBranchLink>;
	commits?: ReadonlyArray<GitSpiceCommit>;
	change?: GitSpiceChange;
	push?: GitSpicePush;
}>;

export function parseGitSpiceBranches(raw: string): GitSpiceBranch[] {
	const branches: GitSpiceBranch[] = [];

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}

		const parsed = safeParse(trimmed);
		if (!parsed) {
			continue;
		}

		const branch = toBranch(parsed);
		if (branch) {
			branches.push(branch);
		}
	}

	return branches;
}

type UnknownRecord = Record<string, unknown>;

function safeParse(value: string): UnknownRecord | undefined {
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === 'object' && parsed !== null ? (parsed as UnknownRecord) : undefined;
	} catch (error) {
		console.error('Failed to parse git-spice json line', error);
		return undefined;
	}
}

function toBranch(input: UnknownRecord): GitSpiceBranch | undefined {
	const name = readString(input.name);
	if (!name) {
		return undefined;
	}

	return {
		name,
		current: readBoolean(input.current) === true ? true : undefined,
		down: readBranchLink(input.down),
		ups: readBranchLinks(input.ups),
		commits: readCommits(input.commits),
		change: readChange(input.change),
		push: readPush(input.push),
	};
}

function readBranchLink(value: unknown): GitSpiceBranchLink | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const name = readString(value.name);
	if (!name) {
		return undefined;
	}

	const needsRestack = readBoolean(value.needsRestack) === true ? true : undefined;
	return { name, needsRestack };
}

function readBranchLinks(value: unknown): ReadonlyArray<GitSpiceBranchLink> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const links = value
		.map((entry) => readBranchLink(entry))
		.filter((link): link is GitSpiceBranchLink => link !== undefined);

	return links.length > 0 ? links : undefined;
}

function readCommits(value: unknown): ReadonlyArray<GitSpiceCommit> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const commits = value
		.map((entry) => readCommit(entry))
		.filter((commit): commit is GitSpiceCommit => commit !== undefined);

	return commits.length > 0 ? commits : undefined;
}

function readCommit(value: unknown): GitSpiceCommit | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const sha = readString(value.sha);
	const subject = readString(value.subject);

	if (!sha || !subject) {
		return undefined;
	}

	return { sha, subject };
}

function readChange(value: unknown): GitSpiceChange | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const id = readString(value.id);
	const url = readString(value.url);
	if (!id || !url) {
		return undefined;
	}

	const status = readChangeStatus(value.status);
	return status ? { id, url, status } : { id, url };
}

function readChangeStatus(value: unknown): GitSpiceChangeStatus | undefined {
	if (value === 'open' || value === 'closed' || value === 'merged') {
		return value;
	}

	return undefined;
}

function readPush(value: unknown): GitSpicePush | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const ahead = readNumber(value.ahead);
	const behind = readNumber(value.behind);
	if (ahead === undefined || behind === undefined) {
		return undefined;
	}

	const needsPush = readBoolean(value.needsPush) === true ? true : undefined;
	return { ahead, behind, needsPush };
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
