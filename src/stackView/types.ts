import type { GitSpiceBranch, GitSpiceChangeStatus } from '../gitSpiceSchema';
import type { BranchReorderInfo as GitSpiceBranchReorderInfo } from '../utils/gitSpice';

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

export type BranchReorderInfo = GitSpiceBranchReorderInfo;

export type DisplayState = {
	branches: BranchViewModel[];
	error?: string;
	pendingReorder?: BranchReorderInfo;
};
