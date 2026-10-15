import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DeepLinkTarget } from '../../src/core/types';
import {
  parseDeepLink,
  readDeepLink,
  serializeDeepLink,
  writeDeepLink,
} from '../../src/overlay/deep-link';

const CHECKOUT: DeepLinkTarget[] = [{ machineId: 'checkout', leaves: ['payment.error'] }];
const CART = { machineId: 'cart', leaves: ['empty'] };

const FORMAT_EXAMPLES: [string, DeepLinkTarget[]][] = [
  ['checkout:payment.error', CHECKOUT],
  [
    'checkout:payment.error;shipping.express,cart:empty',
    [{ machineId: 'checkout', leaves: ['payment.error', 'shipping.express'] }, CART],
  ],
];

// Ids that collide with the separators, URL syntax, or decoding. '%41' would read as 'A' if decoded twice.
const AWKWARD: DeepLinkTarget[] = [
  { machineId: 'a:b;c,d', leaves: ['x:y', 'p;q', 'r,s'] },
  { machineId: '100%', leaves: ['50%.done', '%41'] },
  { machineId: 'a&b#c', leaves: ['x+y', 'k=v'] },
  { machineId: 'with space', leaves: ['a/b?c', ' padded '] },
  { machineId: 'café', leaves: ['crème.brûlée', '🚀.launch'] },
  { machineId: '(machine)', leaves: ['(machine).idle'] },
  { machineId: "it's!~*", leaves: ['done'] },
];

describe('format examples', () => {
  test.each(FORMAT_EXAMPLES)('parses %s', (raw, targets) => {
    expect(parseDeepLink(raw)).toEqual({ targets, errors: [] });
  });

  test.each(FORMAT_EXAMPLES)('serializes back to %s', (raw, targets) => {
    expect(serializeDeepLink(targets)).toBe(raw);
  });
});

describe('serializeDeepLink', () => {
  test.each([
    ['payment.error', 'payment.error'],
    ['(machine)', '(machine)'],
    ["it's!~*-_", "it's!~*-_"],
    ['a:b;c,d', 'a%3Ab%3Bc%2Cd'],
    ['50% & #1', '50%25%20%26%20%231'],
    ['x+y=z/?', 'x%2By%3Dz%2F%3F'],
    ['é🚀', '%C3%A9%F0%9F%9A%80'],
  ])('encodes %j as %s', (id, encoded) => {
    expect(serializeDeepLink([{ machineId: id, leaves: [id] }])).toBe(`${encoded}:${encoded}`);
  });

  test('keeps the given order and skips targets without leaves', () => {
    const targets = [
      { machineId: 'b', leaves: ['x'] },
      { machineId: 'skipped', leaves: [] },
      { machineId: 'a', leaves: ['y', 'z'] },
    ];
    expect(serializeDeepLink(targets)).toBe('b:x,a:y;z');
  });

  test('gives an empty string for no targets', () => {
    expect(serializeDeepLink([])).toBe('');
    expect(serializeDeepLink([{ machineId: 'cart', leaves: [] }])).toBe('');
  });
});

describe('parseDeepLink', () => {
  test('round-trips awkward ids', () => {
    expect(parseDeepLink(serializeDeepLink(AWKWARD))).toEqual({ targets: AWKWARD, errors: [] });
  });

  test("reads '+' as a space, and round-trips a literal '+'", () => {
    expect(parseDeepLink('my+machine:a+b').targets).toEqual([{ machineId: 'my machine', leaves: ['a b'] }]);

    const plus = [{ machineId: 'a+b', leaves: ['c+d'] }];
    expect(serializeDeepLink(plus)).toBe('a%2Bb:c%2Bd');
    expect(parseDeepLink(serializeDeepLink(plus)).targets).toEqual(plus);
  });

  test('splits a segment on its first colon', () => {
    expect(parseDeepLink('checkout:a:b').targets).toEqual([{ machineId: 'checkout', leaves: ['a:b'] }]);
  });

  test.each<[string, string, DeepLinkTarget[], string[]]>([
    ['an empty string', '', [], []],
    ['only commas', ',,,', [], []],
    ['trailing and double commas', 'cart:empty,,checkout:payment.error,', [CART, ...CHECKOUT], []],
    ['empty leaves between good ones', 'checkout:;a;;b;', [{ machineId: 'checkout', leaves: ['a', 'b'] }], []],
    ['a segment without a colon', 'checkout,cart:empty', [CART], ['"checkout"']],
    ['an empty machine id', ':idle,cart:empty', [CART], ['":idle"']],
    ['a segment with no leaves', 'checkout:,cart:empty', [CART], ['"checkout:"']],
    ['a segment with only empty leaves', 'checkout:;;,cart:empty', [CART], ['"checkout:;;"']],
    ['a bad escape in a leaf', 'checkout:%E0%A4%A,cart:empty', [CART], ['"checkout:%E0%A4%A"']],
    ['a bad escape in a machine id', '%E0%A4%A:idle,cart:empty', [CART], ['"%E0%A4%A:idle"']],
    ['a bad escape without a colon', '%E0%A4%A', [], ['"%E0%A4%A"']],
    ['several bad segments', 'x,cart:empty,:y', [CART], ['"x"', '":y"']],
  ])('handles %s', (_name, raw, targets, errorFragments) => {
    const result = parseDeepLink(raw);
    expect(result.targets).toEqual(targets);
    expect(result.errors).toHaveLength(errorFragments.length);
    errorFragments.forEach((fragment, index) => expect(result.errors[index]).toContain(fragment));
  });

  test('never throws or logs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const raw of ['%', ':', '::', ';', ',:,', '%:%', '%ZZ:a', 'a:%ZZ', 'a:%', '\uD800', 'a:\uDC00']) {
        expect(() => parseDeepLink(raw)).not.toThrow();
      }
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  test('removes duplicate leaves, keeping first-seen order', () => {
    expect(parseDeepLink('checkout:b;a;b;c;a')).toEqual({
      targets: [{ machineId: 'checkout', leaves: ['b', 'a', 'c'] }],
      errors: [],
    });
    expect(parseDeepLink('checkout:a.b;a%2Eb').targets).toEqual([{ machineId: 'checkout', leaves: ['a.b'] }]);
  });

  test('lets a later segment for the same machine replace the earlier one', () => {
    const result = parseDeepLink('checkout:a,cart:empty,checkout:b');
    expect(result.targets).toEqual([CART, { machineId: 'checkout', leaves: ['b'] }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"checkout:a"');
    expect(result.errors[0]).toContain('"checkout:b"');
  });

  test('compares machine ids after decoding', () => {
    const result = parseDeepLink('a%3Ab:x,a%3ab:y');
    expect(result.targets).toEqual([{ machineId: 'a:b', leaves: ['y'] }]);
    expect(result.errors).toHaveLength(1);
  });

  test('keeps the earlier segment when the later one for the same machine is invalid', () => {
    const result = parseDeepLink('checkout:a,checkout:');
    expect(result.targets).toEqual([{ machineId: 'checkout', leaves: ['a'] }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"checkout:"');
  });
});

describe('readDeepLink', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each<[string, string, string | undefined, DeepLinkTarget[]]>([
    ['with a leading ?', '?debug-state=checkout:payment.error', undefined, CHECKOUT],
    ['without a leading ?', 'debug-state=checkout:payment.error', undefined, CHECKOUT],
    ['among other params', '?a=1&debug-state=checkout:payment.error&b=2', undefined, CHECKOUT],
    ['when the param is missing', '?a=1&b=2', undefined, []],
    ['from an empty search', '', undefined, []],
    ['when the param has no =', '?debug-state&a=1', undefined, []],
    ['when the param is empty', '?debug-state=&a=1', undefined, []],
    ['a custom param name', '?debug-state=cart:empty&state=checkout:payment.error', 'state', CHECKOUT],
    ['an encoded key', '?debug%2Dstate=checkout:payment.error', undefined, CHECKOUT],
    ["a key with '+' for a space", '?my+state=checkout:payment.error', 'my state', CHECKOUT],
    ['the first of two matching pairs', '?debug-state=checkout:payment.error&debug-state=cart:x', undefined, CHECKOUT],
    ['past a key that fails to decode', '?%E0%A4%A=1&debug-state=checkout:payment.error', undefined, CHECKOUT],
    ['a value that contains =', '?debug-state=a%3Db:x=y', undefined, [{ machineId: 'a=b', leaves: ['x=y'] }]],
  ])('reads %s', (_name, search, param, expected) => {
    expect(readDeepLink(search, param)).toEqual(expected);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('warns once per skipped segment and returns the rest', () => {
    expect(readDeepLink('?debug-state=checkout,cart:empty,:idle')).toEqual([CART]);
    const messages = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/^\[state-viewer\] .*"checkout"/);
    expect(messages[1]).toMatch(/^\[state-viewer\] .*":idle"/);
  });

  test('warns when the same machine appears twice', () => {
    expect(readDeepLink('?debug-state=cart:full,cart:empty')).toEqual([CART]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[state-viewer\] .*"cart:full"/));
  });

  test('survives the browser URL parser', () => {
    const url = new URL(`https://example.test/page${writeDeepLink('?page=2', AWKWARD)}#hash`);
    expect(url.hash).toBe('#hash');
    expect(url.searchParams.get('page')).toBe('2');
    expect(readDeepLink(url.search)).toEqual(AWKWARD);
  });

  test('stays readable in the address bar', () => {
    const [raw, targets] = FORMAT_EXAMPLES[1];
    const url = new URL(`https://example.test/page${writeDeepLink('', targets)}`);
    expect(url.search).toBe(`?debug-state=${raw}`);
  });

  // Code that hands our serialized value to URLSearchParams.set() encodes it once more.
  describe('after URLSearchParams.set() encoded the value again', () => {
    test('reads awkward ids', () => {
      const params = new URLSearchParams('a=1');
      params.set('debug-state', serializeDeepLink(AWKWARD));
      const search = `?${params.toString()}`;
      expect(search).not.toContain(':');
      expect(readDeepLink(search)).toEqual(AWKWARD);
    });

    test.each(FORMAT_EXAMPLES)('reads the format example %s', (raw, targets) => {
      const params = new URLSearchParams();
      params.set('debug-state', raw);
      expect(readDeepLink(`?${params.toString()}`)).toEqual(targets);
    });

    test('reads a hand-written value with spaces', () => {
      const params = new URLSearchParams();
      params.set('debug-state', 'my machine:idle');
      expect(params.toString()).toBe('debug-state=my+machine%3Aidle');
      expect(readDeepLink(`?${params.toString()}`)).toEqual([{ machineId: 'my machine', leaves: ['idle'] }]);
    });
  });

  // What a router does to change one param: parse the whole query, set the param, serialize every pair again.
  // Our value is decoded on the way in, so only one layer of encoding is left on the way out.
  function rebuildQuery(search: string): string {
    const params = new URLSearchParams(search);
    params.set('page', '2');
    return `?${params.toString()}`;
  }

  describe('after a router parsed and rebuilt the query', () => {
    test('reads a format example', () => {
      const [, targets] = FORMAT_EXAMPLES[1];
      const search = rebuildQuery(writeDeepLink('?a=1', targets));
      expect(search).toBe('?a=1&debug-state=checkout%3Apayment.error%3Bshipping.express%2Ccart%3Aempty&page=2');
      expect(readDeepLink(search)).toEqual(targets);
      expect(console.warn).not.toHaveBeenCalled();
    });

    test.each<[string, DeepLinkTarget[]]>([
      ['dotted leaf ids', [{ machineId: 'checkout', leaves: ['payment.card.error'] }]],
      ["the default id '(machine)'", [{ machineId: '(machine)', leaves: ['(machine).idle'] }]],
      ['hyphens and underscores', [{ machineId: 'sign-up_form', leaves: ['step-2.email_input'] }]],
      ['spaces', [{ machineId: 'my machine', leaves: ['waiting for user', ' padded '] }]],
      ["'+'", [{ machineId: 'a+b', leaves: ['c+d', '+'] }]],
      ['unicode and emoji', [{ machineId: 'café', leaves: ['crème.brûlée', '🚀.launch'] }]],
      ['other URL punctuation', [{ machineId: 'a&b#c', leaves: ['k=v', 'a/b?c', "it's!~*"] }]],
      [
        'several machines and parallel leaves',
        [
          { machineId: 'checkout', leaves: ['payment.error', 'shipping.express'] },
          { machineId: 'cart', leaves: ['items.empty', 'promo.none'] },
        ],
      ],
    ])('reads %s', (_name, targets) => {
      const search = rebuildQuery(writeDeepLink('?a=1', targets));
      expect(search).not.toContain(':');
      expect(readDeepLink(search)).toEqual(targets);
      expect(console.warn).not.toHaveBeenCalled();
    });

    // Known limitation: the rebuild turns our %3B back into ';' before encoding the whole value, so a ';'
    // inside a leaf id reads as a leaf separator. A format that survives this should change this test on purpose.
    test("splits a leaf id containing ';'", () => {
      const search = rebuildQuery(writeDeepLink('', [{ machineId: 'checkout', leaves: ['step;2'] }]));
      expect(readDeepLink(search)).toEqual([{ machineId: 'checkout', leaves: ['step', '2'] }]);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  test("warns when a value without ':' fails to decode", () => {
    expect(readDeepLink('?debug-state=%E0%A4%A')).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[state-viewer\] .*"%E0%A4%A"/));
  });
});

describe('writeDeepLink', () => {
  const VALUE = 'debug-state=checkout:payment.error';

  test.each<[string, string, DeepLinkTarget[], string]>([
    ['adds to an empty search', '', CHECKOUT, `?${VALUE}`],
    ['adds to a bare ?', '?', CHECKOUT, `?${VALUE}`],
    ['appends after other params', '?a=1&b=2', CHECKOUT, `?a=1&b=2&${VALUE}`],
    ['accepts a search without ?', 'a=1', CHECKOUT, `?a=1&${VALUE}`],
    ['replaces in place', '?a=1&debug-state=cart:empty&b=2', CHECKOUT, `?a=1&${VALUE}&b=2`],
    ['replaces a pair without =', '?a=1&debug-state&b=2', CHECKOUT, `?a=1&${VALUE}&b=2`],
    ['replaces an encoded key', '?a=1&debug%2Dstate=cart:empty', CHECKOUT, `?a=1&${VALUE}`],
    ['removes duplicate occurrences', '?debug-state=cart:empty&a=1&debug-state=x:y', CHECKOUT, `?${VALUE}&a=1`],
    ['drops empty pairs', '?&a=1&&b=2&', CHECKOUT, `?a=1&b=2&${VALUE}`],
    ['removes the param when targets are empty', '?a=1&debug-state=cart:empty&b=2', [], '?a=1&b=2'],
    ['removes every occurrence', '?debug-state=x:y&a=1&debug-state=z:w', [], '?a=1'],
    ['returns empty when nothing else remains', '?debug-state=cart:empty', [], ''],
    ['treats targets without leaves as empty', '?debug-state=cart:empty', [{ machineId: 'cart', leaves: [] }], ''],
    ['leaves a search without the param alone', '?a=1', [], '?a=1'],
    ['returns empty for an empty search and no targets', '', [], ''],
  ])('%s', (_name, search, targets, expected) => {
    expect(writeDeepLink(search, targets)).toBe(expected);
  });

  test('keeps other params byte for byte', () => {
    const before = 'q=a%20b+c&tag=x&tag=y&empty=&flag&enc=%E2%9C%93';
    const after = 'raw=50%&%E0%A4%A=1&x=a:b;c,d&tag=z';
    const search = `?${before}&debug-state=cart:empty&${after}`;
    expect(writeDeepLink(search, CHECKOUT)).toBe(`?${before}&${VALUE}&${after}`);
    expect(writeDeepLink(search, [])).toBe(`?${before}&${after}`);
  });

  test('uses a custom param name', () => {
    const search = writeDeepLink('?debug-state=cart:empty&my+state=x:y', CHECKOUT, 'my state');
    expect(search).toBe('?debug-state=cart:empty&my%20state=checkout:payment.error');
    expect(readDeepLink(search, 'my state')).toEqual(CHECKOUT);
    expect(writeDeepLink(search, [], 'my state')).toBe('?debug-state=cart:empty');
  });

  test('writes awkward ids that read back', () => {
    expect(readDeepLink(writeDeepLink('?a=1', AWKWARD))).toEqual(AWKWARD);
  });
});
