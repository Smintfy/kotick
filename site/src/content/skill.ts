/** The frontmatter of the SKILL.md that the Copy skill button copies. The docs page shows only the body. */
export const skill = {
  name: 'shiru',
  description:
    'Sets up and uses shiru, the React development overlay that lists every state of every state machine on the page and previews any state in place. Use when a project depends on shiru or imports shiru, shiru/reducer or shiru/xstate, when code calls useMachineReducer, defineReducerMachine, defineFixtures or connect from shiru, when the user asks to add shiru, to preview or debug the states of an XState v5 or useReducer machine, to turn a useReducer reducer into a machine, or to write fixtures, and when a [shiru] console message shows or a machine is missing from the shiru panel.',
} as const;
