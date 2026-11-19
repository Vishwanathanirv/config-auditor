# Benchmark

`npm run bench` checks Redline against misconfiguration test cases written by other projects,
so the rules are measured on files their author did not write. Results: [RESULTS.md](RESULTS.md)
(current) and [BASELINE.md](BASELINE.md) (before any rule was tuned on this data).

## Where the files come from

| Source | Version | Licence | Used for |
| --- | --- | --- | --- |
| [KICS](https://github.com/Checkmarx/kics) query tests | tag `v2.1.21` | Apache-2.0 ([licenses/KICS-LICENSE](licenses/KICS-LICENSE)) | Dockerfile, Docker Compose, Kubernetes |
| [gixy-ng](https://pypi.org/project/gixy-ng/) plugin tests | 0.2.63 | MPL-2.0 ([licenses/gixy-ng-LICENSE](licenses/gixy-ng-LICENSE)) | nginx |

The files in `fixtures/` are unmodified copies; `fixtures/manifest.json` records where each came
from and whether it should be reported. `npm run bench:fetch` downloads them again at the pinned
versions. KICS publishes each query's test files on its documentation pages, which is where they
are read from; JSON duplicates of YAML tests are skipped.

No public, labelled test suite for `sshd_config` was found, so sshd rules are covered only by the
unit tests.

## How it is scored

[sources.ts](sources.ts) maps each external check to the Redline rule that means the same thing.
Checks that are broader or narrower than every Redline rule (for example KICS "Container Traffic
Not Bound To Host Interface", which flags every port while Redline flags only database ports) are
left out instead of being stretched to fit.

- A **positive** file (KICS `positive*`, gixy files not ending `_fp.conf`) is found when one of
  the mapped rules fires anywhere in it.
- A **negative** file (KICS `negative*`, gixy `*_fp.conf`) is a false positive when one of the
  mapped rules fires. Other rules are ignored: those files are only clean for the one check
  they test.

## Held-out split

Each file goes to the development set (about 60%) or the test set by a SHA-256 hash of its
path, fixed once. Rules were changed using only the development set (`npm run bench -- --dev`
lists its misses). The test-set numbers show whether those changes carry over to files that were
not looked at while changing the rules.

## Where Redline disagrees with the labels on purpose

Some development-set "false positives" were looked at and left as they are, because the label
describes a narrower check than Redline's and Redline's finding is correct. They still count
against Redline in the numbers.

- `missing-user-instruction/negative-1`: the final stage (`FROM scratch`) has no `USER`, so it
  runs as root. KICS only checks that a `USER` appears somewhere in the file.
- `add-instead-of-copy/negative-1`: `ADD https://…` downloads with no checksum. Redline
  reports that; KICS treats a URL as a valid use of `ADD`.
- `apt-get-install-lists-were-not-deleted/negative-1` and `-2`: `apt-get clean` empties
  `/var/cache/apt/archives` but leaves `/var/lib/apt/lists`, which is what the check is about.
- `workload-mounting-with-sensitive-os-directory/negative-1`, `docker-daemon-socket-…/negative-1`:
  these mount `/opt`, `/tmp/…` and `/data` from the node. The Kubernetes "baseline" Pod Security
  Standard forbids every `hostPath` volume, so Redline reports them (at high, not critical).

Development-set misses that were left alone: gixy treats `.` in a regex capture as able to carry
a line break and `ssl_prefer_server_ciphers on` as weak; Redline's rules don't, and `add_trailer`
inheritance is out of scope.
