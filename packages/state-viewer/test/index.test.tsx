import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { StateViewer } from '../src/index';

test('renders the overlay root', () => {
  const { container } = render(<StateViewer />);
  expect(container.querySelector('[data-state-viewer-root]')).not.toBeNull();
});
