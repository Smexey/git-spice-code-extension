# git-spice for VSCode

A Visual Studio Code extension that provides a rich UI for [git-spice](https://abhinav.github.io/git-spice/), a tool for stacking Git branches and managing change requests.

## Features

### Branch Stack Visualization

- **Interactive stack view** in the Source Control sidebar showing all your git-spice branches
- **Visual hierarchy** displaying branch relationships, commits, and change request status
- **Auto-refresh** when git-spice metadata or Git HEAD changes
- **Current branch highlighting** to show your position in the stack

### Sync Button

- **Sync Repository** button in the toolbar (replaces traditional refresh)
- Runs `gs repo sync` to pull latest changes and sync with remote
- **Interactive branch deletion** - prompts you with VSCode dialogs when branches have closed PRs
- Displays summary of synced and deleted branches

### Navigation Commands

All navigation commands are available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Git Spice: Navigate Up Stack** - Move up one branch in the stack (`gs up`)
- **Git Spice: Navigate Down Stack** - Move down one branch in the stack (`gs down`)
- **Git Spice: Navigate to Trunk** - Jump to the trunk branch (`gs trunk`)

### Stack Operations

Available via Command Palette:

- **Git Spice: Restack Current Stack** - Rebase all branches in the current stack (`gs stack restack`)
- **Git Spice: Submit Current Stack** - Submit all branches as change requests with auto-generated names (`gs stack submit --fill --no-draft`)

### Branch Operations

Right-click any branch in the stack view to access:

- **Checkout** - Switch to the branch
- **Restack** - Rebase the branch on its base
- **Submit** - Create or update a change request for the branch
- **Rename** - Rename the branch (with input prompt)
- **Fold** - Fold the branch into its parent
- **Squash** - Squash all commits in the branch into one
- **Edit** - Start an interactive rebase to edit the branch
- **Untrack** - Remove the branch from git-spice tracking
- **Reorder** - Drag and drop to reorder branches within the same parent (with confirmation)

### Commit Operations

Right-click any commit in the stack view to access:

- **View Commit** - Open the commit in Git's commit viewer
- **View Changes** - View all file changes in the commit
- **Copy SHA** - Copy the commit SHA to clipboard
- **Create Fixup** - Create a fixup commit for staged changes (`gs commit fixup`)
- **Split Branch Here** - Split the branch at this commit into two branches

### Quick Branch Creation

- **Keyboard shortcut**: `Cmd+Shift+Enter` (Mac) / `Ctrl+Shift+Enter` (Windows/Linux)
- **Context**: While focused in the Source Control commit message input
- Creates a new branch with the commit message using `gs branch create`
- Automatically stages all changes and clears the input box after creation

### Change Request Integration

- View PR/MR status directly in the branch view
- Click change request links to open them in your browser
- Visual indicators for open, merged, and closed change requests

## Requirements

- **git-spice CLI** must be installed and available in your PATH
  - Install from: https://abhinav.github.io/git-spice/install/
- **Git** (usually already installed)
- A repository initialized with `gs repo init`

## Usage

1. Open a repository that uses git-spice
2. The **Git Spice** view will appear in the Source Control sidebar
3. Use the sync button or Command Palette commands to manage your stacks
4. Right-click branches and commits for context menus with additional operations

## Commands

All commands are prefixed with `Git Spice:` in the Command Palette:

| Command | Description |
|---------|-------------|
| Sync Repository | Sync with remote and handle branch deletions |
| Navigate Up Stack | Move up one branch |
| Navigate Down Stack | Move down one branch |
| Navigate to Trunk | Jump to trunk branch |
| Restack Current Stack | Rebase all branches in current stack |
| Submit Current Stack | Submit all branches as change requests |
| Create Branch from Commit Message | Create new branch from SCM input (has keybinding) |

## Extension Settings

This extension does not currently contribute any VSCode settings.

## Known Issues

- The extension requires git-spice CLI to be installed and in PATH
- Branch reordering requires user confirmation before applying changes

## Contributing

This extension is open source. Contributions and feedback are welcome!

## Links

- [git-spice Documentation](https://abhinav.github.io/git-spice/)
- [git-spice CLI Reference](https://abhinav.github.io/git-spice/cli/reference/)

## License

See LICENSE file for details.
