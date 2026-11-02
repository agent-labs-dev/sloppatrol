# hidden-dependency

## Defect

Logic that creates or reaches for what it depends on instead of receiving it: `new Client()`, a
global, a singleton, `process.env` or `os.environ`, the clock or randomness used inside a decision,
or a concrete adapter where the code uses only a few of its methods. The logic cannot be tested
with values alone, and every caller inherits the dependency without seeing it.

## Do not flag

- The composition root (the `main`, the server bootstrap, the app root): creating real adapters is
  its job.
- A thin effect layer at the edge whose only job is the I/O, when the decisions sit in pure
  functions it calls.
- Configuration read once at startup and passed down from there.
- Code a test already reaches through a seam (an optional parameter with the real value as its
  default, a constructor argument).

## Judgment

Could a test exercise this decision with plain values and a fake? If not, name the dependency the
logic creates and the decision it hides. Then look for something that would vary across a seam: a
test that patches the dependency with a mocking library is the evidence.

## Output

On the line that creates or reads the dependency inside the logic. `what` names the dependency and
the decision that uses it; `why` names the test or caller that cannot reach it, and any mock that
patches it.

## Safe move

Inject it through a parameter or constructor, with the current concrete value as the default; the
composition root creates the real one (`inject-dependency`). Remove the default later, in its own
change. Where only a few methods are used, a small port owned by the consumer holds just those.
