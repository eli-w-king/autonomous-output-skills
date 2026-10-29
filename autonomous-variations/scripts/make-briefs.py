#!/usr/bin/env python3
"""Write one brief and one short start prompt per variation from templates, so a lab's sessions start from files
on disk instead of long pasted prompts. No dependencies.

    python3 make-briefs.py <run folder> [--out <dir>] [--hosts "<host>=<ids>;<host>=<ids>"]
                           [--port-base 4600] [--var KEY=VALUE]...

Reads from the run folder:
  brief-variation.template.md  the brief, with {PLACEHOLDERS} and PASTE lines (required)
  variations.md                a markdown table with the columns Id, Name and Idea, and optionally Folder
                               (v/<nn>-<slug>); optionally a "## Notes per variation" section of numbered items
                               ("1. **Name.** text") numbered like the ids, or in row order for ids like A3
  prompt.template.md           the short start prompt (optional; warned about past 1500 characters)
  host-notes-<host>.md         notes for the sessions on one host (optional)

Placeholders: {ID} {NN} {KIND} {SLUG} {NAME} {IDEA} {NOTES} {HOST} {PORT}, and any {KEY} given with --var.
A line "PASTE: <file>" becomes that file from the run folder; "PASTE: a.md | b.md" takes the first that exists
(for example the kit's final contract, else the expected one), and a trailing " demote" pushes its headings one
level down. "PASTE: variations-table" pastes the table, "PASTE: host-notes" the host's notes. Pasted text is filled
in too.

--hosts assigns ids to hosts, for example "boxa=1-10;boxb=11-20" (default: every id on "local"). Kinds are v<NN>
for numeric ids (v01) and the id in lowercase otherwise (a3). Ports are the port base plus the id (plus the row
number for ids that are not numbers).

Writes brief-<kind>.md and prompt-<kind>.md into --out (default <run>/briefs), never into the run folder, and never
deletes anything, so no cleanup glob can take a template with it. Writes nothing when a placeholder or PASTE line
is left over, a text has an em or en dash, or an id repeats.
"""
import argparse
import os
import pathlib
import re
import sys
import tempfile

PLACEHOLDER = re.compile(r'\{([A-Z][A-Z0-9_]*)\}')
PASTE = re.compile(r'^PASTE: (.+?)( demote)?[ \t]*$', re.M)
KIND = re.compile(r'[a-z][a-z0-9]{0,23}')


def fail(msg):
    sys.exit(f'make-briefs: {msg}')


def row_cells(line):
    s = line.strip()
    return [c.strip() for c in s.strip('|').split('|')] if s.startswith('|') else None


def parse_table(text):
    lines = text.splitlines()
    for i, line in enumerate(lines):
        cells = row_cells(line)
        if not cells or not {'id', 'name', 'idea'} <= {c.lower() for c in cells}:
            continue
        header = [c.lower() for c in cells]
        j, rows = i + 2, []
        while j < len(lines) and lines[j].strip().startswith('|'):
            rows.append(dict(zip(header, row_cells(lines[j]))))
            j += 1
        return '\n'.join(lines[i:j]), rows
    fail('variations.md has no table with Id, Name and Idea columns')


def parse_notes(text):
    m = re.search(r'^## Notes per variation.*$', text, re.M | re.I)
    if not m:
        return {}
    section = text[m.end():]
    end = re.search(r'^## ', section, re.M)
    section = section[:end.start()] if end else section
    notes = {}
    for item in re.finditer(r'^\s*(\d+)\. \*\*[^*]+\*\*(.*?)(?=^\s*\d+\. \*\*|\Z)', section, re.M | re.S):
        lines = [l.strip() for l in item.group(2).strip().splitlines() if l.strip()]
        first = [] if not lines or lines[0].startswith('- ') else [lines.pop(0)]
        notes[int(item.group(1))] = '\n'.join(['- ' + l for l in first] + lines)
    return notes


def parse_hosts(spec):
    hosts = {}
    for part in filter(None, re.split(r'[;\s]+', spec)):
        host, _, ids = part.partition('=')
        if not host or not ids:
            fail(f'--hosts: expected <host>=<ids>, got "{part}"')
        for chunk in filter(None, ids.split(',')):
            if re.fullmatch(r'\d+-\d+', chunk):
                lo, hi = map(int, chunk.split('-'))
                hosts.update({str(i): host for i in range(lo, hi + 1)})
            else:
                hosts[str(int(chunk)) if chunk.isdigit() else chunk.lower()] = host
    return hosts


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.tmp-', suffix='-' + path.name)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('run', help='the run folder with the templates')
    ap.add_argument('--out', help='where the briefs and prompts go (default <run>/briefs)')
    ap.add_argument('--hosts', default='', help='"<host>=<ids>;<host>=<ids>", for example "boxa=1-10;boxb=11-20"')
    ap.add_argument('--port-base', type=int, default=4600)
    ap.add_argument('--var', action='append', default=[], metavar='KEY=VALUE')
    a = ap.parse_args()

    run = pathlib.Path(a.run).resolve()
    out = pathlib.Path(a.out).resolve() if a.out else run / 'briefs'
    if out == run:
        fail('--out must be a folder of its own, never the run folder that holds the templates')
    template = run / 'brief-variation.template.md'
    if not template.is_file():
        fail(f'missing {template}')
    variations = (run / 'variations.md').read_text(encoding='utf-8')
    table, rows = parse_table(variations)
    notes = parse_notes(variations)
    hosts = parse_hosts(a.hosts)
    extra = {}
    for kv in a.var:
        key, sep, value = kv.partition('=')
        if not sep or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key):
            fail(f'--var expects KEY=VALUE with an uppercase KEY, got "{kv}"')
        extra[key] = value
    prompt_file = run / 'prompt.template.md'
    texts = {'brief': template.read_text(encoding='utf-8')}
    if prompt_file.is_file():
        texts['prompt'] = prompt_file.read_text(encoding='utf-8')

    def host_notes(host):
        f = run / f'host-notes-{host}.md'
        return f.read_text(encoding='utf-8').strip() if f.is_file() else '- No notes for this machine yet.'

    def paste(text, host):
        def repl(m):
            for option in (o.strip() for o in m.group(1).split('|')):
                if option == 'variations-table':
                    content = table
                elif option == 'host-notes':
                    content = host_notes(host)
                elif (run / option).is_file():
                    content = (run / option).read_text(encoding='utf-8').strip()
                else:
                    continue
                return re.sub(r'^(#+) ', r'#\1 ', content, flags=re.M) if m.group(2) else content
            return m.group(0)
        return PASTE.sub(repl, text)

    outputs, seen, problems, summary = {}, set(), [], []
    for n, row in enumerate(rows, 1):
        vid, name, idea = row.get('id', ''), row.get('name', ''), row.get('idea', '')
        if not vid or not name:
            problems.append(f'row {n}: needs an id and a name')
            continue
        numeric = vid.isdigit()
        nn = f'{int(vid):02d}' if numeric else vid.lower()
        kind = f'v{nn}' if numeric else vid.lower()
        if not KIND.fullmatch(kind) or kind in seen:
            problems.append(f'row {n}: id "{vid}" repeats or does not make a kind')
            continue
        seen.add(kind)
        folder = re.search(r'(\d+)-([a-z0-9-]+)/?$', row.get('folder', '').strip('`'))
        slug = folder.group(2) if folder else re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        key = str(int(vid)) if numeric else vid.lower()
        host = hosts.get(key) or ('local' if not a.hosts else None)
        if not host:
            problems.append(f'id {vid} has no host in --hosts')
            continue
        values = {
            'ID': vid, 'NN': nn, 'KIND': kind, 'SLUG': slug, 'NAME': name, 'IDEA': idea, 'HOST': host,
            'PORT': str(a.port_base + (int(vid) if numeric else n)),
            'NOTES': notes.get(int(vid) if numeric else n, '- None beyond the idea above.'),
            **extra,
        }
        for what, text in texts.items():
            filled = PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), paste(text, host))
            left = sorted(set(PLACEHOLDER.findall(filled)))
            if left:
                problems.append(f'{what}-{kind}: unfilled {", ".join("{" + x + "}" for x in left)}')
            for m in PASTE.finditer(filled):
                problems.append(f'{what}-{kind}: nothing to paste for "{m.group(1)}"')
            if any(d in filled for d in ('\u2013', '\u2014')):
                problems.append(f'{what}-{kind}: has an em or en dash')
            if what == 'prompt' and len(filled) > 1500:
                print(f'make-briefs: warning: prompt-{kind}.md is {len(filled)} characters; keep start prompts short', file=sys.stderr)
            outputs[out / f'{what}-{kind}.md'] = filled
        summary.append(f'{kind}\t{host}\t{values["PORT"]}\t{name}')
    if problems:
        fail('nothing written:\n  ' + '\n  '.join(dict.fromkeys(problems)))
    for path, text in outputs.items():
        write_atomic(path, text)
    print('\n'.join(summary))
    print(f'wrote {len(outputs)} file(s) for {len(seen)} variation(s) to {out}')


if __name__ == '__main__':
    main()
