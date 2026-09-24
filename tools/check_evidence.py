#!/usr/bin/env python3
"""
Check that every `evidence` quote in the question files is copied verbatim
from the law text saved in sources/.

For each question with an `evidence` list, and for each item in it:
  1. `ref` must look like "art. 25, comma 4" (also "art. 27, comma 2-bis");
  2. `text` must appear, word for word, inside THAT comma of THAT article
     of the source file. The only normalisation allowed is whitespace:
     line breaks and repeated spaces count as a single space.

It also warns when `source.article` does not match the evidence refs.

The source file is the one named in each question's `source.file`, e.g.
"sources/L241-1990_2026-09-24.txt" (a path inside the project folder).
A question with `evidence` but no `source.file` is an error.

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

SUFFIX = r'(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?'
ARTICLE_RE = re.compile(r'^\s*Art\.\s+(\d+' + SUFFIX + r')\s*$')
# A comma starts at the beginning of a line: "3. ", "2-bis. ", "((2. ", "1.((COMMA..."
COMMA_RE = re.compile(r'^(?:\(\()?\s*(\d+' + SUFFIX + r')\.(?=\s|\(\(|$)')
REF_RE = re.compile(r'^art\.\s+(\d+' + SUFFIX + r'),\s+comma\s+(\d+' + SUFFIX + r')$')


def norm(text):
    """Whitespace normalisation: every run of spaces/newlines becomes one space."""
    return re.sub(r'\s+', ' ', text).strip()


def parse_law(path):
    """Return {article: {comma: normalised text}} for one source file."""
    with open(path, encoding='utf-8') as f:
        lines = f.read().replace('\r\n', '\n').replace('\r', '\n').split('\n')
    law, article, comma, buf = {}, None, None, []

    def flush():
        if article is not None and comma is not None:
            law.setdefault(article, {})[comma] = norm('\n'.join(buf))

    for line in lines:
        m = ARTICLE_RE.match(line)
        if m:
            flush()
            article, comma, buf = m.group(1), None, []
            continue
        # A new Capo, or the "-----" line before the notes/updates: the comma ends here
        if line.strip().startswith('CAPO ') or line.strip().startswith('-----'):
            flush()
            article, comma, buf = None, None, []
            continue
        m = COMMA_RE.match(line) if article is not None else None
        if m:
            flush()
            comma, buf = m.group(1), [line]
            continue
        if comma is not None:
            buf.append(line)
    flush()
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
                if not m:
                    errors.append('%s evidence %d: ref %r is not in the form "art. X, comma Y"' % (qid, i, ref))
                    continue
                art, com = m.groups()
                refs.append(ref.strip())
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
