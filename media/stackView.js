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
(function () {
  const vscode = acquireVsCodeApi();
  const stackList = document.getElementById('stackList');
  const errorEl = document.getElementById('error');
  const emptyEl = document.getElementById('empty');

  const COMMIT_CHUNK = 10;
  const ANIMATION_DURATION = 200;
  const FLASH_DURATION = 400;

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  let currentState = null;

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }
    if (message.type === 'state') {
      updateState(message.payload);
    }
  });

  vscode.postMessage({ type: 'ready' });

  function updateState(newState) {
    const oldState = currentState;
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

    currentState = newState;

    // Update error display
    errorEl.classList.toggle('hidden', !newState.error);
    errorEl.textContent = newState.error ?? '';

    // Update branch list
    updateBranches(oldState?.branches ?? [], newState.branches);
  }

  // ============================================================================
  // DIFFING ABSTRACTION
  // ============================================================================

  /**
   * Generic differ for lists with animations
   * @param {Element} container - Parent element containing items
   * @param {Array} oldItems - Previous items
   * @param {Array} newItems - New items
   * @param {Object} config - Configuration
   * @param {Function} config.getKey - Extract unique key from item
   * @param {Function} config.render - Render new item element
   * @param {Function} config.update - Update existing element (optional)
   * @param {Function} config.needsUpdate - Check if update needed (optional)
   * @param {string} config.itemSelector - CSS selector for items
   * @param {string} config.itemClass - Class for wrapper elements
   */
  function diffList(container, oldItems, newItems, config) {
    const {
      getKey,
      render,
      update,
      needsUpdate,
      itemSelector,
      itemClass,
    } = config;

    // Build map of existing elements
    const existingElements = new Map();
    container.querySelectorAll(itemSelector).forEach((el) => {
      const key = el.dataset.key;
      if (key) {
        existingElements.set(key, el);
      }
    });

    const newKeys = new Set(newItems.map(getKey));

    // Remove items that no longer exist
    for (const [key, element] of existingElements) {
      if (!newKeys.has(key)) {
        animateOut(element, () => {
          if (element.parentNode === container) {
            container.removeChild(element);
          }
        });
        existingElements.delete(key);
      }
    }

    // Add or update items
    let previousElement = null;
    for (const item of newItems) {
      const key = getKey(item);
      const existingElement = existingElements.get(key);

      if (existingElement) {
        // Update existing item if needed
        if (needsUpdate && update) {
          const child = existingElement.querySelector('[data-content]');
          if (child && needsUpdate(child, item)) {
            const newChild = render(item);
            animateUpdate(newChild);
            child.replaceWith(newChild);
          }
        }

        // Reorder if necessary
        const nextElement = previousElement ? previousElement.nextSibling : container.firstChild;
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

        const nextElement = previousElement ? previousElement.nextSibling : container.firstChild;
        container.insertBefore(wrapper, nextElement);

        animateIn(wrapper);
        previousElement = wrapper;
      }
    }
  }

  /**
   * Animate element entrance
   */
  function animateIn(element) {
    element.classList.add('item-enter');
    requestAnimationFrame(() => {
      element.classList.remove('item-enter');
    });
  }

  /**
   * Animate element exit
   */
  function animateOut(element, onComplete) {
    element.classList.add('item-exit');
    setTimeout(onComplete, ANIMATION_DURATION);
  }

  /**
   * Animate element update (flash)
   */
  function animateUpdate(element) {
    element.classList.add('item-updated');
    setTimeout(() => {
      element.classList.remove('item-updated');
    }, FLASH_DURATION);
  }

  // ============================================================================
  // BRANCH RENDERING
  // ============================================================================

  function updateBranches(oldBranches, newBranches) {
    if (newBranches.length === 0) {
      emptyEl.textContent = currentState.error ?? 'No branches in the current stack.';
      emptyEl.classList.remove('hidden');
      
      // Fade out all existing items
      const items = stackList.querySelectorAll('.stack-item');
      items.forEach((item, index) => {
        item.style.animationDelay = `${index * 30}ms`;
        animateOut(item, () => {});
      });
      setTimeout(() => {
        stackList.innerHTML = '';
      }, items.length * 30 + ANIMATION_DURATION);
      return;
    }

    emptyEl.classList.add('hidden');

    // Reverse to show in correct stack order (top to bottom)
    const reversedNew = [...newBranches].reverse();
    const reversedOld = [...oldBranches].reverse();

    diffList(stackList, reversedOld, reversedNew, {
      getKey: (branch) => branch.name,
      render: renderBranch,
      update: updateBranch,
      needsUpdate: branchNeedsUpdate,
      itemSelector: '.stack-item',
      itemClass: 'stack-item',
    });
  }

  function renderBranch(branch) {
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

    // Store branch data for diffing
    card._branchData = {
      current: branch.current,
      restack: branch.restack,
      commitsCount: branch.commits?.length ?? 0,
      hasChange: Boolean(branch.change),
      changeId: branch.change?.id,
      changeStatus: branch.change?.status,
    };

    const header = renderBranchHeader(branch, card);
    card.appendChild(header);

    if (branch.change?.status) {
      const meta = renderBranchMeta(branch);
      card.appendChild(meta);
    }

    if (branch.commits && branch.commits.length > 0) {
      const commitsContainer = renderCommitsContainer(branch, card);
      card.appendChild(commitsContainer);
    }

    enableDrag(card);
    return card;
  }

  function updateBranch(card, branch) {
    const oldData = card._branchData;
    
    // Update classes
    card.classList.toggle('is-current', Boolean(branch.current));
    card.classList.toggle('needs-restack', Boolean(branch.restack));

    // Update stored data
    card._branchData = {
      current: branch.current,
      restack: branch.restack,
      commitsCount: branch.commits?.length ?? 0,
      hasChange: Boolean(branch.change),
      changeId: branch.change?.id,
      changeStatus: branch.change?.status,
    };

    // Granular updates with targeted animations
    if (oldData) {
      // Flash current branch indicator if it changed
      if (oldData.current !== Boolean(branch.current)) {
        const currentIcon = card.querySelector('.current-branch-icon');
        if (currentIcon) {
          animateUpdate(currentIcon);
        }
      }

      // Flash restack tag if it changed
      if (oldData.restack !== Boolean(branch.restack)) {
        const restackTag = card.querySelector('.tag-warning');
        if (restackTag) {
          animateUpdate(restackTag);
        }
      }

      // Flash PR link if it changed
      if (oldData.hasChange !== Boolean(branch.change) || oldData.changeId !== branch.change?.id) {
        const prLink = card.querySelector('.branch-pr-link');
        if (prLink) {
          animateUpdate(prLink);
        }
      }

      // Flash meta status if it changed
      if (oldData.changeStatus !== branch.change?.status) {
        const metaStatus = card.querySelector('.branch-meta span');
        if (metaStatus) {
          animateUpdate(metaStatus);
        }
      }
    }

    // Update header (tags, etc.) - only if needed
    const header = card.querySelector('.branch-header');
    if (header) {
      const newHeader = renderBranchHeader(branch, card);
      header.replaceWith(newHeader);
    }

    // Update meta
    const existingMeta = card.querySelector('.branch-meta');
    if (branch.change?.status) {
      const newMeta = renderBranchMeta(branch);
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
      const newCommitsContainer = renderCommitsContainer(branch, card);
      if (existingCommits) {
        const wasExpanded = card.classList.contains('expanded');
        existingCommits.replaceWith(newCommitsContainer);
        // Restore expanded state
        if (wasExpanded) {
          card.classList.add('expanded');
        }
      } else {
        card.appendChild(newCommitsContainer);
      }
    } else if (existingCommits) {
      existingCommits.remove();
    }
  }

  function branchNeedsUpdate(card, branch) {
    const oldData = card._branchData;
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

  function renderBranchHeader(branch, card) {
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
      header.addEventListener('click', (event) => {
        if (event.target.closest('.branch-pr-link')) {
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
    
    if (branch.current) {
      const currentIcon = document.createElement('i');
      currentIcon.className = 'codicon codicon-arrow-right current-branch-icon';
      currentIcon.title = 'Current branch';
      tags.appendChild(currentIcon);
    }
    
    if (branch.restack) {
      tags.appendChild(createTag('Restack', 'warning'));
    }
    
    if (branch.change) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'branch-pr-link';
      button.textContent = branch.change.id;
      if (branch.change.url) {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({ type: 'openChange', url: branch.change?.url });
        });
      } else {
        button.disabled = true;
      }
      tags.appendChild(button);
    }
    
    header.appendChild(tags);
    return header;
  }

  function renderBranchMeta(branch) {
    const meta = document.createElement('div');
    meta.className = 'branch-meta';
    const status = document.createElement('span');
    status.textContent = branch.change.status;
    meta.appendChild(status);
    return meta;
  }

  function renderCommitsContainer(branch, card) {
    const container = document.createElement('div');
    container.className = 'branch-commits';
    container.dataset.commitsContainer = 'true';

    // Store initial visible count
    const initialCount = Math.min(branch.commits.length, COMMIT_CHUNK);
    renderCommitsIntoContainer(container, branch.commits, initialCount);

    return container;
  }

  function renderCommitsIntoContainer(container, commits, visibleCount) {
    const newCommits = commits.slice(0, visibleCount);

    // Use diffList to reconcile commits inside the container
    diffList(container, Array.from(container.querySelectorAll('.commit-wrapper')).map(el => ({
      sha: el.dataset.key,
    })), newCommits, {
      getKey: (c) => c.sha,
      render: (c) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'commit-wrapper';
        wrapper.dataset.key = c.sha;
        const row = renderCommitItem(c);
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
        const newRow = renderCommitItem(c);
        const oldRow = el.querySelector('.commit-item');
        if (oldRow) {
          // Check what specifically changed and flash only that part
          const oldSubject = oldRow.querySelector('.commit-subject')?.textContent;
          const oldSha = oldRow.querySelector('.commit-sha')?.textContent;
          
          oldRow.replaceWith(newRow);
          
          // Flash changed elements
          if (oldSubject !== c.subject) {
            const newSubject = newRow.querySelector('.commit-subject');
            if (newSubject) animateUpdate(newSubject);
          }
          if (oldSha !== c.shortSha) {
            const newSha = newRow.querySelector('.commit-sha');
            if (newSha) animateUpdate(newSha);
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
      more.textContent = remaining > COMMIT_CHUNK
        ? `Show more (${remaining})`
        : `Show remaining ${remaining}`;
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        renderCommitsIntoContainer(container, commits, visibleCount + COMMIT_CHUNK);
      });
      container.appendChild(more);
    }
  }

  function renderCommitItem(commit) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'commit-item';
    row.dataset.content = 'true';
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'openCommit', sha: commit.sha });
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

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function createTag(label, variant) {
    const span = document.createElement('span');
    span.className = 'tag' + (variant ? ' tag-' + variant : '');
    span.textContent = label;
    return span;
  }

  function enableDrag(card) {
    card.addEventListener('dragstart', (event) => {
      const branch = card.dataset.branch ?? '';
      event.dataTransfer?.setData('text/plain', branch);
      event.dataTransfer?.setDragImage(card, card.clientWidth / 2, card.clientHeight / 2);
      card.classList.add('dragging');
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
    
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('drag-over');
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    });
    
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('drag-over');
      const source = event.dataTransfer?.getData('text/plain');
      const target = card.dataset.branch;
      if (!source || !target || source === target) {
        return;
      }
      vscode.postMessage({ type: 'branchDrop', source, target });
    });
  }
})();
