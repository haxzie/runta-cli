---
title: runta hello
description: A no-op greeting used to smoke-test the CLI and the development loop.
sidebar_position: 10
---

# `runta hello`

Prints a greeting. It exists to smoke-test the binary and the dev loop — it makes no network
call and needs no credential.

```
runta hello [name]
```

| Argument | Default | Does |
| --- | --- | --- |
| `name` | `world` | Who to greet |

```console
$ runta hello
Hello, world!

$ runta hello Ada
Hello, Ada!
```

Useful as the first thing to run after installing, and as the CI check that a
cross-compiled binary actually executes on its target platform:

```sh
runta --version
runta hello ci
```
