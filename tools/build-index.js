#!/usr/bin/env node
/*
 * Build data/questions/index.json: the list of question files the app loads.
 *
 * It lists every .json file in data/questions/ (except index.json itself),
 * in alphabetical order. The app cannot look inside a folder on its own,
 * so this list is how it knows which files exist.
 *
 * Never edit index.json by hand: it is not in the repository. The GitHub
 * Actions deploy runs this script before publishing the site. To try the
 * app on a computer, run it once from the project folder:
 *     node tools/build-index.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const QUESTIONS_DIR = path.join(__dirname, '..', 'data', 'questions');
const INDEX = 'index.json';

const files = fs.readdirSync(QUESTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.json') && d.name !== INDEX)
  .map((d) => d.name)
  .sort();

fs.writeFileSync(path.join(QUESTIONS_DIR, INDEX), JSON.stringify({ files }, null, 2) + '\n');
console.log('Wrote data/questions/' + INDEX + ' with ' + files.length + ' file(s):');
files.forEach((f) => console.log('  ' + f));
