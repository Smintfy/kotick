import * as React from 'react';
import { describe } from 'vitest';

/** React 19.2 added <Activity>. */
export const describeWithActivity = 'Activity' in React ? describe : describe.skip;

export const REACT_MAJOR = Number(React.version.split('.')[0]);
