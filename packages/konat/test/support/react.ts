// What the installed React has. The test matrix (scripts/test-matrix.mjs) runs the tests on React 18 and 19.

import * as React from 'react';
import { describe } from 'vitest';

/** A describe that runs only when React has <Activity>, which React 19.2 added. It skips with React 18. */
export const describeWithActivity = 'Activity' in React ? describe : describe.skip;

/** The major version of the installed React: 18 or 19. */
export const REACT_MAJOR = Number(React.version.split('.')[0]);
