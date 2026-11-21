/** The frontmatter of the SKILL.md that the Copy skill button copies. The docs page shows only the body. */
export const skill = {
  name: 'kotick',
  description:
    'Sets up and uses kotick, the React development overlay that lists every state of every state machine on the page and previews any state in place. Use when a project depends on kotick or imports kotick, kotick/reducer or kotick/xstate, when code calls useMachineReducer, defineReducerMachine, defineFixtures or connect from kotick, when the user asks to add kotick, to preview or debug the states of an XState v5 or useReducer machine, to turn a useReducer reducer into a machine, or to write fixtures, and when a [kotick] console message shows or a machine is missing from the kotick panel.',
} as const;
