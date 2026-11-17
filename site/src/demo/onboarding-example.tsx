'use client';

import { Box, Check, ChevronLeft, CodeXml, type LucideIcon, PenTool, Plus, Shapes, UserRound, X } from 'lucide-react';
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
  { key: 'design', label: 'Design', Icon: PenTool },
  { key: 'engineering', label: 'Engineering', Icon: CodeXml },
  { key: 'product', label: 'Product management', Icon: Box },
  { key: 'other', label: 'Something else', Icon: Shapes },
] as const satisfies ReadonlyArray<{ key: Role; label: string; Icon: LucideIcon }>;

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

function ProfileStep({ snapshot, send }: StepProps) {
  const { name } = snapshot.context;

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'NEXT' });
      }}
    >
      <span aria-hidden className="grid size-10 place-items-center rounded-full bg-selected font-medium text-heading">
        {initialsOf(name) || <UserRound className="size-4 text-muted-foreground" />}
      </span>
      <div className="grid gap-2">
        <Label htmlFor="onboarding-name">Full name</Label>
        <Input
          id="onboarding-name"
          className="h-9"
          value={name}
          autoComplete="off"
          placeholder="Ada Lovelace"
          onChange={(event) => send({ type: 'UPDATE_NAME', name: event.target.value })}
        />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!snapshot.can({ type: 'NEXT' })}>
        Continue
      </Button>
    </form>
  );
}

function RoleStep({ snapshot, send }: StepProps) {
  return (
    <div className="grid gap-6">
      <fieldset className="min-w-0">
        <legend className="mb-2 font-medium">Select one</legend>
        <RadioGroup
          value={snapshot.context.role ?? null}
          onValueChange={(key) => {
            const role = roles.find((candidate) => candidate.key === key);

            if (role) send({ type: 'SELECT_ROLE', role: role.key });
          }}
        >
          {roles.map((role) => (
            <Label
              key={role.key}
              className="relative h-9 cursor-pointer gap-2.5 rounded-lg border border-input px-2.5 leading-normal font-normal transition-colors hover:bg-surface has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-data-checked:border-fg has-data-checked:font-medium has-data-checked:text-heading"
            >
              <role.Icon className="size-4 shrink-0 text-muted-foreground" />
              {role.label}
              {/* The card shows the selection and the focus. The radio stays for the keyboard and for screen readers. */}
              <RadioGroupItem value={role.key} className="absolute opacity-0" />
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <Button size="lg" className="w-full" disabled={!snapshot.can({ type: 'NEXT' })} onClick={() => send({ type: 'NEXT' })}>
        Continue
      </Button>
    </div>
  );
}

function WorkspaceStep({ snapshot, send }: StepProps) {
  const { workspace, error } = snapshot.context;
  const busy = snapshot.hasTag('busy');
  const failed = snapshot.matches({ workspace: 'error' });

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'CREATE_WORKSPACE' });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="onboarding-workspace">Workspace name</Label>
        <Input
          id="onboarding-workspace"
          className="h-9"
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
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!snapshot.can({ type: 'CREATE_WORKSPACE' })}>
        {busy ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}

function InviteStep({ snapshot, send }: StepProps) {
  const { email, invites } = snapshot.context;

  return (
    <div className="grid gap-6">
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
              <li key={invite} className="flex h-9 items-center gap-2 rounded-lg border border-input pr-1 pl-2.5">
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
          className="h-9"
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
      <div className="grid gap-1">
        <Button size="lg" className="w-full" disabled={!snapshot.can({ type: 'SEND_INVITES' })} onClick={() => send({ type: 'SEND_INVITES' })}>
          {invites.length > 1 ? `Send ${invites.length} invites` : 'Send invite'}
        </Button>
        <Button variant="ghost" size="lg" className="justify-self-center" onClick={() => send({ type: 'SKIP' })}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function Done({ snapshot }: StepProps) {
  const { name, workspace, invites } = snapshot.context;
  const firstName = name.trim().split(/\s+/)[0];
  const sent = invites.length === 0 ? 'You can invite teammates later.' : `We sent ${invites.length === 1 ? '1 invite' : `${invites.length} invites`}.`;

  return (
    <div role="status" className="grid gap-6 text-sm">
      <span className="grid size-11 place-items-center rounded-full bg-selected text-heading">
        <Check className="size-5" />
      </span>
      <div className="grid gap-1">
        <h3 className="m-0">Welcome{firstName ? `, ${firstName}` : ''}</h3>
        <p className="m-0 text-muted-foreground">
          {workspace.trim() || 'Your workspace'} is ready. {sent}
        </p>
      </div>
    </div>
  );
}

const steps = [
  { state: 'profile', title: 'Create your profile', lead: 'This is how your teammates see you.', back: false, Body: ProfileStep },
  { state: 'role', title: "What's your role?", lead: 'We use your role to set up your workspace.', back: true, Body: RoleStep },
  { state: 'workspace', title: 'Create your workspace', lead: 'A workspace holds the work of your team.', back: true, Body: WorkspaceStep },
  { state: 'invite', title: 'Invite your teammates', lead: 'Add the email of each person on your team.', back: false, Body: InviteStep },
] as const;

export function Onboarding() {
  const [snapshot, send] = useMachine(onboardingMachine);
  const index = steps.findIndex((step) => snapshot.matches(step.state));
  const step = steps[index];

  if (step === undefined) return <Done snapshot={snapshot} send={send} />;

  return (
    <div className="grid gap-6 text-sm">
      <div className="grid gap-3">
        <div
          role="progressbar"
          aria-label="Onboarding"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          className="h-1 overflow-hidden rounded-full bg-selected"
        >
          <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        {/* The row has a fixed height. Thus, the title stays at the same position when a step has no Back button. */}
        <div className="flex h-7 items-center">
          {step.back && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back"
              title="Back"
              className="-ml-1.5 text-muted-foreground"
              disabled={!snapshot.can({ type: 'BACK' })}
              onClick={() => send({ type: 'BACK' })}
            >
              <ChevronLeft />
            </Button>
          )}
          {/* The progress bar gives the same text to a screen reader. */}
          <p aria-hidden className="m-0 ml-auto text-[13px] text-muted-foreground">
            Step {index + 1} of {steps.length}
          </p>
        </div>
      </div>
      <div className="grid gap-1">
        <h3 className="m-0">{step.title}</h3>
        <p className="m-0 text-muted-foreground">{step.lead}</p>
      </div>
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
