#!/usr/bin/env node
/*
 * Check every question file in data/questions/ with the same rules the app
 * uses (they are in validation.js, shared with the app).
 *
 * It reads the files directly from the folder, so it does not need index.json.
 *
 * Usage (from the project folder):
 *     node tools/validate.js
 * Exit code 0 = all good (warnings are printed but allowed),
 *           1 = at least one file is not valid JSON or one question is invalid.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { validateBank } = require('../validation.js');

const ROOT = path.join(__dirname, '..');
const QUESTIONS_DIR = path.join(ROOT, 'data', 'questions');

const subjects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'subjects.json'), 'utf8')).subjects || [];
const subjectById = {};
subjects.forEach((s) => { subjectById[s.id] = s; });

const files = fs.readdirSync(QUESTIONS_DIR)
  .filter((f) => f.toLowerCase().endsWith('.json') && f !== 'index.json')
  .sort();

const results = files.map((file) => {
  try {
    const text = fs.readFileSync(path.join(QUESTIONS_DIR, file), 'utf8');
    try {
      return { file, json: JSON.parse(text) };
    } catch (e) {
      return { file, error: 'JSON non valido: ' + e.message };
    }
  } catch (e) {
    return { file, error: e.message };
  }
});

const bank = validateBank(results, subjectById);

bank.warnings.forEach((w) => console.log('WARNING ' + w.file + ' #' + w.index + ' (' + w.id + '): ' + w.message));
bank.fileErrors.forEach((f) => console.log('ERROR   ' + f.file + ': ' + f.error));
bank.invalid.forEach((x) => console.log('ERROR   ' + x.file + ' #' + x.index + ' (' + x.id + '): ' + x.reasons.join('; ')));

const problems = bank.fileErrors.length + bank.invalid.length;
console.log('Checked ' + files.length + ' file(s), ' + (bank.questions.length + bank.invalid.length) + ' question(s): ' +
  bank.questions.length + ' valid, ' + bank.invalid.length + ' invalid, ' + bank.fileErrors.length + ' broken file(s), ' +
  bank.warnings.length + ' warning(s).');
console.log(problems ? 'FAILED' : 'OK');
process.exit(problems ? 1 : 0);
