# Yoshi

A one-page site for Yoshi Cormac Babaganoush: his pedigree back five
generations, and a health log built from his vet paperwork.

Everything lives in `index.html` — no build step. Open it, or push and let
GitHub Pages serve it.

## The password

The site sits behind a password box. `index.html` stores a SHA-256 hash of the
password, never the password itself, and remembers an unlocked device in
`localStorage`.

To change it, hash the new password and drop it in:

```sh
printf 'newpassword' | sha256sum
```

Replace the value of `PASS` in `index.html` (and the matching hash in the small
`<script>` just after the gate markup, which is what skips the box on a device
that has already been let in).

Worth being clear about what this is: a curtain, not a lock. The page source is
public, so anyone who knows to look can read what's in it. It keeps casual
visitors out; don't put anything genuinely sensitive behind it.

## Adding to the health log

The `LOG` list near the bottom of `index.html` holds every entry. Copy a block,
change the fields, done — the weight chart, the entry count and the "coming up"
countdowns all follow from it.

There's also an add-entry form on the page itself. That saves to the browser it
was typed on, which is handy from the sofa but invisible to everyone else; the
*copy my entries for the file* button hands you the block to paste into `LOG`.

## Litter-Robot sync

Whisker only keeps 7 days of visits and weights unless you pay for Whisker+.
`.github/workflows/litter-sync.yml` runs daily, pulls that rolling window with
[pylitterbot](https://github.com/natekspencer/pylitterbot), and appends anything
new to `data/litter.json`. Leave it running and the archive builds up on our
side — the history the subscription sells, for nothing.

To switch it on, add two repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `WHISKER_EMAIL` | the email you log into the Whisker app with |
| `WHISKER_PASSWORD` | that account's password |

Until those exist the job runs, finds no credentials, exits cleanly, and the
site hides the Litter-Robot panel. Nothing looks broken in the meantime.

Two things to know:

- Scheduled workflows only run on the **default branch**, so this does nothing
  until it's merged to `main`. GitHub also pauses schedules after 60 days with
  no activity in the repo.
- `data/litter.json` is committed to a public repo, so his weights and visit
  counts are public. Low stakes for a cat, but it's true regardless of the
  password gate — the gate can't hide a file the site has to fetch.

### If the weights look wrong

The Whisker API returns pounds, so the script converts. If the site shows
roughly half his real weight, add a repository *variable* (not a secret) called
`LITTER_WEIGHT_UNIT` set to `kg` and re-run the job. Every reading keeps its raw
value alongside the converted one, so switching re-interprets the whole history
rather than losing it.

### Running it by hand

```sh
pip install -r scripts/requirements.txt
WHISKER_EMAIL=you@example.com WHISKER_PASSWORD=... python scripts/litter_sync.py
```

pylitterbot is an unofficial client for an API Whisker doesn't publish, so it
can break when they change something. If the job starts failing, check for a
newer pylitterbot release first.
