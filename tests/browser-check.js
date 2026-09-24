#!/usr/bin/env node
/*
 * End-to-end check of the app in a real browser (Chromium, via Playwright).
 * Not part of the automatic deploy check: run it by hand after changing the app.
 *
 *   node tools/build-index.js
 *   python3 -m http.server 8765 &
 *   node tests/browser-check.js            (BASE_URL=http://localhost:8765/ by default)
 *
 * What it checks:
 *   1. saved data from the previous version (v1) survives the update
 *   2. English never appears outside the simulation label and the estimate
 *      (a fake English question is injected into the bank to be sure)
 *   3. the daily session works with no errors yet, and the home then shows
 *      "Sessione di oggi completata"
 *   4. "consolidate" on the home needs correct answers on two different days
 *      (the browser clock is moved forward)
 *   5. no horizontal scroll at 360px, light and dark; screenshots are saved
 *      in tests/screenshots/ (not committed)
 */
'use strict';
const fs = require('fs');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// Correct option id for each question text (options are shuffled, but their data-id is the option id)
const correctByText = {};
let studyCount = 0; // questions usable in practice (English is only in the injected file; da_rivedere excluded)
for (const f of fs.readdirSync(path.join(ROOT, 'data/questions'))) {
  if (f === 'index.json') continue;
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions', f), 'utf8')).forEach((q) => {
    correctByText[q.question.trim()] = q.correct;
    if (q.status !== 'da_rivedere') studyCount++;
  });
}
const ENGLISH_Q = {
  id: 'eng-test-001', subject: 'inglese', question: 'ENGLISH-TEST: choose the correct form',
  options: [{ id: 'a', text: 'He go', why_wrong: 'x' }, { id: 'b', text: 'He goes', why_wrong: null }],
  correct: 'b', explanation: 'Third person.', source: null, source_date: null, status: 'rivista'
};
correctByText[ENGLISH_Q.question] = 'b';

const DAY = 86400000;
const T0 = new Date('2026-09-20T09:00:00+02:00').getTime();

/** Saved data as the previous version of the app wrote it. */
const V1 = {
  app: 'asmel-quiz', version: 1, profile: 'comunicazione',
  progress: {
    'l241-acc-001': { attempts: 3, correct: 1, wrong: 2, lastCorrect: true, streak: 1, inErrors: true, lastAt: T0 },
    'l241-acc-002': { attempts: 4, correct: 3, wrong: 1, lastCorrect: true, streak: 2, inErrors: false, lastAt: T0 },
    'l241-acc-003': { attempts: 2, correct: 0, wrong: 2, lastCorrect: false, streak: 0, inErrors: true, lastAt: T0 },
    'l241-acc-004': { attempts: 12, correct: 9, wrong: 3, lastCorrect: true, streak: 4, inErrors: false, lastAt: T0 },
    'l150-002': { attempts: 1, correct: 1, wrong: 0, lastCorrect: true, streak: 1, inErrors: false, lastAt: T0 },
    'eng-test-001': { attempts: 1, correct: 0, wrong: 1, lastCorrect: false, streak: 0, inErrors: true, lastAt: T0 }
  },
  flags: { 'l241-acc-003': { note: 'ricontrollare', date: '2026-09-19' } },
  activeSim: null,
  lastSim: null,
  simHistory: [{ date: '2026-09-18T10:00:00.000Z', profile: 'comunicazione', score: 30, correct: 30, total: 60, passed: false }]
};

let failures = 0;
function check(cond, msg) {
  console.log((cond ? 'ok     ' : 'FAILED ') + msg);
  if (!cond) failures++;
}

async function newPage(browser, scheme, now) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.clock.install({ time: now });
  // Inject one English question into the bank, without touching data/questions/
  await page.route('**/data/questions/index.json', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.files.push('zz-english-test.json');
    await route.fulfill({ response: res, json });
  });
  await page.route('**/data/questions/zz-english-test.json', (route) => route.fulfill({ json: [ENGLISH_Q] }));
  page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); failures++; });
  return { context, page };
}

async function store(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('asmel-quiz-v1')));
}
async function text(page) { return page.locator('main').innerText(); }
async function noHScroll(page, label) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 360, 'no horizontal scroll at 360px: ' + label + ' (' + w + 'px)');
}
async function goHome(page) { await page.click('.topbar-home'); await page.waitForSelector('.subject-list, .menu-btn'); }
async function answerCurrent(page, wantCorrect) {
  const q = (await page.locator('.q-text').first().innerText()).trim();
  const correct = correctByText[q];
  if (!correct) throw new Error('unknown question: ' + q);
  const sel = wantCorrect ? '[data-action="answer"][data-id="' + correct + '"]' : '[data-action="answer"]:not([data-id="' + correct + '"])';
  await page.locator(sel).first().click();
}
const noEnglish = (t) => !/ingles|english/i.test(t);

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* 1. Migration of real-looking v1 data */
  {
    const { context, page } = await newPage(browser, 'light', T0 + DAY);
    await page.goto(BASE);
    await page.evaluate((v1) => localStorage.setItem('asmel-quiz-v1', JSON.stringify(v1)), V1);
    await page.reload();
    await page.waitForSelector('.subject-list');
    const s = await store(page);
    check(s.version === 2, 'store migrated to version 2');
    check(Object.keys(V1.progress).every((id) => ['attempts', 'correct', 'wrong', 'streak', 'inErrors', 'lastAt'].every((k) => s.progress[id][k] === V1.progress[id][k])), 'every answer total kept');
    check(Object.keys(V1.progress).every((id) => s.progress[id].h.length === V1.progress[id].attempts), 'history rebuilt for every question');
    check(JSON.stringify(s.flags) === JSON.stringify(V1.flags), 'flags kept');
    check(JSON.stringify(s.simHistory) === JSON.stringify(V1.simHistory), 'simulation history kept');
    const copy = await page.evaluate(() => localStorage.getItem('asmel-quiz-v1-before-v2'));
    check(copy && JSON.stringify(JSON.parse(copy)) === JSON.stringify(V1), 'untouched copy of the old data saved');
    const home = await text(page);
    check(/Copertura/.test(home) && /Consolidate/.test(home), 'home shows progress per subject');
    check(/Materie specifiche[\s\S]*Materie comuni/.test(home), 'specific subjects before common subjects');
    check(/Nessuna domanda ancora/.test(home), 'empty subjects greyed out with "Nessuna domanda ancora"');
    check(/Diritto di accesso[\s\S]*?4\/30[\s\S]*?0\/30/.test(home), 'accesso: 4/30 seen, 0/30 consolidated (da_rivedere excluded)');
    check(/Stima: \d+\/60 · basata su 2,5 quesiti su 60 · materie senza dati: 13/.test(home), 'estimate line with coverage');
    check(/Soglia: 42/.test(home) && /Stima parziale/i.test(home), 'threshold and "Stima parziale"');
    check(/(^|\D)2 domande da ripassare/.test(home), 'English question not in error review (2, not 3)');
    await context.close();
  }

  /* 2. English only in the simulation label and the estimate */
  {
    const { context, page } = await newPage(browser, 'light', T0 + DAY);
    await page.goto(BASE);
    await page.evaluate((v1) => localStorage.setItem('asmel-quiz-v1', JSON.stringify(v1)), V1);
    await page.reload();
    await page.waitForSelector('.subject-list');
    const home = await text(page);
    const homeWithoutEstimate = home.replace(/Include \d+ quesiti di inglese considerati corretti \(non studiato\)\./, '');
    check(noEnglish(homeWithoutEstimate), 'home: English only in the estimate note');
    for (const screen of ['practiceSetup', 'errorsSetup', 'weakSetup', 'stats', 'settings', 'diagnostics']) {
      await page.click('[data-screen="' + screen + '"]');
      check(noEnglish(await text(page)), screen + ': no English');
      await goHome(page);
    }
    // Error review session never contains the English question
    await page.click('[data-screen="errorsSetup"]');
    await page.click('[data-action="start-errors"]');
    for (let i = 0; i < 10 && await page.locator('.q-text').count(); i++) {
      check(noEnglish(await text(page)), 'error review question ' + (i + 1) + ': no English');
      await answerCurrent(page, true);
      const next = page.locator('[data-action="next"]');
      const label = await next.innerText();
      await next.click();
      if (/risultato/.test(label)) break;
    }
    await goHome(page);
    // Practice on all subjects
    await page.click('[data-screen="practiceSetup"]');
    await page.click('[data-action="check-all"]');
    await page.click('input[name="count"][value="all"] + span');
    await page.click('[data-action="start-practice"]');
    const total = Number((await page.locator('.q-meta span').first().innerText()).match(/di (\d+)/)[1]);
    check(total === studyCount, 'practice on all subjects: ' + studyCount + ' questions (English and da_rivedere excluded), got ' + total);
    await goHome(page);
    // Simulation: 58 drawn, 2 English counted correct
    await page.click('[data-screen="simSetup"]');
    const setup = await text(page);
    check(/58 domande da svolgere/.test(setup), 'simulation setup: 58 questions to answer');
    check(/Inglese: 2 quesiti considerati corretti \(non studiato\)/.test(setup), 'simulation setup: English label');
    await page.click('[data-action="start-sim"]');
    page.once('dialog', (d) => d.accept());
    const simQs = await page.locator('.nav-grid button').count();
    await page.click('[data-action="sim-submit"]');
    await page.waitForSelector('.big-score');
    const res = await text(page);
    check(/Inglese: 2 quesiti considerati corretti \(non studiato\)/.test(res), 'simulation result: English label');
    check(/2 \/ 60/.test(res) && /soglia 42/.test(res), 'simulation result: blank test scores 2 (English) out of 60, threshold 42');
    const table = await page.locator('table').first().innerText();
    check(noEnglish(table), 'simulation result: no English row in the per-subject table');
    console.log('       (simulation drew ' + simQs + ' questions: the bank is still small)');
    await page.screenshot({ path: path.join(SHOTS, 'sim-result-light.png'), fullPage: false });
    await context.close();
  }

  /* 3 + 4. Daily session with no errors yet; consolidation needs two days */
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(browser, scheme, T0);
    await page.goto(BASE);
    await page.evaluate(() => localStorage.setItem('asmel-quiz-v1', JSON.stringify({ app: 'asmel-quiz', version: 1, profile: 'comunicazione', progress: {}, flags: {}, activeSim: null, lastSim: null, simHistory: [] })));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('asmel-quiz-v1')); s.version = 2; s.settings = { dailySize: 30, examDate: '2026-10-15' }; localStorage.setItem('asmel-quiz-v1', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('.subject-list');
    let home = await text(page);
    check(/Mancano 25 giorni alla prova/.test(home), scheme + ': countdown');
    check(/Stima non ancora disponibile/.test(home), scheme + ': no estimate without data');
    await page.screenshot({ path: path.join(SHOTS, 'home-empty-' + scheme + '.png'), fullPage: true });
    await noHScroll(page, 'home ' + scheme);

    await page.click('[data-action="start-daily"]');
    const first = await text(page);
    check(/Oggi: 30 mai viste/.test(first), scheme + ': daily session with no errors is 30 new questions');
    await page.screenshot({ path: path.join(SHOTS, 'daily-question-' + scheme + '.png'), fullPage: true });
    await noHScroll(page, 'daily question ' + scheme);
    // Leave and resume: the session is saved
    await answerCurrent(page, true);
    await goHome(page);
    check(/Riprendi la sessione del giorno/.test(await text(page)), scheme + ': daily session can be resumed');
    await page.click('[data-action="resume-daily"]');
    let answered = 1;
    await page.click('[data-action="next"]');
    while (true) {
      await answerCurrent(page, answered % 3 !== 0);
      answered++;
      if (answered === 2) { await page.screenshot({ path: path.join(SHOTS, 'daily-feedback-' + scheme + '.png'), fullPage: true }); await noHScroll(page, 'feedback ' + scheme); }
      const next = page.locator('[data-action="next"]');
      const label = await next.innerText();
      await next.click();
      if (/risultato/.test(label)) break;
    }
    const end = await text(page);
    check(/Sessione del giorno completata/.test(end) && /Corrette: 21 · Sbagliate: 9/.test(end) && /Materie toccate/.test(end), scheme + ': daily summary (21 correct, 9 wrong, subjects touched)');
    await page.screenshot({ path: path.join(SHOTS, 'daily-end-' + scheme + '.png') });
    await goHome(page);
    home = await text(page);
    check(/Sessione di oggi completata/.test(home), scheme + ': home says "Sessione di oggi completata"');
    check(/Consolidate[\s\S]*?0\/\d+/.test(home) && !/Consolidate\s*[1-9]/.test(home), scheme + ': nothing consolidated on day 1');
    check(/(^|\D)9 domande da ripassare/.test(home), scheme + ': 9 wrong answers in error review');

    // Same day, second session allowed
    await page.click('[data-action="start-daily"]');
    check(/Oggi: 12 dal ripasso errori/.test(await text(page)) || /dal ripasso errori/.test(await text(page)), scheme + ': second session the same day includes errors');
    page.once('dialog', (d) => d.accept());
    await page.click('[data-action="end-session"]');
    await goHome(page);

    // Next day: answer every seen question correctly -> the 20 correct ones become consolidated
    await page.clock.setSystemTime(T0 + DAY);
    await page.reload();
    await page.waitForSelector('.subject-list');
    const s = await store(page);
    const correctIds = Object.keys(s.progress).filter((id) => s.progress[id].lastCorrect && s.progress[id].attempts === 1);
    await page.click('[data-screen="practiceSetup"]');
    await page.click('[data-action="check-all"]');
    await page.click('input[name="count"][value="all"] + span');
    await page.click('[data-action="start-practice"]');
    // Practice puts unseen questions first; answer everything correctly until done
    while (true) {
      await answerCurrent(page, true);
      const next = page.locator('[data-action="next"]');
      const label = await next.innerText();
      await next.click();
      if (/risultato/.test(label)) break;
    }
    const s2 = await store(page);
    const consolidated = correctIds.filter((id) => {
      const h = s2.progress[id].h; return h.length >= 2 && h[h.length - 1][1] && h[h.length - 2][1];
    });
    check(consolidated.length === correctIds.length, scheme + ': questions right on day 1 and day 2 have two correct answers');
    await goHome(page);
    home = await text(page);
    const consNums = [...home.matchAll(/Consolidate\s*(\d+)\/(\d+)/g)].map((m) => Number(m[1]));
    check(consNums.reduce((a, b) => a + b, 0) === correctIds.length, scheme + ': home counts ' + correctIds.length + ' consolidated questions (got ' + consNums.reduce((a, b) => a + b, 0) + ')');
    check(/(^|\D)9 domande da ripassare/.test(home), scheme + ': wrong on day 1, right on day 2: still in error review (one correct answer is not enough)');
    await page.screenshot({ path: path.join(SHOTS, 'home-data-' + scheme + '.png'), fullPage: true });
    await noHScroll(page, 'home with data ' + scheme);
    await page.click('[data-screen="settings"]');
    await page.screenshot({ path: path.join(SHOTS, 'settings-' + scheme + '.png'), fullPage: true });
    await noHScroll(page, 'settings ' + scheme);
    await context.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nAll browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
