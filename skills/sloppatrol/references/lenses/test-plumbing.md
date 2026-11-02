# test-plumbing

## Defect

Tests that cost maintenance without catching realistic defects: asserting a constant equals itself,
asserting the private shape of an implementation, mocking so many collaborators that only the mocks
are tested, snapshot tests nobody reads, near-identical tests that permute inputs without new
coverage, tests of the framework or language rather than the project, and tests that can never fail.

## Do not flag

- Regression tests pinned to a real, previously shipped bug.
- Contract tests of public behaviour, error handling, security, data integrity or concurrency.
- Tests the project uses as executable documentation of an API.
- Thin tests in a codebase whose runtime is hard to test: judge them against what is feasible there.

## Judgment

Describe the realistic future change that would make this test fail. If there is none, or only a
refactor that preserves behaviour, the test is plumbing. When in doubt, prove it: break the line
the test guards and run the test. A test that still passes cannot fail.

## Output

On the test's definition. `what` says why it cannot catch a real defect; `why` names the
behaviour that remains covered elsewhere (or is genuinely uncovered and needs a better test).

## Safe move

Test through the interface with a fake injected at the seam, and assert on outcomes with independent expected values (see testing.md).
