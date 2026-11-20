// The XState machine and the reducer machine use the same data, the same events and the same request.

export type Role = 'design' | 'engineering' | 'product' | 'other';

export type Account = {
  name: string;
  role?: Role;
  workspace: string;
  email: string;
  invites: string[];
};

export type OnboardingEvent =
  | { type: 'UPDATE_NAME'; name: string }
  | { type: 'SELECT_ROLE'; role: Role }
  | { type: 'UPDATE_WORKSPACE'; workspace: string }
  | { type: 'CREATE_WORKSPACE' }
  | { type: 'UPDATE_EMAIL'; email: string }
  | { type: 'ADD_INVITE' }
  | { type: 'REMOVE_INVITE'; email: string }
  | { type: 'SEND_INVITES' }
  | { type: 'SKIP' }
  | { type: 'NEXT' }
  | { type: 'BACK' };

export const takenWorkspace = 'Acme';

export const emptyAccount: Account = { name: '', workspace: '', email: '', invites: [] };

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const canInvite = (account: Account) => isEmail(account.email) && !account.invites.includes(account.email.trim());

/** The service refuses the name of a workspace that exists, and Acme exists. */
export async function saveWorkspace(workspace: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (workspace.trim().toLowerCase() === takenWorkspace.toLowerCase()) {
    throw new Error(`The name ${workspace.trim()} is taken`);
  }
}
