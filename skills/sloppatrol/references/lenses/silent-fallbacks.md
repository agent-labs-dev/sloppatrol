# silent-fallbacks

## Defect

Missing or invalid values quietly replaced with a default where the program should fail loudly:
`value or "default"` on a required identifier, an `else` branch that assumes the common case of a
closed set, a lookup that returns nothing and is skipped without a log, a parse error answered with
an empty result, an unknown enum value mapped to a guess. The program keeps running and does the
wrong thing somewhere far away.

## Do not flag

- Defaults that are part of the documented contract (optional settings, user preferences).
- Graceful degradation that is deliberate, logged and visible (a missing optional dependency, a
  feature that turns off with a message).
- Fallbacks at an untrusted boundary where the documented behaviour is to ignore bad input.

## Judgment

If this fallback fires, will anyone find out? Would the caller rather receive an error here than a
plausible-looking wrong value?

## Output

On the fallback. `what` names the value that can be missing and the default substituted;
`why` names where the wrong value surfaces.

## Safe move

Let the failure surface, or name the fallback and its reason where it happens. Changing what a caller sees is a behaviour change: `decide`.
