import type { GitSpiceBranch, GitSpiceChangeStatus } from '../gitSpiceSchema';

export type BranchRecord = GitSpiceBranch;

export type BranchCommitViewModel = {
	sha: string;
	shortSha: string;
	subject: string;
};

export type BranchChangeViewModel = {
	id: string;
	url?: string;
	status?: GitSpiceChangeStatus;
};

export type BranchViewModel = {
	name: string;
	current: boolean;
	restack: boolean;
	change?: BranchChangeViewModel;
	commits?: BranchCommitViewModel[];
};

export type DisplayState = {
	branches: BranchViewModel[];
	error?: string;
};
