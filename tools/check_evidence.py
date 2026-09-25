#!/usr/bin/env python3
"""
Check that every `evidence` quote in the question files is copied verbatim
from the law text saved in sources/.

For each question with an `evidence` list, and for each item in it:
  1. `ref` must look like "art. 25, comma 4" (also "art. 27, comma 2-bis").
     EU acts number paragraphs instead of commas: "art. 6, par. 1" is read
     like "art. 6, comma 1". A final ", lett. c)" is allowed and does not
     change the check (the quote must be inside that comma or paragraph).
     Articles made of numbered points, such as the definitions of the GDPR,
     use "art. 4, punto 7": the quote must be inside that point. An EU
     article made of a single unnumbered paragraph is cited as "art. 16":
     the quote must be inside that article. When one source file holds two
     treaties with their own article numbers (TUE and TFUE), the treaty
     follows the article number: "art. 5 TUE, par. 3", "art. 288 TFUE";
  2. `text` must appear, word for word, inside THAT comma of THAT article
     of the source file. When an article has no numbered commas (e.g. the
     codice penale), its commas are its paragraphs, counted from 1 after the
     heading. The only normalisation allowed is whitespace:
     line breaks and repeated spaces count as a single space.

It also warns when `source.article` does not match the evidence refs.

The source file is the one named in each question's `source.file`, e.g.
"sources/L241-1990_2026-09-24.txt" (a path inside the project folder).
A question with `evidence` but no `source.file` is an error.

A source file ends at the closing formula of its act ("Il presente decreto,
munito del sigillo dello Stato..." or, for EU acts, "Fatto a Bruxelles, il
..."): what follows (annexes, other acts published in the same Official
Journal) is not read, so its article numbers never replace the act's own.

The Costituzione (Normattiva) is a special case: its commas are neither
numbered nor separated by blank lines. Each comma starts on a new line, so
in that file a comma ends at a line ending with a full stop (note markers
such as "((20))" or "(19)" ignored); list items ending with ";" or ":"
stay in the same comma. The file is read up to the "DISPOSIZIONI
TRANSITORIE E FINALI", and PARTE / TITOLO / SEZIONE headings end the
article before them.

Every .json file in data/questions/ is checked (index.json excluded).

Usage (from the project folder):
    python3 tools/check_evidence.py
Exit code 0 = all good, 1 = at least one problem.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUESTIONS_DIR = os.path.join(ROOT, 'data', 'questions')
SOURCES_DIR = os.path.join(ROOT, 'sources')

SUFFIX = (r'(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies'
          r'|undecies|duodecies|terdecies|quaterdecies|quinquiesdecies|sexiesdecies|septiesdecies))?')
# "Art. 25" (Normattiva laws), "Articolo 25" (some Normattiva texts, e.g. the
# TUEL) or "Art. 314." (codice penale): the final dot is optional
ARTICLE_RE = re.compile(r'^\s*Art(?:\.|icolo)\s+(\d+' + SUFFIX + r')\.?\s*$')
# A comma starts at the beginning of a line: "3. ", "2-bis. ", "((2. ", "1.((COMMA..."
COMMA_RE = re.compile(r'^(?:\(\()?\s*(\d+' + SUFFIX + r')\.(?=\s|\(\(|$)')
# Optional treaty after the article number ("art. 5 TUE", "art. 288 TFUE"):
# see TREATY_RE
ART = r'(\d+' + SUFFIX + r'(?:\s+(?:TUE|TFUE))?)'
REF_RE = re.compile(r'^art\.\s+' + ART + r',\s+(?:comma|par\.)\s+(\d+' + SUFFIX + r')'
                    r'(?:,\s+lett\.\s+[a-z]+\))?$')
# "art. 4, punto 7": a numbered point "7)" of an article made of points
POINT_REF_RE = re.compile(r'^art\.\s+' + ART + r',\s+punto\s+(\d+)$')
# "art. 16": the whole article (EU articles with a single unnumbered paragraph)
ARTICLE_REF_RE = re.compile(r'^art\.\s+' + ART + r'$')
POINT_RE = re.compile(r'^\s*(\d+)\)\s+\S')
# The closing formula of the act: nothing after it belongs to the act
# The heading of a treaty in the consolidated TUE/TFUE file (EUR-Lex): the
# articles after it are stored as "5 TUE", "288 TFUE", because both treaties
# number their articles from 1
TREATY_RE = re.compile(r"^TRATTATO (SULL'UNIONE EUROPEA|SUL FUNZIONAMENTO DELL'UNIONE EUROPEA)"
                       r" \(VERSIONE CONSOLIDATA\)\s*$")
TREATIES = {"SULL'UNIONE EUROPEA": 'TUE', "SUL FUNZIONAMENTO DELL'UNIONE EUROPEA": 'TFUE'}
END_RE = re.compile(r'^\s*(?:Il presente decreto, munito del sigillo dello Stato|Fatto a \S.*, il )')
# The Costituzione: recognised by its title line; its articles end before the
# transitional provisions, and its headings are not part of any article
CONSTITUTION_RE = re.compile(r'^COSTITUZIONE DELLA REPUBBLICA ITALIANA\s*$')
CONSTITUTION_END_RE = re.compile(r'^\s*DISPOSIZIONI TRANSITORIE E FINALI\s*$')
CONSTITUTION_HEADING_RE = re.compile(r'^(?:PARTE|TITOLO|SEZIONE) [IVX]+\s*$')
# Note markers "((20))", "(19)" and omitted text "(( . . . ))": ignored when
# deciding whether a line of the Costituzione ends a comma
CONSTITUTION_MARK_RE = re.compile(r'\(\(\s*\d+\s*\)\)|\(\d+\)|\(\(\s*(?:\.\s*)+\)\)')
# The only places where a line of the Costituzione ends with a full stop in
# the middle of a comma: the line after it continues that comma
# (art. 48, comma 3; art. 102, comma 2; art. 123, comma 2)
CONSTITUTION_CONTINUED = ('A tale fine è istituita una circoscrizione Estero',
                          'Possono soltanto istituirsi presso gli organi giudiziari',
                          'Per tale legge non è richiesta l\'apposizione del visto')


def norm(text):
    """Whitespace normalisation: every run of spaces/newlines becomes one space."""
    return re.sub(r'\s+', ' ', text).strip()


# Unnumbered paragraphs (codice penale): a block made only of note markers
# such as "(281)", "((281))" or ".", and a block starting a list item such as
# "1)", "5-bis)", "1°" or "a)", continue the current comma.
MARKERS_RE = re.compile(r'^[\s().,;\d]*$')
LIST_ITEM_RE = re.compile(r'^(?:\(\()?\s*(?:\d+(?:-[a-z]+)?\)|\d+°|[a-z]\))')


def unnumbered_commas(lines):
    """Split an article without numbered commas into commas.

    Used for texts like the codice penale, where each comma is a paragraph
    separated by a blank line. The first block is the heading ("(Peculato).");
    in the form "(( (Rubrica).))" followed by the text on the next line only
    that first line is the heading. Returns {"1": text, "2": text, ...}.
    """
    blocks, cur = [], []
    for line in lines:
        if line.strip():
            cur.append(line.strip())
        elif cur:
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    if blocks:
        first = blocks[0]
        if re.match(r'^\(\(\s*\(', first[0]):
            blocks[0] = first[1:]
        elif first[0].startswith('(') and not re.match(r'^\(\([^\s(]', first[0]):
            blocks[0] = []
    commas = []
    for b in blocks:
        text = ' '.join(b)
        if not text:
            continue
        if commas and (MARKERS_RE.match(text) or LIST_ITEM_RE.match(text)):
            commas[-1] += ' ' + text
        elif not MARKERS_RE.match(text):
            commas.append(text)
    return {str(i): norm(t) for i, t in enumerate(commas, 1)}


def line_commas(lines):
    """Split an article of the Costituzione into commas.

    Each comma starts on a new line and ends with a full stop at the end of a
    line (possibly followed by "))" or by note markers). Returns
    {"1": text, "2": text, ...}.
    """
    commas, cur = [], []
    for line in lines:
        text = line.strip()
        if not text:
            continue
        bare = CONSTITUTION_MARK_RE.sub('', text).strip()
        # A line of note markers or a lone "." belongs to the previous comma; a
        # listed continuation line reopens it
        if not cur and commas and (MARKERS_RE.match(bare) or text.startswith(CONSTITUTION_CONTINUED)):
            cur = [commas.pop()]
        cur.append(text)
        if bare.endswith('.') or bare.endswith('.))'):
            commas.append(' '.join(cur))
            cur = []
    if cur:
        commas.append(' '.join(cur))
    return {str(i): norm(t) for i, t in enumerate(commas, 1)}


def parse_law(path):
    """Return {article: {comma: normalised text}} for one source file.

    Numbered points ("7)") are also stored, under the key "punto 7".
    """
    with open(path, encoding='utf-8') as f:
        lines = f.read().replace('\r\n', '\n').replace('\r', '\n').split('\n')
    law, article, comma, buf, raw = {}, None, None, [], []
    treaty = None
    constitution = any(CONSTITUTION_RE.match(line) for line in lines)
    points, point, pbuf = {}, None, []

    def flush():
        if article is not None and comma is not None:
            law.setdefault(article, {})[comma] = norm('\n'.join(buf))

    def flush_point():
        # A point ends at the next point or at the end of its article
        if article is not None and point is not None:
            points.setdefault(article, {})['punto ' + point] = norm('\n'.join(pbuf))

    def end_article():
        # An article with no numbered comma: its paragraphs are its commas
        if article is not None and article not in law:
            commas = line_commas(raw) if constitution else unnumbered_commas(raw)
            if commas:
                law[article] = commas

    for line in lines:
        if END_RE.match(line) or (constitution and CONSTITUTION_END_RE.match(line)):
            break
        t = TREATY_RE.match(line)
        if t:
            flush()
            flush_point()
            end_article()
            article, comma, buf, raw = None, None, [], []
            point, pbuf = None, []
            treaty = TREATIES[t.group(1)]
            continue
        m = ARTICLE_RE.match(line)
        if m:
            flush()
            flush_point()
            end_article()
            key = m.group(1) + (' ' + treaty if treaty else '')
            article, comma, buf, raw = key, None, [], []
            point, pbuf = None, []
            points.pop(article, None)
            # The same article number seen again (e.g. the single article of an
            # approving decree before the text it approves): the later one wins
            law.pop(article, None)
            continue
        # A new Capo, or the "-----" line before the notes/updates: the comma ends here
        if (line.strip().startswith('CAPO ') or line.strip().startswith('-----')
                or (constitution and CONSTITUTION_HEADING_RE.match(line))):
            flush()
            flush_point()
            end_article()
            article, comma, buf, raw = None, None, [], []
            point, pbuf = None, []
            continue
        if article is not None:
            raw.append(line)
            p = POINT_RE.match(line)
            if p:
                flush_point()
                point, pbuf = p.group(1), [line]
            elif point is not None:
                pbuf.append(line)
        m = COMMA_RE.match(line) if article is not None else None
        # A comma number already seen in this article is not a new comma: it is
        # the text of another act quoted inside the current comma (e.g. "1. ...",
        # "2. ..." of an article inserted by L. 190/2012, art. 1, comma 44).
        if m and (m.group(1) in law.get(article, {}) or m.group(1) == comma):
            m = None
        if m:
            flush()
            comma, buf = m.group(1), [line]
            continue
        if comma is not None:
            buf.append(line)
    flush()
    flush_point()
    end_article()
    for art, pts in points.items():
        law.setdefault(art, {})
        for key, text in pts.items():
            law[art].setdefault(key, text)
    return law


def source_file(rel):
    """Absolute path of `source.file`, or (None, reason) if it is not usable."""
    if not isinstance(rel, str) or not rel.strip():
        return None, 'evidence present but source.file is missing'
    path = os.path.realpath(os.path.join(ROOT, rel))
    if not path.startswith(os.path.realpath(SOURCES_DIR) + os.sep):
        return None, 'source.file %r is not inside sources/' % rel
    if not os.path.isfile(path):
        return None, 'source.file %r does not exist' % rel
    return path, None


def main():
    files = sorted(f for f in os.listdir(QUESTIONS_DIR)
                   if f.lower().endswith('.json') and f != 'index.json')
    laws, errors, warnings, checked = {}, [], [], 0

    for name in files:
        try:
            with open(os.path.join(QUESTIONS_DIR, name), encoding='utf-8') as f:
                data = json.load(f)
        except ValueError as e:
            errors.append('%s: not valid JSON (%s)' % (name, e))
            continue
        questions = data.get('questions') if isinstance(data, dict) else data
        if not isinstance(questions, list):
            errors.append('%s: the file must contain a list [ ... ] of questions' % name)
            continue
        for q in questions:
            if not isinstance(q, dict):
                continue  # reported by tools/validate.js
            evidence = q.get('evidence')
            if evidence is None:
                continue
            qid = q.get('id', '?')
            src = q.get('source') if isinstance(q.get('source'), dict) else {}
            path, problem = source_file(src.get('file'))
            if not path:
                errors.append('%s: %s' % (qid, problem))
                continue
            if path not in laws:
                laws[path] = parse_law(path)
            law = laws[path]
            refs = []
            if not isinstance(evidence, list):
                errors.append('%s: evidence must be a list' % qid)
                continue
            for i, e in enumerate(evidence, 1):
                checked += 1
                ref, text = (e or {}).get('ref', ''), (e or {}).get('text', '')
                m = REF_RE.match(ref.strip())
                p = POINT_REF_RE.match(ref.strip())
                w = ARTICLE_REF_RE.match(ref.strip())
                if not m and not p and not w:
                    errors.append('%s evidence %d: ref %r is not in the form "art. X, comma Y" (or "par. Y", "punto Y", "art. X")' % (qid, i, ref))
                    continue
                refs.append(ref.strip())
                if w:
                    art = norm(w.group(1))
                    commas = [t for c, t in law.get(art, {}).items() if not c.startswith('punto ')]
                    body = ' '.join(commas) if commas else None
                else:
                    art, com = m.groups() if m else (p.group(1), 'punto ' + p.group(2))
                    art = norm(art)
                    body = law.get(art, {}).get(com)
                if body is None:
                    errors.append('%s evidence %d: %s not found in %s' % (qid, i, ref, os.path.basename(path)))
                elif norm(text) not in body:
                    where = [a + '/' + c for a, cs in law.items() for c, t in cs.items() if norm(text) in t]
                    errors.append('%s evidence %d: text is NOT verbatim in %s%s' % (
                        qid, i, ref, (' (found instead in art/comma ' + ', '.join(where) + ')') if where else ''))
            article = (src.get('article') or '').strip()
            if refs and article not in refs:
                warnings.append('%s: source.article %r differs from the evidence refs %s' % (qid, article, refs))

    for w in warnings:
        print('WARNING', w)
    for e in errors:
        print('ERROR  ', e)
    print('Checked %d evidence quotes: %s' % (checked, 'all verbatim' if not errors else '%d problem(s)' % len(errors)))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
