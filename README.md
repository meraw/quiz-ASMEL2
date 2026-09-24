# Quiz ASMEL

A personal quiz app for studying for the **Maxi Avviso ASMEL 2026** exam
(profiles: Istruttore amministrativo, Istruttore comunicazione, Istruttore turistico).

It runs in the phone's browser, works offline, and can be added to the home
screen like a normal app. There are no accounts and no server: your progress
is saved only on your phone.

---

## What each file does

| File | What it is |
|---|---|
| `index.html` | The page the browser opens. It is almost empty: the app draws every screen into it. |
| `style.css` | Colours, sizes and layout (including dark mode). |
| `app.js` | All the app logic: loading questions, the quiz modes, statistics, backup. Comments explain each part. |
| `manifest.json` | Name and icon used when you "install" the app on the home screen. |
| `sw.js` | The "service worker": keeps a copy of the app so it works offline. |
| `icons/` | App icons. |
| `data/subjects.json` | The list of subjects (id, Italian name, block). |
| `data/profiles.json` | The three profiles, their specific subjects, and the simulation rules. |
| `data/questions/index.json` | The list of question files the app loads. |
| `data/questions/*.json` | The questions, one file per subject (or per batch). |
| `data/questions/_demo.json` | Fake demo questions for testing the app (can be hidden, see below). |
| `sources/` | The law texts used to write the questions (e.g. `L241-1990_2026-09-24.txt`, saved from Normattiva). |
| `tools/check_evidence.py` | Checks that every `evidence` quote is copied word for word from the file in `sources/` (see below). |

You will normally only edit files in the `data/` folder.

---

## How to add a new batch of questions

1. Create a new file in `data/questions/`, for example `privacy.json`.
   The file contains a list (`[ ... ]`) of questions separated by commas.
2. Open `data/questions/index.json` and add the file name to the list:

   ```json
   {
     "files": [
       "accesso.json",
       "diritto-amministrativo-enti-locali.json",
       "comunicazione-pa-l150.json",
       "privacy.json",
       "_demo.json"
     ]
   }
   ```

   Watch the commas: every line except the last one ends with a comma.
   (The app cannot "look inside" a folder on its own, so this list is how it
   knows which files exist.)
3. Save (commit) the changes on GitHub. Open the app: the new questions are there.
4. Open **Diagnostica** in the app to check that no question was rejected.

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
  "source": { "act": "L. 241/1990", "article": "art. 25, comma 4", "url": null },
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
| `source` | Where the answer comes from: `act` (the law), `article`, `url` (a link, or `null`). The whole `source` can be `null` for non-legal subjects. |
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
file, word for word, **inside the article and comma named in `ref`**. The only
difference it tolerates is whitespace (line breaks, double spaces). It also
warns if `source.article` does not match the evidence.

It needs Python 3 and nothing else. From the project folder run:

```
python3 tools/check_evidence.py
```

The last line says `all verbatim` when everything is fine; otherwise every
wrong quote is listed with its question id. The law file is chosen from
`source.act` and `source_date` (e.g. `L. 241/1990` + `2026-09-24` →
`sources/L241-1990_2026-09-24.txt`). To support another law, add it to
`ACT_FILES` at the top of the script.

---

## How to remove the demo questions

`data/questions/_demo.json` contains 2 fake questions per subject (text starting
with `[DEMO]`) so every screen can be tried out. To hide them, delete this line
from `data/questions/index.json`:

```json
    "_demo.json"
```

(and remove the comma at the end of the line before it, if it becomes the last
one). The file itself can stay; it is simply no longer loaded.

---

## Simulation rules

The rules are in `data/profiles.json` under `"simulation"`:

- `total_questions` and `duration_minutes` (60 and 60)
- `blocks`: how many questions come from the profile's specific subjects (30),
  the common legal subjects (25) and English + IT (5)
- `pass_threshold`: the minimum score to pass (42)
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

The backup includes answers, statistics, simulation results and your
"Segnala dubbio" notes.

## Flagged questions ("Segnala dubbio")

After answering, tap **Segnala dubbio** to mark a question you're unsure about
(with an optional note). **Impostazioni** lists all flagged questions;
**Copia elenco** copies them (id + note) so you can paste them somewhere and
fix the data files.

---

## Updates and offline use

- Any change (new questions, `app.js`, `style.css`, …) appears the next time
  you open the app with an internet connection: the app always checks every
  file online first, and uses the saved copy only when offline.
- If you change `sw.js`, also change `CACHE_VERSION` at its top, so installed
  apps replace the old service worker and its saved copies.

## Trying it on a computer

The app must be opened through a web server (opening `index.html` directly
from the file system won't load the questions). For example, in the project
folder run `python3 -m http.server 8000` and open <http://localhost:8000/>.
