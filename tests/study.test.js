/*
 * Tests for study.js (the study rules). Run from the project folder:
 *     node --test tests/
 * They also run in the GitHub Actions check before every deploy.
 */
'use strict';
process.env.TZ = 'Europe/Rome';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../study.js');

// Fixed local dates (Europe/Rome), so "different days" does not depend on when the tests run
const at = (iso) => new Date(iso).getTime();
const DAY1_MORNING = at('2026-09-20T09:00:00+02:00');
const DAY1_EVENING = at('2026-09-20T23:30:00+02:00');
const DAY2_EARLY = at('2026-09-21T00:30:00+02:00');   // 1 hour later, but the next day
const DAY3 = at('2026-09-22T10:00:00+02:00');

/** Saved data as written by the previous version of the app (version 1). */
function v1Store() {
  return {
    app: 'asmel-quiz', version: 1, profile: 'comunicazione',
    progress: {
      'l241-001': { attempts: 3, correct: 1, wrong: 2, lastCorrect: true, streak: 1, inErrors: true, lastAt: DAY1_MORNING },
      'l241-002': { attempts: 4, correct: 3, wrong: 1, lastCorrect: true, streak: 2, inErrors: false, lastAt: DAY1_EVENING },
      'l241-003': { attempts: 1, correct: 0, wrong: 1, lastCorrect: false, streak: 0, inErrors: true, lastAt: DAY1_MORNING },
      'l241-004': { attempts: 1, correct: 1, wrong: 0, lastCorrect: true, streak: 1, inErrors: false, lastAt: DAY1_MORNING },
      'acc-010': { attempts: 45, correct: 40, wrong: 5, lastCorrect: true, streak: 7, inErrors: false, lastAt: DAY1_MORNING },
      'old-no-date': { attempts: 2, correct: 2, wrong: 0, lastCorrect: true, streak: 2, inErrors: false }
    },
    flags: { 'l241-003': { note: 'ricontrollare art. 3', date: '2026-09-19' } },
    activeSim: { profile: 'comunicazione', startedAt: DAY1_MORNING, endAt: DAY1_MORNING + 3600000, items: [{ qid: 'l241-001', order: ['a', 'b', 'c', 'd'], answer: 'b' }], notices: [], index: 0 },
    lastSim: { date: '2026-09-18T10:00:00.000Z', profile: 'comunicazione', correct: 30, wrong: 20, blank: 10, total: 60, score: 30, threshold: 42, passed: false, bySubject: {}, notices: [], items: [] },
    simHistory: [{ date: '2026-09-18T10:00:00.000Z', profile: 'comunicazione', score: 30, correct: 30, total: 60, passed: false }]
  };
}

test('migration keeps every piece of old data', () => {
  const old = v1Store();
  const before = JSON.parse(JSON.stringify(old));
  const m = S.migrateStore(JSON.parse(JSON.stringify(old)), 'asmel-quiz');
  assert.equal(m.version, 2);
  assert.equal(m.profile, 'comunicazione');
  assert.deepEqual(m.flags, before.flags);
  assert.deepEqual(m.activeSim, before.activeSim);
  assert.deepEqual(m.lastSim, before.lastSim);
  assert.deepEqual(m.simHistory, before.simHistory);
  assert.deepEqual(Object.keys(m.progress).sort(), Object.keys(before.progress).sort());
  for (const id of Object.keys(before.progress)) {
    const o = before.progress[id], p = m.progress[id];
    for (const k of Object.keys(o)) assert.deepEqual(p[k], o[k], id + '.' + k);
    assert.ok(Array.isArray(p.h));
    assert.equal(p.h.length, Math.min(o.attempts, S.HISTORY_MAX), id + ' history length');
  }
  assert.deepEqual(m.settings, { dailySize: 30, examDate: null });
  assert.deepEqual(m.dailyHistory, []);
  assert.equal(m.activeDaily, null);
});

test('migration is idempotent and keeps unknown fields', () => {
  const once = S.migrateStore(Object.assign(v1Store(), { futureField: 42 }), 'asmel-quiz');
  const twice = S.migrateStore(JSON.parse(JSON.stringify(once)), 'asmel-quiz');
  assert.deepEqual(twice, once);
  assert.equal(twice.futureField, 42);
});

test('rebuilt history follows what version 1 knew', () => {
  const m = S.migrateStore(v1Store(), 'asmel-quiz');
  const ok = (id) => m.progress[id].h.map((e) => e[1]);
  // attempts 3, streak 1: ... wrong, correct
  assert.deepEqual(ok('l241-001'), [0, 0, 1]);
  // attempts 4, correct 3, streak 2: 1 older correct, then wrong, then 2 correct
  assert.deepEqual(ok('l241-002'), [1, 0, 1, 1]);
  assert.deepEqual(ok('l241-003'), [0]);
  // 45 answers -> last 30 kept; last 7 correct, the one before wrong, 22 older with 36/40 correct mix
  const h = ok('acc-010');
  assert.equal(h.length, 30);
  assert.deepEqual(h.slice(-8), [0, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(h.slice(0, 22).filter((x) => x === 1).length, Math.round(22 * 33 / 37));
  // The last answer keeps its real time; older ones are marked "day unknown"
  const e = m.progress['l241-002'].h;
  assert.deepEqual(e[e.length - 1], [DAY1_EVENING, 1]);
  assert.ok(e.slice(0, -1).every((x) => x[2] === 1));
  // No lastAt at all: every answer has an unknown day
  assert.ok(m.progress['old-no-date'].h.every((x) => x[2] === 1));
});

test('consolidated requires two correct answers on two different days', () => {
  const store = S.emptyStore('asmel-quiz');
  S.recordAnswer(store, 'q', true, DAY1_MORNING);
  S.recordAnswer(store, 'q', true, DAY1_EVENING);
  assert.equal(S.isConsolidated(store.progress.q), false, 'same day');
  S.recordAnswer(store, 'q', true, DAY2_EARLY);
  assert.equal(S.isConsolidated(store.progress.q), true, 'next day (even 1 hour later)');
  S.recordAnswer(store, 'q', false, DAY3);
  assert.equal(S.isConsolidated(store.progress.q), false, 'wrong answer breaks it');
});

test('a wrong answer between two days prevents consolidation', () => {
  const store = S.emptyStore('asmel-quiz');
  S.recordAnswer(store, 'q', true, DAY1_MORNING);
  S.recordAnswer(store, 'q', false, DAY1_EVENING);
  S.recordAnswer(store, 'q', true, DAY2_EARLY);
  assert.equal(S.isConsolidated(store.progress.q), false);
});

test('migrated answers never count as a different day', () => {
  const m = S.migrateStore(v1Store(), 'asmel-quiz');
  // streak 2 in version 1, but the day of the older answer is unknown
  assert.equal(S.isConsolidated(m.progress['l241-002']), false);
  assert.equal(S.isConsolidated(m.progress['old-no-date']), false);
  // One more correct answer on the same day as the last one: still not
  const same = S.migrateStore(v1Store(), 'asmel-quiz');
  S.recordAnswer(same, 'l241-004', true, DAY1_EVENING);
  assert.equal(S.isConsolidated(same.progress['l241-004']), false);
  // On a later day: yes
  S.recordAnswer(m, 'l241-004', true, DAY2_EARLY);
  assert.equal(S.isConsolidated(m.progress['l241-004']), true);
});

test('error review: a question leaves only when consolidated', () => {
  const store = S.emptyStore('asmel-quiz');
  S.recordAnswer(store, 'q', false, DAY1_MORNING);
  assert.equal(store.progress.q.inErrors, true);
  S.recordAnswer(store, 'q', true, DAY1_MORNING + 60000);
  S.recordAnswer(store, 'q', true, DAY1_EVENING);
  assert.equal(store.progress.q.inErrors, true, 'two correct the same day are not enough');
  S.recordAnswer(store, 'q', true, DAY2_EARLY);
  assert.equal(store.progress.q.inErrors, false);
  // Migrated question in the error pool keeps its place until consolidated
  const m = S.migrateStore(v1Store(), 'asmel-quiz');
  S.recordAnswer(m, 'l241-001', true, DAY1_EVENING);
  assert.equal(m.progress['l241-001'].inErrors, true);
  S.recordAnswer(m, 'l241-001', true, DAY2_EARLY);
  assert.equal(m.progress['l241-001'].inErrors, false);
});

test('history is capped, totals are not', () => {
  const store = S.emptyStore('asmel-quiz');
  for (let i = 0; i < 40; i++) S.recordAnswer(store, 'q', i % 2 === 0, DAY1_MORNING + i);
  assert.equal(store.progress.q.h.length, S.HISTORY_MAX);
  assert.equal(store.progress.q.attempts, 40);
});

/* ---------- Progress per subject ---------- */

function bank(subject, n, prefix) {
  return Array.from({ length: n }, (_, i) => ({ id: (prefix || subject) + '-' + i, subject }));
}

test('subject progress: copertura, consolidate, % corrette recenti over the last 30 answers', () => {
  const qs = bank('accesso', 5);
  const store = S.emptyStore('asmel-quiz');
  // 20 old wrong answers on q0, then 30 correct answers spread over q1..q3
  for (let i = 0; i < 20; i++) S.recordAnswer(store, 'accesso-0', false, DAY1_MORNING + i);
  for (let i = 0; i < 30; i++) S.recordAnswer(store, 'accesso-' + (1 + (i % 3)), true, DAY2_EARLY + i);
  S.recordAnswer(store, 'accesso-1', true, DAY3);
  const s = S.subjectProgress(qs, store.progress);
  assert.equal(s.total, 5);
  assert.equal(s.seen, 4);
  assert.equal(s.consolidated, 1, 'only accesso-1 has correct answers on two days');
  assert.equal(s.answers, 51);
  assert.equal(s.recentCount, 30);
  assert.equal(s.recentCorrect, 30);
  assert.equal(S.subjectProgress([], {}).recentRate, null);
});

/* ---------- Daily session ---------- */

function answer(store, qid, ok, t) { S.recordAnswer(store, qid, ok, t); }
function seededRng(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
const NOW = at('2026-09-24T08:00:00+02:00');

test('daily session with no answers yet: all new, spread across subjects', () => {
  const qs = bank('accesso', 20).concat(bank('privacy', 20), bank('reati-pa', 20));
  const d = S.buildDaily(qs, {}, 30, NOW, seededRng(1));
  assert.equal(d.items.length, 30);
  assert.deepEqual(d.counts, { errori: 0, deboli: 0, nuove: 30, altre: 0 });
  const per = {};
  d.items.forEach((x) => { per[x.q.subject] = (per[x.q.subject] || 0) + 1; });
  assert.deepEqual(per, { accesso: 10, privacy: 10, 'reati-pa': 10 });
});

test('daily session: 40% errors, 30% weak, rest new when all are available', () => {
  const qs = bank('accesso', 40).concat(bank('privacy', 40), bank('reati-pa', 40));
  const store = S.emptyStore('asmel-quiz');
  const past = at('2026-09-23T10:00:00+02:00');
  // accesso: 20 answered, 15 wrong (weakest); privacy: 20 answered, all correct; reati-pa untouched
  for (let i = 0; i < 20; i++) answer(store, 'accesso-' + i, i >= 15, past + i);
  for (let i = 0; i < 20; i++) answer(store, 'privacy-' + i, true, past + 100 + i);
  const d = S.buildDaily(qs, store.progress, 30, NOW, seededRng(2));
  assert.deepEqual(d.counts, { errori: 12, deboli: 9, nuove: 9, altre: 0 });
  assert.deepEqual(d.weakSubjects, ['accesso'], 'privacy is at 100%, not weak');
  const ids = d.items.map((x) => x.q.id);
  assert.equal(new Set(ids).size, 30, 'no duplicates');
  d.items.filter((x) => x.cat === 'errori').forEach((x) => assert.equal(store.progress[x.q.id].inErrors, true));
  d.items.filter((x) => x.cat === 'deboli').forEach((x) => assert.equal(x.q.subject, 'accesso'));
  d.items.filter((x) => x.cat === 'nuove').forEach((x) => assert.ok(!store.progress[x.q.id]));
});

test('daily session: missing errors pass their share to weak, then new', () => {
  const qs = bank('accesso', 40).concat(bank('privacy', 40));
  const store = S.emptyStore('asmel-quiz');
  // 3 errors only; no subject has 10 answers -> no weak subjects
  for (let i = 0; i < 3; i++) answer(store, 'accesso-' + i, false, NOW - 86400000);
  const d = S.buildDaily(qs, store.progress, 30, NOW, seededRng(3));
  assert.deepEqual(d.counts, { errori: 3, deboli: 0, nuove: 27, altre: 0 });
  assert.equal(d.items.length, 30);
});

test('daily session: no errors, weak subject short of questions', () => {
  const qs = bank('accesso', 12).concat(bank('privacy', 50));
  const store = S.emptyStore('asmel-quiz');
  // accesso: all 12 seen, wrong once then consolidated (correct on two days): weak, but no errors left
  for (let i = 0; i < 12; i++) {
    answer(store, 'accesso-' + i, false, NOW - 3 * 86400000);
    answer(store, 'accesso-' + i, true, NOW - 2 * 86400000);
    answer(store, 'accesso-' + i, true, NOW - 86400000);
  }
  assert.ok(qs.every((q) => !store.progress[q.id] || !store.progress[q.id].inErrors));
  const d = S.buildDaily(qs, store.progress, 30, NOW, seededRng(4));
  // errors (12) + weak (9) shares go to weak, which only has 12 questions; the rest are new
  assert.deepEqual(d.counts, { errori: 0, deboli: 12, nuove: 18, altre: 0 });
});

test('daily session: everything seen and no errors -> filled with other questions', () => {
  const qs = bank('accesso', 10);
  const store = S.emptyStore('asmel-quiz');
  qs.forEach((q) => answer(store, q.id, true, NOW - 86400000));
  const d = S.buildDaily(qs, store.progress, 30, NOW, seededRng(5));
  assert.equal(d.items.length, 10, 'bank smaller than the session');
  assert.deepEqual(d.counts, { errori: 0, deboli: 0, nuove: 0, altre: 10 });
});

test('daily session: empty bank gives an empty session', () => {
  const d = S.buildDaily([], {}, 30, NOW);
  assert.equal(d.items.length, 0);
});

test('daily session: errors not answered today come first', () => {
  const qs = bank('accesso', 30);
  const store = S.emptyStore('asmel-quiz');
  answer(store, 'accesso-0', false, NOW - 60000);          // today
  answer(store, 'accesso-1', false, NOW - 3 * 86400000);   // 3 days ago
  const d = S.buildDaily(qs, store.progress, 5, NOW, seededRng(6));
  // 5 -> 2 errors, 2 weak (none) and 1 new: both errors fit
  assert.equal(d.counts.errori, 2);
  const one = S.buildDaily(qs, store.progress, 2, NOW, seededRng(6));
  // 2 -> 1 error: the one not answered today
  assert.deepEqual(one.items.filter((x) => x.cat === 'errori').map((x) => x.q.id), ['accesso-1']);
});

/* ---------- Exam plan and estimate ---------- */

const RULES = {
  total_questions: 60,
  blocks: { specific: 30, common_law: 25, common_lang_it: 5 },
  english: { subject: 'inglese', assumed_questions: 2 },
  pass_threshold: 42,
  scoring: { correct: 1, wrong: 0, blank: 0 }
};
const LAW = ['diritto-pubblico', 'diritto-amministrativo-enti-locali', 'contratti-pubblici', 'pubblico-impiego', 'trasparenza-anticorruzione', 'accesso', 'diritto-ue', 'reati-pa', 'contabilita-pubblica', 'privacy'];
const BLOCKS = { specific: ['comunicazione-pa-l150', 'social-media', 'teoria-tecniche-informazione'], common_law: LAW, common_lang_it: ['inglese', 'informatica'] };

test('exam plan: English removed from its block, the rest spread evenly', () => {
  const plan = S.examPlan(RULES, BLOCKS);
  assert.equal(plan.english, 2);
  assert.equal(plan.perBlock.common_lang_it.need, 3);
  assert.deepEqual(plan.perBlock.common_lang_it.subjects, ['informatica']);
  assert.equal(plan.expected.informatica, 3);
  assert.equal(plan.expected['comunicazione-pa-l150'], 10);
  assert.equal(plan.expected.accesso, 2.5);
  assert.equal(plan.expected.inglese, undefined);
  const sum = Object.values(plan.expected).reduce((a, b) => a + b, 0);
  assert.equal(sum + plan.english, 60);
  // Simulation draws 58 questions
  assert.equal(Object.values(plan.perBlock).reduce((a, b) => a + b.need, 0), 58);
});

test('estimate: only subjects with at least 10 answers, plus English as correct', () => {
  const plan = S.examPlan(RULES, BLOCKS);
  const stats = {
    'comunicazione-pa-l150': { answers: 40, recentRate: 0.8 },   // 10 expected -> 8
    'diritto-amministrativo-enti-locali': { answers: 12, recentRate: 0.6 }, // 2.5 -> 1.5
    accesso: { answers: 9, recentRate: 1 }                          // not enough answers
  };
  const e = S.estimateScore(RULES, plan, stats);
  assert.equal(e.covered, 12.5);
  assert.equal(e.score, 2 + 8 + 1.5);
  assert.equal(e.missing.length, 14 - 2); // 3 specific + 10 law + informatica, minus 2 estimated
  assert.equal(e.partial, true);
  assert.equal(e.threshold, 42);
});

test('estimate is not partial from 30 covered questions', () => {
  const plan = S.examPlan(RULES, BLOCKS);
  const stats = {};
  BLOCKS.specific.forEach((id) => { stats[id] = { answers: 10, recentRate: 0.5 }; });
  const e = S.estimateScore(RULES, plan, stats);
  assert.equal(e.covered, 30);
  assert.equal(e.partial, false);
  assert.equal(e.score, 2 + 15);
});

test('days until the exam', () => {
  assert.equal(S.daysUntil('2026-09-30', NOW), 6);
  assert.equal(S.daysUntil('2026-09-24', NOW), 0);
  assert.equal(S.daysUntil('2026-09-20', NOW), -4);
  assert.equal(S.daysUntil('', NOW), null);
  assert.equal(S.daysUntil(null, NOW), null);
});
