---
title: runta-next hello
description: A no-op greeting used to smoke-test the CLI and the development loop.
sidebar_position: 15
---

# `runta-next hello`

Prints a greeting. It exists to smoke-test the binary and the dev loop — it makes no network
call and needs no credential.

```
runta-next hello [name]
```

| Argument | Default | Does |
| --- | --- | --- |
| `name` | `world` | Who to greet |

```console
$ runta-next hello
Hello, world!

$ runta-next hello Ada
Hello, Ada!
```

Useful as the first thing to run after installing, and as the CI check that a
cross-compiled binary actually executes on its target platform:

```sh
runta-next --version
runta-next hello ci
```
