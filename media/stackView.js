(function () {
  const vscode = acquireVsCodeApi();
  const stackList = document.getElementById('stackList');
  const errorEl = document.getElementById('error');
  const emptyEl = document.getElementById('empty');

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }
    if (message.type === 'state') {
      render(message.payload);
    }
  });

  vscode.postMessage({ type: 'ready' });

  function render(state) {
    errorEl.classList.toggle('hidden', !state.error);
    errorEl.textContent = state.error ?? '';

    stackList.innerHTML = '';

    if (state.branches.length === 0) {
      emptyEl.textContent = state.error ?? 'No branches in the current stack.';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    for (const branch of [...state.branches].reverse()) {
      const item = document.createElement('li');
      item.className = 'stack-item';
      item.appendChild(renderBranch(branch));
      stackList.appendChild(item);
    }
  }

  const COMMIT_CHUNK = 10;

  function renderBranch(branch) {
    const card = document.createElement('article');
    card.className = 'branch-card';
    card.dataset.branch = branch.name;

    if (branch.current) {
      card.classList.add('is-current');
    }
    if (branch.restack) {
      card.classList.add('needs-restack');
    }
    card.draggable = true;

    const header = document.createElement('div');
    header.className = 'branch-header';

    const hasCommits = branch.commits && branch.commits.length > 0;
    let toggle;

    if (hasCommits) {
      toggle = document.createElement('i');
      toggle.className = 'branch-toggle codicon codicon-chevron-right';
      toggle.role = 'button';
      toggle.tabIndex = 0;
      const expandedByDefault = branch.current === true;
      if (expandedByDefault) {
        card.classList.add('expanded');
        toggle.classList.add('expanded');
      }
      header.appendChild(toggle);
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

    // Make the entire header clickable for expansion (except for other clickable elements)
    if (hasCommits) {
      header.style.cursor = 'pointer';
      header.addEventListener('click', (event) => {
        // Don't expand if clicking on the PR link or other interactive elements
        if (event.target.closest('.branch-pr-link')) {
          return;
        }
        card.classList.toggle('expanded');
        if (toggle) {
          toggle.classList.toggle('expanded');
        }
      });
    }

    card.appendChild(header);

    if (branch.change?.status) {
      const meta = document.createElement('div');
      meta.className = 'branch-meta';
      const status = document.createElement('span');
      status.textContent = branch.change.status;
      meta.appendChild(status);
      card.appendChild(meta);
    }

    if (branch.commits && branch.commits.length > 0) {
      const commits = document.createElement('div');
      commits.className = 'branch-commits';

      const renderCommits = (visibleCount) => {
        commits.innerHTML = '';

        const count = Math.min(visibleCount, branch.commits.length);
        for (let index = 0; index < count; index += 1) {
          const commit = branch.commits[index];
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'commit-item';
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

          commits.appendChild(row);
        }

        if (count < branch.commits.length) {
          const remaining = branch.commits.length - count;
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'branch-more';
          more.textContent = remaining > COMMIT_CHUNK ? `Show more (${remaining})` : `Show remaining ${remaining}`;
          more.addEventListener('click', (event) => {
            event.stopPropagation();
            renderCommits(count + COMMIT_CHUNK);
          });
          commits.appendChild(more);
        }
      };

      const initialCount = Math.min(branch.commits.length, COMMIT_CHUNK);
      renderCommits(initialCount);

      card.appendChild(commits);
    }

    enableDrag(card);
    return card;
  }

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
