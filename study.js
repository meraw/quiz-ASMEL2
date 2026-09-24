/*
 * Quiz ASMEL - study logic
 *
 * The rules that organise the study, kept apart from the screens so they can
 * be tested on the command line (node --test tests/). Nothing in this file
 * touches the page or localStorage: every function gets the data it needs
 * and returns a result.
 *
 *   - migrateStore:   bring saved data from older versions to the current one
 *   - recordAnswer:   update a question's statistics after an answer
 *   - isConsolidated: last two answers correct, on two different days
 *   - subjectProgress:copertura, consolidate, % corrette recenti
 *   - buildDaily:     questions of the "Sessione del giorno"
 *   - estimateScore:  "Stima" of the exam score
 *
 * Used by the app (app.js) and by the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizStudy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORE_VERSION = 2;
  const HISTORY_MAX = 30;      // answers kept per question (enough for "last 30 answers of a subject")
  const RECENT_ANSWERS = 30;   // % corrette recenti: last 30 answers of a subject
  const MIN_ANSWERS = 10;      // answers a subject needs to count as weak or be estimated
  const DEFAULT_SETTINGS = { dailySize: 30, examDate: null };

  /** Local calendar day of a timestamp, as YYYY-MM-DD (the phone's day, not UTC). */
  function localDay(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function shuffle(list, rng) {
    const r = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------------------------------------------------------------
   * Saved data
   * ---------------------------------------------------------------------
   * progress[questionId] = {
   *   attempts, correct, wrong,  totals since the first answer
   *   lastCorrect, streak, lastAt,
   *   inErrors,                  in "Ripasso errori"
   *   h: [[time, ok, unknownDay], ...]
   *                              the last HISTORY_MAX answers, oldest first:
   *                              time in ms, ok 1/0; unknownDay 1 marks answers
   *                              given before version 2, whose day is unknown
   * }
   * ------------------------------------------------------------------- */

  /**
   * Rebuild an approximate answer history for a question saved by version 1,
   * which only kept totals. What is known: the last `streak` answers were
   * correct, the one before them was wrong, and the last answer was given at
   * `lastAt`. Older answers are spread in proportion to the totals. Only the
   * last answer keeps its real day; the others are marked "day unknown", so
   * they never count as proof of "two different days".
   */
  function rebuildHistory(p) {
    const attempts = Math.max(0, p.attempts | 0);
    const correct = Math.min(attempts, Math.max(0, p.correct | 0));
    const wrong = Math.min(attempts - correct, Math.max(0, p.wrong | 0));
    if (!attempts) return [];
    let streak = Math.min(Math.max(0, p.streak | 0), correct);
    if (p.lastCorrect === false) streak = 0;
    const wrongBefore = wrong > 0 && attempts > streak ? 1 : 0;
    const olderCorrect = correct - streak;
    const olderWrong = wrong - wrongBefore;
    const older = olderCorrect + olderWrong;

    // Newest first, then reversed
    const newestFirst = [];
    for (let i = 0; i < streak && newestFirst.length < HISTORY_MAX; i++) newestFirst.push(1);
    if (wrongBefore && newestFirst.length < HISTORY_MAX) newestFirst.push(0);
    const room = Math.min(older, HISTORY_MAX - newestFirst.length);
    const keepCorrect = older ? Math.round(room * olderCorrect / older) : 0;
    // Interleave so the kept part has the same mix as all the older answers
    for (let i = 0; i < room; i++) {
      newestFirst.push(Math.floor((i + 1) * keepCorrect / room) > Math.floor(i * keepCorrect / room) ? 1 : 0);
    }
    const t = typeof p.lastAt === 'number' && isFinite(p.lastAt) ? p.lastAt : 0;
    return newestFirst.reverse().map((ok, i, all) => (i === all.length - 1 && t ? [t, ok] : [t, ok, 1]));
  }

  function emptyStore(appId) {
    return {
      app: appId, version: STORE_VERSION, profile: null, progress: {}, flags: {},
      activeSim: null, lastSim: null, simHistory: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      activeDaily: null, dailyHistory: []
    };
  }

  /**
   * Bring saved data (from localStorage or a backup) to the current version.
   * Nothing is removed: unknown fields are kept as they are.
   */
  function migrateStore(raw, appId) {
    const store = Object.assign(emptyStore(appId), raw && typeof raw === 'object' ? raw : {});
    if (!store.progress || typeof store.progress !== 'object') store.progress = {};
    if (!store.flags || typeof store.flags !== 'object') store.flags = {};
    if (!Array.isArray(store.simHistory)) store.simHistory = [];
    if (!Array.isArray(store.dailyHistory)) store.dailyHistory = [];
    store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings && typeof store.settings === 'object' ? store.settings : {});

    Object.keys(store.progress).forEach((qid) => {
      const p = store.progress[qid];
      if (!p || typeof p !== 'object') { delete store.progress[qid]; return; }
      if (!Array.isArray(p.h)) p.h = rebuildHistory(p);
    });
    store.version = STORE_VERSION;
    return store;
  }

  /** The last two answers were both correct AND given on two different (known) days. */
  function isConsolidated(p) {
    const h = p && p.h;
    if (!h || h.length < 2) return false;
    const a = h[h.length - 2], b = h[h.length - 1];
    return a[1] === 1 && b[1] === 1 && !a[2] && !b[2] && localDay(a[0]) !== localDay(b[0]);
  }

  /** Update the statistics of one question after an answer. */
  function recordAnswer(store, qid, isCorrect, now) {
    const t = now == null ? Date.now() : now;
    const p = store.progress[qid] || { attempts: 0, correct: 0, wrong: 0, lastCorrect: null, streak: 0, inErrors: false, h: [] };
    if (!Array.isArray(p.h)) p.h = rebuildHistory(p);
    p.attempts++;
    p.lastAt = t;
    p.lastCorrect = isCorrect;
    p.h.push([t, isCorrect ? 1 : 0]);
    if (p.h.length > HISTORY_MAX) p.h.splice(0, p.h.length - HISTORY_MAX);
    if (isCorrect) {
      p.correct++;
      p.streak++;
      // A question leaves "Ripasso errori" when it is consolidated
      if (p.inErrors && isConsolidated(p)) p.inErrors = false;
    } else {
      p.wrong++;
      p.streak = 0;
      p.inErrors = true;
    }
    store.progress[qid] = p;
    return p;
  }

  /* ---------------------------------------------------------------------
   * Progress per subject
   * ------------------------------------------------------------------- */

  /** The last `n` answers given to a set of questions (newest first). */
  function recentAnswers(questions, progress, n) {
    const all = [];
    questions.forEach((q) => {
      const p = progress[q.id];
      if (!p || !p.h) return;
      p.h.forEach((e, i) => all.push({ t: e[0], i, ok: e[1] === 1 }));
    });
    all.sort((a, b) => b.t - a.t || b.i - a.i);
    return all.slice(0, n == null ? RECENT_ANSWERS : n);
  }

  /**
   * For the questions of one subject (da_rivedere already excluded):
   * total, seen, consolidated, answers (all time), recent answers and % correct.
   */
  function subjectProgress(questions, progress) {
    let seen = 0, consolidated = 0, answers = 0;
    questions.forEach((q) => {
      const p = progress[q.id];
      if (!p || !p.attempts) return;
      seen++;
      answers += p.attempts;
      if (isConsolidated(p)) consolidated++;
    });
    const recent = recentAnswers(questions, progress);
    const recentCorrect = recent.filter((a) => a.ok).length;
    return {
      total: questions.length, seen, consolidated, answers,
      recentCount: recent.length, recentCorrect,
      recentRate: recent.length ? recentCorrect / recent.length : null
    };
  }

  /* ---------------------------------------------------------------------
   * Exam blocks: how many questions each subject is expected to have
   * ------------------------------------------------------------------- */

  /**
   * rules: the "simulation" object of profiles.json
   * blockSubjects: { blockName: [subject ids of that block for the profile] }
   *                (the English subject included, if present in the block)
   * Returns { english, perBlock: {block: {need, subjects}}, expected: {subjectId: n} }
   * The English questions are removed from their block; the rest of the block
   * is spread evenly across its other subjects.
   */
  function examPlan(rules, blockSubjects) {
    const eng = rules.english || {};
    const engSubject = eng.subject || null;
    const englishAssumed = Math.max(0, Number(eng.assumed_questions) || 0);
    const perBlock = {};
    const expected = {};
    let english = 0;
    Object.keys(rules.blocks).forEach((block) => {
      const all = blockSubjects[block] || [];
      const hasEnglish = engSubject && all.includes(engSubject);
      const eng = hasEnglish ? Math.min(englishAssumed, rules.blocks[block]) : 0;
      english += eng;
      const subjects = all.filter((id) => id !== engSubject);
      const need = rules.blocks[block] - eng;
      perBlock[block] = { need, subjects };
      subjects.forEach((id) => { expected[id] = subjects.length ? need / subjects.length : 0; });
    });
    return { english, englishSubject: engSubject, perBlock, expected };
  }

  /**
   * "Stima": for each subject with at least MIN_ANSWERS answers,
   * expected questions × recent % correct; subjects with fewer answers are
   * not estimated. The assumed English questions count as correct.
   * statsById: { subjectId: result of subjectProgress }
   */
  function estimateScore(rules, plan, statsById) {
    const pts = rules.scoring || { correct: 1, wrong: 0, blank: 0 };
    let score = plan.english * pts.correct;
    let covered = 0;
    const missing = [];
    Object.keys(plan.expected).forEach((id) => {
      const s = statsById[id];
      const n = plan.expected[id];
      if (!s || s.answers < MIN_ANSWERS || s.recentRate == null) { missing.push(id); return; }
      covered += n;
      score += n * (s.recentRate * pts.correct + (1 - s.recentRate) * pts.wrong);
    });
    return {
      score, covered, missing, english: plan.english,
      total: rules.total_questions, threshold: rules.pass_threshold,
      partial: covered < 30
    };
  }

  /* ---------------------------------------------------------------------
   * Sessione del giorno
   * ------------------------------------------------------------------- */

  /**
   * questions: the questions the session may use (profile subjects, English
   *            and da_rivedere already excluded)
   * Composition, in this order, each category passing what it lacks to the next:
   *   ~40% "errori"  - questions in Ripasso errori (not answered today first)
   *   ~30% "deboli"  - questions of the weakest subjects (lowest recent %
   *                    correct among subjects with at least MIN_ANSWERS answers)
   *   rest "nuove"   - never seen questions, spread across subjects
   * If all three together are still short, the session is filled with
   * other questions (not consolidated first, least recently answered first).
   * Returns { items: [{ q, cat }], counts: { errori, deboli, nuove, altre }, weakSubjects }
   */
  function buildDaily(questions, progress, size, now, rng) {
    const t = now == null ? Date.now() : now;
    const today = localDay(t);
    const N = Math.max(1, size | 0);
    const target = { errori: Math.round(N * 0.4), deboli: Math.round(N * 0.3) };
    target.nuove = N - target.errori - target.deboli;

    const bySubject = {};
    questions.forEach((q) => { (bySubject[q.subject] || (bySubject[q.subject] = [])).push(q); });
    const lastAt = (q) => (progress[q.id] && progress[q.id].lastAt) || 0;
    const seen = (q) => !!(progress[q.id] && progress[q.id].attempts);
    const byOldest = (list) => shuffle(list, rng).sort((a, b) => lastAt(a) - lastAt(b));

    // Errors: those not answered today first (a second correct answer today cannot consolidate them)
    const errors = questions.filter((q) => progress[q.id] && progress[q.id].inErrors);
    const errorList = byOldest(errors.filter((q) => localDay(lastAt(q)) !== today))
      .concat(byOldest(errors.filter((q) => localDay(lastAt(q)) === today)));

    // Weakest subjects: at most 3, below 100% recent correct
    const weakSubjects = Object.keys(bySubject)
      .map((id) => ({ id, s: subjectProgress(bySubject[id], progress) }))
      .filter((x) => x.s.answers >= MIN_ANSWERS && x.s.recentRate != null && x.s.recentRate < 1)
      .sort((a, b) => a.s.recentRate - b.s.recentRate || b.s.answers - a.s.answers)
      .slice(0, 3)
      .map((x) => x.id);
    const weakLists = weakSubjects.map((id) => {
      const qs = bySubject[id];
      const lastWrong = qs.filter((q) => seen(q) && progress[q.id].lastCorrect === false);
      const unseen = qs.filter((q) => !seen(q));
      const open = qs.filter((q) => seen(q) && progress[q.id].lastCorrect !== false && !isConsolidated(progress[q.id]));
      const done = qs.filter((q) => seen(q) && progress[q.id].lastCorrect !== false && isConsolidated(progress[q.id]));
      return byOldest(lastWrong).concat(shuffle(unseen, rng), byOldest(open), byOldest(done));
    });
    const weakList = roundRobin(weakLists);

    // New: least covered subjects first, then round robin
    const newLists = Object.keys(bySubject)
      .map((id) => ({ id, qs: bySubject[id], cov: bySubject[id].filter(seen).length / bySubject[id].length }))
      .sort((a, b) => a.cov - b.cov || (rng || Math.random)() - 0.5)
      .map((x) => shuffle(x.qs.filter((q) => !seen(q)), rng));
    const newList = roundRobin(newLists);

    const used = new Set();
    const items = [];
    const counts = { errori: 0, deboli: 0, nuove: 0, altre: 0 };
    function take(list, k, cat) {
      let n = 0;
      for (let i = 0; i < list.length && n < k && items.length < N; i++) {
        const q = list[i];
        if (used.has(q.id)) continue;
        used.add(q.id);
        items.push({ q, cat });
        counts[cat]++;
        n++;
      }
      return n;
    }
    let carry = 0;
    ['errori', 'deboli', 'nuove'].forEach((cat) => {
      const want = target[cat] + carry;
      const list = cat === 'errori' ? errorList : cat === 'deboli' ? weakList : newList;
      carry = want - take(list, want, cat);
    });
    if (items.length < N) {
      // Still short: more errors, more weak questions, then anything else
      take(errorList, N, 'errori');
      take(weakList, N, 'deboli');
      const rest = questions.filter((q) => !used.has(q.id));
      take(byOldest(rest.filter((q) => !isConsolidated(progress[q.id]))).concat(byOldest(rest.filter((q) => isConsolidated(progress[q.id])))), N, 'altre');
    }
    return { items: shuffle(items, rng), counts, weakSubjects };
  }

  function roundRobin(lists) {
    const out = [];
    const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
    for (let i = 0; i < max; i++) lists.forEach((l) => { if (i < l.length) out.push(l[i]); });
    return out;
  }

  /** Whole days from today to an exam date (YYYY-MM-DD), in the phone's time zone. */
  function daysUntil(dateISO, now) {
    if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
    const [y, m, d] = dateISO.split('-').map(Number);
    const today = new Date(now == null ? Date.now() : now);
    const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
  }

  return {
    STORE_VERSION, HISTORY_MAX, RECENT_ANSWERS, MIN_ANSWERS, DEFAULT_SETTINGS,
    localDay, shuffle, emptyStore, migrateStore, rebuildHistory,
    isConsolidated, recordAnswer, recentAnswers, subjectProgress,
    examPlan, estimateScore, buildDaily, daysUntil
  };
});
