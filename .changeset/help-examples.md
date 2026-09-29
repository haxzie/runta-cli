---
'@haxzie/runta-next': patch
---

Bring the examples back to `runta-next --help`.

Root help was cut to a command index, and the examples went with the prose blocks.
They should not have: a reader skimming for a command's shape finds it faster in a
runnable line than in any paragraph, and `docs.test.ts` resolves every flag in them
against the real command tree, so unlike prose they cannot rot. The output-contract
and waiting explanations stay where they moved — on the commands they describe.
