# @haxzie/runta-next

An experimental command line interface for [Runta](https://runta.haxzie.com), installed as
`runta-next`.

> This is not Runta's official CLI. That one is [`@runta/runta-cli`](https://www.npmjs.com/package/@runta/runta-cli)
> and it is the complete product. This one is an experiment with a deliberately smaller surface,
> and it installs under a different name so the two can coexist.

## Install

```sh
npm install -g @haxzie/runta-next
```

Or as a standalone binary, with no Node.js required:

```sh
curl -fsSL https://runta.haxzie.com/install.sh | sh
```

## Use

```sh
runta-next login
runta-next create --name scratch
runta-next list
runta-next exec scratch -- echo hello
runta-next delete scratch
```

`--json` on any command gives machine-readable output with a settled shape. Error *text* is not
stable — branch on exit codes.

Full documentation: **https://runta.haxzie.com**
