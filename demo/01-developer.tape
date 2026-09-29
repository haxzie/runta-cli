# Act 1 — the developer path.
#
# Real calls against the live API; nothing is stubbed and nothing is sped up. `create` takes as
# long as it takes, because waiting until the runtime can accept work is the design decision.
#
#   RUNTA_TOKEN=rt_… vhs demo/01-developer.tape
#
# The token is inherited from the environment and never typed, so it cannot appear on screen.

Output "demo/out/01-developer.gif"
Output "demo/out/01-developer.mp4"

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 760
Set TypingSpeed 55ms
Set Padding 20

Hide
Type "export PATH=$PWD/demo/bin:$PATH PS1='$ '" Enter
# A previous recording may have left `demo` behind, and the API refuses a duplicate name.
Type "runta-next delete demo >/dev/null 2>&1; clear" Enter
Show

Type "runta-next create --name demo --cpus 1 --memory 512" Enter
Wait@180s /^\$$/
Sleep 3s

Type "runta-next exec demo -- sh -c 'echo hi > /tmp/x; cat /tmp/x'" Enter
Wait@60s /^\$$/
Sleep 2s

Type "runta-next list --fields name,status,vcpus" Enter
Wait@60s /^\$$/
Sleep 3s

Type "runta-next inspect demo" Enter
Wait@60s /^\$$/
Sleep 5s

Type "runta-next delete demo --dry-run" Enter
Wait@60s /^\$$/
Sleep 4s

Type "runta-next delete demo" Enter
Wait@120s /^\$$/
Sleep 3s
