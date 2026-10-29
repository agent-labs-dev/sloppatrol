# ADR 0001 — Code decides, agents propose

**Status:** Accepted
**Date:** 2026-10-28

## Context

An agent that refactors code can be wrong in ways that look right: a changed default, a reordered side effect, a test bent to match. Its own report of "behaviour unchanged" proves nothing. Speedpatrol solved the same problem for speed: statistics decide, agents explain.

## Decision

Only code keeps a refactor. The gate runs guards on the diff and then the repo's own checks; a failure rejects the refactor, and no agent can overrule it. The reviewer agent runs only on a change that passed the gate, and it can only reject. A reviewer that gives no verdict rejects. Sloppatrol does no work while the checks fail on the patrolled commit, because a red oracle verifies nothing.

## Consequences

Sloppatrol is as safe as the repo's checks are strong. A repo with weak tests gets few kept refactors, and the surveyor proposes characterization tests first. A false "approve" from the reviewer cannot ship a change that a check or a guard catches.
