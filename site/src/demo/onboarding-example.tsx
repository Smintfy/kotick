'use client';

import { Check, UserRound, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMachine } from 'konat/xstate';
import type { SnapshotFrom } from 'xstate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DemoWindow } from '@/demo/demo-window';
import { type OnboardingEvent, onboardingFixtures, onboardingMachine, type Role, takenWorkspace } from '@/demo/onboarding';

type StepProps = {
  snapshot: SnapshotFrom<typeof onboardingMachine>;
  send: (event: OnboardingEvent) => void;
};

const roles = [
  { key: 'design', label: 'Design' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'product', label: 'Product management' },
  { key: 'other', label: 'Something else' },
] as const satisfies ReadonlyArray<{ key: Role; label: string }>;

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex justify-end gap-2">{children}</div>;
}

function BackButton({ snapshot, send }: StepProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      className="mr-auto"
      disabled={!snapshot.can({ type: 'BACK' })}
      onClick={() => send({ type: 'BACK' })}
    >
      Back
    </Button>
  );
}

function ProfileStep({ snapshot, send }: StepProps) {
  const { name } = snapshot.context;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'NEXT' });
      }}
    >
      <div className="flex items-end gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-selected text-[13px] font-medium text-heading"
        >
          {initialsOf(name) || <UserRound className="size-4 text-muted-foreground" />}
        </span>
        <div className="grid flex-1 gap-2">
          <Label htmlFor="onboarding-name">Full name</Label>
          <Input
            id="onboarding-name"
            value={name}
            autoComplete="off"
            placeholder="Ada Lovelace"
            onChange={(event) => send({ type: 'UPDATE_NAME', name: event.target.value })}
          />
        </div>
      </div>
      <Actions>
        <Button type="submit" size="lg" disabled={!snapshot.can({ type: 'NEXT' })}>
          Continue
        </Button>
      </Actions>
    </form>
  );
}

function RoleStep({ snapshot, send }: StepProps) {
  return (
    <div className="grid gap-4">
      <RadioGroup
        aria-label="Role"
        className="gap-0 divide-y rounded-lg border"
        value={snapshot.context.role ?? null}
        onValueChange={(key) => {
          const role = roles.find((candidate) => candidate.key === key);

          if (role) send({ type: 'SELECT_ROLE', role: role.key });
        }}
      >
        {roles.map((role) => (
          <Label key={role.key} className="cursor-pointer gap-2.5 px-2.5 py-2 leading-normal font-normal">
            <RadioGroupItem value={role.key} />
            {role.label}
          </Label>
        ))}
      </RadioGroup>
      <Actions>
        <BackButton snapshot={snapshot} send={send} />
        <Button size="lg" disabled={!snapshot.can({ type: 'NEXT' })} onClick={() => send({ type: 'NEXT' })}>
          Continue
        </Button>
      </Actions>
    </div>
  );
}

function WorkspaceStep({ snapshot, send }: StepProps) {
  const { workspace, error } = snapshot.context;
  const busy = snapshot.hasTag('busy');
  const failed = snapshot.matches({ workspace: 'error' });

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'CREATE_WORKSPACE' });
      }}
    >
      <Label htmlFor="onboarding-workspace">Workspace name</Label>
      <Input
        id="onboarding-workspace"
        value={workspace}
        autoComplete="off"
        placeholder="Analytical Engines"
        disabled={busy}
        aria-invalid={failed || undefined}
        aria-describedby="onboarding-workspace-hint"
        onChange={(event) => send({ type: 'UPDATE_WORKSPACE', workspace: event.target.value })}
      />
      <p id="onboarding-workspace-hint" className={`m-0 text-[13px] ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        {failed ? `${error ?? 'Could not create the workspace'}.` : `Any name works. The name ${takenWorkspace} is taken.`}
      </p>
      <Actions>
        <BackButton snapshot={snapshot} send={send} />
        <Button type="submit" size="lg" disabled={!snapshot.can({ type: 'CREATE_WORKSPACE' })}>
          {busy ? 'Creating…' : 'Create workspace'}
        </Button>
      </Actions>
    </form>
  );
}

function InviteStep({ snapshot, send }: StepProps) {
  const { email, invites } = snapshot.context;

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: 'ADD_INVITE' });
        }}
      >
        <Label htmlFor="onboarding-email">Email</Label>
        <div className="flex gap-2">
          <Input
            id="onboarding-email"
            type="email"
            value={email}
            autoComplete="off"
            placeholder="grace@example.com"
            onChange={(event) => send({ type: 'UPDATE_EMAIL', email: event.target.value })}
          />
          <Button type="submit" variant="secondary" size="lg" disabled={!snapshot.can({ type: 'ADD_INVITE' })}>
            Add
          </Button>
        </div>
      </form>
      {invites.length > 0 && (
        <ul aria-label="Invites" className="divide-y rounded-lg border">
          {invites.map((invite) => (
            <li key={invite} className="flex items-center justify-between gap-2 py-1 pr-1 pl-2.5">
              <span className="truncate">{invite}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${invite}`}
                className="text-muted-foreground"
                onClick={() => send({ type: 'REMOVE_INVITE', email: invite })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Actions>
        <Button variant="ghost" size="lg" className="mr-auto" onClick={() => send({ type: 'SKIP' })}>
          Skip for now
        </Button>
        <Button size="lg" disabled={!snapshot.can({ type: 'SEND_INVITES' })} onClick={() => send({ type: 'SEND_INVITES' })}>
          {invites.length > 1 ? `Send ${invites.length} invites` : 'Send invite'}
        </Button>
      </Actions>
    </div>
  );
}

function Done({ snapshot }: StepProps) {
  const { name, workspace, invites } = snapshot.context;
  const firstName = name.trim().split(/\s+/)[0];
  const sent = invites.length === 0 ? 'You can invite teammates later.' : `We sent ${invites.length === 1 ? '1 invite' : `${invites.length} invites`}.`;

  return (
    <div role="status" className="grid justify-items-center gap-3 pt-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-recorded-soft text-recorded">
        <Check className="size-5" />
      </span>
      <h3 className="m-0">Welcome{firstName ? `, ${firstName}` : ''}</h3>
      <p className="m-0 text-muted-foreground">
        {workspace.trim() || 'Your workspace'} is ready. {sent}
      </p>
    </div>
  );
}

const steps = [
  { state: 'profile', title: 'Create your profile', Body: ProfileStep },
  { state: 'role', title: "What's your role?", Body: RoleStep },
  { state: 'workspace', title: 'Create your workspace', Body: WorkspaceStep },
  { state: 'invite', title: 'Invite your teammates', Body: InviteStep },
] as const;

export function Onboarding() {
  const [snapshot, send] = useMachine(onboardingMachine);
  const index = steps.findIndex((step) => snapshot.matches(step.state));
  const step = steps[index];

  if (step === undefined) return <Done snapshot={snapshot} send={send} />;

  return (
    <div className="grid gap-5 text-sm">
      <div className="grid gap-2">
        <p className="m-0 text-[13px] text-muted-foreground">
          Step {index + 1} of {steps.length}
        </p>
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((other, position) => (
            <span key={other.state} className={`h-1 flex-1 rounded-full ${position <= index ? 'bg-fg' : 'bg-selected'}`} />
          ))}
        </div>
      </div>
      <h3 className="m-0">{step.title}</h3>
      <step.Body snapshot={snapshot} send={send} />
    </div>
  );
}

export function OnboardingExample({ href }: { href: string }) {
  return (
    <DemoWindow fixtures={onboardingFixtures} href={href}>
      <Onboarding />
    </DemoWindow>
  );
}
