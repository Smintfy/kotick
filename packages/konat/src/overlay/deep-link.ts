// Deep links: ?debug-state=<machineId>:<leaf>[;<leaf>…][,<machineId>:…]

import type { DeepLinkTarget } from '../core/types';
import type { KonatProps } from './props';

const DEFAULT_URL_PARAM = 'debug-state';
const TARGET_SEPARATOR = ',';
const MACHINE_ID_END = ':';
const LEAF_SEPARATOR = ';';

export function resolveUrlParam(urlParam: KonatProps['urlParam']): string {
  return isUrlParam(urlParam) ? urlParam : DEFAULT_URL_PARAM;
}

/** Whether the prop names a parameter. A JS app can pass anything. */
function isUrlParam(value: KonatProps['urlParam']): value is string {
  return typeof value === 'string' && value !== '';
}

interface ParsedDeepLink {
  targets: DeepLinkTarget[];
  /** One message per segment, or whole value, that was skipped or replaced. */
  errors: string[];
}

/** Parses a raw parameter value, before any percent-decoding. */
function parseDeepLink(raw: string): ParsedDeepLink {
  const errors: string[] = [];
  let value = raw.replace(/\+/g, ' ');

  // A valid value always contains ':', so one without it went through URLSearchParams, which encodes ':' as %3A.
  // If code passed our value to set(), that added one encoding and one decode restores what we wrote. If a router
  // parsed and rebuilt the query, our value was decoded before being encoded, so one decode gives the fully decoded
  // value: ids without reserved characters come back intact, ids with ':' ';' ',' or '%' don't.
  if (!value.includes(MACHINE_ID_END)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return { targets: [], errors: [`Ignored "${raw}": invalid percent-encoding.`] };
    }
  }

  const byMachine = new Map<string, { target: DeepLinkTarget; segment: string }>();

  for (const segment of value.split(TARGET_SEPARATOR)) {
    if (segment === '') continue;

    const idEnd = segment.indexOf(MACHINE_ID_END);

    if (idEnd === -1) {
      errors.push(`Skipped "${segment}": expected <machineId>:<leaf>.`);
      continue;
    }

    if (idEnd === 0) {
      errors.push(`Skipped "${segment}": the machine id is empty.`);
      continue;
    }

    const rawLeaves = segment
      .slice(idEnd + 1)
      .split(LEAF_SEPARATOR)
      .filter((leaf) => leaf !== '');

    if (rawLeaves.length === 0) {
      errors.push(`Skipped "${segment}": no leaves after the machine id.`);
      continue;
    }

    let target: DeepLinkTarget;

    try {
      target = {
        machineId: decodeURIComponent(segment.slice(0, idEnd)),
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
function serializeDeepLink(targets: DeepLinkTarget[]): string {
  const segments: string[] = [];

  for (const target of targets) {
    if (target.leaves.length === 0) continue;
    // encodeURIComponent keeps dots and parentheses readable but escapes the separators ':' ';' ','.
    const leaves = target.leaves.map(encodeURIComponent).join(LEAF_SEPARATOR);
    segments.push(encodeURIComponent(target.machineId) + MACHINE_ID_END + leaves);
  }

  return segments.join(TARGET_SEPARATOR);
}

/** Reads targets from a query string such as `location.search`, warning about skipped segments. */
export function readDeepLink(search: string, param = DEFAULT_URL_PARAM): DeepLinkTarget[] {
  const pair = splitQuery(search).find((candidate) => pairKey(candidate) === param);

  if (pair === undefined) return [];

  const equals = pair.indexOf('=');
  const { targets, errors } = parseDeepLink(equals === -1 ? '' : pair.slice(equals + 1));

  for (const error of errors) {
    console.warn(`[konat] Deep link "${param}": ${error}`);
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
