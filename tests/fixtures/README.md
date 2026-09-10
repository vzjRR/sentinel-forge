# Test fixtures

Synthetic FiveM server layouts used by the automated test suite.

**Everything in this directory is fictional.** No fixture contains production
data, real credentials, real webhook endpoints, real player data, or code copied
from a third-party resource. Values that look like secrets are deliberately
malformed placeholders (`EXAMPLE_...`, all-zero identifiers) so that a leaked
fixture is worthless and so that credential scanners have something to match
without a real secret ever entering the repository.

Each fixture directory contains a `fixture.json` describing:

| Field | Meaning |
| --- | --- |
| `name` | Fixture identifier used by tests. |
| `synthetic` | Always `true`. Asserted by `tests/integration/fixtures.test.ts`. |
| `description` | What the fixture represents. |
| `expectedRules` | Rule ids a complete implementation should report. Not all are implemented yet; see `docs/GATE_STATUS.md`. |
| `notes` | Anything a reader needs in order to interpret the fixture. |

`expectedRules` is a specification of intended behaviour, not a claim about the
current build. Tests assert that the listed ids exist in the rule catalog; they
do not assert that the rules run yet.
