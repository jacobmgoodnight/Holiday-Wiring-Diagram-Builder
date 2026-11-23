/**
 * Outline parser: text → structured lines. Pure and total: it never throws and never drops a
 * line. Problems become diagnostics; the builder decides what each line means in the graph.
 */
import type { LoadCategory, NodeKind, OutlineFields, SignalType, Status } from '../model/types';
import { ID_PREFIX, STATUSES } from '../model/types';
import {
  type KindGuess,
  inferCategory,
  inferColor,
  inferKind,
  inferOutputs,
  inferPowerKind,
  inferSignalType,
  signalTypeFromWord,
} from './infer';

export interface ContentParse {
  /** Port/socket label prefix such as `left`, `2`, `tap` (lower-case). */
  port?: string;
  /** Set when the line is a signal (non-power) link. */
  signal?: SignalType;
  /** `Unused socket` placeholder: records an empty socket, not a node. */
  unused: boolean;
  fields: OutlineFields;
  /** Subtype set by a bracket word such as `[strip]`. */
  explicitSubtype?: string;
  /** Kind set by a bracket word such as `[cord]`. */
  explicitKind?: NodeKind;
  /** Inferred from the label; the builder decides whether to apply these. */
  inferred: { subtype?: string; category?: LoadCategory; outputs?: number; color?: string };
  warnings: string[];
}

export type LineType = 'blank' | 'comment' | 'item';

export interface ParsedLine {
  /** 0-based line index. */
  index: number;
  raw: string;
  /** Line with indentation removed and trailing whitespace trimmed. */
  content: string;
  /** Indentation in spaces after tab normalisation. */
  indent: number;
  type: LineType;
  /** Repaired nesting depth (0 = top level). */
  depth: number;
  /** Index of the item line this one is nested under. */
  parent?: number;
  parse?: ContentParse;
  warnings: string[];
}

const PORT_RE = /^(\d{1,2}|left|right|top|bottom|middle|tap\d{0,2}|end|[a-d])\s*:\s*/i;
const ID_RE = /^([OKCSTPL])(\d{2,3})(?=$|[\s,.;:])/;
const UNUSED_RE = /^(unused|empty socket|free socket)\b/i;
const SIGNAL_SUFFIX_RE = /\s*\(signal\)\s*$/i;

const KIND_WORDS: Record<string, KindGuess> = {
  outlet: { kind: 'outlet' },
  receptacle: { kind: 'outlet' },
  plug: { kind: 'smartplug' },
  'smart plug': { kind: 'smartplug' },
  smartplug: { kind: 'smartplug' },
  timer: { kind: 'smartplug', subtype: 'timer' },
  cord: { kind: 'cord' },
  extension: { kind: 'cord' },
  'multi-outlet': { kind: 'cord', subtype: 'multi-outlet' },
  spt: { kind: 'cord', subtype: 'spt' },
  splitter: { kind: 'splitter' },
  strip: { kind: 'splitter', subtype: 'strip' },
  'power strip': { kind: 'splitter', subtype: 'strip' },
  stake: { kind: 'splitter', subtype: 'stake' },
  controller: { kind: 'controller' },
  supply: { kind: 'controller', subtype: 'power-supply' },
  'power supply': { kind: 'controller', subtype: 'power-supply' },
  psu: { kind: 'controller', subtype: 'power-supply' },
  tote: { kind: 'enclosure' },
  enclosure: { kind: 'enclosure' },
  load: { kind: 'load' },
};

/** Bracket word used by the serializer for each kind and subtype. */
export const KIND_WORD: Record<NodeKind, string> = {
  outlet: 'outlet',
  smartplug: 'plug',
  cord: 'cord',
  splitter: 'splitter',
  controller: 'controller',
  enclosure: 'tote',
  load: 'load',
};
export const SUBTYPE_WORD: Record<string, string> = {
  timer: 'timer',
  'multi-outlet': 'multi-outlet',
  spt: 'spt',
  strip: 'strip',
  stake: 'stake',
  'power-supply': 'power supply',
};

const KIND_BY_PREFIX: Record<string, NodeKind> = Object.fromEntries(
  Object.entries(ID_PREFIX).map(([kind, prefix]) => [prefix, kind as NodeKind]),
);

export function kindForId(id: string): NodeKind | undefined {
  return KIND_BY_PREFIX[id[0]];
}

const num = (s: string) => Number(s);

/** Remove the first match of `re` from `text`, returning the match. */
function take(text: string, re: RegExp): { text: string; m?: RegExpExecArray } {
  const m = re.exec(text);
  if (!m) return { text };
  return { text: text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length), m };
}

function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .trim();
}

/**
 * Parse the content of one item line (indentation already removed).
 * `depth` only matters for kind inference: top-level lines default to outlets.
 */
export function parseContent(content: string, depth: number): ContentParse {
  const warnings: string[] = [];
  let rest = content.trim();
  let port: string | undefined;
  let signal: SignalType | undefined;

  const pm = PORT_RE.exec(rest);
  if (pm) {
    port = pm[1].toLowerCase();
    rest = rest.slice(pm[0].length);
  }

  // Leading `~TYPE` marks a signal link; `~` followed by a digit is an approximate value.
  if (rest.startsWith('~') && !/^~\s*\d/.test(rest)) {
    const sm = /^~\s*([A-Za-z][\w.\-]*)?\s*/.exec(rest)!;
    const word = sm[1];
    const type = word ? signalTypeFromWord(word) : undefined;
    if (type) {
      signal = type;
      rest = rest.slice(sm[0].length);
    } else {
      signal = 'data';
      rest = rest.slice(1).trimStart();
    }
  }
  if (SIGNAL_SUFFIX_RE.test(rest)) {
    rest = rest.replace(SIGNAL_SUFFIX_RE, '');
    signal ??= inferSignalType(rest);
  }

  const unused = !signal && UNUSED_RE.test(rest);

  let explicitId: string | undefined;
  const im = ID_RE.exec(rest);
  if (im) {
    explicitId = im[0];
    rest = rest.slice(im[0].length);
  }

  // Bracket words: kind overrides, status, flags, tags.
  let explicitKind: NodeKind | undefined;
  let explicitSubtype: string | undefined;
  let status: Status = 'planned';
  let isNew: boolean | undefined;
  let retired: boolean | undefined;
  const tags: string[] = [];
  rest = rest.replace(/\[([^\]]*)\]/g, (_all, inner: string) => {
    for (const rawWord of inner.split(',')) {
      const word = rawWord.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!word) continue;
      const kw = KIND_WORDS[word];
      if (kw) {
        if (explicitKind && explicitKind !== kw.kind) warnings.push(`Two kinds given; using [${word}]`);
        explicitKind = kw.kind;
        explicitSubtype = kw.subtype;
      } else if ((STATUSES as readonly string[]).includes(word)) {
        status = word as Status;
      } else if (word === 'new' || word === 'new this year') {
        isNew = true;
      } else if (word === 'retired') {
        retired = true;
      } else if (!tags.includes(word)) {
        tags.push(word);
      }
    }
    return ' ';
  });
  if (/\[|\]/.test(rest)) warnings.push('Unmatched [ or ] bracket');

  let breakerAmps: number | undefined;
  let r = take(rest, /@\s*(\d+(?:\.\d+)?)\s*A\b/i);
  rest = r.text;
  if (r.m) breakerAmps = num(r.m[1]);

  let gfci: boolean | undefined;
  r = take(rest, /\bGFCI\b/i);
  rest = r.text;
  if (r.m) gfci = true;

  let lengthFt: number | undefined;
  let lengthApprox: boolean | undefined;
  r = take(rest, /(?<![\w.\-~])(~)?(\d+(?:\.\d+)?)\s?(?:ft|feet|foot|')(?![\w\-])/i);
  rest = r.text;
  if (r.m) {
    lengthFt = num(r.m[2]);
    if (r.m[1]) lengthApprox = true;
  }

  let qty: number | undefined;
  r = take(rest, /(?<![\w])[x×](\d+)(?![\w.])/i);
  rest = r.text;
  if (r.m) qty = num(r.m[1]);

  let watts: number | undefined;
  let wattsApprox: boolean | undefined;
  r = take(rest, /(?<![\w.\-~])(~)?(\d+(?:\.\d+)?)\s?(?:W|w|[Ww]atts?)(?![\w])/);
  rest = r.text;
  if (r.m) {
    watts = num(r.m[2]);
    if (r.m[1]) wattsApprox = true;
  }

  let amps: number | undefined;
  let ampsApprox: boolean | undefined;
  r = take(rest, /(?<![\w.\-~@])(~)?(\d+(?:\.\d+)?)\s?(?:A|[Aa]mps?)(?![\w])/);
  rest = r.text;
  if (r.m) {
    amps = num(r.m[2]);
    if (r.m[1]) ampsApprox = true;
  }

  const label = cleanLabel(rest);

  // Kind: explicit [kind] → ID prefix → keywords → depth default.
  const guess = inferKind(label, depth);
  const idKind = explicitId ? kindForId(explicitId) : undefined;
  let kind: NodeKind = explicitKind ?? idKind ?? guess.kind;
  if (explicitKind && idKind && explicitKind !== idKind) {
    warnings.push(`[${KIND_WORD[explicitKind]}] overrides the kind implied by ${explicitId}`);
  }
  if (unused) kind = 'load';

  let inferredSubtype: string | undefined;
  if (!explicitSubtype) {
    const power = inferPowerKind(label);
    if (power && power.kind === kind) inferredSubtype = power.subtype;
  }

  if (breakerAmps !== undefined && kind !== 'outlet') warnings.push('@A breaker rating only applies to outlets');

  const fields: OutlineFields = {
    kind,
    label,
    explicitId,
    qty,
    watts,
    wattsApprox,
    amps,
    ampsApprox,
    lengthFt,
    lengthApprox,
    breakerAmps,
    gfci,
    status,
    isNew,
    retired,
    tags,
  };
  return {
    port,
    signal,
    unused,
    fields,
    explicitKind,
    explicitSubtype,
    inferred: {
      subtype: explicitSubtype ?? inferredSubtype,
      category: kind === 'load' ? inferCategory(label) ?? 'other' : undefined,
      outputs: inferOutputs(label),
      color: inferColor(label),
    },
    warnings,
  };
}

/** Split text into lines and recover the nesting structure. */
export function parseLines(text: string): ParsedLine[] {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: ParsedLine[] = [];
  // Stack of item lines that can be parents: [indent, line index].
  let stack: { indent: number; index: number }[] = [];

  rawLines.forEach((raw, index) => {
    const expanded = raw.replace(/\t/g, '  ');
    const indent = expanded.length - expanded.trimStart().length;
    const content = expanded.trim();
    const warnings: string[] = [];
    if (!content) {
      lines.push({ index, raw, content: '', indent: 0, type: 'blank', depth: 0, warnings });
      return;
    }
    if (content.startsWith('#')) {
      if (indent === 0) {
        stack = [];
        lines.push({ index, raw, content, indent, type: 'comment', depth: 0, warnings });
        return;
      }
      // Indented comments belong to the deepest open item above them; they never become parents.
      const parentEntry = [...stack].reverse().find((s) => s.indent < indent);
      const depth = parentEntry ? stack.indexOf(parentEntry) + 1 : 0;
      lines.push({ index, raw, content, indent, type: 'comment', depth, parent: parentEntry?.index, warnings });
      return;
    }

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentEntry = stack[stack.length - 1];
    if (indent % 2 === 1) {
      warnings.push(
        parentEntry
          ? `Odd indentation (${indent} spaces); read as plugged into line ${parentEntry.index + 1}`
          : `Odd indentation (${indent} spaces); read as top level`,
      );
    } else if (parentEntry && indent > parentEntry.indent + 2) {
      warnings.push(`Indented more than one level; read as plugged into line ${parentEntry.index + 1}`);
    } else if (!parentEntry && indent > 0) {
      warnings.push('Indented, but there is nothing above it to plug into; read as top level');
    }
    const depth = stack.length;
    const parse = parseContent(content, depth);
    lines.push({ index, raw, content, indent, type: 'item', depth, parent: parentEntry?.index, parse, warnings });
    if (!parse.unused) stack.push({ indent, index });
  });
  return lines;
}
