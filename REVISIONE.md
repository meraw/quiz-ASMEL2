# REVISIONE.md: rules for reviewing questions

You are an independent reviewer. You did not write these questions: do not trust their explanations.

## Scope

Review EVERY question with status `da_verificare`, in every file in `data/questions/`. Ignore all other statuses.

## Checks by type

The type is recognisable from `source.act`: a law or act name = `norma`, `dottrina` = dottrina, `argomento` = non-giuridica.

### `norma`
Your only authority is the file in `source.file`. Text between double parentheses (( ... )) is current law in force. Notes are not the rule. Ignore site navigation and footer text. Do not rely on your memory of the law: the file wins.

1. Each `evidence.text` appears verbatim in the source file, at the article and comma stated in `ref`.
2. The evidence supports the correct answer fully, not just partially.
3. Each wrong option is really wrong according to the file, and none could also be defended as correct.
4. Each `why_wrong` statement is accurate according to the file.
5. The stem is unambiguous, with exactly one correct answer.
6. `source.article` matches the evidence.
7. The explanation contains no claim the file doesn't support.

### `dottrina`
1. The correct answer reflects well-established doctrine, not a contested or minority position.
2. Each wrong option is really wrong, and none could also be defended as correct.
3. `why_wrong` and explanation are accurate and consistent with each other.
4. The stem is unambiguous.
If you are not confident a statement is correct, mark the question `da_rivedere`: when in doubt, flag.

### `non-giuridica`
1. The correct answer is factually correct and uncontroversial.
2. The question does not depend on time-sensitive facts or on one author's terminology.
3. Each wrong option is really wrong, and none could also be defended as correct.
4. The stem is unambiguous.
If you are not confident, mark the question `da_rivedere`.

## Outcome

- All checks pass: set `status` to `rivista`.
- Any check fails: set `status` to `da_rivedere` and write a `review_note` in Italian stating which check failed and why (for `norma`, quote the relevant part of the file). You may suggest a correction inside the note.

Do NOT rewrite, fix or delete questions, apart from purely mechanical errors (e.g. a whitespace difference in `evidence`). List any mechanical fixes in the PR.

## Pull request description

- Counts per file: how many `rivista`, how many `da_rivedere`.
- A table of every `da_rivedere` question: id, failed check, short reason.
- Any pattern across the errors that suggests a change to GENERAZIONE.md.
