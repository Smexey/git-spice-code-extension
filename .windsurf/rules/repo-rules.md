---
trigger: always_on
---

# Git-Spice VSCode Extension Development Guidelines

## Project Overview

This VSCode extension provides a UI for **git-spice**, a CLI tool for stacking Git branches.

### Git-Spice Core Concepts

git-spice introduces several concepts on top of Git to enable efficient branch stacking workflows. Understanding these concepts is essential for building the VSCode extension UI.

#### Core Terminology

1. **Branch**
   - A regular Git branch that can have a _base_: the branch it was created from
   - The branch currently checked out is called the _current branch_
   - All branches except trunk have a base branch

2. **Trunk**
   - The default branch of a repository (typically `main` or `master`)
   - The only branch that does not have a base branch
   - All changes eventually merge back to trunk
   - Acts as the foundation for all stacks

3. **Current Branch**
   - The branch that is currently checked out in the working directory
   - Used as the reference point for upstack/downstack operations
   - All navigation and stack operations are relative to the current branch

4. **Stack**
   - A collection of branches stacked on top of each other in a linear chain
   - Each branch (except trunk) has exactly one base branch
   - A branch can have multiple branches stacked on top of it
   - Forms a dependency tree where changes flow from trunk → upstack
   - Example: trunk → branch-a → branch-b → branch-c

5. **Downstack**
   - All branches below the current branch in the dependency chain
   - Includes all ancestors back to (but not including) the trunk branch
   - These are the branches the current branch depends on
   - Changes in downstack branches may require restacking upstack

6. **Upstack**
   - All branches stacked on top of the current branch
   - Includes direct children and their entire upstack recursively
   - If a branch has multiple children, they are all upstack from it
   - Changes in the current branch typically require restacking upstack

7. **Sibling Branches**
   - Branches that share the same base branch
   - Siblings are independent of each other but depend on the same parent
   - Example: If branch-b and branch-c both branch from branch-a, they are siblings

8. **Restacking**
   - The process of rebasing branches on top of their base branch
   - Maintains linear history when base branches are updated
   - Keeps branches up-to-date with changes in their downstack
   - Can be applied to a single branch, upstack, or entire stack
   - Essential for keeping Change Requests synchronized

9. **Change Request (CR)**
   - A merge-able unit of work submitted to GitHub or GitLab
   - Each CR corresponds to a single branch
   - On GitHub: Pull Requests (PRs)
   - On GitLab: Merge Requests (MRs)
   - git-spice uses "Change Request" as a platform-agnostic term

#### Key Operations

1. **Navigation Commands**:
   - `gs up [n]` - Move up n branches in the stack (default: 1)
   - `gs down [n]` - Move down n branches in the stack (default: 1)
   - `gs top` - Jump to the topmost branch in the current stack
   - `gs bottom` - Jump to the bottom branch in the current stack
   - `gs trunk` - Checkout the trunk branch

2. **Branch Management**:
   - `gs branch create [name]` - Create a new branch on top of current
   - `gs branch checkout <name>` - Switch to an existing branch
   - `gs branch delete` - Delete a branch and restack its upstack
   - `gs branch restack` - Rebase current branch on its base
   - `gs branch rename` - Rename a branch

3. **Stack Operations**:
   - `gs stack submit` - Submit all branches in stack as CRs
   - `gs stack restack` - Restack all branches in current stack
   - `gs upstack restack` - Restack all upstack branches
   - `gs downstack restack` - Restack all downstack branches

4. **Commit Operations**:
   - `gs commit create` - Create a new commit
   - `gs commit amend` - Amend the current commit
   - `gs commit split` - Split a commit into multiple commits
   - `gs commit fixup` - Create a fixup commit for a previous commit

5. **Repository Operations**:
   - `gs repo init` - Initialize git-spice in a repository
   - `gs repo sync` - Pull latest changes from remote and delete merged branches
   - Sync keeps the local repository in sync with remote state

6. **Logging and Inspection**:
   - `gs log short` (alias: `gs ls`) - Short branch listing
   - `gs log long` (alias: `gs ll`) - Detailed branch listing with commit info
   - Both support `--json` flag for machine-readable output
   - Use `gs ll -a --json` to get all branches with full details (used by this extension)

#### Change Request Integration

git-spice integrates with GitHub and GitLab to manage Change Requests:

- **CR Creation**: Automatically creates PRs/MRs for branches
- **CR Updates**: Updates PRs/MRs when branches are restacked or amended
- **Status Tracking**: Monitors CR state (open, merged, closed)
- **Navigation Comments**: Adds comments showing stack context and relationships
- **Automatic Rebasing**: Updates CRs when their base branches change
- **Stacked CRs**: Multiple CRs can be submitted in sequence, maintaining dependencies

#### JSON Output

Many git-spice commands support `--json` flag for structured output:

- Enables programmatic access to git-spice data
- This extension uses `gs ll -a --json` to fetch branch information
- JSON schema provides branch metadata, commit info, CR status, and relationships
- Essential for building UI representations of stacks

### CLI Reference

For complete command reference: https://abhinav.github.io/git-spice/cli/reference/

## TypeScript & VSCode Extension Guidelines

### General Principles

1. **Modern TypeScript**: Use TypeScript 5.x+ features with strict type checking enabled
2. **VSCode API Patterns**: Follow official VSCode extension patterns and best practices
3. **Async-First**: VSCode APIs are async; use `async/await` consistently, avoid blocking operations
4. **Disposables**: Always register disposables via `context.subscriptions` for proper cleanup
5. **Error Handling**: Handle errors gracefully with user-friendly messages via `vscode.window.show*` APIs

### Code Style

1. **Type Safety**:
   - Enable strict TypeScript checking (`strict: true` in tsconfig.json)
   - Avoid `any`; use `unknown` when type is truly unknown
   - Use explicit return types for public functions
   - Prefer interfaces for object shapes, types for unions/intersections
   - Use type guards to narrow types safely

2. **Naming Conventions**:
   - PascalCase for classes, interfaces, types: `StackViewProvider`, `BranchRecord`
   - camelCase for variables, functions, methods: `workspaceFolder`, `execGitSpice`
   - UPPER_SNAKE_CASE for constants: `MAX_RETRY_COUNT`
   - Prefix private class members with `private` keyword (not `_` underscore)

3. **Code Organization**:
   - One class per file for providers and major components
   - Group related utilities in `utils/` directory
   - Keep types in dedicated `types.ts` files or co-located with implementation
   - Separate view logic (webview providers) from business logic (git-spice interactions)

4. **Functions**:
   - Prefer pure functions where possible
   - Keep functions small and focused (single responsibility)
   - Use early returns to reduce nesting
   - Document complex logic with inline comments
   - Extract magic values to named constants

5. **Async Patterns**:
   - Use `async/await` over raw Promises
   - Handle promise rejections with try-catch or `.catch()`
   - Use `void` keyword when intentionally ignoring promises: `void this.refresh()`
   - Avoid fire-and-forget promises without error handling

### VSCode Extension Patterns

1. **Extension Activation**:
   - Keep `activate()` lightweight; defer heavy initialization
   - Register all disposables in `context.subscriptions`
   - Use activation events to load only when needed
   - Provide a no-op `deactivate()` function

2. **Webview Views**:
   - Implement `WebviewViewProvider` for sidebar views
   - Set appropriate CSP (Content Security Policy) for security
   - Use nonces for inline scripts/styles
   - Handle webview disposal and recreation gracefully
   - Use `postMessage` for bidirectional communication

3. **Commands**:
   - Register commands in `package.json` under `contributes.commands`
   - Use namespaced command IDs: `git-spice.commandName`
   - Provide user-friendly titles
   - Handle command errors with user notifications

4. **State Management**:
   - Keep state in provider classes
   - Push state updates to webviews via `postMessage`
   - Handle webview lifecycle (dispose/recreate) gracefully
   - Cache data when appropriate to reduce git-spice invocations

5. **Error Handling**:
   - Show user-friendly error messages via `vscode.window.showErrorMessage()`
   - Log detailed errors to output channel for debugging
   - Gracefully degrade when git-spice is not available
   - Provide actionable error messages when possible

### Git-Spice Integration

1. **CLI Invocation**:
   - Use Node's `child_process.execFile` (promisified) for safety
   - Always specify workspace folder as `cwd`
   - Use `--json` flag for structured output when available
   - Handle command failures gracefully (git-spice may not be installed)
   - Parse and validate JSON output with proper types

2. **Command Selection**:
   - Use `gs ll -a --json` (log long, all branches) for branch listing
   - Use `gs ls -a --json` (log short) for simpler branch views if needed
   - Invoke navigation commands (`up`, `down`, etc.) directly
   - Invoke branch/commit operations with appropriate flags
   - Consider `--no-prompt` flag for non-interactive operations

3. **Data Parsing**:
   - Define TypeScript types matching git-spice JSON schema
   - Validate JSON structure before use (consider using zod or similar)
   - Handle missing optional fields gracefully
   - Map git-spice data to display models appropriate for UI

4. **Workspace Context**:
   - Check for workspace folder before invoking git-spice
   - Handle workspace folder changes (listen to `onDidChangeWorkspaceFolders`)
   - Support multi-root workspaces if feasible

### Webview Development

1. **HTML/CSS/JS**:
   - Keep webview assets in `media/` directory
   - Use VSCode CSS variables for theming: `var(--vscode-*)`
   - Use Codicons for icons: `<i class="codicon codicon-refresh"></i>`
   - Write vanilla JS or minimal frameworks for webview scripts
   - Minimize dependencies in webview context

2. **Communication**:
   - Use message passing between extension and webview
   - Define clear message types and payloads
   - Handle messages with switch statements on `message.type`
   - Validate message data before use

3. **Performance**:
   - Minimize DOM manipulation; batch updates when possible
   - Use event delegation for repeated elements
   - Avoid heavy computation in webview; push to extension host
   - Cache rendered elements when appropriate

4. **Security**:
   - Always set strict CSP headers
   - Use nonces for inline scripts/styles
   - Sanitize user-provided content before rendering
   - Use `webview.asWebviewUri()` for resource URIs

### Testing

1. **Unit Tests**:
   - Write tests in `src/test/` directory
   - Use Mocha as the test runner (VSCode standard)
   - Test utilities and pure functions thoroughly
   - Mock VSCode APIs using appropriate patterns

2. **Integration Tests**:
   - Test extension activation and command registration
   - Test git-spice CLI invocation with fixtures
   - Validate data parsing and transformation

### File Organization

```
src/
├── extension.ts          # Extension entry point (activate/deactivate)
├── gitSpiceSchema.ts     # Type definitions and parsers for git-spice JSON
├── stackView/            # Stack view webview provider and logic
│   ├── StackViewProvider.ts
│   ├── state.ts          # State transformation for display
│   └── types.ts          # View-specific types
├── utils/             