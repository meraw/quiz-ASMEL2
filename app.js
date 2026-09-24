/*
 * Quiz ASMEL - app logic
 * ======================
 * A single-page quiz app with no frameworks and no build step.
 *
 * How it is organised (top to bottom):
 *   1. Settings and small helpers
 *   2. Saved data (localStorage): progress, flags, settings
 *   3. Loading and validating questions from the data/ folder
 *   4. Choosing questions for each mode (practice, simulation, errors, weak points)
 *   5. Screens (each function draws one screen into <main id="app">)
 *   6. Button handling (one listener for the whole page)
 *   7. Start-up
 *
 * All text shown to the user is in Italian; comments are in English.
 */
(function () {
  'use strict';

  /* =====================================================================
   * 1. SETTINGS AND HELPERS
   * ===================================================================== */

  const STORE_KEY = 'asmel-quiz-v1'; // name of the localStorage entry
  const APP_ID = 'asmel-quiz';       // written in backups, checked on import
  // verificata: checked by hand · rivista: passed the automated review ·
  // da_verificare: not yet checked · da_rivedere: review found a problem
  // (excluded from every quiz mode, listed in Diagnostica) · demo: fake question
  const STATUS_VALUES = ['verificata', 'rivista', 'da_verificare', 'da_rivedere', 'demo'];
  const STATUS_LABELS = { verificata: 'Ver.', rivista: 'Riv.', da_verificare: 'DaV', da_rivedere: 'DaR', demo: 'Demo' };
  const BLOCK_NAMES = {
    specific: 'Materie specifiche',
    common_law: 'Materie comuni – giuridiche',
    common_lang_it: 'Materie comuni – inglese e informatica'
  };

  const $app = document.getElementById('app');
  const $topExtra = document.getElementById('topbar-extra');

  /** Escape text before putting it into HTML (questions are data, not code). */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Return a shuffled copy of an array (Fisher–Yates). */
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pct(part, total) {
    return total ? Math.round((part / total) * 100) : 0;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /** Small message at the bottom of the screen that disappears by itself. */
  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  /* =====================================================================
   * 2. SAVED DATA (localStorage)
   * ---------------------------------------------------------------------
   * Everything is kept in one JSON object:
   *   profile   - default profile id chosen at first launch
   *   progress  - per question id: { attempts, correct, wrong, lastCorrect,
   *               streak (correct answers in a row), inErrors, lastAt }
   *   flags     - per question id: { note, date }   ("Segnala dubbio")
   *   activeSim - a simulation in progress (so it survives a page reload)
   *   lastSim   - the last finished simulation (to review it again)
   *   simHistory- short summary of every finished simulation
   * ===================================================================== */

  function emptyStore() {
    return { app: APP_ID, version: 1, profile: null, progress: {}, flags: {}, activeSim: null, lastSim: null, simHistory: [] };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      return Object.assign(emptyStore(), JSON.parse(raw));
    } catch (e) {
      console.warn('Saved data could not be read, starting fresh', e);
      return emptyStore();
    }
  }

  let store = loadStore();

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      toast('Impossibile salvare i progressi sul dispositivo');
    }
  }

  /** Update the statistics of one question after an answer. */
  function recordAnswer(qid, isCorrect) {
    const p = store.progress[qid] || { attempts: 0, correct: 0, wrong: 0, lastCorrect: null, streak: 0, inErrors: false };
    p.attempts++;
    p.lastAt = Date.now();
    p.lastCorrect = isCorrect;
    if (isCorrect) {
      p.correct++;
      p.streak++;
      // A question leaves "Ripasso errori" after two correct answers in a row
      if (p.inErrors && p.streak >= 2) p.inErrors = false;
    } else {
      p.wrong++;
      p.streak = 0;
      p.inErrors = true;
    }
    store.progress[qid] = p;
  }

  /* =====================================================================
   * 3. LOADING AND VALIDATING QUESTIONS
   * ===================================================================== */

  const data = {
    subjects: [],       // from data/subjects.json
    subjectById: {},
    profiles: [],       // from data/profiles.json
    profileById: {},
    simRules: null,     // simulation rules from data/profiles.json
    questions: [],      // valid questions usable in the quiz modes
    qById: {},
    toRevise: [],       // valid questions with status "da_rivedere" (Diagnostica only)
    invalid: [],        // { file, index, id, reasons[] } shown in Diagnostica
    warnings: [],       // { file, index, id, message } loaded questions with a problem (e.g. unknown status)
    fileErrors: []      // { file, error } files that could not be loaded
  };

  async function fetchJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('JSON non valido: ' + e.message);
    }
  }

  /** Check one question. Returns a list of problems (empty list = valid). */
  function validateQuestion(q) {
    const problems = [];
    if (!q || typeof q !== 'object' || Array.isArray(q)) return ['non è un oggetto JSON'];

    const isText = (v) => typeof v === 'string' && v.trim() !== '';
    if (!isText(q.id)) problems.push('campo "id" mancante o vuoto');
    if (!isText(q.subject)) problems.push('campo "subject" mancante');
    else if (!data.subjectById[q.subject]) problems.push('materia "' + q.subject + '" non presente in subjects.json');
    if (!isText(q.question)) problems.push('campo "question" mancante o vuoto');
    if (!isText(q.explanation)) problems.push('campo "explanation" mancante o vuoto');
    if (q.no_shuffle != null && typeof q.no_shuffle !== 'boolean') problems.push('"no_shuffle" deve essere true o false');
    if (q.source != null && (typeof q.source !== 'object' || Array.isArray(q.source))) problems.push('"source" deve essere un oggetto o null');
    if (q.source_date != null && typeof q.source_date !== 'string') problems.push('"source_date" deve essere una data o null');
    if (q.review_note != null && typeof q.review_note !== 'string') problems.push('"review_note" deve essere testo');
    if (q.evidence != null) {
      if (!Array.isArray(q.evidence) || !q.evidence.length) problems.push('"evidence" deve essere un elenco non vuoto');
      else q.evidence.forEach((e, i) => {
        if (!e || typeof e !== 'object' || Array.isArray(e) || !isText(e.ref) || !isText(e.text)) {
          problems.push('evidence n. ' + (i + 1) + ': servono "ref" e "text" non vuoti');
        }
      });
    }

    if (!Array.isArray(q.options) || q.options.length < 2) {
      problems.push('servono almeno 2 opzioni in "options"');
    } else {
      const ids = [];
      q.options.forEach((o, i) => {
        if (!o || typeof o !== 'object') { problems.push('opzione n. ' + (i + 1) + ' non valida'); return; }
        if (!isText(o.id)) problems.push('opzione n. ' + (i + 1) + ' senza "id"');
        if (!isText(o.text)) problems.push('opzione n. ' + (i + 1) + ' senza "text"');
        if (o.why_wrong != null && typeof o.why_wrong !== 'string') problems.push('opzione n. ' + (i + 1) + ': "why_wrong" deve essere testo o null');
        ids.push(o.id);
      });
      if (new Set(ids).size !== ids.length) problems.push('id delle opzioni ripetuti');
      const matches = ids.filter((id) => id === q.correct).length;
      if (!isText(q.correct)) problems.push('campo "correct" mancante');
      else if (matches !== 1) problems.push('"correct" ("' + q.correct + '") deve corrispondere a esattamente una opzione');
    }
    return problems;
  }

  async function loadAllData() {
    const [subjectsFile, profilesFile, indexFile] = await Promise.all([
      fetchJSON('data/subjects.json'),
      fetchJSON('data/profiles.json'),
      fetchJSON('data/questions/index.json')
    ]);

    data.subjects = subjectsFile.subjects || [];
    data.subjects.forEach((s) => { data.subjectById[s.id] = s; });
    data.profiles = profilesFile.profiles || [];
    data.profiles.forEach((p) => { data.profileById[p.id] = p; });
    data.simRules = profilesFile.simulation;

    // Load every question file listed in index.json (in parallel)
    const files = (indexFile.files || []).filter((f) => typeof f === 'string');
    const results = await Promise.all(files.map((file) =>
      fetchJSON('data/questions/' + file)
        .then((json) => ({ file, json }))
        .catch((err) => ({ file, error: err.message }))
    ));

    const firstSeenIn = {}; // question id -> file, to detect duplicates
    results.forEach(({ file, json, error }) => {
      if (error) { data.fileErrors.push({ file, error }); return; }
      const list = Array.isArray(json) ? json : json && json.questions;
      if (!Array.isArray(list)) { data.fileErrors.push({ file, error: 'il file deve contenere un elenco [ ... ] di domande' }); return; }

      list.forEach((q, index) => {
        let reasons;
        try { reasons = validateQuestion(q); } catch (e) { reasons = ['errore inatteso: ' + e.message]; }
        if (!reasons.length && firstSeenIn[q.id]) reasons.push('id duplicato (già presente in ' + firstSeenIn[q.id] + ')');
        if (reasons.length) {
          data.invalid.push({ file, index: index + 1, id: q && typeof q.id === 'string' ? q.id : '(senza id)', reasons });
          return;
        }
        firstSeenIn[q.id] = file;
        // An unknown status does not discard the question: it is loaded as "da_verificare"
        if (!STATUS_VALUES.includes(q.status)) {
          data.warnings.push({ file, index: index + 1, id: q.id,
            message: 'status ' + (q.status === undefined ? 'mancante' : JSON.stringify(q.status) + ' sconosciuto') +
              ': trattata come "da_verificare" (valori ammessi: ' + STATUS_VALUES.join(', ') + ')' });
          q.status = 'da_verificare';
        }
        if (q.status === 'da_rivedere') { data.toRevise.push(q); return; }
        data.questions.push(q);
        data.qById[q.id] = q;
      });
    });
  }

  /* =====================================================================
   * 4. CHOOSING QUESTIONS
   * ===================================================================== */

  function profileSubjects(profileId) {
    const p = data.profileById[profileId];
    const specific = p ? p.specific_subjects.filter((id) => data.subjectById[id]) : [];
    const common = data.subjects.filter((s) => s.block !== 'specific').map((s) => s.id);
    return specific.concat(common);
  }

  /** Subject ids of a simulation block for a profile. */
  function blockSubjects(profileId, block) {
    if (block === 'specific') return profileSubjects(profileId).filter((id) => data.subjectById[id].block === 'specific');
    return data.subjects.filter((s) => s.block === block).map((s) => s.id);
  }

  function questionsOf(subjectIds) {
    const set = new Set(subjectIds);
    return data.questions.filter((q) => set.has(q.subject));
  }

  /** Create a quiz item: remembers the question, the display order of options and the answer. */
  function makeItem(q) {
    const ids = q.options.map((o) => o.id);
    return { qid: q.id, order: q.no_shuffle ? ids : shuffle(ids), answer: null };
  }

  /** Practice order: unseen first, then previously wrong, then the rest. */
  function pickPractice(subjectIds, count) {
    const unseen = [], wrong = [], rest = [];
    questionsOf(subjectIds).forEach((q) => {
      const p = store.progress[q.id];
      if (!p || !p.attempts) unseen.push(q);
      else if (p.lastCorrect === false) wrong.push(q);
      else rest.push(q);
    });
    const ordered = shuffle(unseen).concat(shuffle(wrong), shuffle(rest));
    return (count === 'all' ? ordered : ordered.slice(0, count)).map(makeItem);
  }

  function errorPool() {
    return data.questions.filter((q) => store.progress[q.id] && store.progress[q.id].inErrors);
  }

  /** Error rate of a subject: (wrong + 1) / (attempts + 2), so few answers don't give extreme values. */
  function subjectStats(subjectId) {
    const qs = questionsOf([subjectId]);
    let seen = 0, attempts = 0, correct = 0, wrong = 0;
    qs.forEach((q) => {
      const p = store.progress[q.id];
      if (p && p.attempts) { seen++; attempts += p.attempts; correct += p.correct; wrong += p.wrong; }
    });
    return { total: qs.length, seen, attempts, correct, wrong, errorRate: (wrong + 1) / (attempts + 2) };
  }

  /**
   * "Punti deboli": draw questions at random, but questions with a high error
   * rate (and from subjects with a high error rate) are much more likely.
   */
  function pickWeak(profileId, count) {
    const rates = {};
    profileSubjects(profileId).forEach((id) => { rates[id] = subjectStats(id).errorRate; });
    let pool = questionsOf(Object.keys(rates)).map((q) => {
      const p = store.progress[q.id];
      const qRate = p && p.attempts ? (p.wrong + 1) / (p.attempts + 2) : 0.4;
      return { q, weight: Math.pow(rates[q.subject] + qRate, 2) + 0.01 };
    });
    const chosen = [];
    while (chosen.length < count && pool.length) {
      const total = pool.reduce((s, x) => s + x.weight, 0);
      let r = Math.random() * total;
      let i = 0;
      while (i < pool.length - 1 && r >= pool[i].weight) { r -= pool[i].weight; i++; }
      chosen.push(pool[i].q);
      pool.splice(i, 1);
    }
    return chosen.map(makeItem);
  }

  /** Weakest subjects of a profile: answered at least once, lowest % correct first. */
  function weakestSubjects(profileId, howMany) {
    return profileSubjects(profileId)
      .map((id) => Object.assign({ id }, subjectStats(id)))
      .filter((s) => s.attempts > 0 && s.correct < s.attempts)
      .sort((a, b) => (a.correct / a.attempts) - (b.correct / b.attempts) || b.attempts - a.attempts)
      .slice(0, howMany);
  }

  /**
   * Build the simulation question list.
   * For each block: split the quota evenly across its subjects; if a subject
   * has too few questions, take the missing ones from the other subjects of
   * the same block and record a notice.
   */
  function buildSimulation(profileId) {
    const rules = data.simRules;
    const items = [];
    const notices = [];

    Object.keys(rules.blocks).forEach((block) => {
      const need = rules.blocks[block];
      const subjects = shuffle(blockSubjects(profileId, block));
      if (!subjects.length || need <= 0) return;

      // Even split; the remainder goes to randomly chosen subjects
      const quota = {};
      subjects.forEach((id, i) => { quota[id] = Math.floor(need / subjects.length) + (i < need % subjects.length ? 1 : 0); });

      const picked = [];
      const leftovers = [];
      subjects.forEach((id) => {
        const qs = shuffle(questionsOf([id]));
        const take = qs.slice(0, quota[id]);
        if (take.length < quota[id]) notices.push('Banca dati incompleta: ' + id + ' (' + qs.length + ' domande, ne servirebbero ' + quota[id] + ')');
        picked.push(...take);
        leftovers.push(...qs.slice(quota[id]));
      });

      // Fill any gap with other questions of the same block
      const extra = shuffle(leftovers).slice(0, need - picked.length);
      picked.push(...extra);
      if (picked.length < need) notices.push('Blocco "' + BLOCK_NAMES[block] + '" incompleto: ' + picked.length + ' domande su ' + need);

      items.push(...shuffle(picked).map(makeItem));
    });

    return { items, notices };
  }

  /* =====================================================================
   * 5. SCREENS
   * ---------------------------------------------------------------------
   * `ui` holds what is on screen now. Each render function writes HTML
   * into <main id="app">. Buttons carry data-action="..." attributes that
   * are handled in section 6.
   * ===================================================================== */

  let ui = { screen: 'home' };
  let timerHandle = null;

  function render(html) {
    $app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  /** Go to a screen. Pushes a history entry so Android "back" returns to the menu. */
  function go(screen, extra) {
    stopTimer();
    $topExtra.textContent = '';
    ui = Object.assign({ screen }, extra || {});
    if (screen !== 'home' && (!history.state || history.state.screen !== 'inner')) history.pushState({ screen: 'inner' }, '');
    SCREENS[screen]();
  }

  function subjectName(id) {
    return data.subjectById[id] ? data.subjectById[id].name : id;
  }

  function profileName(id) {
    return data.profileById[id] ? data.profileById[id].name : '—';
  }

  function statusBadge(q) {
    if (q.status === 'verificata') return '';
    if (q.status === 'demo') return '<span class="badge demo">Demo</span>';
    if (q.status === 'rivista') return '<span class="badge subtle">Rivista</span>';
    if (q.status === 'da_rivedere') return '<span class="badge bad">Da rivedere</span>';
    return '<span class="badge">Da verificare</span>';
  }

  function profileSelect(name, selected) {
    return '<select name="' + name + '" data-change="' + name + '">' +
      data.profiles.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
      '</select>';
  }

  function countChoice(name, values, checked) {
    return '<div class="choice" role="radiogroup">' + values.map(([value, label]) =>
      '<label><input type="radio" name="' + name + '" value="' + value + '"' + (String(value) === String(checked) ? ' checked' : '') + '><span>' + label + '</span></label>'
    ).join('') + '</div>';
  }

  function readCount(name) {
    const el = $app.querySelector('input[name="' + name + '"]:checked');
    if (!el) return 10;
    return el.value === 'all' ? 'all' : Number(el.value);
  }

  /* ---------- First launch: choose profile ---------- */
  function renderFirstLaunch() {
    render(
      '<h1>Benvenuta/o!</h1>' +
      '<p>Per quale profilo ti stai preparando? Potrai cambiarlo in qualsiasi momento dalle <b>Impostazioni</b>.</p>' +
      data.profiles.map((p) =>
        '<button type="button" class="menu-btn" data-action="choose-profile" data-id="' + esc(p.id) + '"><strong>' + esc(p.name) + '</strong></button>'
      ).join('')
    );
  }

  /* ---------- Home menu ---------- */
  function renderHome() {
    if (!store.profile || !data.profileById[store.profile]) return renderFirstLaunch();
    const errors = errorPool().length;
    const resume = store.activeSim
      ? '<button type="button" class="menu-btn highlight" data-action="resume-sim"><strong>▶ Riprendi simulazione</strong><span>Hai una simulazione in corso</span></button>'
      : '';
    const problems = data.invalid.length + data.fileErrors.length + data.warnings.length;
    render(
      '<p class="muted small">Profilo: <b>' + esc(profileName(store.profile)) + '</b> · ' + data.questions.length + ' domande caricate</p>' +
      resume +
      '<button type="button" class="menu-btn" data-action="go" data-screen="practiceSetup"><strong>Allenamento</strong><span>Scegli le materie, correzione immediata</span></button>' +
      '<button type="button" class="menu-btn" data-action="go" data-screen="simSetup"><strong>Simulazione d\'esame</strong><span>' + data.simRules.total_questions + ' domande, ' + data.simRules.duration_minutes + ' minuti</span></button>' +
      '<button type="button" class="menu-btn" data-action="go" data-screen="errorsSetup"><strong>Ripasso errori</strong><span>' + errors + ' domande da ripassare</span></button>' +
      '<button type="button" class="menu-btn" data-action="go" data-screen="weakSetup"><strong>Punti deboli</strong><span>Più domande dalle materie in cui sbagli di più</span></button>' +
      '<button type="button" class="menu-btn" data-action="go" data-screen="stats"><strong>Statistiche</strong><span>Andamento per materia</span></button>' +
      '<button type="button" class="menu-btn" data-action="go" data-screen="settings"><strong>Impostazioni</strong><span>Profilo, segnalazioni, backup</span></button>' +
      '<button type="button" class="menu-btn" data-action="go" data-screen="diagnostics"><strong>Diagnostica</strong><span>' +
        (problems ? '⚠ ' + problems + ' problemi nei file delle domande' : 'Controllo della banca dati') + '</span></button>'
    );
  }

  /* ---------- Allenamento: setup ---------- */
  function subjectCheckboxes(profileId, checkedIds) {
    const ids = profileSubjects(profileId);
    const byBlock = { specific: [], common_law: [], common_lang_it: [] };
    ids.forEach((id) => { (byBlock[data.subjectById[id].block] || (byBlock[data.subjectById[id].block] = [])).push(id); });
    return Object.keys(byBlock).filter((b) => byBlock[b].length).map((b) =>
      '<h3>' + esc(BLOCK_NAMES[b] || b) + '</h3><div class="card">' +
      byBlock[b].map((id) => {
        const n = questionsOf([id]).length;
        return '<label class="check-row"><input type="checkbox" name="subject" value="' + esc(id) + '"' +
          (checkedIds.includes(id) ? ' checked' : '') + (n ? '' : ' disabled') + '>' +
          '<span class="grow">' + esc(subjectName(id)) + '</span><span class="count">' + n + '</span></label>';
      }).join('') + '</div>'
    ).join('');
  }

  function renderPracticeSetup() {
    const profileId = ui.profile || store.profile;
    ui.profile = profileId;
    render(
      '<h1>Allenamento</h1>' +
      '<label class="small muted">Profilo</label>' + profileSelect('practice-profile', profileId) +
      '<div class="btn-row"><button type="button" class="btn small" data-action="check-all">Seleziona tutte</button>' +
      '<button type="button" class="btn small" data-action="check-none">Nessuna</button></div>' +
      subjectCheckboxes(profileId, ui.checked || []) +
      '<h3>Quante domande?</h3>' + countChoice('count', [[10, '10'], [20, '20'], ['all', 'Tutte']], ui.count || 10) +
      '<button type="button" class="btn primary" data-action="start-practice">Inizia</button>'
    );
  }

  /* ---------- Ripasso errori: setup ---------- */
  function renderErrorsSetup() {
    const n = errorPool().length;
    render(
      '<h1>Ripasso errori</h1>' +
      '<p>Qui trovi le domande a cui hai risposto in modo sbagliato. Una domanda esce da questo elenco dopo <b>due risposte corrette di fila</b>.</p>' +
      '<div class="card"><div class="big-score">' + n + '</div><div class="muted">domande da ripassare</div></div>' +
      (n
        ? '<h3>Quante domande?</h3>' + countChoice('count', [[10, '10'], [20, '20'], ['all', 'Tutte']], 'all') +
          '<button type="button" class="btn primary" data-action="start-errors">Inizia ripasso</button>'
        : '<p class="muted">Nessun errore da ripassare. Ottimo lavoro!</p>')
    );
  }

  /* ---------- Punti deboli: setup ---------- */
  function renderWeakSetup() {
    const weak = weakestSubjects(store.profile, 5);
    render(
      '<h1>Punti deboli</h1>' +
      '<p>Una sessione con più domande dalle materie e dalle domande in cui sbagli di più (profilo <b>' + esc(profileName(store.profile)) + '</b>).</p>' +
      (weak.length
        ? '<div class="card"><b>Materie più deboli</b><ul class="why-list">' +
          weak.map((s) => '<li>' + esc(subjectName(s.id)) + ' — ' + pct(s.correct, s.attempts) + '% corrette</li>').join('') + '</ul></div>'
        : '<p class="muted small">Non hai ancora abbastanza risposte: la sessione sarà quasi casuale. Fai qualche allenamento prima!</p>') +
      '<h3>Quante domande?</h3>' + countChoice('count', [[10, '10'], [20, '20'], [40, '40']], 20) +
      '<button type="button" class="btn primary" data-action="start-weak">Inizia</button>'
    );
  }

  /* ---------- Practice session (used by Allenamento, Ripasso errori, Punti deboli) ---------- */
  function startSession(title, items) {
    if (!items.length) { toast('Nessuna domanda disponibile'); return; }
    go('quiz', { session: { title, items, index: 0 } });
  }

  /** HTML for the list of options. `mode`: 'answer' (clickable), 'sim' (clickable, no feedback), 'review' (colours only). */
  function optionsHTML(q, item, mode) {
    return item.order.map((optId, pos) => {
      const o = q.options.find((x) => x.id === optId);
      let cls = 'option';
      if (mode === 'review') {
        if (optId === q.correct) cls += ' correct';
        else if (optId === item.answer) cls += ' wrong';
      } else if (item.answer === optId) {
        cls += ' selected';
      }
      const action = mode === 'review' ? '' : ' data-action="' + (mode === 'sim' ? 'sim-answer' : 'answer') + '" data-id="' + esc(optId) + '"';
      return '<button type="button" class="' + cls + '"' + action + (mode === 'review' ? ' disabled' : '') + '>' +
        '<span class="letter">' + 'ABCDEFGH'[pos] + '</span><span>' + esc(o.text) + '</span></button>';
    }).join('');
  }

  function sourceHTML(q) {
    const s = q.source;
    if (!s || !(s.act || s.article)) return '';
    const label = [s.act, s.article].filter(Boolean).map(esc).join(', ');
    const link = s.url ? ' — <a href="' + esc(s.url) + '" target="_blank" rel="noopener">apri il testo</a>' : '';
    const date = q.source_date ? ' <span class="small">(testo scaricato il ' + esc(q.source_date) + ')</span>' : '';
    return '<p class="source"><b>Fonte:</b> ' + label + date + link + '</p>';
  }

  /** Collapsible "Testo della norma": the verbatim text of the cited commi. */
  function evidenceHTML(q) {
    if (!Array.isArray(q.evidence) || !q.evidence.length) return '';
    return '<details class="evidence"><summary>Testo della norma</summary>' +
      q.evidence.map((e) => '<p><b>' + esc(e.ref) + '</b> ' + esc(e.text) + '</p>').join('') + '</details>';
  }

  function flagHTML(qid) {
    const f = store.flags[qid];
    return '<div class="flag-box">' +
      '<button type="button" class="btn small" data-action="flag-open" data-id="' + esc(qid) + '">' + (f ? '⚑ Segnalata – modifica' : '⚑ Segnala dubbio') + '</button>' +
      '<div class="flag-form hidden" data-flag-form="' + esc(qid) + '">' +
        '<textarea maxlength="300" placeholder="Nota facoltativa (es. risposta da ricontrollare)">' + esc(f ? f.note : '') + '</textarea>' +
        '<button type="button" class="btn small" data-action="flag-save" data-id="' + esc(qid) + '">Salva segnalazione</button>' +
        (f ? '<button type="button" class="btn small danger" data-action="flag-remove" data-id="' + esc(qid) + '">Rimuovi</button>' : '') +
      '</div></div>';
  }

  /** Correct/wrong verdict, explanation, why the chosen option is wrong, the others (expandable), source. */
  function feedbackHTML(q, item) {
    const isBlank = item.answer == null;
    const isCorrect = item.answer === q.correct;
    const correctPos = item.order.indexOf(q.correct);
    let html = '<div class="card feedback ' + (isBlank ? 'is-blank' : isCorrect ? 'is-correct' : 'is-wrong') + '">' +
      '<p class="verdict">' + (isBlank ? 'Non risposta' : isCorrect ? '✓ Corretto' : '✗ Sbagliato') + '</p>';
    if (!isCorrect) html += '<p>Risposta corretta: <b>' + 'ABCDEFGH'[correctPos] + '</b></p>';
    html += '<p>' + esc(q.explanation) + '</p>' + evidenceHTML(q);

    const chosen = q.options.find((o) => o.id === item.answer);
    if (chosen && !isCorrect && chosen.why_wrong) {
      html += '<p><b>Perché la tua risposta è sbagliata:</b> ' + esc(chosen.why_wrong) + '</p>';
    }
    const others = item.order
      .map((id, pos) => ({ o: q.options.find((x) => x.id === id), pos }))
      .filter(({ o }) => o.id !== q.correct && o.id !== item.answer && o.why_wrong);
    if (others.length) {
      html += '<details><summary>Perché le altre opzioni sono sbagliate</summary><ul class="why-list">' +
        others.map(({ o, pos }) => '<li><b>' + 'ABCDEFGH'[pos] + '.</b> ' + esc(o.why_wrong) + '</li>').join('') + '</ul></details>';
    }
    html += sourceHTML(q) + flagHTML(q.id) + '</div>';
    return html;
  }

  function questionHeader(q, number, total) {
    return '<div class="q-meta"><span>Domanda ' + number + ' di ' + total + '</span><span>·</span><span>' + esc(subjectName(q.subject)) + '</span>' + statusBadge(q) + '</div>' +
      '<div class="progress"><div style="width:' + pct(number, total) + '%"></div></div>' +
      '<p class="q-text">' + esc(q.question) + '</p>';
  }

  function renderQuiz() {
    const s = ui.session;
    const item = s.items[s.index];
    const q = data.qById[item.qid];
    const answered = item.answer != null;
    render(
      '<p class="muted small">' + esc(s.title) + '</p>' +
      questionHeader(q, s.index + 1, s.items.length) +
      optionsHTML(q, item, answered ? 'review' : 'answer') +
      (answered
        ? feedbackHTML(q, item) +
          '<button type="button" class="btn primary" data-action="next">' + (s.index + 1 < s.items.length ? 'Avanti ›' : 'Vedi risultato') + '</button>'
        : '') +
      '<button type="button" class="btn" data-action="end-session">Termina sessione</button>'
    );
  }

  function renderQuizEnd() {
    const s = ui.session;
    const done = s.items.filter((i) => i.answer != null);
    const correct = done.filter((i) => i.answer === data.qById[i.qid].correct).length;
    render(
      '<h1>Sessione terminata</h1>' +
      '<div class="card"><div class="big-score">' + correct + ' / ' + done.length + '</div>' +
      '<div class="muted">risposte corrette (' + pct(correct, done.length) + '%)</div></div>' +
      '<button type="button" class="btn primary" data-action="home">Torna al menu</button>' +
      (done.length ? '<h2>Rivedi le domande</h2>' + reviewListHTML(done) : '')
    );
  }

  /** Full review of a list of items (used after practice and after the simulation). */
  function reviewListHTML(items) {
    return items.map((item, n) => {
      const q = data.qById[item.qid];
      if (!q) return '';
      return '<div class="card"><div class="q-meta"><span>' + (n + 1) + '.</span><span>' + esc(subjectName(q.subject)) + '</span>' + statusBadge(q) + '</div>' +
        '<p class="q-text">' + esc(q.question) + '</p>' + optionsHTML(q, item, 'review') + feedbackHTML(q, item) + '</div>';
    }).join('');
  }

  /* ---------- Simulazione ---------- */
  function renderSimSetup() {
    const r = data.simRules;
    const plan = buildSimulation(store.profile);
    const blockLines = Object.keys(r.blocks).map((b) => '<li>' + r.blocks[b] + ' — ' + esc(BLOCK_NAMES[b] || b) + '</li>').join('');
    render(
      '<h1>Simulazione d\'esame</h1>' +
      '<div class="card"><p>Profilo: <b>' + esc(profileName(store.profile)) + '</b></p>' +
      '<p><b>' + r.total_questions + '</b> domande in <b>' + r.duration_minutes + '</b> minuti:</p><ul class="why-list">' + blockLines + '</ul>' +
      '<p>Soglia di superamento: <b>' + r.pass_threshold + '</b> punti.<br>Punteggio: corretta ' + r.scoring.correct + ', errata ' + r.scoring.wrong + ', non data ' + r.scoring.blank + '.</p>' +
      '<p class="small muted">Nessuna correzione durante la prova. Puoi saltare domande e tornarci. Allo scadere del tempo la prova viene consegnata automaticamente.</p></div>' +
      noticesHTML(plan.notices) +
      (store.activeSim ? '<p class="small muted">Attenzione: iniziare una nuova simulazione cancella quella in corso.</p>' : '') +
      '<button type="button" class="btn primary" data-action="start-sim"' + (plan.items.length ? '' : ' disabled') + '>Inizia simulazione</button>'
    );
  }

  function noticesHTML(notices) {
    if (!notices || !notices.length) return '';
    return '<div class="card notice"><b>Avvisi</b><ul>' + notices.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></div>';
  }

  function startSimulation() {
    const plan = buildSimulation(store.profile);
    const now = Date.now();
    store.activeSim = {
      profile: store.profile,
      startedAt: now,
      endAt: now + data.simRules.duration_minutes * 60 * 1000,
      items: plan.items,
      notices: plan.notices,
      index: 0
    };
    saveStore();
    go('sim');
  }

  function renderSim() {
    const sim = store.activeSim;
    if (!sim) return go('home');
    // Remove questions that no longer exist (e.g. data files changed during the test)
    sim.items = sim.items.filter((i) => data.qById[i.qid]);
    if (!sim.items.length) { store.activeSim = null; saveStore(); return go('home'); }
    if (sim.index >= sim.items.length) sim.index = sim.items.length - 1;
    if (Date.now() >= sim.endAt) return submitSimulation(true);

    const item = sim.items[sim.index];
    const q = data.qById[item.qid];
    const answeredCount = sim.items.filter((i) => i.answer != null).length;
    const last = sim.index === sim.items.length - 1;

    render(
      (sim.index === 0 ? noticesHTML(sim.notices) : '') +
      questionHeader(q, sim.index + 1, sim.items.length) +
      optionsHTML(q, item, 'sim') +
      '<div class="btn-row">' +
        '<button type="button" class="btn" data-action="sim-prev"' + (sim.index === 0 ? ' disabled' : '') + '>‹ Indietro</button>' +
        '<button type="button" class="btn primary" data-action="sim-next"' + (last ? ' disabled' : '') + '>' + (item.answer == null ? 'Salta ›' : 'Avanti ›') + '</button>' +
      '</div>' +
      (item.answer != null ? '<button type="button" class="btn small" data-action="sim-clear">Cancella risposta</button>' : '') +
      '<details' + (ui.gridOpen ? ' open' : '') + ' data-grid><summary>Tutte le domande (' + answeredCount + '/' + sim.items.length + ' risposte)</summary><div class="nav-grid">' +
        sim.items.map((i, n) => '<button type="button" data-action="sim-goto" data-n="' + n + '" class="' +
          (i.answer != null ? 'answered' : '') + (n === sim.index ? ' current' : '') + '">' + (n + 1) + '</button>').join('') +
      '</div></details>' +
      '<button type="button" class="btn danger" data-action="sim-submit">Consegna</button>'
    );
    startTimer();
  }

  function startTimer() {
    stopTimer();
    const tick = () => {
      const sim = store.activeSim;
      if (!sim) return stopTimer();
      const left = sim.endAt - Date.now();
      $topExtra.innerHTML = '<span class="timer' + (left < 5 * 60 * 1000 ? ' low' : '') + '" role="timer">⏱ ' + formatTime(left) + '</span>';
      if (left <= 0) submitSimulation(true);
    };
    tick();
    timerHandle = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  /** Score the simulation, save progress and show the results. */
  function submitSimulation(timeUp) {
    stopTimer();
    const sim = store.activeSim;
    if (!sim) return;
    const r = data.simRules;
    let correct = 0, wrong = 0, blank = 0;
    const bySubject = {};
    sim.items.forEach((item) => {
      const q = data.qById[item.qid];
      if (!q) return;
      const b = bySubject[q.subject] || (bySubject[q.subject] = { total: 0, correct: 0, wrong: 0, blank: 0 });
      b.total++;
      if (item.answer == null) { blank++; b.blank++; return; }
      const ok = item.answer === q.correct;
      if (ok) { correct++; b.correct++; } else { wrong++; b.wrong++; }
      recordAnswer(q.id, ok);
    });
    const score = correct * r.scoring.correct + wrong * r.scoring.wrong + blank * r.scoring.blank;
    const result = {
      date: new Date().toISOString(), profile: sim.profile, timeUp: !!timeUp,
      correct, wrong, blank, total: sim.items.length, score: Math.round(score * 100) / 100,
      threshold: r.pass_threshold, passed: score >= r.pass_threshold,
      bySubject, notices: sim.notices, items: sim.items
    };
    store.lastSim = result;
    store.simHistory.push({ date: result.date, profile: result.profile, score: result.score, correct, total: result.total, passed: result.passed });
    store.activeSim = null;
    saveStore();
    go('simResults');
  }

  function renderSimResults() {
    const r = store.lastSim;
    if (!r) return go('home');
    const rows = Object.keys(r.bySubject)
      .sort((a, b) => pct(r.bySubject[a].correct, r.bySubject[a].total) - pct(r.bySubject[b].correct, r.bySubject[b].total))
      .map((id) => {
        const b = r.bySubject[id];
        return '<tr><td>' + esc(subjectName(id)) + '</td><td class="num">' + b.correct + '/' + b.total + '</td><td class="num">' + pct(b.correct, b.total) + '%</td></tr>';
      }).join('');
    render(
      '<h1>Risultato simulazione</h1>' +
      (r.timeUp ? '<div class="card notice">Tempo scaduto: la prova è stata consegnata automaticamente.</div>' : '') +
      '<div class="card"><div class="big-score ' + (r.passed ? 'pass' : 'fail') + '">' + r.score + ' / ' + r.total + '</div>' +
      '<p class="' + (r.passed ? 'pass' : 'fail') + '"><b>' + (r.passed ? 'SUPERATA' : 'NON SUPERATA') + '</b> (soglia ' + r.threshold + ')</p>' +
      '<p class="small muted">Corrette ' + r.correct + ' · Errate ' + r.wrong + ' · Non date ' + r.blank + ' · Profilo ' + esc(profileName(r.profile)) + '</p></div>' +
      noticesHTML(r.notices) +
      '<h2>Per materia</h2><div class="card"><table><thead><tr><th>Materia</th><th class="num">Corrette</th><th class="num">%</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<button type="button" class="btn primary" data-action="home">Torna al menu</button>' +
      '<h2>Revisione di tutte le domande</h2>' + reviewListHTML(r.items)
    );
  }

  /* ---------- Statistiche ---------- */
  function renderStats() {
    const profileId = ui.profile || store.profile;
    const ids = profileSubjects(profileId);
    const weak = new Set(weakestSubjects(profileId, 3).map((s) => s.id));
    let totalQ = 0, totalSeen = 0, totalAtt = 0, totalCorrect = 0;
    const rows = ids.map((id) => {
      const s = subjectStats(id);
      totalQ += s.total; totalSeen += s.seen; totalAtt += s.attempts; totalCorrect += s.correct;
      return '<tr' + (weak.has(id) ? ' class="weak"' : '') + '><td>' + esc(subjectName(id)) + (weak.has(id) ? ' ⚠' : '') + '</td>' +
        '<td class="num">' + s.seen + '/' + s.total + '</td>' +
        '<td class="num">' + (s.attempts ? pct(s.correct, s.attempts) + '%' : '—') + '</td></tr>';
    }).join('');
    const sims = store.simHistory.filter((h) => h.profile === profileId).slice(-5).reverse();
    render(
      '<h1>Statistiche</h1>' + profileSelect('stats-profile', profileId) +
      '<div class="card"><p>Domande viste: <b>' + totalSeen + '</b> su ' + totalQ + '<br>Risposte corrette: <b>' + pct(totalCorrect, totalAtt) + '%</b> (' + totalCorrect + ' su ' + totalAtt + ')</p>' +
      (weak.size ? '<p class="small">Le materie evidenziate (⚠) sono le più deboli.</p>' : '') + '</div>' +
      '<div class="card"><table><thead><tr><th>Materia</th><th class="num">Viste</th><th class="num">Corrette</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (sims.length ? '<h2>Ultime simulazioni</h2><div class="card"><table><tbody>' + sims.map((h) =>
        '<tr><td>' + esc(h.date.slice(0, 10)) + '</td><td class="num">' + h.score + '/' + h.total + '</td><td class="num ' + (h.passed ? 'pass' : 'fail') + '">' + (h.passed ? 'Superata' : 'Non superata') + '</td></tr>'
      ).join('') + '</tbody></table></div>' : '')
    );
  }

  /* ---------- Impostazioni ---------- */
  function flaggedListText() {
    return Object.keys(store.flags).map((id) => {
      const f = store.flags[id];
      return id + (f.note ? ' — ' + f.note : '');
    }).join('\n');
  }

  function renderSettings() {
    const flagIds = Object.keys(store.flags);
    render(
      '<h1>Impostazioni</h1>' +
      '<h2>Profilo predefinito</h2>' + profileSelect('default-profile', store.profile) +

      '<h2>Domande segnalate (' + flagIds.length + ')</h2>' +
      (flagIds.length
        ? '<div class="card">' + flagIds.map((id) => {
            const q = data.qById[id] || data.toRevise.find((x) => x.id === id);
            return '<div class="error-item"><code>' + esc(id) + '</code>' + (q ? ' <span class="small muted">(' + esc(subjectName(q.subject)) + ')</span>' : ' <span class="small muted">(domanda non più presente)</span>') +
              (store.flags[id].note ? '<br>' + esc(store.flags[id].note) : '') +
              '<br><button type="button" class="btn small danger" data-action="flag-remove" data-id="' + esc(id) + '">Rimuovi</button></div>';
          }).join('') + '</div>' +
          '<button type="button" class="btn" data-action="copy-flags">Copia elenco</button>'
        : '<p class="muted small">Nessuna segnalazione. Usa "Segnala dubbio" durante la correzione.</p>') +

      '<h2>Backup</h2>' +
      '<p class="small muted">Salva un file con tutti i progressi e le segnalazioni. Serve se cancelli i dati del browser o cambi telefono.</p>' +
      '<button type="button" class="btn" data-action="export">Esporta backup</button>' +
      '<button type="button" class="btn" data-action="import">Importa backup</button>' +
      '<input type="file" id="import-file" accept="application/json,.json" class="hidden">' +

      '<h2>Azzera</h2>' +
      '<button type="button" class="btn danger" data-action="reset">Azzera tutti i progressi</button>' +
      '<p class="small muted">Cancella risposte, statistiche e simulazioni. Le segnalazioni e il profilo restano.</p>'
    );
  }

  /* ---------- Diagnostica ---------- */
  function renderDiagnostics() {
    const all = data.questions.concat(data.toRevise);
    const emptyCounts = () => STATUS_VALUES.reduce((c, st) => { c[st] = 0; return c; }, { total: 0 });
    const counts = {};
    all.forEach((q) => {
      const c = counts[q.subject] || (counts[q.subject] = emptyCounts());
      c.total++; c[q.status]++;
    });
    const rows = data.subjects.map((s) => {
      const c = counts[s.id] || emptyCounts();
      return '<tr><td>' + esc(s.name) + '<br><code class="small muted">' + esc(s.id) + '</code></td><td class="num">' + c.total + '</td>' +
        STATUS_VALUES.map((st) => '<td class="num">' + c[st] + '</td>').join('') + '</tr>';
    }).join('');

    // Questions to fix (excluded from the quiz) and any other question with a review note
    const noted = data.toRevise.concat(data.questions.filter((q) => q.review_note));
    const notedHTML = noted.length
      ? '<h2>Domande da rivedere e note di revisione</h2>' +
        '<p class="small muted">Le domande "da rivedere" sono escluse da allenamento e simulazione finché non vengono corrette.</p>' +
        '<div class="card">' + noted.map((q) =>
          '<div class="error-item"><div class="q-meta"><code>' + esc(q.id) + '</code><span>·</span><span>' + esc(subjectName(q.subject)) + '</span>' + statusBadge(q) + '</div>' +
          '<p>' + esc(q.question) + '</p>' +
          (q.review_note ? '<p class="review-note"><b>Nota di revisione:</b> ' + esc(q.review_note) + '</p>' : '') +
          '</div>').join('') + '</div>'
      : '';

    render(
      '<h1>Diagnostica</h1>' +
      '<div class="card"><p>Domande valide: <b>' + all.length + '</b> (di cui da rivedere: <b>' + data.toRevise.length + '</b>)<br>Domande scartate: <b>' + data.invalid.length + '</b><br>Avvisi: <b>' + data.warnings.length + '</b><br>File non caricati: <b>' + data.fileErrors.length + '</b></p></div>' +
      (data.fileErrors.length ? '<h2>File non caricati</h2><div class="card">' + data.fileErrors.map((f) =>
        '<div class="error-item"><code>' + esc(f.file) + '</code><br>' + esc(f.error) + '</div>').join('') + '</div>' : '') +
      (data.invalid.length ? '<h2>Domande scartate</h2><div class="card">' + data.invalid.map((x) =>
        '<div class="error-item"><code>' + esc(x.file) + '</code> · domanda n. ' + x.index + ' · id <code>' + esc(x.id) + '</code><ul class="why-list">' +
        x.reasons.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul></div>').join('') + '</div>' : '') +
      (data.warnings.length ? '<h2>Avvisi</h2><p class="small muted">Queste domande sono state caricate, ma vanno corrette nel loro file.</p><div class="card">' + data.warnings.map((w) =>
        '<div class="error-item"><code>' + esc(w.file) + '</code> · domanda n. ' + w.index + ' · id <code>' + esc(w.id) + '</code><ul class="why-list"><li>⚠ ' + esc(w.message) + '</li></ul></div>').join('') + '</div>' : '') +
      notedHTML +
      '<h2>Domande per materia</h2><div class="card table-scroll"><table class="diag-table"><thead><tr><th>Materia</th><th class="num">Tot.</th>' +
        STATUS_VALUES.map((st) => '<th class="num">' + STATUS_LABELS[st] + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '<p class="small muted">Ver. = verificata · Riv. = rivista · DaV = da verificare · DaR = da rivedere · Demo = demo</p></div>'
    );
  }

  const SCREENS = {
    home: renderHome,
    practiceSetup: renderPracticeSetup,
    errorsSetup: renderErrorsSetup,
    weakSetup: renderWeakSetup,
    quiz: renderQuiz,
    quizEnd: renderQuizEnd,
    simSetup: renderSimSetup,
    sim: renderSim,
    simResults: renderSimResults,
    stats: renderStats,
    settings: renderSettings,
    diagnostics: renderDiagnostics
  };

  /* =====================================================================
   * 6. BUTTON HANDLING
   * ===================================================================== */

  function checkedSubjects() {
    return Array.from($app.querySelectorAll('input[name="subject"]:checked')).map((el) => el.value);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for browsers without the clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  function exportBackup() {
    const backup = Object.assign({}, store, { exportedAt: new Date().toISOString() });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'asmel-quiz-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) { parsed = null; }
      if (!parsed || parsed.app !== APP_ID || typeof parsed.progress !== 'object') {
        alert('Questo file non è un backup valido di Quiz ASMEL.');
        return;
      }
      if (!confirm('Importare il backup? I progressi attuali su questo dispositivo verranno sostituiti.')) return;
      delete parsed.exportedAt;
      store = Object.assign(emptyStore(), parsed);
      saveStore();
      toast('Backup importato');
      go('home');
    };
    reader.readAsText(file);
  }

  /** Redraw only the "Segnala dubbio" box (so the page does not jump), or the whole screen in Settings. */
  function refreshFlag(el, qid) {
    const box = el.closest('.flag-box');
    if (box) box.outerHTML = flagHTML(qid);
    else SCREENS[ui.screen]();
  }

  const ACTIONS = {
    home: () => go('home'),
    go: (el) => go(el.dataset.screen),

    'choose-profile': (el) => { store.profile = el.dataset.id; saveStore(); go('home'); },

    'check-all': () => $app.querySelectorAll('input[name="subject"]:not(:disabled)').forEach((el) => { el.checked = true; }),
    'check-none': () => $app.querySelectorAll('input[name="subject"]').forEach((el) => { el.checked = false; }),

    'start-practice': () => {
      const subjects = checkedSubjects();
      if (!subjects.length) return toast('Scegli almeno una materia');
      startSession('Allenamento', pickPractice(subjects, readCount('count')));
    },
    'start-errors': () => {
      const count = readCount('count');
      const pool = shuffle(errorPool());
      startSession('Ripasso errori', (count === 'all' ? pool : pool.slice(0, count)).map(makeItem));
    },
    'start-weak': () => startSession('Punti deboli', pickWeak(store.profile, readCount('count'))),

    answer: (el) => {
      const item = ui.session.items[ui.session.index];
      if (item.answer != null) return;
      item.answer = el.dataset.id;
      recordAnswer(item.qid, item.answer === data.qById[item.qid].correct);
      saveStore();
      renderQuiz();
      // Scroll to the feedback so it is visible on a small screen
      const fb = $app.querySelector('.feedback');
      if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    next: () => {
      const s = ui.session;
      if (s.index + 1 < s.items.length) { s.index++; renderQuiz(); window.scrollTo(0, 0); } else { ui.screen = 'quizEnd'; renderQuizEnd(); }
    },
    'end-session': () => { ui.screen = 'quizEnd'; renderQuizEnd(); },

    'start-sim': () => {
      if (store.activeSim && !confirm('C\'è una simulazione in corso. Vuoi cancellarla e iniziarne una nuova?')) return;
      startSimulation();
    },
    'resume-sim': () => go('sim'),
    'sim-answer': (el) => {
      const sim = store.activeSim;
      sim.items[sim.index].answer = el.dataset.id;
      saveStore();
      renderSim();
    },
    'sim-clear': () => { const sim = store.activeSim; sim.items[sim.index].answer = null; saveStore(); renderSim(); },
    'sim-prev': () => { store.activeSim.index--; saveStore(); renderSim(); },
    'sim-next': () => { store.activeSim.index++; saveStore(); renderSim(); },
    'sim-goto': (el) => { store.activeSim.index = Number(el.dataset.n); ui.gridOpen = false; saveStore(); renderSim(); },
    'sim-submit': () => {
      const blank = store.activeSim.items.filter((i) => i.answer == null).length;
      const msg = blank ? 'Hai ancora ' + blank + ' domande senza risposta. Consegnare comunque?' : 'Consegnare la simulazione?';
      if (confirm(msg)) submitSimulation(false);
    },

    'flag-open': (el) => {
      const form = $app.querySelector('[data-flag-form="' + CSS.escape(el.dataset.id) + '"]');
      if (form) { form.classList.toggle('hidden'); const ta = form.querySelector('textarea'); if (ta) ta.focus(); }
    },
    'flag-save': (el) => {
      const id = el.dataset.id;
      const ta = el.parentElement.querySelector('textarea');
      store.flags[id] = { note: ta ? ta.value.trim() : '', date: todayISO() };
      saveStore();
      toast('Segnalazione salvata');
      refreshFlag(el, id);
    },
    'flag-remove': (el) => {
      delete store.flags[el.dataset.id];
      saveStore();
      toast('Segnalazione rimossa');
      refreshFlag(el, el.dataset.id);
    },
    'copy-flags': async () => {
      const ok = await copyText(flaggedListText());
      toast(ok ? 'Elenco copiato' : 'Copia non riuscita');
    },

    export: exportBackup,
    import: () => $app.querySelector('#import-file').click(),
    reset: () => {
      if (!confirm('Vuoi davvero azzerare tutti i progressi? L\'operazione non si può annullare.')) return;
      if (!confirm('Confermi? Consiglio: esporta prima un backup.')) return;
      store.progress = {};
      store.activeSim = null;
      store.lastSim = null;
      store.simHistory = [];
      saveStore();
      toast('Progressi azzerati');
      go('home');
    }
  };

  // One listener for every button in the page (including the top bar)
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const action = ACTIONS[el.dataset.action];
    if (action) action(el);
  });

  // Drop-down menus and the backup file picker
  $app.addEventListener('change', (event) => {
    const el = event.target;
    if (el.id === 'import-file' && el.files[0]) { importBackup(el.files[0]); el.value = ''; return; }
    switch (el.dataset.change) {
      case 'practice-profile': ui.profile = el.value; ui.checked = checkedSubjects(); ui.count = readCount('count'); renderPracticeSetup(); break;
      case 'stats-profile': ui.profile = el.value; renderStats(); break;
      case 'default-profile': store.profile = el.value; saveStore(); toast('Profilo aggiornato'); break;
    }
  });

  // Remember whether the question grid of the simulation is open
  $app.addEventListener('toggle', (event) => {
    if (event.target.hasAttribute && event.target.hasAttribute('data-grid')) ui.gridOpen = event.target.open;
  }, true);

  // Android back button: return to the menu instead of leaving the app
  window.addEventListener('popstate', () => {
    if (ui.screen !== 'home') { stopTimer(); $topExtra.textContent = ''; ui = { screen: 'home' }; renderHome(); }
  });

  // When the phone wakes up, check the simulation timer immediately
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ui.screen === 'sim' && store.activeSim && Date.now() >= store.activeSim.endAt) submitSimulation(true);
  });

  // Another tab changed the saved data: reload it
  window.addEventListener('storage', (event) => {
    if (event.key === STORE_KEY) store = loadStore();
  });

  /* =====================================================================
   * 7. START-UP
   * ===================================================================== */

  async function start() {
    try {
      await loadAllData();
    } catch (e) {
      render('<h1>Errore</h1><p>Non è stato possibile caricare i file di base (subjects.json, profiles.json o index.json).</p><p class="small muted">' + esc(e.message) + '</p>' +
        '<button type="button" class="btn primary" onclick="location.reload()">Riprova</button>');
      return;
    }
    history.replaceState({ screen: 'home' }, '');
    // A simulation whose time ran out while the app was closed is submitted now
    if (store.activeSim && Date.now() >= store.activeSim.endAt && store.profile) {
      submitSimulation(true);
      return;
    }
    renderHome();
  }

  // Offline support (service worker); it only works over http(s), not from a file
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered', e));
    });
  }

  start();
})();
