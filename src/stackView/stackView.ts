/**
 * Git-Spice Stack View
 * 
 * Architecture:
 * 
 * 1. STATE MANAGEMENT
 *    - Single source of truth: currentState
 *    - Immutable updates trigger diffing and rendering
 *    - State includes: error, branches (with commits, changes, etc.)
 * 
 * 2. DIFFING ABSTRACTION
 *    - Generic diffList() function handles list animations
 *    - Works at any level: branches, commits, tags, etc.
 *    - Three operations: add (animate in), remove (animate out), update (flash)
 *    - Keyed reconciliation prevents unnecessary re-renders
 * 
 * 3. RENDERING PIPELINE
 *    - updateState() → updateBranches() → diffList()
 *    - Each branch tracks its own data for change detection
 *    - Commits can be expanded/animated independently
 *    - All animations are CSS-based for performance
 * 
 * 4. ANIMATION SYSTEM
 *    - animateIn(): Entrance animation (fade + slide)
 *    - animateOut(): Exit animation (fade + slide + collapse)
 *    - animateUpdate(): Flash animation to highlight changes
 *    - All durations are constants for easy tweaking
 * 
 * 5. EXTENSIBILITY
 *    - Add new animatable elements by wrapping in diffList()
 *    - New animations: add CSS classes and update constants
 *    - New state fields: extend updateState() and render functions
 */

import type { BranchViewModel, DisplayState, BranchReorderInfo } from './types';
import type { WebviewMessage, ExtensionMessage } from './webviewTypes';
import Sortable from 'sortablejs';

interface BranchData {
	current: boolean;
	restack: boolean;
	commitsCount: number;
	hasChange: boolean;
	changeId?: string;
	changeStatus?: string;
}

interface DiffListConfig<T> {
	getKey: (item: T) => string;
	render: (item: T) => HTMLElement;
	update?: (element: HTMLElement, item: T) => void;
	needsUpdate?: (element: HTMLElement, item: T) => boolean;
	itemSelector: string;
	itemClass: string;
}

class StackView {
	private readonly vscode = acquireVsCodeApi();
	private readonly stackList: HTMLElement;
	private readonly errorEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private currentState: DisplayState | null = null;
	private sortableInstance: Sortable | null = null;
	private contextMenu: HTMLElement | null = null;
	private currentContextBranch: string | null = null;
	private commitContextMenu: HTMLElement | null = null;
	private currentContextCommit: { sha: string; branchName: string } | null = null;

	private static readonly COMMIT_CHUNK = 10;
	private static readonly ANIMATION_DURATION = 200;
	private static readonly FLASH_DURATION = 300; // Back to normal duration

	constructor() {
		this.stackList = document.getElementById('stackList')!;
		this.errorEl = document.getElementById('error')!;
		this.emptyEl = document.getElementById('empty')!;

		this.setupEventListeners();
		this.createContextMenu();
		this.createCommitContextMenu();
		this.vscode.postMessage({ type: 'ready' });
	}

	private setupEventListeners(): void {
		window.addEventListener('message', (event: MessageEvent) => {
			const message = event.data as ExtensionMessage;
			if (!message) {
				return;
			}
			if (message.type === 'state') {
				this.updateState(message.payload);
			}
		});

		// Hide context menus when clicking elsewhere
		document.addEventListener('click', () => {
			this.hideContextMenu();
			this.hideCommitContextMenu();
		});

		// Prevent context menus from closing when clicking inside them
		document.addEventListener('click', (event) => {
			if (this.contextMenu && this.contextMenu.contains(event.target as Node)) {
				event.stopPropagation();
			}
			if (this.commitContextMenu && this.commitContextMenu.contains(event.target as Node)) {
				event.stopPropagation();
			}
		});
	}

	private createContextMenu(): void {
		this.contextMenu = document.createElement('div');
		this.contextMenu.className = 'context-menu';
		this.contextMenu.style.display = 'none';
		document.body.appendChild(this.contextMenu);

		// Create menu items with codicon icons
		const menuItems = [
			{ label: 'Untrack', action: 'branchUntrack', icon: 'codicon-eye-closed' },
			{ label: 'Checkout', action: 'branchCheckout', icon: 'codicon-git-branch' },
			{ label: 'Fold', action: 'branchFold', icon: 'codicon-fold' },
			{ label: 'Squash', action: 'branchSquash', icon: 'codicon-fold-down' },
			{ label: 'Edit', action: 'branchEdit', icon: 'codicon-edit', requiresCurrent: true },
			{ label: 'Rename', action: 'branchRename', icon: 'codicon-tag', requiresPrompt: true },
			{ label: 'Restack', action: 'branchRestack', icon: 'codicon-refresh', requiresRestack: true },
			{ label: 'Submit', action: 'branchSubmit', icon: 'codicon-git-pull-request' },
		];

		menuItems.forEach(item => {
			const menuItem = document.createElement('div');
			menuItem.className = 'context-menu-item';
			menuItem.dataset.action = item.action;
			menuItem.innerHTML = `
				<i class="codicon ${item.icon}"></i>
				<span>${item.label}</span>
			`;
			menuItem.addEventListener('click', () => {
				if (item.requiresPrompt) {
					this.handlePromptAction(item.action);
				} else {
					this.executeBranchAction(item.action);
				}
				this.hideContextMenu();
			});
			this.contextMenu!.appendChild(menuItem);
		});
	}

	private createCommitContextMenu(): void {
		this.commitContextMenu = document.createElement('div');
		this.commitContextMenu.className = 'context-menu';
		this.commitContextMenu.style.display = 'none';
		document.body.appendChild(this.commitContextMenu);

		// Create menu items for commit actions
		const menuItems = [
			{ label: 'Copy SHA', action: 'commitCopySha', icon: 'codicon-copy' },
			// { label: 'Fixup', action: 'commitFixup', icon: 'codicon-edit' }, // Experimental feature - disabled for now
			{ label: 'Split Branch', action: 'commitSplit', icon: 'codicon-split-horizontal' },
		];

		menuItems.forEach(item => {
			const menuItem = document.createElement('div');
			menuItem.className = 'context-menu-item';
			menuItem.dataset.action = item.action;
			menuItem.innerHTML = `
				<i class="codicon ${item.icon}"></i>
				<span>${item.label}</span>
			`;
			menuItem.addEventListener('click', () => {
				this.executeCommitAction(item.action);
				this.hideCommitContextMenu();
			});
			this.commitContextMenu!.appendChild(menuItem);
		});
	}

	private showContextMenu(event: MouseEvent, branchName: string): void {
		if (!this.contextMenu) return;

		event.preventDefault();
		event.stopPropagation();

		this.currentContextBranch = branchName;

		// Update menu items based on current branch
		this.updateContextMenuItems(branchName);

		// Position the context menu
		this.contextMenu.style.left = `${event.clientX}px`;
		this.contextMenu.style.top = `${event.clientY}px`;
		this.contextMenu.style.display = 'block';
	}

	private updateContextMenuItems(branchName: string): void {
		if (!this.contextMenu) return;

		const branch = this.currentState?.branches.find(b => b.name === branchName);
		const menuItems = this.contextMenu.querySelectorAll('.context-menu-item');
		menuItems.forEach((item) => {
			const menuItem = item as HTMLElement;
			const action = menuItem.dataset.action;

			// Disable edit for non-current branches
			if (action === 'branchEdit') {
				const isCurrent = branch?.current;
				if (!isCurrent) {
					menuItem.classList.add('disabled');
					menuItem.style.opacity = '0.5';
					menuItem.style.pointerEvents = 'none';
				} else {
					menuItem.classList.remove('disabled');
					menuItem.style.opacity = '1';
					menuItem.style.pointerEvents = 'auto';
				}
			}

			// Disable restack for branches that don't need restacking
			if (action === 'branchRestack') {
				const needsRestack = branch?.restack;
				if (!needsRestack) {
					menuItem.classList.add('disabled');
					menuItem.style.opacity = '0.5';
					menuItem.style.pointerEvents = 'none';
				} else {
					menuItem.classList.remove('disabled');
					menuItem.style.opacity = '1';
					menuItem.style.pointerEvents = 'auto';
				}
			}

			// Update submit icon and label based on PR existence
			if (action === 'branchSubmit') {
				const icon = menuItem.querySelector('.codicon');
				const label = menuItem.querySelector('span');
				if (icon && label) {
					const hasPR = Boolean(branch?.change);
					icon.className = hasPR ? 'codicon codicon-cloud-upload' : 'codicon codicon-git-pull-request';
					label.textContent = hasPR ? 'Submit' : 'Submit (create PR)';
				}
			}
		});
	}

	private handlePromptAction(action: string): void {
		if (!this.currentContextBranch) return;

		if (action === 'branchRename') {
			// Send message to extension to show VSCode input box
			this.vscode.postMessage({
				type: 'branchRenamePrompt',
				branchName: this.currentContextBranch
			});
		}
	}

	private hideContextMenu(): void {
		if (this.contextMenu) {
			this.contextMenu.style.display = 'none';
			this.currentContextBranch = null;
		}
	}

	private executeBranchAction(action: string): void {
		if (!this.currentContextBranch) return;

		this.vscode.postMessage({
			type: action as any,
			branchName: this.currentContextBranch
		});
	}

	private showCommitContextMenu(event: MouseEvent, sha: string, branchName: string): void {
		if (!this.commitContextMenu) return;

		event.preventDefault();
		event.stopPropagation();

		this.currentContextCommit = { sha, branchName };

		// Position the context menu
		this.commitContextMenu.style.left = `${event.clientX}px`;
		this.commitContextMenu.style.top = `${event.clientY}px`;
		this.commitContextMenu.style.display = 'block';
	}

	private hideCommitContextMenu(): void {
		if (this.commitContextMenu) {
			this.commitContextMenu.style.display = 'none';
			this.currentContextCommit = null;
		}
	}

	private executeCommitAction(action: string): void {
		if (!this.currentContextCommit) return;

		const { sha, branchName } = this.currentContextCommit;

		if (action === 'commitCopySha') {
			// Copy SHA to clipboard
			this.vscode.postMessage({ type: 'commitCopySha', sha });
		} else if (action === 'commitFixup') {
			this.vscode.postMessage({ type: 'commitFixup', sha });
		} else if (action === 'commitSplit') {
			this.vscode.postMessage({ type: 'commitSplit', sha, branchName });
		}
	}

	private updateState(newState: DisplayState): void {
		const oldState = this.currentState;

		// Avoid no-op updates: shallow compare serialized JSON (cheap for small states)
		try {
			const oldJson = JSON.stringify(oldState);
			const newJson = JSON.stringify(newState);
			if (oldJson === newJson) {
				return; // no visible changes, skip update
			}
		} catch (e) {
			// fallback to updating if serialization fails
		}

		this.currentState = newState;

		// Update error display
		this.errorEl.classList.toggle('hidden', !newState.error);
		this.errorEl.textContent = newState.error ?? '';

		// Update branch list
		this.updateBranches(oldState?.branches ?? [], newState.branches);

		// Handle pending reorder state
		this.updatePendingReorder(newState.pendingReorder);

		// Initialize SortableJS after branches are rendered
		this.initializeSortable();
	}

	/**
	 * Generic differ for lists with animations
	 */
	private diffList<T>(
		container: HTMLElement,
		oldItems: T[],
		newItems: T[],
		config: DiffListConfig<T>
	): void {
		const {
			getKey,
			render,
			update,
			needsUpdate,
			itemSelector,
			itemClass,
		} = config;

		// Build map of existing elements
		const existingElements = new Map<string, HTMLElement>();
		container.querySelectorAll(itemSelector).forEach((el) => {
			const key = (el as HTMLElement).dataset.key;
			if (key) {
				existingElements.set(key, el as HTMLElement);
			}
		});

		const newKeys = new Set(newItems.map(getKey));

		// Remove items that no longer exist
		for (const [key, element] of existingElements) {
			if (!newKeys.has(key)) {
				this.animateOut(element, () => {
					if (element.parentNode === container) {
						container.removeChild(element);
					}
				});
				existingElements.delete(key);
			}
		}

		// Add or update items
		let previousElement: HTMLElement | null = null;
		for (const item of newItems) {
			const key = getKey(item);
			const existingElement = existingElements.get(key);

			if (existingElement) {
				// Update existing item if needed
				if (needsUpdate && update) {
					const child = existingElement.querySelector('[data-content]') as HTMLElement;
					if (child && needsUpdate(child, item)) {
						const newChild = render(item);
						// Don't animate here - let the update function handle specific animations
						child.replaceWith(newChild);

						// Update the wrapper's dataset.branch if it changed
						if (newChild.dataset.branch) {
							existingElement.dataset.branch = newChild.dataset.branch;
						}
					}
				}

				// Reorder if necessary
				const nextElement: ChildNode | null = previousElement ? previousElement.nextSibling : container.firstChild;
				if (existingElement !== nextElement) {
					container.insertBefore(existingElement, nextElement);
				}
				previousElement = existingElement;
			} else {
				// Add new item
				const wrapper = document.createElement('li');
				wrapper.className = itemClass;
				wrapper.dataset.key = key;

				const child = render(item);
				wrapper.appendChild(child);

				// Copy the branch name to the wrapper for SortableJS
				if (child.dataset.branch) {
					wrapper.dataset.branch = child.dataset.branch;
				}

				const nextElement: ChildNode | null = previousElement ? previousElement.nextSibling : container.firstChild;
				container.insertBefore(wrapper, nextElement);

				this.animateIn(wrapper);
				previousElement = wrapper;
			}
		}
	}

	/**
	 * Animate element entrance
	 */
	private animateIn(element: HTMLElement): void {
		element.classList.add('item-enter');
		requestAnimationFrame(() => {
			element.classList.remove('item-enter');
		});
	}

	/**
	 * Animate element exit
	 */
	private animateOut(element: HTMLElement, onComplete: () => void): void {
		element.classList.add('item-exit');
		setTimeout(onComplete, StackView.ANIMATION_DURATION);
	}

	/**
	 * Animate element update (flash)
	 */
	private animateUpdate(element: HTMLElement): void {
		// Prevent overlapping animations by removing existing animation class first
		element.classList.remove('item-updated');

		// Use requestAnimationFrame to ensure the class removal takes effect
		requestAnimationFrame(() => {
			element.classList.add('item-updated');
			setTimeout(() => {
				element.classList.remove('item-updated');
			}, StackView.FLASH_DURATION);
		});
	}

	private updateBranches(oldBranches: BranchViewModel[], newBranches: BranchViewModel[]): void {
		if (newBranches.length === 0) {
			this.emptyEl.textContent = this.currentState?.error ?? 'No branches in the current stack.';
			this.emptyEl.classList.remove('hidden');

			// Fade out all existing items
			const items = this.stackList.querySelectorAll('.stack-item');
			items.forEach((item, index) => {
				(item as HTMLElement).style.animationDelay = `${index * 30}ms`;
				this.animateOut(item as HTMLElement, () => { });
			});
			setTimeout(() => {
				this.stackList.innerHTML = '';
			}, items.length * 30 + StackView.ANIMATION_DURATION);
			return;
		}

		this.emptyEl.classList.add('hidden');

		// Reverse to show in correct stack order (top to bottom)
		const reversedNew = [...newBranches].reverse();
		const reversedOld = [...oldBranches].reverse();

		this.diffList(this.stackList, reversedOld, reversedNew, {
			getKey: (branch) => branch.name,
			render: (branch) => this.renderBranch(branch),
			update: (card, branch) => {
				this.updateBranch(card, branch);
			},
			needsUpdate: (card, branch) => this.branchNeedsUpdate(card, branch),
			itemSelector: '.stack-item',
			itemClass: 'stack-item',
		});
	}

	/**
	 * Updates the UI to show or hide confirm/cancel buttons for pending reorder operations.
	 * When a branch is dragged and dropped, this method creates buttons that allow the user
	 * to confirm the reorder (execute stack edit) or cancel it (revert to original position).
	 * 
	 * @param pendingReorder - The pending reorder operation details, or undefined to clear buttons
	 */
	private updatePendingReorder(pendingReorder?: BranchReorderInfo): void {
		// Validate stackList element exists
		if (!this.stackList) {
			console.error('❌ StackList element not found');
			return;
		}

		// Remove existing confirm/cancel buttons
		const existingButtons = this.stackList.querySelectorAll('.reorder-buttons');
		existingButtons.forEach(button => {
			if (button && button.parentNode) {
				button.remove();
			}
		});

		if (!pendingReorder) {
			return;
		}

		// Validate pendingReorder object structure
		if (typeof pendingReorder.branchName !== 'string' || pendingReorder.branchName.trim() === '') {
			console.error('❌ Invalid branch name in pendingReorder:', pendingReorder.branchName);
			return;
		}

		if (typeof pendingReorder.oldIndex !== 'number' || typeof pendingReorder.newIndex !== 'number') {
			console.error('❌ Invalid indices in pendingReorder:', { oldIndex: pendingReorder.oldIndex, newIndex: pendingReorder.newIndex });
			return;
		}

		if (pendingReorder.oldIndex < 0 || pendingReorder.newIndex < 0) {
			console.error('❌ Negative indices in pendingReorder:', { oldIndex: pendingReorder.oldIndex, newIndex: pendingReorder.newIndex });
			return;
		}

		// Find the branch element that was moved
		const branchElement = this.stackList.querySelector(`[data-branch="${pendingReorder.branchName}"]`) as HTMLElement;

		if (!branchElement) {
			console.error('❌ Branch element not found for:', pendingReorder.branchName);
			return;
		}

		// Validate branch element has a parent
		if (!branchElement.parentNode) {
			console.error('❌ Branch element has no parent node');
			return;
		}

		console.log('🔄 Creating reorder buttons for branch:', pendingReorder.branchName);

		// Create confirm/cancel buttons
		const buttonsContainer = document.createElement('div');
		buttonsContainer.className = 'reorder-buttons';

		const confirmButton = document.createElement('button');
		confirmButton.type = 'button';
		confirmButton.className = 'reorder-confirm';
		confirmButton.textContent = '✓ Confirm';
		confirmButton.addEventListener('click', () => {
			console.log('🔄 Confirm button clicked for:', pendingReorder.branchName);
			this.vscode.postMessage({ type: 'confirmReorder', branchName: pendingReorder.branchName });
		});

		const cancelButton = document.createElement('button');
		cancelButton.type = 'button';
		cancelButton.className = 'reorder-cancel';
		cancelButton.textContent = '✗ Cancel';
		cancelButton.addEventListener('click', () => {
			console.log('🔄 Cancel button clicked for:', pendingReorder.branchName);
			this.vscode.postMessage({ type: 'cancelReorder', branchName: pendingReorder.branchName });
		});

		buttonsContainer.appendChild(confirmButton);
		buttonsContainer.appendChild(cancelButton);

		// Insert buttons after the moved branch
		branchElement.parentNode.insertBefore(buttonsContainer, branchElement.nextSibling);
	}

	private renderBranch(branch: BranchViewModel): HTMLElement {
		const card = document.createElement('article');
		card.className = 'branch-card';
		card.dataset.content = 'true';
		card.dataset.branch = branch.name;

		if (branch.current) {
			card.classList.add('is-current');
		}
		if (branch.restack) {
			card.classList.add('needs-restack');
		}
		card.draggable = true;

		// Add right-click context menu
		card.addEventListener('contextmenu', (event: MouseEvent) => {
			this.showContextMenu(event, branch.name);
		});

		// Store branch data for diffing
		(card as any)._branchData = {
			current: branch.current,
			restack: branch.restack,
			commitsCount: branch.commits?.length ?? 0,
			hasChange: Boolean(branch.change),
			changeId: branch.change?.id,
			changeStatus: branch.change?.status,
		} as BranchData;

		const header = this.renderBranchHeader(branch, card);
		card.appendChild(header);

		if (branch.change?.status) {
			const meta = this.renderBranchMeta(branch);
			card.appendChild(meta);
		}

		if (branch.commits && branch.commits.length > 0) {
			const commitsContainer = this.renderCommitsContainer(branch, card);
			card.appendChild(commitsContainer);
		}

		return card;
	}

	private updateBranch(card: HTMLElement, branch: BranchViewModel): void {
		const oldData = (card as any)._branchData as BranchData;

		// Update classes
		card.classList.toggle('is-current', Boolean(branch.current));
		card.classList.toggle('needs-restack', Boolean(branch.restack));

		// Update stored data
		(card as any)._branchData = {
			current: branch.current,
			restack: branch.restack,
			commitsCount: branch.commits?.length ?? 0,
			hasChange: Boolean(branch.change),
			changeId: branch.change?.id,
			changeStatus: branch.change?.status,
		} as BranchData;

		// Granular updates with targeted animations
		if (oldData) {
			// Flash current branch indicator if it changed TO current (not FROM current)
			if (!oldData.current && Boolean(branch.current)) {
				const currentIcon = card.querySelector('.current-branch-icon');
				if (currentIcon) {
					this.animateUpdate(currentIcon as HTMLElement);
				}
			}

			// Flash restack tag if it changed
			if (oldData.restack !== Boolean(branch.restack)) {
				const restackTag = card.querySelector('.tag-warning');
				if (restackTag) {
					this.animateUpdate(restackTag as HTMLElement);
				}
			}

			// Flash PR link if it changed
			if (oldData.hasChange !== Boolean(branch.change) || oldData.changeId !== branch.change?.id) {
				const prLink = card.querySelector('.branch-pr-link');
				if (prLink) {
					this.animateUpdate(prLink as HTMLElement);
				}
			}

			// Flash meta status if it changed
			if (oldData.changeStatus !== branch.change?.status) {
				const metaStatus = card.querySelector('.branch-meta span');
				if (metaStatus) {
					this.animateUpdate(metaStatus as HTMLElement);
				}
			}
		}

		// Update header (tags, etc.) - only if needed
		const header = card.querySelector('.branch-header');
		if (header) {
			const newHeader = this.renderBranchHeader(branch, card);
			header.replaceWith(newHeader);
		}

		// Update meta
		const existingMeta = card.querySelector('.branch-meta');
		if (branch.change?.status) {
			const newMeta = this.renderBranchMeta(branch);
			if (existingMeta) {
				existingMeta.replaceWith(newMeta);
			} else {
				const insertBefore = card.querySelector('.branch-commits');
				if (insertBefore) {
					card.insertBefore(newMeta, insertBefore);
				} else {
					card.appendChild(newMeta);
				}
			}
		} else if (existingMeta) {
			existingMeta.remove();
		}

		// Update commits with animation
		const existingCommits = card.querySelector('.branch-commits');
		if (branch.commits && branch.commits.length > 0) {
			const newCommitsContainer = this.renderCommitsContainer(branch, card);
			if (existingCommits) {
				existingCommits.replaceWith(newCommitsContainer);
			} else {
				card.appendChild(newCommitsContainer);
			}
		} else if (existingCommits) {
			existingCommits.remove();
		}
	}

	private branchNeedsUpdate(card: HTMLElement, branch: BranchViewModel): boolean {
		const oldData = (card as any)._branchData as BranchData;
		if (!oldData) return true;

		return (
			oldData.current !== Boolean(branch.current) ||
			oldData.restack !== Boolean(branch.restack) ||
			oldData.commitsCount !== (branch.commits?.length ?? 0) ||
			oldData.hasChange !== Boolean(branch.change) ||
			oldData.changeId !== branch.change?.id ||
			oldData.changeStatus !== branch.change?.status
		);
	}

	private renderBranchHeader(branch: BranchViewModel, card: HTMLElement): HTMLElement {
		const header = document.createElement('div');
		header.className = 'branch-header';

		const hasCommits = branch.commits && branch.commits.length > 0;

		if (hasCommits) {
			const toggle = document.createElement('i');
			toggle.className = 'branch-toggle codicon codicon-chevron-right';
			toggle.role = 'button';
			toggle.tabIndex = 0;
			const expandedByDefault = branch.current === true;
			if (expandedByDefault) {
				card.classList.add('expanded');
				toggle.classList.add('expanded');
			}
			header.appendChild(toggle);

			header.style.cursor = 'pointer';
			header.addEventListener('click', (event: Event) => {
				if ((event.target as HTMLElement).closest('.branch-pr-link')) {
					return;
				}
				card.classList.toggle('expanded');
				toggle.classList.toggle('expanded');
			});
		} else {
			const spacer = document.createElement('span');
			spacer.className = 'branch-toggle-spacer';
			header.appendChild(spacer);
		}

		const nameSpan = document.createElement('span');
		nameSpan.className = 'branch-name';
		nameSpan.textContent = branch.name;
		header.appendChild(nameSpan);

		const tags = document.createElement('div');
		tags.className = 'branch-tags';


		if (branch.restack) {
			tags.appendChild(this.createTag('Restack', 'warning'));
		}

		if (branch.change) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'branch-pr-link';
			button.textContent = branch.change.id;
			if (branch.change.url) {
				button.addEventListener('click', (event: Event) => {
					event.stopPropagation();
					this.vscode.postMessage({ type: 'openChange', url: branch.change?.url! });
				});
			} else {
				button.disabled = true;
			}
			tags.appendChild(button);
		}

		header.appendChild(tags);
		return header;
	}

	private renderBranchMeta(branch: BranchViewModel): HTMLElement {
		const meta = document.createElement('div');
		meta.className = 'branch-meta';
		const status = document.createElement('span');
		status.textContent = branch.change!.status!;
		meta.appendChild(status);
		return meta;
	}

	private renderCommitsContainer(branch: BranchViewModel, card: HTMLElement): HTMLElement {
		const container = document.createElement('div');
		container.className = 'branch-commits';
		container.dataset.commitsContainer = 'true';

		// Store initial visible count
		const initialCount = Math.min(branch.commits!.length, StackView.COMMIT_CHUNK);
		this.renderCommitsIntoContainer(container, branch.commits!, initialCount, branch.name);

		return container;
	}

	private renderCommitsIntoContainer(container: HTMLElement, commits: BranchViewModel['commits'], visibleCount: number, branchName: string): void {
		if (!commits) return;

		const newCommits = commits.slice(0, visibleCount);

		// Use diffList to reconcile commits inside the container
		this.diffList(container, Array.from(container.querySelectorAll('.commit-wrapper')).map(el => {
			const key = (el as HTMLElement).dataset.key;
			return key ? { sha: key, shortSha: '', subject: '' } : null;
		}).filter((item): item is NonNullable<BranchViewModel['commits']>[0] => item !== null), newCommits, {
			getKey: (c) => c.sha,
			render: (c) => {
				const wrapper = document.createElement('div');
				wrapper.className = 'commit-wrapper';
				wrapper.dataset.key = c.sha;
				const row = this.renderCommitItem(c, branchName);
				wrapper.appendChild(row);
				return wrapper;
			},
			needsUpdate: (el, c) => {
				const row = el.querySelector('.commit-item');
				if (!row) return true;
				// simple check: subject or shortSha changed
				const subjectEl = row.querySelector('.commit-subject');
				const shaEl = row.querySelector('.commit-sha');
				return (
					subjectEl?.textContent !== c.subject ||
					shaEl?.textContent !== c.shortSha
				);
			},
			update: (el, c) => {
				const newRow = this.renderCommitItem(c, branchName);
				const oldRow = el.querySelector('.commit-item');
				if (oldRow) {
					// Check what specifically changed and flash only that part
					const oldSubject = oldRow.querySelector('.commit-subject')?.textContent;
					const oldSha = oldRow.querySelector('.commit-sha')?.textContent;

					oldRow.replaceWith(newRow);

					// Flash changed elements
					if (oldSubject !== c.subject) {
						const newSubject = newRow.querySelector('.commit-subject');
						if (newSubject) this.animateUpdate(newSubject as HTMLElement);
					}
					if (oldSha !== c.shortSha) {
						const newSha = newRow.querySelector('.commit-sha');
						if (newSha) this.animateUpdate(newSha as HTMLElement);
					}
				}
			},
			itemSelector: '.commit-wrapper',
			itemClass: 'commit-wrapper',
		});

		// Add "show more" button if needed (ensure it's after the commits)
		const existingMore = container.querySelector('.branch-more');
		if (existingMore) existingMore.remove();
		if (visibleCount < commits.length) {
			const remaining = commits.length - visibleCount;
			const more = document.createElement('button');
			more.type = 'button';
			more.className = 'branch-more';
			more.textContent = remaining > StackView.COMMIT_CHUNK
				? `Show more (${remaining})`
				: `Show remaining ${remaining}`;
			more.addEventListener('click', (event: Event) => {
				event.stopPropagation();
				this.renderCommitsIntoContainer(container, commits, visibleCount + StackView.COMMIT_CHUNK, branchName);
			});
			container.appendChild(more);
		}
	}

	private renderCommitItem(commit: NonNullable<BranchViewModel['commits']>[0], branchName?: string): HTMLElement {
		const row = document.createElement('button');
		row.type = 'button';
		row.className = 'commit-item';
		row.dataset.content = 'true';
		row.addEventListener('click', (event: Event) => {
			event.stopPropagation();
			if (typeof commit.sha !== 'string' || commit.sha.length === 0) {
				console.error('❌ Invalid commit SHA provided for diff request:', commit);
				return;
			}
			this.vscode.postMessage({ type: 'openCommitDiff', sha: commit.sha });
		});

		// Add right-click context menu for commits
		row.addEventListener('contextmenu', (event: MouseEvent) => {
			if (branchName) {
				this.showCommitContextMenu(event, commit.sha, branchName);
			}
		});

		const subject = document.createElement('span');
		subject.className = 'commit-subject';
		subject.textContent = commit.subject;
		row.appendChild(subject);

		const sha = document.createElement('span');
		sha.className = 'commit-sha';
		sha.textContent = commit.shortSha;
		row.appendChild(sha);

		return row;
	}

	private createTag(label: string, variant: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'tag' + (variant ? ' tag-' + variant : '');
		span.textContent = label;
		return span;
	}

	/**
	 * Initializes SortableJS for drag-and-drop functionality on the branch list.
	 * Destroys any existing instance before creating a new one.
	 */
	private initializeSortable(): void {
		// Validate stackList element exists
		if (!this.stackList) {
			console.error('❌ StackList element not found for SortableJS initialization');
			return;
		}

		// Destroy existing instance if it exists
		if (this.sortableInstance) {
			try {
				this.sortableInstance.destroy();
			} catch (error) {
				console.warn('⚠️ Error destroying existing SortableJS instance:', error);
			}
			this.sortableInstance = null;
		}

		// Only initialize if we have branches
		if (this.stackList.children.length === 0) {
			console.log('🔄 No branches to make sortable, skipping SortableJS initialization');
			return;
		}

		try {
			this.sortableInstance = new Sortable(this.stackList, {
				animation: 150,
				ghostClass: 'sortable-ghost',
				chosenClass: 'sortable-chosen',
				dragClass: 'sortable-drag',
				onEnd: (evt) => {
					// Validate event structure
					if (!evt || typeof evt.oldIndex !== 'number' || typeof evt.newIndex !== 'number') {
						console.error('❌ Invalid SortableJS event structure:', evt);
						return;
					}

					// Check if this is actually a reorder (not just a drop in the same position)
					if (evt.oldIndex === evt.newIndex) {
						console.log('🔄 Branch dropped in same position, ignoring');
						return;
					}

					// Validate indices are non-negative
					if (evt.oldIndex < 0 || evt.newIndex < 0) {
						console.error('❌ Negative SortableJS indices:', { oldIndex: evt.oldIndex, newIndex: evt.newIndex });
						return;
					}

					// Get branch name from dataset
					const branchName = (evt.item as HTMLElement)?.dataset?.branch;

					if (!branchName || typeof branchName !== 'string' || branchName.trim() === '') {
						console.error('❌ No valid branch name found in dataset for item:', evt.item);
						return;
					}

					console.log('🔄 SortableJS reorder detected:', { branchName, oldIndex: evt.oldIndex, newIndex: evt.newIndex });

					this.vscode.postMessage({
						type: 'branchReorder',
						oldIndex: evt.oldIndex,
						newIndex: evt.newIndex,
						branchName: branchName
					});
				}
			});

			console.log('🔄 SortableJS initialized successfully');
		} catch (error) {
			console.error('❌ Failed to initialize SortableJS:', error);
			this.sortableInstance = null;
		}
	}
}

// Initialize the stack view when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	new StackView();
});
