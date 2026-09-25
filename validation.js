/*
 * Quiz ASMEL - question validation
 *
 * The same rules are used in two places:
 *   - by the app in the browser (app.js), which skips invalid questions and
 *     lists them in Diagnostica;
 *   - by tools/validate.js on the command line (and in the GitHub Actions
 *     deploy), which stops the deploy if anything is invalid.
 * Change the rules only here, so the two can never disagree.
 *
 * It also holds the option-length check (optionLengthCue), shared by
 * Diagnostica and tools/check_lengths.js. That one is only a warning.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizValidation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // verificata: checked by hand · rivista: passed the automated review ·
  // da_verificare: not yet checked · da_rivedere: review found a problem
  // (excluded from every quiz mode, listed in Diagnostica) · demo: fake question
  const STATUS_VALUES = ['verificata', 'rivista', 'da_verificare', 'da_rivedere', 'demo'];

  /** Check one question. Returns a list of problems (empty list = valid). */
  function validateQuestion(q, subjectById) {
    const problems = [];
    if (!q || typeof q !== 'object' || Array.isArray(q)) return ['non è un oggetto JSON'];

    const isText = (v) => typeof v === 'string' && v.trim() !== '';
    if (!isText(q.id)) problems.push('campo "id" mancante o vuoto');
    if (!isText(q.subject)) problems.push('campo "subject" mancante');
    else if (!subjectById[q.subject]) problems.push('materia "' + q.subject + '" non presente in subjects.json');
    if (!isText(q.question)) problems.push('campo "question" mancante o vuoto');
    if (!isText(q.explanation)) problems.push('campo "explanation" mancante o vuoto');
    if (q.no_shuffle != null && typeof q.no_shuffle !== 'boolean') problems.push('"no_shuffle" deve essere true o false');
    if (q.rev != null && !(Number.isInteger(q.rev) && q.rev >= 1)) problems.push('"rev" deve essere un numero intero maggiore o uguale a 1');
    if (q.source != null && (typeof q.source !== 'object' || Array.isArray(q.source))) problems.push('"source" deve essere un oggetto o null');
    else if (q.source != null && q.source.file != null && !(isText(q.source.file) && q.source.file.startsWith('sources/'))) {
      problems.push('"source.file" deve essere il percorso di un file in sources/ (es. "sources/L241-1990_2026-09-24.txt") o null');
    }
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

  // A question is flagged for the length cue when the correct option is the
  // longest AND at least this many times longer than the longest distractor.
  const LENGTH_CUE_RATIO = 1.25;

  /**
   * Length cue: is the correct option noticeably longer than the distractors?
   * Lengths are in characters, after trimming. Call it only on a valid question.
   * Returns { correctLen, maxDistractorLen, longest, flagged }:
   *   longest - the correct option is strictly longer than every distractor
   *   flagged - longest, and correctLen >= LENGTH_CUE_RATIO * maxDistractorLen
   * Not a validation error: flagged questions stay in every quiz mode.
   */
  function optionLengthCue(q) {
    const len = (o) => o.text.trim().length;
    const correct = q.options.find((o) => o.id === q.correct);
    const correctLen = len(correct);
    const maxDistractorLen = Math.max(...q.options.filter((o) => o !== correct).map(len));
    const longest = correctLen > maxDistractorLen;
    return { correctLen, maxDistractorLen, longest, flagged: longest && correctLen >= LENGTH_CUE_RATIO * maxDistractorLen };
  }

  /**
   * Check every question file.
   * `results` is a list of { file, json } (file read and parsed) or
   * { file, error } (file missing or not valid JSON).
   * Returns:
   *   questions  - valid questions, in file order (an unknown status becomes "da_verificare")
   *   invalid    - { file, index, id, reasons[] } skipped questions
   *   warnings   - { file, index, id, message } loaded questions with a problem
   *   fileErrors - { file, error } files that could not be loaded
   */
  function validateBank(results, subjectById) {
    const out = { questions: [], invalid: [], warnings: [], fileErrors: [] };
    const firstSeenIn = {}; // question id -> file, to detect duplicates
    results.forEach(({ file, json, error }) => {
      if (error) { out.fileErrors.push({ file, error }); return; }
      const list = Array.isArray(json) ? json : json && json.questions;
      if (!Array.isArray(list)) { out.fileErrors.push({ file, error: 'il file deve contenere un elenco [ ... ] di domande' }); return; }

      list.forEach((q, index) => {
        let reasons;
        try { reasons = validateQuestion(q, subjectById); } catch (e) { reasons = ['errore inatteso: ' + e.message]; }
        if (!reasons.length && firstSeenIn[q.id]) reasons.push('id duplicato (già presente in ' + firstSeenIn[q.id] + ')');
        if (reasons.length) {
          out.invalid.push({ file, index: index + 1, id: q && typeof q.id === 'string' ? q.id : '(senza id)', reasons });
          return;
        }
        firstSeenIn[q.id] = file;
        // An unknown status does not discard the question: it is loaded as "da_verificare"
        if (!STATUS_VALUES.includes(q.status)) {
          out.warnings.push({ file, index: index + 1, id: q.id,
            message: 'status ' + (q.status === undefined ? 'mancante' : JSON.stringify(q.status) + ' sconosciuto') +
              ': trattata come "da_verificare" (valori ammessi: ' + STATUS_VALUES.join(', ') + ')' });
          q.status = 'da_verificare';
        }
        out.questions.push(q);
      });
    });
    return out;
  }

  return { STATUS_VALUES, LENGTH_CUE_RATIO, validateQuestion, validateBank, optionLengthCue };
});
