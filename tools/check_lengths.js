#!/usr/bin/env node
/*
 * Length cue check: is the correct option noticeably longer than the distractors?
 *
 * For every valid question it compares the character length of the correct
 * option with the distractors. A question is FLAGGED when the correct option
 * is the longest AND at least 25% longer than the longest distractor (the rule
 * is optionLengthCue in validation.js, shared with Diagnostica in the app).
 *
 * It reports, per file and per subject: total questions, % where the correct
 * option is the longest, % flagged.
 *
 * Usage (from the project folder):
 *     node tools/check_lengths.js                      whole bank
 *     node tools/check_lengths.js privacy.json ...     only these files (names in data/questions/)
 * Options:
 *     --list      also list every flagged question (id, correct and longest distractor length)
 *     --markdown  print the report as Markdown tables (for a pull request or the Actions summary)
 *     --strict    exit code 1 if any question is flagged or could not be checked
 *                 (default: always 0, report only)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { validateBank, optionLengthCue } = require('../validation.js');

const ROOT = path.join(__dirname, '..');
const QUESTIONS_DIR = path.join(ROOT, 'data', 'questions');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const known = ['--list', '--markdown', '--strict'];
const unknown = [...flags].filter((f) => !known.includes(f));
if (unknown.length) {
  console.error('Unknown option(s): ' + unknown.join(', ') + ' (allowed: ' + known.join(', ') + ')');
  process.exit(2);
}
const markdown = flags.has('--markdown');

const subjects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'subjects.json'), 'utf8')).subjects || [];
const subjectById = {};
subjects.forEach((s) => { subjectById[s.id] = s; });

const requested = args.filter((a) => !a.startsWith('--')).map((a) => path.basename(a));
const files = requested.length
  ? requested
  : fs.readdirSync(QUESTIONS_DIR).filter((f) => f.toLowerCase().endsWith('.json') && f !== 'index.json').sort();

const results = files.map((file) => {
  try {
    return { file, json: JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, file), 'utf8')) };
  } catch (e) {
    return { file, error: e.message };
  }
});
const bank = validateBank(results, subjectById);

// Which file each question came from (validateBank keeps file order)
const fileOf = {};
results.forEach(({ file, json }) => {
  const list = Array.isArray(json) ? json : json && json.questions;
  if (Array.isArray(list)) list.forEach((q) => { if (q && typeof q.id === 'string' && !fileOf[q.id]) fileOf[q.id] = file; });
});

const emptyRow = () => ({ total: 0, longest: 0, flagged: 0 });
const byFile = {};
const bySubject = {};
const all = emptyRow();
const flaggedList = [];
bank.questions.forEach((q) => {
  const cue = optionLengthCue(q);
  const file = fileOf[q.id];
  [byFile[file] || (byFile[file] = emptyRow()), bySubject[q.subject] || (bySubject[q.subject] = emptyRow()), all].forEach((row) => {
    row.total++;
    if (cue.longest) row.longest++;
    if (cue.flagged) row.flagged++;
  });
  if (cue.flagged) flaggedList.push({ file, id: q.id, correctLen: cue.correctLen, maxDistractorLen: cue.maxDistractorLen });
});

const pct = (part, total) => (total ? (100 * part / total).toFixed(1) : '0.0') + '%';

function table(title, label, rows) {
  const lines = [];
  if (markdown) {
    lines.push('### ' + title, '', '| ' + label + ' | Questions | Correct is longest | Flagged |', '|---|---:|---:|---:|');
    rows.forEach(([name, r]) => lines.push('| ' + name + ' | ' + r.total + ' | ' + pct(r.longest, r.total) + ' | ' +
      pct(r.flagged, r.total) + ' (' + r.flagged + ') |'));
    lines.push('');
  } else {
    const width = Math.max(label.length, ...rows.map(([name]) => name.length));
    lines.push(title, label.padEnd(width) + '  Questions  Longest  Flagged');
    rows.forEach(([name, r]) => lines.push(name.padEnd(width) + '  ' + String(r.total).padStart(9) + '  ' +
      pct(r.longest, r.total).padStart(7) + '  ' + (pct(r.flagged, r.total) + ' (' + r.flagged + ')').padStart(7)));
    lines.push('');
  }
  return lines.join('\n');
}

const subjectRows = subjects.filter((s) => bySubject[s.id]).map((s) => [s.id, bySubject[s.id]]);
const totalRow = ['TOTAL', all];
const out = [];
if (markdown) out.push('## Option length check', '');
out.push((markdown ? 'A' : 'Option length check: a') + ' question is flagged when the correct option is the longest AND at least 25% longer than the longest distractor.', '');
out.push(table('Per subject', 'Subject', subjectRows.concat([totalRow])));
out.push(table('Per file', 'File', Object.keys(byFile).sort().map((f) => [f, byFile[f]]).concat([totalRow])));
if (flags.has('--list') && flaggedList.length) {
  out.push(markdown ? '### Flagged questions\n' : 'Flagged questions (correct / longest distractor, characters):');
  flaggedList.forEach((x) => out.push((markdown ? '- `' + x.id + '` (' + x.file + '): ' : '  ' + x.id + ' (' + x.file + '): ') +
    x.correctLen + ' / ' + x.maxDistractorLen));
  out.push('');
}
if (bank.fileErrors.length || bank.invalid.length) {
  out.push('Skipped: ' + bank.fileErrors.length + ' unreadable file(s), ' + bank.invalid.length + ' invalid question(s) (see tools/validate.js).', '');
}
out.push(all.flagged + ' of ' + all.total + ' question(s) flagged.');
console.log(out.join('\n'));

process.exit(flags.has('--strict') && (all.flagged || bank.fileErrors.length || bank.invalid.length) ? 1 : 0);
