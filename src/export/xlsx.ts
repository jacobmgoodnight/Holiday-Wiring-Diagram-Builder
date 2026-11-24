/**
 * Minimal .xlsx writer and reader (Office Open XML), built on fflate's zip.
 *
 * Written here instead of pulling in SheetJS: the npm build of SheetJS has unfixed security
 * advisories, and we only need plain text and number cells. Strings are written as inline
 * strings, never formulas, so a name starting with "=" stays text in Excel.
 *
 * The reader handles what Excel, Numbers, LibreOffice and Google Sheets save: shared strings,
 * inline strings, numbers, booleans and cached formula results. Styles, dates and merged cells
 * are ignored (cells come back as their stored text or number).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Cell = string | number | boolean | null | undefined;

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export class XlsxError extends Error {}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters other than tab/newline are not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const unesc = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "A" → 0, "AA" → 26. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function sheetXml(sheet: Sheet): string {
  const widths = new Map<number, number>();
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === undefined || v === null || v === '') return '';
          const ref = `${colName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : '';
          const len = String(v).length;
          widths.set(c, Math.max(widths.get(c) ?? 0, len));
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const cols = [...widths.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(6, w + 2))}" customWidth="1"/>`)
    .join('');
  const freeze = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  return `${XML}<worksheet xmlns="${NS}" xmlns:r="${RNS}">${freeze}${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`;
}

/** Build an .xlsx file. Sheet names are trimmed to Excel's 31-character limit. */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  if (!sheets.length) throw new XlsxError('A workbook needs at least one sheet');
  const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        names
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${RNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${names.length + 1}" Type="${RNS}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `${XML}<styleSheet xmlns="${NS}">` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml({ ...s, name: names[i] }));
  });
  return zipSync(files, { level: 6 });
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unesc(m[1]) : undefined;
};

/** All text of <t> elements inside a fragment, skipping phonetic hints (<rPh>). */
const textOf = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unesc(m[1] ?? '')).join('');

/** Resolve a relationship target against the folder of the part that owns it. */
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Read every sheet of an .xlsx file as rows of strings, numbers and booleans. */
export function readXlsx(data: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new XlsxError('This file is not an Excel workbook (.xlsx).');
  }
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : undefined);
  const rootRels = text('_rels/.rels') ?? '';
  const wbPath =
    [...rootRels.matchAll(/<Relationship\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => (attr(t, 'Type') ?? '').endsWith('/officeDocument'))
      .map((t) => resolvePart('', attr(t, 'Target') ?? ''))[0] ?? 'xl/workbook.xml';
  const wb = text(wbPath);
  if (!wb) throw new XlsxError('This file is not an Excel workbook (.xlsx).');
  const relsPath = wbPath.replace(/[^/]*$/, (f) => `_rels/${f}.rels`);
  const rels = new Map<string, string>();
  for (const m of (text(relsPath) ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels.set(id, resolvePart(wbPath, target));
  }
  const sharedPath = [...rels.values()].find((p) => /sharedStrings\.xml$/i.test(p)) ?? 'xl/sharedStrings.xml';
  const shared = [...(text(sharedPath) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) => textOf(m[1] ?? ''));

  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? text(path) : undefined;
    if (!xml) continue;
    const rows: Cell[][] = [];
    let nextRow = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rAttr = attr(rm[1], 'r');
      const r = rAttr ? Number(rAttr) - 1 : nextRow;
      nextRow = r + 1;
      const row: Cell[] = [];
      let nextCol = 0;
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r');
        const c = ref ? colIndex(/^[A-Z]+/i.exec(ref)?.[0] ?? 'A') : nextCol;
        nextCol = c + 1;
        const t = attr(cm[1], 't');
        const body = cm[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: Cell;
        if (t === 'inlineStr') value = textOf(body);
        else if (t === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : '';
        else if (t === 'b') value = v === '1';
        else if (t === 'str' || t === 'e') value = v !== undefined ? unesc(v) : '';
        else value = v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v !== undefined ? unesc(v) : undefined;
        if (value !== undefined && value !== '') row[c] = value;
      }
      rows[r] = row;
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new XlsxError('This workbook has no sheets.');
  return sheets;
}
