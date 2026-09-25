# Quiz ASMEL

A personal quiz app for studying for the **Maxi Avviso ASMEL 2026** exam
(profiles: Istruttore amministrativo, Istruttore comunicazione, Istruttore turistico).

It runs in the phone's browser, works offline, and can be added to the home
screen like a normal app. There are no accounts and no server: your progress
is saved only on your phone.

**Rules for the questions** (read these before asking a session to write or
review questions):

- [GENERAZIONE.md](GENERAZIONE.md): how new questions are generated.
- [REVISIONE.md](REVISIONE.md): how questions are reviewed.

---

## How the site is updated (in plain words)

You never publish the site by hand. Every time something is saved on the
`main` branch (for example when you merge a pull request with new questions),
GitHub runs an automatic check and, only if everything is fine, publishes the
new version of the site. This is called the **deploy**.

The check does three things, in this order:

1. **Makes the list of question files.** Every `.json` file in
   `data/questions/` is included automatically, whatever its name. Nobody has
   to keep a list up to date.
2. **Checks every question** with the same rules the app uses: missing
   fields, a wrong `correct`, a repeated `id`, an unknown subject, or a file
   that is not valid JSON (for example a missing comma).
3. **Checks every quote of the law** (`evidence`): each one must be copied
   word for word from the file named in its `source.file`.

If any of these fails, **nothing is published**: the previous version of the
site stays online, exactly as it was, and your phone keeps working normally.
You fix the problem, save it on `main` again, and the check runs again.

### How to see whether a deploy worked

1. Open the repository on GitHub and click the **Actions** tab.
2. Each line is one run of **Check and deploy**, newest at the top.
   - Green tick ✅: the check passed and the site was updated.
   - Red cross ❌: something is wrong and the site was **not** updated.
   - Yellow dot 🟡: still running (it takes a minute or two).
3. To see what went wrong, click the red line, then the job
   **Check questions and build site**, then the step with the red cross.
   The lines starting with `ERROR` name the file, the question `id` and the
   problem.

The same check also runs on every pull request (without publishing anything),
so you can see a red cross on the pull request page before you merge it.

---

## What each file does

| File | What it is |
|---|---|
| `index.html` | The page the browser opens. It is almost empty: the app draws every screen into it. |
| `validation.js` | The rules that decide whether a question is valid. Used both by the app and by `tools/validate.js`, so they always agree. |
| `study.js` | The study rules: answer history, "consolidata", error review, daily session, score estimate, migration of saved data. Tested by `tests/study.test.js`. |
| `style.css` | Colours, sizes and layout (including dark mode). |
| `app.js` | The screens: home, quiz modes, statistics, settings, backup. Comments explain each part. |
| `tests/study.test.js` | Automatic tests of `study.js` (run before every deploy). |
| `tests/browser-check.js` | Check of the whole app in a real browser (run by hand, see below). |
| `manifest.json` | Name and icon used when you "install" the app on the home screen. |
| `sw.js` | The "service worker": keeps a copy of the app so it works offline. |
| `icons/` | App icons. |
| `data/subjects.json` | The list of subjects (id, Italian name, block). |
| `data/profiles.json` | The three profiles, their specific subjects, and the simulation rules. |
| `data/questions/*.json` | The questions: one file per batch. Every `.json` file in this folder is loaded, whatever its name. |
| `sources/` | The law texts used to write the questions (e.g. `L241-1990_2026-09-24.txt`, saved from Normattiva). |
| `tools/build-index.js` | Makes `data/questions/index.json`, the list of question files the app loads. Runs automatically; that file is not in the repository and must never be edited by hand. |
| `tools/validate.js` | Checks every question file with the same rules as the app. |
| `tools/check_evidence.py` | Checks that every `evidence` quote is copied word for word from its `source.file` (see below). |
| `.github/workflows/deploy.yml` | The automatic check and publication described above. |
| `GENERAZIONE.md`, `REVISIONE.md` | The rules for generating and reviewing questions. |

You will normally only edit files in the `data/` folder.

---

## How to add a new batch of questions

1. Create a new file in `data/questions/`, for example `privacy.json`
   (one file per batch; never change the existing files to add a batch).
   The file contains a list (`[ ... ]`) of questions separated by commas.
2. Save (commit) it on GitHub, usually through a pull request, and merge it
   into `main`. There is **no list of files to update**: the new file is
   picked up automatically.
3. Check the **Actions** tab (see above). When the run is green, open the app:
   the new questions are there.
4. Open **Diagnostica** in the app to check the counts per subject.

### Question format

```json
{
  "id": "l241-001",
  "subject": "accesso",
  "question": "Testo della domanda",
  "options": [
    { "id": "a", "text": "...", "why_wrong": "Perché questa opzione è sbagliata" },
    { "id": "b", "text": "...", "why_wrong": null },
    { "id": "c", "text": "...", "why_wrong": "..." },
    { "id": "d", "text": "...", "why_wrong": "..." }
  ],
  "correct": "b",
  "explanation": "Perché la risposta corretta è corretta",
  "evidence": [
    { "ref": "art. 25, comma 4", "text": "Decorsi inutilmente trenta giorni dalla richiesta, questa si intende respinta." }
  ],
  "source": { "act": "L. 241/1990", "article": "art. 25, comma 4", "file": "sources/L241-1990_2026-09-24.txt", "url": null },
  "source_date": "2026-09-24",
  "status": "da_verificare",
  "no_shuffle": false
}
```

| Field | Meaning |
|---|---|
| `id` | A unique code for the question. **Must be different from every other question in every file.** Never change it once you've studied the question, or its statistics are lost. |
| `subject` | The subject `id` from `data/subjects.json` (e.g. `accesso`, `privacy`, `inglese`). |
| `question` | The question text. |
| `options` | The possible answers. Each has its own `id` (`a`, `b`, …), the `text`, and `why_wrong` (why that option is wrong; `null` for the correct one, or when you have no explanation). |
| `correct` | The `id` of the correct option. Exactly one option must have this id. |
| `explanation` | Why the correct answer is correct. Shown after you answer. |
| `source` | Where the answer comes from: `act` (the law), `article`, `file` (see below), `url` (a link, or `null`). The whole `source` can be `null` for non-legal subjects. |
| `source.file` | *Optional.* The path of the law text in `sources/` the question was written from, e.g. `"sources/L241-1990_2026-09-24.txt"`, or `null`. **Required when the question has `evidence`**: the quote check reads the law from this file. |
| `source_date` | The date you downloaded the law text you used (`YYYY-MM-DD`), or `null`. |
| `evidence` | *Optional.* The text of the law that proves the correct answer: a list of `{ "ref": "art. X, comma Y", "text": "..." }`, where `text` is copied **word for word** from the file in `sources/`. Shown after you answer, under the explanation, in a collapsible section **"Testo della norma"**. If present it must be a non-empty list, and every item needs a non-empty `ref` and `text`. |
| `status` | One of the statuses below. |
| `review_note` | *Optional.* A note written during review (usually explaining what is wrong with a `da_rivedere` question). Shown in **Diagnostica** next to the question. |
| `no_shuffle` | `true` keeps the options in the written order (useful for "tutte le precedenti"). Otherwise the app mixes them up each time. |

#### Statuses

| `status` | Meaning | In the app |
|---|---|---|
| `verificata` | You checked it yourself against the law text. | No badge. |
| `rivista` | It passed the automated independent review. | Small grey "Rivista" badge. |
| `da_verificare` | Nobody has checked it yet. | Yellow "Da verificare" badge. |
| `da_rivedere` | The review found a problem (see its `review_note`). | **Excluded from every practice mode and from the simulation.** Listed only in **Diagnostica**, with its note. |
| `demo` | Fake question for trying the app. | "Demo" badge. |

Text is written between double quotes `"..."`. If you need a double quote
inside a text, write it as `\"`. Apostrophes (`'`) are fine as they are.

If a question has a mistake (missing field, wrong `correct`, repeated `id`,
unknown `subject`), the app **skips it** and lists it in **Diagnostica** with
the reason. A question with an unknown or missing `status` is **not** skipped:
it is loaded as `da_verificare` and listed in **Diagnostica** under **Avvisi**
so you can fix it. If a whole file is broken (for example a missing comma), the file
is listed there too. The rest of the app keeps working.

---

## How to mark a question as verified

When you have checked a question against the official law text, open its file
and change

```json
"status": "da_verificare",
```

to

```json
"status": "verificata",
```

(the same works for a `rivista` question). The badge disappears.
**Diagnostica** shows, per subject, how many questions have each status.

To fix a `da_rivedere` question: read its note in **Diagnostica**, correct the
question in its file, delete the `review_note` line and set the status back to
`da_verificare` (or `verificata` if you checked it). Until then it never appears
in practice or in the simulation.

---

## Checking the `evidence` quotes

`tools/check_evidence.py` makes sure every `evidence.text` is really in the law
file named in the question's `source.file`, word for word, **inside the article and comma named in `ref`**. The only
difference it tolerates is whitespace (line breaks, double spaces). It also
warns if `source.article` does not match the evidence.

Some texts, such as the codice penale, do not number their commas: each comma
is a paragraph. For an article like that, the check counts the paragraphs after
the article title as comma 1, comma 2, and so on. A numbered list inside a
comma ("1)", "1°", "a)") stays part of that comma.

EU acts (e.g. the GDPR) number paragraphs, not commas, so `ref` can also be
written `"art. 6, par. 1"` (read like `comma 1`), optionally followed by a
letter: `"art. 5, par. 1, lett. c)"` (the quote must still be inside that
paragraph). An article made of numbered points, such as the GDPR definitions,
is cited by point: `"art. 4, punto 7"`. An EU article with a single unnumbered
paragraph is cited as a whole: `"art. 10"`.

The consolidated TUE/TFUE file holds two treaties that both number their
articles from 1, so the treaty follows the article number:
`"art. 5 TUE, par. 3"`, `"art. 294 TFUE, par. 7, lett. a)"`, or, for an
article without numbered paragraphs, `"art. 288 TFUE"`.

The name of the act may also follow the article number, as a label only
(the act is always the one in `source.file`): `"art. 74 Reg. 2021/1060, par. 2"`,
`"art. 2 Reg. 2021/1060, punto 31"`, `"art. 11 L. 3/2003, comma 2-bis"`. The check reads the
heading of each treaty ("TRATTATO SULL'UNIONE EUROPEA (VERSIONE
CONSOLIDATA)", "TRATTATO SUL FUNZIONAMENTO...") to know which treaty an
article belongs to.

The Costituzione does not number its commas and does not separate them with
blank lines: each comma simply starts on a new line. In that file the check
ends a comma at a line that ends with a full stop (note markers such as
`((20))` are ignored), so `"art. 13, comma 3"` works as usual. It reads the
Costituzione only up to the "DISPOSIZIONI TRANSITORIE E FINALI".

The check reads a source file only up to the closing formula of its act
("Il presente decreto, munito del sigillo dello Stato..." or "Fatto a
Bruxelles, il ..."). Annexes and other acts saved in the same file (the
codes of conduct after the d.lgs. 196/2003, the directive published after the
GDPR in the same Official Journal) are not read, so their article numbers
never replace the act's own.

It runs automatically before every deploy. To run it yourself you need
Python 3 and nothing else. From the project folder run:

```
python3 tools/check_evidence.py
```

The last line says `all verbatim` when everything is fine; otherwise every
wrong quote is listed with its question id. A question with `evidence` but
no `source.file` (or with a `source.file` that does not exist) is an error.
To use another law, save its text in `sources/` and put its path in
`source.file`: nothing in the script needs to change.

The question check works the same way (it needs Node.js):

```
node tools/validate.js
```

The last line says `OK` or `FAILED`.

The study rules have their own tests (Node.js only, nothing to install):

```
node --test "tests/*.test.js"
```

To check the whole app in a browser at phone width, in light and dark mode
(needs Playwright with Chromium), start the local server described below and run
`node tests/browser-check.js`. Screenshots go in `tests/screenshots/`.

---

## How the app organises your study

The home screen of your profile shows, from the top:

1. **Mancano N giorni alla prova**, if you set the exam date in **Impostazioni**.
2. **Sessione del giorno**: a fixed number of questions (30 by default,
   changeable in **Impostazioni**) chosen for you: about 40% from the error
   review, about 30% from your weakest subjects (lowest % correct in the last
   30 answers, among subjects with at least 10 answers), the rest never-seen
   questions spread across subjects. If a group has too few questions, the
   next one fills the gap. You can stop and resume it later. When you finish
   it, the button says **Sessione di oggi completata** for the rest of the day
   (you can still do another one).
3. **Stima**: the estimated score. For every subject with at least 10 answers:
   expected exam questions × % correct in its last 30 answers; subjects with
   fewer answers are not estimated. The line also says how many of the 60
   questions the estimate is based on and how many subjects have no data.
   Below 30 estimated questions it says **Stima parziale**.
4. **Progress per subject**, specific subjects first, then common ones:
   - **Copertura**: questions seen / questions available;
   - **Consolidate**: questions whose last two answers were both correct
     **on two different days** / questions available;
   - **% corrette recenti**: over the last 30 answers in that subject.

   The numbers are always shown, not only the bars: when a new batch of
   questions is added the bars get shorter, but the number of questions you
   know stays the same. Tap a subject to practise it (10 questions: new ones
   first). Questions with status `da_rivedere` are never counted.

A question leaves **Ripasso errori** when it is consolidated (the same rule).

**English is not studied.** It never appears in practice, error review,
progress or the daily session. In the simulation and in the estimate, the
English questions are counted as correct (see below).

## Simulation rules

The rules are in `data/profiles.json` under `"simulation"`:

- `total_questions` and `duration_minutes` (60 and 60)
- `blocks`: how many questions come from the profile's specific subjects (30),
  the common legal subjects (25) and English + IT (5)
- `english`: `subject` is the English subject id (`inglese`) and
  `assumed_questions` how many of the 5 English + IT questions are assumed to
  be English (2). Those are **not drawn** (the simulation has 58 questions by
  default) and are **counted as correct** in the result and in the estimate,
  with the label *"Inglese: 2 quesiti considerati corretti (non studiato)"*.
- `pass_threshold`: the minimum score to pass (42, out of 60)
- `scoring`: points for a `correct`, `wrong` and `blank` answer (1 / 0 / 0).
  If the official bando gives e.g. −0.25 for wrong answers, write `"wrong": -0.25`.

Within each block the questions are split evenly across its subjects. If a
subject has too few questions, the app takes more from the other subjects of the
same block and shows a notice such as *"Banca dati incompleta: management-pubblico"*.

To change which specific subjects belong to a profile, edit its
`specific_subjects` list. All profiles always include all common subjects
(those with block `common_law` or `common_lang_it` in `subjects.json`).

---

## Backing up your progress

Progress is stored in the browser on your phone. It is lost if you clear the
browser's data or change phone. To keep a copy:

1. Open **Impostazioni** → **Esporta backup**. A file named
   `asmel-quiz-backup-YYYY-MM-DD.json` is downloaded.
2. Keep it somewhere safe (Google Drive, email to yourself…).
3. To restore it: **Impostazioni** → **Importa backup** and choose the file.
   This replaces the progress currently on the phone.

The backup includes answers, statistics, simulation results, daily sessions,
settings and your "Segnala dubbio" notes. A backup made with an older version
of the app can still be imported.

### When the app is updated

Saved progress is never thrown away. When a new version needs more
information than the old one saved (for example, since the daily session the
app records the **day** of every answer), the old data is converted on first
launch and an untouched copy is kept in the browser. For answers given before
this update the day is unknown, so they never count as "two different days":
a question you had already answered correctly becomes *consolidata* after one
more correct answer on a later day.

## Flagged questions ("Segnala dubbio")

After answering, tap **Segnala dubbio** to mark a question you're unsure about
(with an optional note). **Impostazioni** lists all flagged questions;
**Copia elenco** copies them (id + note) so you can paste them somewhere and
fix the data files.

---

## Updates and offline use

- Any change (new questions, `app.js`, `style.css`, …) appears the next time
  you open the app with an internet connection, once its deploy in the
  **Actions** tab is green: the app always checks every file online first,
  and uses the saved copy only when offline.
- If you change `sw.js`, also change `CACHE_VERSION` at its top, so installed
  apps replace the old service worker and its saved copies.

## Trying it on a computer

The app must be opened through a web server (opening `index.html` directly
from the file system won't load the questions). In the project folder, first
build the list of question files, then start a server:

```
node tools/build-index.js
python3 -m http.server 8000
```

and open <http://localhost:8000/>. Run `node tools/build-index.js` again
whenever you add or remove a question file.
