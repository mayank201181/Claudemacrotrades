"""fxopt loader (12 Nov 2026). The FX option pricer is scripts/fxopt/fxopt.py in the public GitHub repository mayank201181/Claudemacrotrades. A Drive text read now escapes characters and flattens indentation, which breaks a long Python file, so this short file fetches the pricer at a pinned commit, checks its hash and runs it. Use it exactly as before: python3 -I fxopt.py 'JSON' (a JSON list prices several legs; JSON on stdin also works). To print the usage text with every type and input: python3 -I fxopt.py usage. Save this file exactly as written here. No line in it is indented and it holds no backslash: if your copy shows one, the read added it, so delete it."""
import hashlib, os, subprocess, sys
c = "47825f3e82219675f02fb2b3f0c7b0b0e44d34ba"
h = "1fc05f6138050bf2952cab55ab7ed05d542985ccdf9d915c11a0fff61e8ab2ca"
d = "/tmp/claudemacrotrades-fxopt"
p = d + "/scripts/fxopt/fxopt.py"
u = "https://github.com/mayank201181/Claudemacrotrades.git"
w = "https://raw.githubusercontent.com/mayank201181/Claudemacrotrades/" + c + "/scripts/fxopt/fxopt.py"
run = lambda s: subprocess.run(s, shell=True).returncode
ok = lambda: os.path.isfile(p) and hashlib.sha256(open(p, "rb").read()).hexdigest() == h
ok() or run("mkdir -p " + d + "/scripts/fxopt") or run("curl -fsSL --retry 2 -o " + p + " " + w)
ok() or run("rm -rf " + d) or run("git clone -q " + u + " " + d) or run("git -C " + d + " checkout -q " + c)
ok() or sys.exit("fxopt loader: could not fetch the pricer from GitHub, or its hash is wrong (curl and git clone were both tried)")
sys.argv.pop(0)
if " ".join(sys.argv) == "usage": print(open(p).read().split('"""').pop(1)); sys.exit(0)
sys.exit(subprocess.run((sys.executable or "python3", "-I", p) + tuple(sys.argv)).returncode)
