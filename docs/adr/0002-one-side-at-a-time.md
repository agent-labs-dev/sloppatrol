# ADR 0002 — One side at a time

**Status:** Accepted
**Date:** 2026-10-28

## Context

Tests are the oracle of a refactor. A change that edits the source and its tests together can change behaviour and bend the tests to match, and every check still passes.

## Decision

Each opportunity kind has a side. A `source` refactor may change no test file: the unchanged tests prove the behaviour held. A `tests` refactor (`characterize`, `replace-mock`, `test-through-interface`) may change no source file: the unchanged source proves the new tests are right. The `one-side` guard enforces it from the diff, with the `tests` globs of the config. A tests refactor may not remove a test case.

Work that needs both sides is two refactors: first `inject-dependency` adds a seam with today's behaviour as the default, then `replace-mock` injects a fake through it.

## Consequences

Some refactors take two pull requests. In return each pull request has an oracle that the same pull request did not touch.
