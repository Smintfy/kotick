// Vitest only typechecks *.test-d.ts files, so this runs the TypeScript compiler on a probe module instead: the
// assertions below are about types, and a runtime test can't see them otherwise.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE_PATH = path.join(PACKAGE_DIR, 'test/verify/__leafid_probe__.ts');

// A parallel machine with one compound region and one atomic region. XState's ToStateValue types the atomic region
// as `{}`, so the value type is `{ format: 'plain' | 'bold'; autosave: {} }`.
const PROBE = `
import { setup } from 'xstate';
import { defineFixtures, type FixtureStates, type LeafIdFrom } from '../../src/xstate';

const editorMachine = setup({ types: { context: {} as { text: string } } }).createMachine({
  id: 'editor',
  type: 'parallel',
  context: { text: '' },
  states: {
    format: { initial: 'plain', states: { plain: {}, bold: {} } },
    autosave: {},
  },
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type EditorLeaf = 'format.plain' | 'format.bold' | 'autosave';

export type ProbeLeafId = LeafIdFrom<typeof editorMachine>;
export const leafIdsAreExact: Equal<ProbeLeafId, EditorLeaf> = true;
export const fixtureKeysAreExact: Equal<keyof FixtureStates<typeof editorMachine>, EditorLeaf> = true;

defineFixtures(editorMachine, {
  // @ts-expect-error not a leaf of the machine
  'anything-goes': { context: { text: '' } },
});
`;

function typecheckProbe(): { errors: string[]; leafIdType: string } {
  const configPath = path.join(PACKAGE_DIR, 'tsconfig.json');
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!config) throw new Error('Could not read tsconfig.json');

  const host = ts.createCompilerHost(config.options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (fileName) => fileName === PROBE_PATH || fileExists.call(host, fileName);
  host.readFile = (fileName) => (fileName === PROBE_PATH ? PROBE : readFile.call(host, fileName));
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === PROBE_PATH
      ? ts.createSourceFile(fileName, PROBE, languageVersion, true)
      : getSourceFile.call(host, fileName, languageVersion, ...rest);

  const program = ts.createProgram({ rootNames: [PROBE_PATH], options: config.options, host });
  const probe = program.getSourceFile(PROBE_PATH)!;
  const errors = ts
    .getPreEmitDiagnostics(program, probe)
    .map((d) => {
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });

  const checker = program.getTypeChecker();
  const alias = probe.statements.find(
    (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'ProbeLeafId',
  )!;
  const leafIdType = checker.typeToString(checker.getTypeAtLocation(alias.name));
  return { errors, leafIdType };
}

describe('LeafIdFrom for a parallel machine with an atomic region', () => {
  test('is the union of leaf ids, the atomic region included, and rejects unknown fixture keys', () => {
    const { errors, leafIdType } = typecheckProbe();

    expect({ leafIdType, errors }).toEqual({ leafIdType: expect.not.stringMatching(/^string$/), errors: [] });
  }, 60_000);
});
