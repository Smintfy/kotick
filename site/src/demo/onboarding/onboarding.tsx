'use client';

import { Box, Check, CodeXml, type LucideIcon, PenTool, Plus, Puzzle, UserRound, X } from 'lucide-react';
import { useMachine } from 'konat/xstate';
import type { SnapshotFrom } from 'xstate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import { type OnboardingEvent, onboardingMachine, type Role, takenWorkspace } from '@/demo/onboarding/machine';
import { RadioCard } from '@/demo/radio-card';

type StepProps = {
  snapshot: SnapshotFrom<typeof onboardingMachine>;
  send: (event: OnboardingEvent) => void;
};

const roles = [
  { key: 'design', label: 'Design', Icon: PenTool },
  { key: 'engineering', label: 'Engineering', Icon: CodeXml },
  { key: 'product', label: 'Product management', Icon: Box },
  { key: 'other', label: 'Something else', Icon: Puzzle },
] as const satisfies ReadonlyArray<{
  key: Role;
  label: string;
  Icon: LucideIcon;
}>;

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

const profileForm = 'onboarding-profile-form';
const workspaceForm = 'onboarding-workspace-form';

function ProfileStep({ snapshot, send }: StepProps) {
  const { name } = snapshot.context;

  return (
    <form
      id={profileForm}
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'NEXT' });
      }}
    >
      <span aria-hidden className="grid size-10 place-items-center rounded-full bg-accent font-medium text-foreground">
        {initialsOf(name) || <UserRound className="size-4 text-muted-foreground" />}
      </span>
      <div className="grid gap-2">
        <Label htmlFor="onboarding-name">Full name</Label>
        <Input
          id="onboarding-name"
          className="h-9 border-transparent shadow-edge"
          value={name}
          autoComplete="off"
          placeholder="Ada Lovelace"
          onChange={(event) => send({ type: 'UPDATE_NAME', name: event.target.value })}
        />
      </div>
    </form>
  );
}

function ProfileActions({ snapshot }: StepProps) {
  return (
    <Button type="submit" form={profileForm} size="lg" disabled={!snapshot.can({ type: 'NEXT' })}>
      Continue
    </Button>
  );
}

function RoleStep({ snapshot, send }: StepProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2">Select one</legend>
      <RadioGroup
        value={snapshot.context.role ?? null}
        onValueChange={(key) => {
          const role = roles.find((candidate) => candidate.key === key);

          if (role) send({ type: 'SELECT_ROLE', role: role.key });
        }}
      >
        {roles.map((role) => (
          <RadioCard key={role.key} value={role.key} icon={role.Icon}>
            {role.label}
          </RadioCard>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function RoleActions({ snapshot, send }: StepProps) {
  return (
    <Button size="lg" disabled={!snapshot.can({ type: 'NEXT' })} onClick={() => send({ type: 'NEXT' })}>
      Continue
    </Button>
  );
}

function WorkspaceStep({ snapshot, send }: StepProps) {
  const { workspace, error } = snapshot.context;
  const busy = snapshot.hasTag('busy');
  const failed = snapshot.matches({ workspace: 'error' });

  return (
    <form
      id={workspaceForm}
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'CREATE_WORKSPACE' });
      }}
    >
      <Label htmlFor="onboarding-workspace">Workspace name</Label>
      <Input
        id="onboarding-workspace"
        className="h-9 border-transparent shadow-edge"
        value={workspace}
        autoComplete="off"
        placeholder="Analytical Engines"
        disabled={busy}
        aria-invalid={failed || undefined}
        aria-describedby="onboarding-workspace-hint"
        onChange={(event) => send({ type: 'UPDATE_WORKSPACE', workspace: event.target.value })}
      />
      <p id="onboarding-workspace-hint" className={`m-0 text-[13px] font-normal ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        {failed ? `${error ?? 'Could not create the workspace'}.` : `Any name works. The name ${takenWorkspace} is taken.`}
      </p>
    </form>
  );
}

function WorkspaceActions({ snapshot }: StepProps) {
  return (
    <Button type="submit" form={workspaceForm} size="lg" disabled={!snapshot.can({ type: 'CREATE_WORKSPACE' })}>
      {snapshot.hasTag('busy') ? 'Creating…' : 'Create workspace'}
    </Button>
  );
}

function InviteStep({ snapshot, send }: StepProps) {
  const { email, invites } = snapshot.context;

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'ADD_INVITE' });
      }}
    >
      <Label htmlFor="onboarding-email">Email</Label>
      {invites.length > 0 && (
        <ul aria-label="Invites" className="grid gap-2">
          {invites.map((invite) => (
            <li key={invite} className="flex h-9 items-center gap-2 rounded-lg pr-1 pl-2.5 shadow-edge">
              <span className="truncate">{invite}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${invite}`}
                className="ml-auto text-muted-foreground"
                onClick={() => send({ type: 'REMOVE_INVITE', email: invite })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id="onboarding-email"
        className="h-9 border-transparent shadow-edge"
        type="email"
        value={email}
        autoComplete="off"
        placeholder="grace@example.com"
        onChange={(event) => send({ type: 'UPDATE_EMAIL', email: event.target.value })}
      />
      <Button type="submit" variant="ghost" className="justify-self-start" disabled={!snapshot.can({ type: 'ADD_INVITE' })}>
        <Plus />
        Add
      </Button>
    </form>
  );
}

function InviteActions({ snapshot, send }: StepProps) {
  const { invites } = snapshot.context;

  return (
    <>
      <Button variant="ghost" size="lg" onClick={() => send({ type: 'SKIP' })}>
        Skip
      </Button>
      <Button size="lg" disabled={!snapshot.can({ type: 'SEND_INVITES' })} onClick={() => send({ type: 'SEND_INVITES' })}>
        {invites.length > 1 ? `Send ${invites.length} invites` : 'Send invite'}
      </Button>
    </>
  );
}

function Done({ snapshot }: StepProps) {
  const { name, workspace, invites } = snapshot.context;
  const firstName = name.trim().split(/\s+/)[0];
  const sent = invites.length === 0 ? 'You can invite teammates later.' : `We sent ${invites.length === 1 ? '1 invite' : `${invites.length} invites`}.`;

  return (
    <div role="status" className="my-auto grid justify-items-center gap-6 text-center text-sm font-medium">
      <span className="grid size-11 place-items-center rounded-full bg-accent text-foreground">
        <Check className="size-5" />
      </span>
      <div className="grid gap-1">
        <h3 className="m-0 text-base font-medium">Welcome{firstName ? `, ${firstName}` : ''}</h3>
        <p className="m-0 font-normal text-muted-foreground">
          {workspace.trim() || 'Your workspace'} is ready. {sent}
        </p>
      </div>
    </div>
  );
}

const steps = [
  {
    state: 'profile',
    title: 'Create your profile',
    lead: 'This is how your teammates see you.',
    back: false,
    Body: ProfileStep,
    Actions: ProfileActions,
  },
  {
    state: 'role',
    title: "What's your role?",
    lead: 'We use your role to set up your workspace.',
    back: true,
    Body: RoleStep,
    Actions: RoleActions,
  },
  {
    state: 'workspace',
    title: 'Create your workspace',
    lead: 'A workspace holds the work of your team.',
    back: true,
    Body: WorkspaceStep,
    Actions: WorkspaceActions,
  },
  {
    state: 'invite',
    title: 'Invite your teammates',
    lead: 'Add the email of each person on your team.',
    back: false,
    Body: InviteStep,
    Actions: InviteActions,
  },
] as const;

export function Onboarding() {
  const [snapshot, send] = useMachine(onboardingMachine);
  const index = steps.findIndex((step) => snapshot.matches(step.state));
  const step = steps[index];

  if (step === undefined) return <Done snapshot={snapshot} send={send} />;

  return (
    <div className="flex flex-1 flex-col gap-6 text-sm font-medium">
      <div className="grid gap-1">
        <p aria-hidden className="m-0 mb-2 text-[13px] font-normal text-muted-foreground">
          Step {index + 1} of {steps.length}
        </p>
        <h3 className="m-0 text-base font-medium">{step.title}</h3>
        <p className="m-0 font-normal text-muted-foreground">{step.lead}</p>
      </div>
      <step.Body snapshot={snapshot} send={send} />
      <div className="mt-auto flex items-center gap-2 pt-6">
        <div
          role="progressbar"
          aria-label="Onboarding"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          className="flex items-center gap-1"
        >
          {steps.map((dot, dotIndex) => (
            <span
              key={dot.state}
              className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${
                dotIndex === index ? 'w-4 bg-foreground' : dotIndex < index ? 'w-1.5 bg-foreground' : 'w-1.5 bg-accent'
              }`}
            />
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {step.back && (
            <Button variant="ghost" size="lg" disabled={!snapshot.can({ type: 'BACK' })} onClick={() => send({ type: 'BACK' })}>
              Back
            </Button>
          )}
          <step.Actions snapshot={snapshot} send={send} />
        </div>
      </div>
    </div>
  );
}
