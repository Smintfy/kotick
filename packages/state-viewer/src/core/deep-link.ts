// Deep links (spec §10.4): ?debug-state=<machineId>:<leaf>[;<leaf>…][,<machineId>:…]

import type { DeepLinkTarget } from './types';

export type { DeepLinkTarget } from './types';

export const DEFAULT_URL_PARAM = 'debug-state';

export interface ParsedDeepLink {
  targets: DeepLinkTarget[];
  /** One message per segment, or whole value, that was skipped or replaced. */
  errors: string[];
}

/** Parses a raw parameter value, before any percent-decoding. */
export function parseDeepLink(raw: string): ParsedDeepLink {
  const errors: string[] = [];
  let value = raw.replace(/\+/g, ' ');
  // A valid value always contains ':', so one without it went through URLSearchParams, which encodes ':' as %3A.
  // If code passed our value to set(), that added one encoding and one decode restores what we wrote. If a router
  // parsed and rebuilt the query, our value was decoded before being encoded, so one decode gives the fully decoded
  // value: ids without reserved characters come back intact, ids with ':' ';' ',' or '%' don't (spec §11).
  if (!value.includes(':')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return { targets: [], errors: [`Ignored "${raw}": invalid percent-encoding.`] };
    }
  }

  const byMachine = new Map<string, { target: DeepLinkTarget; segment: string }>();
  for (const segment of value.split(',')) {
    if (segment === '') continue;

    const colon = segment.indexOf(':');
    if (colon === -1) {
      errors.push(`Skipped "${segment}": expected <machineId>:<leaf>.`);
      continue;
    }
    if (colon === 0) {
      errors.push(`Skipped "${segment}": the machine id is empty.`);
      continue;
    }
    const rawLeaves = segment
      .slice(colon + 1)
      .split(';')
      .filter((leaf) => leaf !== '');
    if (rawLeaves.length === 0) {
      errors.push(`Skipped "${segment}": no leaves after the machine id.`);
      continue;
    }

    let target: DeepLinkTarget;
    try {
      target = {
        machineId: decodeURIComponent(segment.slice(0, colon)),
        leaves: [...new Set(rawLeaves.map((leaf) => decodeURIComponent(leaf)))],
      };
    } catch {
      errors.push(`Skipped "${segment}": invalid percent-encoding.`);
      continue;
    }

    const previous = byMachine.get(target.machineId);
    if (previous) {
      errors.push(
        `Skipped "${previous.segment}": machine "${target.machineId}" appears again in "${segment}", which wins.`,
      );
      byMachine.delete(target.machineId);
    }
    byMachine.set(target.machineId, { target, segment });
  }

  return { targets: [...byMachine.values()].map((entry) => entry.target), errors };
}

/** Serializes targets into a raw parameter value that is safe to put in a query string. */
export function serializeDeepLink(targets: DeepLinkTarget[]): string {
  // encodeURIComponent keeps dots and parentheses readable but escapes the separators ':' ';' ','.
  return targets
    .filter((target) => target.leaves.length > 0)
    .map((target) => `${encodeURIComponent(target.machineId)}:${target.leaves.map(encodeURIComponent).join(';')}`)
    .join(',');
}

/** Reads targets from a query string such as `location.search`, warning about skipped segments. */
export function readDeepLink(search: string, param = DEFAULT_URL_PARAM): DeepLinkTarget[] {
  const pair = splitQuery(search).find((candidate) => pairKey(candidate) === param);
  if (pair === undefined) return [];

  const equals = pair.indexOf('=');
  const { targets, errors } = parseDeepLink(equals === -1 ? '' : pair.slice(equals + 1));
  for (const error of errors) {
    console.warn(`[state-viewer] Deep link "${param}": ${error}`);
  }
  return targets;
}

/**
 * Returns `search` with the parameter set to `targets`, or removed when `targets` is empty.
 * Other parameters are kept byte for byte, in order.
 */
export function writeDeepLink(search: string, targets: DeepLinkTarget[], param = DEFAULT_URL_PARAM): string {
  // Built by hand: URLSearchParams would escape ':' ';' ',' in our value and re-encode every other parameter.
  const value = serializeDeepLink(targets);
  const pairs: string[] = [];
  let insertAt = -1;
  for (const pair of splitQuery(search)) {
    if (pairKey(pair) === param) {
      if (insertAt === -1) insertAt = pairs.length;
      continue;
    }
    pairs.push(pair);
  }

  if (value !== '') {
    pairs.splice(insertAt === -1 ? pairs.length : insertAt, 0, `${encodeURIComponent(param)}=${value}`);
  }
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

function splitQuery(search: string): string[] {
  return (search.startsWith('?') ? search.slice(1) : search).split('&').filter((pair) => pair !== '');
}

/** The pair's form-decoded key, or `undefined` when it isn't valid percent-encoding. */
function pairKey(pair: string): string | undefined {
  const equals = pair.indexOf('=');
  try {
    return decodeURIComponent((equals === -1 ? pair : pair.slice(0, equals)).replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}
