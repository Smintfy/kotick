import { describe, expect, test } from 'vitest';
import type { MachineHandle, Override } from '../../src/core/types';
import { findInstance, groupMachines, planLink } from '../../src/overlay/model';

function handle(machineId: string, instanceId: string, extra: Partial<MachineHandle> = {}): MachineHandle {
  return {
    machineId,
    instanceId,
    adapter: 'test',
    capabilities: { preview: true, live: false, children: false },
    describe: () => [],
    getActiveLeaves: () => [],
    getContext: () => undefined,
    subscribe: () => () => {},
    normalizeTarget: (leaves) => leaves,
    ...extra,
  };
}

function override(instanceKey: string, requested: string[], leaves = requested): Override {
  return { instanceKey, requested, leaves, context: {}, source: 'live', createdAt: 0 };
}

describe('groupMachines', () => {
  test('groups by machine id in first-registration order, numbering instances from 1', () => {
    const groups = groupMachines([
      handle('checkout', '1'),
      handle('upload', '2'),
      handle('checkout', '7'),
      handle('upload', '9', { label: 'Upload row' }),
    ]);

    expect(groups.map((group) => group.machineId)).toEqual(['checkout', 'upload']);
    expect(groups[0].instances.map((entry) => [entry.key, entry.ordinal, entry.label])).toEqual([
      ['checkout#1', 1, 'checkout · 1'],
      ['checkout#7', 2, 'checkout · 2'],
    ]);
    // A label stands in for the machine id.
    expect(groups[1].instances.map((entry) => entry.label)).toEqual(['upload · 1', 'Upload row · 2']);
  });

  test('marks a group as child only when every instance is a child machine', () => {
    const groups = groupMachines([
      handle('parent', '1'),
      handle('fetch', 's1', { parentKey: 'parent#1' }),
      handle('mixed', 's2', { parentKey: 'parent#1' }),
      handle('mixed', '3'),
    ]);
    expect(groups.map((group) => [group.machineId, group.child])).toEqual([
      ['parent', false],
      ['fetch', true],
      ['mixed', false],
    ]);
  });

  test('findInstance looks across groups', () => {
    const groups = groupMachines([handle('a', '1'), handle('b', '2')]);
    expect(findInstance(groups, 'b#2')?.label).toBe('b · 1');
    expect(findInstance(groups, 'c#3')).toBeUndefined();
    expect(findInstance(groups, undefined)).toBeUndefined();
  });
});

describe('planLink', () => {
  const handles = [handle('checkout', '1'), handle('upload', '2'), handle('upload', '3'), handle('cart', '4')];

  test('writes one target per previewed machine, with the requested leaves', () => {
    const plan = planLink(
      handles,
      {
        'checkout#1': override('checkout#1', ['payment.error'], ['payment.error', 'shipping.standard']),
        'upload#2': override('upload#2', ['failed']),
        'upload#3': override('upload#3', ['failed']),
      },
      undefined,
    );
    expect(plan.targets).toEqual([
      { machineId: 'checkout', leaves: ['payment.error'] },
      { machineId: 'upload', leaves: ['failed'] },
    ]);
    expect(plan.partial).toEqual([]);
  });

  test('prefers the selected instance’s preview, then the first-registered one', () => {
    const overrides = {
      'upload#2': override('upload#2', ['failed']),
      'upload#3': override('upload#3', ['done']),
    };
    expect(planLink(handles, overrides, 'upload#3').targets).toEqual([{ machineId: 'upload', leaves: ['done'] }]);
    expect(planLink(handles, overrides, 'checkout#1').targets).toEqual([{ machineId: 'upload', leaves: ['failed'] }]);
  });

  test('reports machines whose instances differ, including ones that aren’t previewed', () => {
    expect(planLink(handles, { 'upload#2': override('upload#2', ['failed']) }, undefined).partial).toEqual(['upload']);
    const differing = { 'upload#2': override('upload#2', ['failed']), 'upload#3': override('upload#3', ['done']) };
    expect(planLink(handles, differing, undefined).partial).toEqual(['upload']);
  });

  test('skips child machines, which links can’t preview', () => {
    const child = handle('fetch', 's1', {
      parentKey: 'checkout#1',
      capabilities: { preview: false, live: false, children: false },
    });
    const plan = planLink([handle('fetch', '5'), child], { 'fetch#5': override('fetch#5', ['loading']) }, undefined);
    expect(plan).toEqual({ targets: [{ machineId: 'fetch', leaves: ['loading'] }], partial: [] });
  });
});
