/** The install command of each package manager. The install tabs and the Markdown copy of a page show them. */
export const packageManagers = [
  { manager: 'npm', add: 'npm install' },
  { manager: 'pnpm', add: 'pnpm add' },
  { manager: 'yarn', add: 'yarn add' },
  { manager: 'bun', add: 'bun add' },
] as const;
