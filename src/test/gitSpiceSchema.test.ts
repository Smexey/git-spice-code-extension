import * as assert from 'assert';

import { parseGitSpiceBranches } from '../gitSpiceSchema';

suite('git-spice schema', () => {
	test('parses multiple branches', () => {
		const raw = [
			JSON.stringify({ name: 'main', current: true }),
			JSON.stringify({
				name: 'feature',
				down: { name: 'main', needsRestack: true },
				ups: [{ name: 'feature-docs' }],
				push: { ahead: 2, behind: 1, needsPush: true },
				change: { id: '#12', url: 'https://example.com/pull/12', status: 'open' },
				commits: [
					{ sha: 'abcd', subject: 'Add feature' },
				],
			}),
		].join('\n');

		const branches = parseGitSpiceBranches(raw);

		assert.strictEqual(branches.length, 2);
		assert.strictEqual(branches[0].name, 'main');
		assert.strictEqual(branches[0].current, true);
		assert.strictEqual(branches[1].down?.needsRestack, true);
		assert.strictEqual(branches[1].push?.ahead, 2);
		assert.strictEqual(branches[1].change?.status, 'open');
		assert.strictEqual(branches[1].commits?.[0]?.subject, 'Add feature');
	});

	test('ignores malformed lines', () => {
		const raw = ['{', JSON.stringify({ name: 'valid' })].join('\n');
		const branches = parseGitSpiceBranches(raw);
		assert.deepStrictEqual(branches.map((branch) => branch.name), ['valid']);
	});
});
