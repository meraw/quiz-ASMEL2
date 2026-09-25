# GENERAZIONE.md: rules for generating questions

Every generation request in this repo refers to this file. Read README.md for the question format.

Each request specifies:
- **Type**: `norma`, `dottrina` or `non-giuridica`
- **Source**: a file in `sources/` (norma), reference material pasted in the prompt (dottrina), or a list of topics (non-giuridica)
- **Parts**: one or more parts to cover (e.g. "Capo III", "artt. 36-54"), each with its own **output file name**
- **Subject**: the subject id from `data/subjects.json`
- **Id prefix**
- **Quantity**: if not stated, 25 to 30 questions per part

## Rules for every type

### Files
- Each part goes into its own new file: `data/questions/<output-file-name>.json`.
- Never modify existing question files. Never create or edit `data/questions/index.json`: it is built automatically.
- If a request lists several parts, process them one at a time: generate part 1, run the checks, then part 2, and so on.

### Question quality
- Exactly one correct answer, unambiguous on the basis of the source.
- Test understanding, not bare article numbers: at most 3 questions per part of the "quale articolo" type.
- For the most important rules or concepts, write 2 or 3 questions from different angles: one asking the rule directly, one asking its consequence, one applying it to a short concrete scenario. Different angles, not reworded copies.
- About one third of all questions should be short concrete scenarios (e.g. "Un Comune..."), where the type allows it.
- Distractors must be plausible and built from neighbouring rules or concepts in the same source (other deadlines, other bodies, other procedures, other consequences), not from invented nonsense.
- Every `why_wrong` must only state what the source says. Keep it short: name the rule or concept the distractor confuses, without adding explanations of your own. If you can't justify why a distractor is wrong from the source, choose a different distractor.
- Avoid "tutte le precedenti" / "nessuna delle precedenti"; if used, set `no_shuffle: true`.
- Avoid negative stems; if unavoidable, write NON in capitals.
- All options must be similar in length, structure and level of detail. The correct option must not be systematically the longest: give distractors the same kind of qualifications and specifics as the correct answer, and cut unnecessary detail from the correct answer.
- Mix of difficulty: roughly one third straightforward, one third medium, one third tricky.
- Correct, formal Italian, in the style of Italian public competition quizzes.

### Fields
- `status`: always `da_verificare`.
- `source_date`: the date in the source file name, or the date of the request for non-file sources.

## Type `norma`

Source: a law text in `sources/`, saved from Normattiva or EUR-Lex (or a collective agreement from ARAN).

- Use ONLY that file. Ignore site navigation, menus and footer text.
- Text between double parentheses (( ... )) is text inserted or amended by later laws. It IS the law currently in force.
- Notes to articles are not the rule itself: never base a correct answer only on a note.
- Do not use your own memory of the law. If the file and your memory disagree, the file wins.
- If a rule depends on another act not included in the file, do not write a question that requires knowing that other act.
- Some concepts are used but not defined by the text (e.g. "eccesso di potere"). You may ask what the text says about them, never questions requiring a definition the text does not give.
- First confirm, from the file, which articles make up each requested part.
- `evidence`: the comma or commas that prove the correct answer, copied CHARACTER FOR CHARACTER from the source file (only whitespace may be normalized). `ref` in the form "art. X, comma Y".
- `source`: `{ "act": "<act name>", "article": "<same as the evidence ref>", "file": "<path of the source file>", "url": null }`.

## Type `dottrina`

Source: reference material pasted in the prompt (e.g. from Brocardi or a textbook). It is copyrighted.

- NEVER save the reference material in the repo, and never copy its sentences into questions or explanations. Write everything in your own words.
- Only use concepts clearly stated in the material provided. If a concept is contested or presented differently by different authors, do not ask about it.
- `evidence`: null.
- `source`: `{ "act": "dottrina", "article": "<topic>", "file": null, "url": null }`.
- The `explanation` must be self-contained: it has to make the answer understandable without the original material.

## Type `non-giuridica`

Source: a list of topics given in the prompt.

- Only well-established, uncontroversial knowledge at the level of a public competition quiz.
- Avoid time-sensitive facts (software versions, platform features, statistics, current figures) unless they are provided in the prompt.
- Avoid questions whose answer depends on a particular author's or textbook's terminology.
- `evidence`: null.
- `source`: `{ "act": "argomento", "article": "<topic>", "file": null, "url": null }`.

## Checks before opening the pull request

1. Run `tools/validate.js` on the whole bank: no question may be invalid.
2. For type `norma`, run the verbatim evidence check in `tools/`: every `evidence.text` must appear in its `source.file`. Fix every mismatch.
3. Run the index build script and check that the new files are included.
4. Run tools/check_lengths.js on the new files: no question may be flagged. Rewrite the options of any flagged question before opening the PR.

## Pull request description

- For each part: output file, number of questions per article or topic, how many are scenarios.
- Topics deliberately skipped, and why.
- Results of the checks.
