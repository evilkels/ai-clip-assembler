# Research: a sandboxed Lua runtime for Review-chat timeline scripting

Date: 2026-09-29 · Branch: `research/rcs-lua-runtime` · Scope: research only, no
product code.

**Question.** An **Editor** (or the **In-App Review Agent**) will paste a short
Lua script into the Review chat, like pasting a script into DaVinci Resolve's
console, and it edits the **Timeline**. The backend embeds Lua with the `lupa`
package. Each script runs in a fresh, locked-down Lua runtime whose only
capability is a small API object we expose. Its mutations are **recorded** as
**Operations** (the `{"operation": name, "args": {...}}` shape that
`TimelineController.apply_batch` takes, `backend/src/timeline_ops.py`) and never
applied live. That fits [ADR 0002](../adr/0002-backend-authoritative-timeline.md):
the Operations core stays the only mutation path, and a script's output is a
batch of Operations (a **Proposal** for the Review Agent) rather than a
side-channel write.

Everything below marked **[E]** was verified by experiment on this machine
(macOS arm64, CPython 3.9.6, lupa 2.8, throwaway `.lupa-venv`, not committed).
Other claims cite a primary source. Scratch scripts are reproduced at the end.

## Recommendation

- **Pin `lupa==2.8`** (2026-04-15, MIT). Every other backend dependency in
  `backend/requirements.txt` is pinned with `==`, and the sandbox depends on
  exact engine behaviour.
- **Use the Lua 5.4 engine, imported explicitly:** `import lupa.lua54 as lupa`.
  Never a bare `import lupa` (it silently binds to the newest engine, `lua55`
  today, and would move again when lupa adds one, and it also breaks the
  PyInstaller build, see §6).
- **LuaJIT is not an option:** none of the macOS wheels ship it [E].
- Lua 5.4 gives the 5.4 feature set (integers, `<close>`, `//`, bitwise
  operators), a mature runtime that LLMs and the Editor know, and `max_memory`
  works on it [E].
- **Known trade-off: `pairs()` order over string keys is not deterministic
  between processes on 5.4** [E]. lupa's `string_hash_seed` fixes this only on
  Lua 5.5 [E]. Recorded Operations are the output and are never re-executed, so
  we accept this and document it. If replay-determinism ever becomes a
  requirement, switch to `lupa.lua55` with `string_hash_seed=<constant>`
  (verified: 1 distinct order over 12 processes) or provide a sorted `pairs`.
- **Run every script under all four limits together:** an instruction budget
  and a wall-clock deadline (both from a count hook), `max_memory`, and caps on
  recorded Operations and log lines. The hook alone is not enough, see §3.
- **No `hiddenimports` or hook is needed** in `backend/packaging/backend.spec`
  provided the code imports `lupa.lua54` statically (§6). Adding
  `"lupa.lua54"` to `hiddenimports` costs nothing and guards against a later
  refactor to a dynamic import.

## 1. Release, license, engines, wheels, which engine

**Release and license.**

| Fact | Value | Source |
|---|---|---|
| Latest release | 2.8, uploaded 2026-04-15 (2.7 on 2026-04-07) | PyPI JSON https://pypi.org/pypi/lupa/2.8/json [E] |
| License | "MIT style" (`LICENSE.txt`); Lua is MIT as well | PyPI metadata `license: 'MIT style'`; wheel `dist-info/licenses/LICENSE.txt` [E] |
| Python | `>=3.8` | PyPI metadata |

**Engines bundled.** The README says lupa "ships with Lua 5.1, 5.2, 5.3, 5.4
and 5.5 as well as LuaJIT 2.0 and 2.1 on systems that support it"
(https://github.com/scoder/lupa#readme, feature list). The wheels on macOS do
**not** include LuaJIT. I opened all ten macOS wheels (arm64 and x86_64 × CPython
3.9–3.13) and listed the extension modules [E]:

```
3.9-macosx_11_0_arm64   -> ['lua51', 'lua52', 'lua53', 'lua54', 'lua55']
3.9-macosx_10_9_x86_64  -> ['lua51', 'lua52', 'lua53', 'lua54', 'lua55']
... (identical for 3.10, 3.11, 3.12, 3.13, both architectures)
```

`import lupa.luajit21` raises `ImportError` in the installed wheel [E]. The
sdist's `third-party/lua54/lua.h` has `LUA_VERSION_RELEASE "8"`, so the bundled
engine is **Lua 5.4.8** [E] (from `lupa-2.8.tar.gz`,
https://pypi.org/project/lupa/2.8/#files).

**Wheels for macOS** [E, from the PyPI file list and `pip download --platform`
resolution]:

| Python | arm64 | x86_64 |
|---|---|---|
| 3.9 | `lupa-2.8-cp39-cp39-macosx_11_0_arm64.whl` | `lupa-2.8-cp39-abi3-macosx_10_9_x86_64.whl` |
| 3.10 | `cp310-cp310-macosx_11_0_arm64` | same `cp39-abi3` wheel |
| 3.11 | `cp311-cp311-macosx_11_0_arm64` | same `cp39-abi3` wheel |
| 3.12+ | `cp312`/`cp313`/`cp314` `-macosx_11_0_arm64` | `cp312-abi3-macosx_10_13_x86_64` (or the `cp39-abi3` one) |

`pip download lupa==2.8 --only-binary=:all: --platform <macosx_11_0_arm64 |
macosx_10_9_x86_64> --python-version <3.9…3.13>` resolved a wheel for every
combination. I only *executed* lupa on arm64 with CPython 3.9.6; the x86_64
wheels were verified by tag and contents, not run. The repo's `python3` is
`/usr/bin/python3` (3.9.6) and `backend/.venv/bin/python` is also 3.9.6.

**Which engine.**

| Criterion | lua54 | lua55 | luajit21 |
|---|---|---|---|
| In macOS wheels | yes | yes | **no** |
| `max_memory` enforced | yes (`LuaMemoryError`) [E] | yes [E] | docstring: "Not supported on 64bit LuaJIT" |
| Deterministic `pairs` order | no (12 orders in 12 processes) [E] | only with `string_hash_seed` (1 order in 12) [E] | n/a |
| Maturity | Lua 5.4.8 | newest engine in lupa (added in 2.7) | n/a |

The `string_hash_seed` option is documented in the runtime docstring: "hash
seed for Lua strings. (default: randomly initialised. Ignored in Lua < 5.5.)"
(`lupa.lua54.LuaRuntime.__doc__` [E]; changelog 2.7: "In Lua 5.5, the string
hash seed can be configured for each `LuaRuntime`"). Passing
`string_hash_seed=12345` to `lua54` still gave 12 different orders in 12
processes [E], confirming it is ignored there.

Measured with `.lupa-scratch/determinism.py`:

```
lua54: 12 distinct pairs() orders over 12 fresh processes
lua55: 12 distinct pairs() orders over 12 fresh processes
lua54 with string_hash_seed=12345: 12 distinct order(s) over 12 fresh processes
lua55 with string_hash_seed=12345: 1 distinct order(s) over 12 fresh processes
```

Engine choice: **lua54**, for the reasons in the Recommendation.

Bare `import lupa` picks the engine at runtime. `lupa/__init__.py:44-66`:
`_import_newest_lib` lists the package directory with `os.listdir`, matches
`((lua[a-z]*)([0-9]*))\..*` and takes `max(..., key=(m[1] == 'lua', version))`
("prefer Lua over LuaJIT and high versions over low versions"), then
`__import__(module_name[0], level=1, ...)`. Verified: `from lupa import
LuaRuntime; LuaRuntime.__module__ == 'lupa.lua55'` [E]. The README says the
same: "By default, `import lupa` uses the latest Lua version, but you can choose
a specific one via import".

## 2. Sandbox [E]

### Constructing the runtime

```python
lupa.LuaRuntime(register_eval=False, register_builtins=False,
                attribute_filter=_deny,          # raises AttributeError for everything
                unpack_returned_tuples=False,    # the default; a tuple stays one value
                max_memory=16 * 1024 * 1024)
```

What each option does, and what it does *not* do (source: lupa 2.8
`lupa/_lupa.pyx`, README "Restricting Lua access to Python objects"):

- `register_eval=False` / `register_builtins=False` only stop
  `python.eval` and `python.builtins` being registered
  (`_lupa.pyx:679-682`). The docstring is explicit: they do "not remove it from
  the builtins. Use an `attribute_filter` function for that", and for
  `register_builtins` "this does not prevent access to the globals available as
  special Python function attributes".
- The `python` global **still exists** with `args, as_attrgetter, as_function,
  as_itemgetter, enumerate, iter, iterex, none, set_overflow_handler` (from
  `py_lib`, `_lupa.pyx:2510-2518`; confirmed by listing it at runtime [E]).
  The sandbox deletes the whole `python` table.
- `attribute_filter(obj, attr_name, is_setting)` is called "for all Python
  object attributes that are being accessed from Lua code"; raise
  `AttributeError` to deny. The README warns that "attributes of Python
  functions provide access to the current `globals()` and therefore to the
  builtins", and recommends "a list of dedicated API objects" plus a whitelist.
  `attribute_handlers=(getter, setter)` is the equivalent with the handler doing
  the access itself. We use a deny-all filter as a **second layer**, because the
  script never receives a Python object (below).
- `unpack_returned_tuples=False` is the default; keeping it means a Python
  callable that returns a tuple does not fan out into Lua values.
- README, Restricting section: "Any Lupa deployment that allows untrusted Lua
  code to be executed should disable the access to Python's builtin functions".

### Building the script's environment

lupa's `LuaRuntime.compile(lua_code, name=None, mode=None)` has **no `env`
argument** [E] (`TypeError: compile() got an unexpected keyword argument
'env'`). So the boot chunk (Lua, run once per runtime) builds an `env` table
and hands back a loader that calls Lua's own `load(src, "=script", "t", env)`.
Lua 5.4 manual, `load`: "The string mode controls whether the chunk can be
text or binary ... `"t"` (only text chunks)", and "running maliciously crafted
bytecode can crash the interpreter"
(https://www.lua.org/manual/5.4/manual.html#pdf-load). Mode `"t"` refuses
bytecode: `LuaSyntaxError: attempt to load a binary chunk (mode is 't')` [E].

`env` is a *whitelist copy*: `assert error ipairs next pairs pcall select
tonumber tostring type`, a subset of `math` (no `random`, which would be
non-deterministic), `table` (`concat insert remove sort unpack`), `string`, a
`print` that appends to a capped log, a guarded `setmetatable`, and `api`. The
real `_G` is *also* stripped of `os io package require load loadfile dofile
debug collectgarbage getmetatable rawset rawget coroutine utf8 warn xpcall
python` as defence in depth (the boot chunk keeps the few it needs as
upvalues).

### Escape vectors and how the sketch closes each

| # | Vector | Evidence | Closed by | Test |
|---|---|---|---|---|
| 1 | `os`, `io`, `package`, `require`, `dofile`, `loadfile` | Lua manual §6 | not in `env`, stripped from `_G` | `os.execute` … `dofile` |
| 2 | `load` of source or bytecode; malicious bytecode can crash the VM | manual `load` | `load` not in `env`; loader is mode `"t"` | `load`, `loadstring-via-_G`, `compile(bytecode, mode=t)` |
| 3 | `debug.*` (sethook, getinfo, upvalue access) | manual §6.10 | not in `env`; the hook is installed from the boot chunk before `debug` is stripped | `debug` |
| 4 | `string.dump`, reachable as `("x"):dump()` because every string's metatable points at the *real* `string` table | [E] | `string.dump = nil` **on the real table** (patching only the `env` copy would leave the method form open) | `string.dump`, `string.dump via metatable` |
| 5 | `collectgarbage` | manual `collectgarbage` | not in `env` | `collectgarbage` |
| 6 | `python` global: `as_attrgetter`, `as_function`, `iter`, … even with `register_*=False` | `_lupa.pyx:2510` [E] | `python` not in `env`, stripped from `_G` | `python.eval`, `python.builtins`, `python.as_attrgetter` |
| 7 | `getmetatable` on a Python object returns lupa's internal metatable table (observed: `getmetatable(api.ok)` returned a table) [E] | probe | `getmetatable` not in `env` (also blocks `getmetatable("").__index`) | `getmetatable`, `getmetatable on string` |
| 8 | Python function attributes (`__globals__`, `__self__`, `__class__`) | README | script only ever sees **Lua closures** around the Python callables, plus a deny-all `attribute_filter` behind them | `api is Lua closures, not Python`, `raw fn.*` |
| 9 | A caught Python exception arrives in Lua as a userdata proxy of the exception object | [E] `type(e) == "userdata"` | `guard` converts every Python error to a **string** with `error(tostring(res), level)` | `caught API error is a string` |
| 10 | Lua tables/functions passed *into* Python callables are live proxies into the runtime | `_LuaTable` in error text [E] | `_arg()` accepts only `str` / `int` / `float` | `Lua table into API is rejected` |
| 11 | `rawset`/`rawget`/`_ENV` tricks | manual | `rawset`/`rawget` not in `env`; `_ENV` is the per-run `env` table, so it reaches nothing global | `rawset`, `rawget`, `_ENV escape` |
| 12 | Coroutines | [E] a runaway inside `coroutine.wrap` was **not** stopped even with the re-armed hook | `coroutine` not in `env` | `coroutine` |
| 13 | `__gc` finalizers run with hooks **off** | Lua source `lgc.c` `GCTM` (tag v5.4.7): `L->allowhook = 0;  /* stop debug hooks during GC metamethod */`; manual §2.5.3; and observed on lupa's bundled 5.4.8 [E]: an infinite `__gc` loop was not stopped in 20 s by the hook | `setmetatable` wrapper refuses a metatable that has a `__gc` key (manual: the object is only marked "when you set its metatable and the metatable has a `__gc` metamethod") | `__gc finalizer` |
| 14 | Pattern matching (`find`/`match`/`gmatch`/`gsub`) is one native call the hook cannot interrupt | manual `lua_sethook`: the count hook "only happens while Lua is executing a Lua function" | removed from the real `string` table | `string.match`, `string.gsub` |
| 15 | `string.rep('', 3e9)` burns CPU in a native loop with **zero** memory | [E] 3.64 s, hook never fires | `string.rep` wrapper caps `n` and `n * len` at 1e6 | `string.rep empty x 3e9` |
| 16 | Unbounded Python-side growth (`print`, recorded Operations) is outside `max_memory` | design | counts capped: 200 log lines, 1000 Operations | `print flood`, `op flood` |

Two subtler findings the sketch handles:

- **A hook that raises once is bypassed by `pcall`.** `while true do
  pcall(function() while true do end end) end` was *not stopped* in 8 s with a
  hook that only calls `error` [E]. After tripping, the hook re-arms itself with
  `debug.sethook(hook, "", 1)` (count 1), so the very next VM instruction of any
  caller re-raises, and every enclosing `pcall` unwinds. Result: stopped in
  0.00 s.
- **After a trip the runtime is poisoned.** The hook is now armed at count 1, so
  *any* further Lua call from Python (even a "read the reason" getter) raises
  again. The sketch reports the reason through a **Python callback made from
  inside the hook** (`on_trip`), and the runtime is then discarded.

### Proof: blocked capabilities raise

The full suite is under "Escape tests" below. Excerpt (all 50 checks pass):

```
PASS  os.execute        ScriptError: script:1: attempt to index a nil value (global 'os')
PASS  load              ScriptError: script:1: attempt to call a nil value (global 'load')
PASS  string.dump via metatable   ScriptError: script:1: attempt to call a nil value (method 'dump')
PASS  python.eval       ScriptError: script:1: attempt to index a nil value (global 'python')
PASS  __gc finalizer    ScriptError: script:1: __gc is not allowed
PASS  raw fn.__globals__  AttributeError: access denied
PASS  compile(bytecode, mode=t)  LuaSyntaxError: attempt to load a binary chunk (mode is 't')
```

## 3. Limits [E]

**Memory: `max_memory`.** Added in lupa 2.0 (README "Restricting Lua Memory
Usage"; changelog GH#211). Set only at construction: `set_max_memory` on a
runtime built without it raises `RuntimeError: max_memory must be set on
LuaRuntime creation` [E] (`_lupa.pyx:603`). Enforced on **all** five bundled
engines (`lua51`–`lua55`), each raising `LuaMemoryError` for a 1e7-element table
under a 200 kB cap [E]. `LuaMemoryError` "inherits from `LuaError` and
`MemoryError`" (README, `_lupa.pyx:128`), and from Python its `str()` is empty
[E]; a script that `pcall`s it sees the string `not enough memory` [E]. The
allocator limit is applied via `lua_newstate` with a restricted allocator
(`_lupa.pyx:277-285`). The ~20 KiB the runtime itself uses is excluded unless
`total=True`: fresh runtime `get_memory_used() == 0`, `total=True` gives 21 358
bytes [E]. After the error `get_memory_used()` still reported 524 772 bytes
(garbage not yet collected), so discard the runtime rather than reuse it.

**CPU: a count hook installed from the boot chunk.** `debug.sethook(hook, "",
1000)` calls `hook` "after the interpreter executes every count instructions"
(manual `debug.sethook`). A **Python** callable cannot be the hook (it is
userdata, not a Lua function), so the hook is a Lua function defined in the boot
chunk, run *before* `debug` is removed from the environment. Installed by that
call from Python, it stays in force for the later calls into the same runtime
(verified: every limit test above trips). A runaway inside a coroutine was not
stopped (row 12); I did not confirm the mechanism, so coroutines are simply
excluded.

Two limits in the same hook:

1. **Instruction budget:** `ticks > max_ticks` (1 tick = 1000 instructions).
2. **Wall clock:** `time.monotonic()` (passed in as a Python callable,
   captured as an upvalue the script cannot reach) `> deadline`.

Why both: the instruction budget is deterministic but does not bound wall time,
because a single VM instruction can hide a native call. Measured [E]: a loop of
`table.remove(t, 1); table.insert(t, 1, 0)` over a 200 000-element array was
**not stopped in 60 s** under a 5M-instruction budget, but was stopped at
**1.02 s** by a 1 s wall-clock check in the same hook. The wall-clock check costs
nothing measurable: a 3e7-iteration `for` loop took 0.22 s without it and 0.23 s
with it.

**Runaway loop stopped within the limit** (`.lupa-scratch/limits_measure.py`):

```
== instruction budget (wall clock generous) ==
while true do end, max_instructions=100,000       0.001s  ScriptLimitError(instruction limit exceeded)
while true do end, max_instructions=1,000,000     0.002s  ScriptLimitError(instruction limit exceeded)
while true do end, max_instructions=5,000,000     0.012s  ScriptLimitError(instruction limit exceeded)
while true do end, max_instructions=50,000,000    0.093s  ScriptLimitError(instruction limit exceeded)
== wall clock (instruction budget effectively unlimited) ==
while true do end, timeout_s=0.05                 0.050s  ScriptLimitError(time limit exceeded)
while true do end, timeout_s=0.25                 0.250s  ScriptLimitError(time limit exceeded)
while true do end, timeout_s=1.0                  1.000s  ScriptLimitError(time limit exceeded)
while true do end, timeout_s=2.0                  2.000s  ScriptLimitError(time limit exceeded)
== nested pcall/function loops ==
pcall loop, timeout_s=0.5                         0.500s  ScriptLimitError(time limit exceeded)
== throughput ==
for i=1,2e7 (legit)                               0.101s  finished
```

About 400 M VM instructions per second here, so the default of 5 000 000
instructions is ~12 ms of CPU: generous for a timeline script. Per-run setup
(fresh runtime + boot chunk) measured 0.06 ms over 200 runs.

**How the error surfaces in Python.** The hook's `error("instruction limit
exceeded", 0)` comes out of the Lua call as `lupa.LuaError`; the sketch checks
its own `on_trip` record first and raises `ScriptLimitError`. Memory exhaustion
is `lupa.LuaMemoryError` (a `LuaError` subclass: catch it first) →
`ScriptLimitError("memory limit exceeded")`.

**What no hook can stop.** The count hook only fires while Lua executes Lua
code; native functions are opaque (manual, `lua_sethook`: "This event only
happens while Lua is executing a Lua function"). Measured [E]:

- Lua patterns: `('a'):rep(300):find(('a-'):rep(4)..'b')` ran **49.9 s**, and the
  600-character variant did not finish in 60 s. **Removed** from the sandbox.
- `string.rep('', 3e9)`: 3.64 s. **Capped.**
- Remaining single native calls at the default 16 MiB memory cap are cheap, and
  the memory cap bounds them: `table.sort` of a 5e5-element array with the
  default comparator 0.09 s (fill included), `table.insert(t, 1, x)` /
  `table.remove(t, 1)` on 5e5 elements 0.01 s each. A 1e6-element array does not
  fit in 16 MiB [E], so ~5e5 elements is the ceiling. Worst overshoot past the
  deadline is therefore ~0.1 s.

If pattern matching (`string.match`, `gsub`) is later wanted, the only sound
way is to run scripts in a **subprocess** with a hard kill; capping subject
length does not help, because the cost is polynomial in the number of `-`/`*`
quantifiers, not just the subject length.

## 4. Data and errors [E]

**Exposing callables and plain values.** Build the API as a Lua table of Python
callables with `rt.table_from({...})` (README "Lua Tables"; `recursive=True`
converts nested dicts/lists, changelog GH#199, and works in 2.8 as used by the
sketch). The `items()` API returns `rt.table_from(items, recursive=True)`: a
*fresh plain Lua table* on each call, so no Python object crosses the boundary.
Returning a plain `int`/`float`/`str`/`bool`/`None` needs nothing special
(`None` → `nil`). Returning a Python `dict`/`list` would hand the script a
proxy, so do not.

Each callable is wrapped in a Lua closure (`guard`) before the script sees it,
so a script never holds a Python callable at all (`api.set_speed.__globals__`
→ `attempt to index a function value`).

**Python exceptions inside a callable.** Uncaught, they propagate out of the
Lua call as the *original Python exception* (`ValueError`, not `LuaError`) [E];
caught by a script's `pcall`, they arrive as a userdata. `guard` therefore
catches with `pcall` and rethrows `error(tostring(res), level)` so the script
sees a string at its own line.

**Message format.** Unmodified lupa, `rt.execute(...)` [E]:

```
runtime error on line 3:
  LuaError('[string "<python>"]:3: attempt to perform arithmetic on a nil value\nstack traceback:\n\t[string "<python>"]:3: in main chunk')
error() on line 2:
  LuaError('[string "<python>"]:2: nope\nstack traceback:\n\t[string "<python>"]:2: in main chunk\n\t[C]: in function \'error\'')
syntax error:
  LuaSyntaxError('error loading code: [string "<python>"]:2: <name> expected near \'=\'')
```

So `LuaError` / `LuaSyntaxError` carry `chunkname:LINE:` from Lua, and lupa
appends a Lua `stack traceback:` (it calls `debug.traceback` as the message
handler, found via the *real* `_G.debug`, `_lupa.pyx:1917-1927`). Once the
sketch strips `_G.debug`, **no traceback is appended** (the regex in
`run_script` is belt and braces) and, with our own chunk name `"=script"`, the
messages become:

```
runtime error on line 3:  script:3: attempt to perform arithmetic on a nil value
syntax error (line 2):    script:2: <name> expected near '='
API misuse on line 3:     script:3: expected a number, got str
```

In the sketch a syntax error is *not* a `LuaSyntaxError`: `load` in the loader
returns `nil, message` and Python raises `ScriptError(message)`. A runtime error
is `LuaError` → `ScriptError(cleaned message)`. If lupa's own `compile()` is
used instead, syntax errors do surface as `LuaSyntaxError` (README:
`LuaSyntaxError` subclasses `LuaError`).

**Error position through wrappers.** `error(msg, 2)` names the caller of the
function that raised; the `guard` frame is level 1, the script is level 2. For
`print` (which goes through `print` → `write` → `log`) the level is 3. An early
draft used level 2 for `print` and reported the *boot chunk's* line
(`[string "<python>"]:49`) instead of the script's; the test `print flood` now
asserts `script:1:`.

## 5. Threading [E]

- **GIL: released while Lua runs.** README feature list: "frees the GIL and
  supports threading in separate runtimes when calling into Lua". Source:
  `execute_lua_call` runs `lua_pcall` inside `with nogil:` (`_lupa.pyx:1916`).
  Measured: 4 CPU-bound Lua runtimes took 0.65 s sequentially and 0.17 s in 4
  threads (**3.8× speed-up**, 18 cores); the pure-Python control took 0.51 s vs
  0.50 s (1.0×).
- **One runtime per script run is the intended model.** README "Threading":
  "each `LuaRuntime` is protected by a global lock that prevents concurrent
  access to it" (`_lupa.pyx:291`, a per-runtime `FastRLock`), and "values
  cannot easily be exchanged between threads inside of Lua". Do not share a
  runtime between concurrent requests.
- **A runtime is usable from a different thread than the one that created
  it:** a runtime created on the main thread and driven from three separate
  worker threads incremented one Lua counter correctly (3 distinct thread
  names). `asyncio.to_thread` may run creation and execution on different pool
  threads, so this is required and works.
- **`asyncio.to_thread` under load.** Five concurrent runtimes: a 1 s runaway
  (stopped at 1.00 s), a 0.3 s runaway (0.30 s), a memory bomb (0.00 s) and two
  legitimate scripts (0.00–0.01 s) all finished with their own limits. The
  event loop's 10 ms heartbeat had a **worst gap of 11 ms** during the runaway,
  so the GIL is not starved.
- **Callbacks re-take the GIL.** Every Python callable (`api.*`, `log`, the
  `clock` in the hook) re-acquires it, so the hook calls `time.monotonic` once
  per 1000 instructions: negligible cost measured above.
- **Per-process global state:** none that matters. Lua state, allocator
  counters (`_memory_status`), hooks, hash seed and lock are all fields of the
  `LuaRuntime` (`_lupa.pyx:268-291`). The module-level assignments in
  `_lupa.pyx` are imports, constants (`POBJECT`, `LUPAOFH`, `PYREFST`,
  `LUA_VERSION`) and the static function tables `py_lib` / `py_object_lib`; I
  found no mutable module-level runtime state (a read of the assignments, not a
  proof). The engine choice in `lupa/__init__.py` is cached in `_newest_lib`
  (only for bare `import lupa`). The one process-wide knob is
  `lupa.allow_lua_module_loading()` (temporarily sets `sys.setdlopenflags`); the
  sandbox never calls it. `math.random` seeding and `os.setlocale` would be
  process-affecting, and both are absent from the environment.
- **Cancellation does not stop Lua.** Cancelling the awaiting task leaves the
  worker thread running the script until a limit trips. The limits are the only
  stop mechanism, so the hook must always be installed and `max_memory` always
  set.

## 6. PyInstaller [E]

`backend/packaging/backend.spec` sets `hiddenimports=collect_submodules("src")`
and the entry point loads the app by string (`uvicorn.run("src.api:app")`), so
`src.*` modules are found only through that list, and their own imports are then
analysed normally.

PyInstaller detects `import` statements statically. The docs: "Hidden imports
can occur when the code is using `__import__()`, `importlib.import_module()` or
perhaps `exec()` or `eval()` ... When this occurs, Analysis can detect nothing.
There will be no warnings, only an ImportError at run-time" and the remedies are
`--hidden-import`, `hiddenimports` in the spec, or a hook
(https://pyinstaller.org/en/stable/when-things-go-wrong.html#listing-hidden-imports).
lupa's `__init__` is exactly that case for a bare `import lupa` (`os.listdir` +
`__import__`, `lupa/__init__.py:44-66`). pyinstaller-hooks-contrib (PyInstaller
6.22.3, the version `npm run build:backend` gets, since it installs
`pyinstaller` unpinned) has **no lupa hook** (no file or reference to `lupa`
under `_pyinstaller_hooks_contrib`) [E].

Experiment: freeze one-folder apps with PyInstaller 6.22.3 (CPython 3.9.6,
arm64) and run the *frozen* executable:

| App | Bundled | Frozen exe result |
|---|---|---|
| `import lupa.lua54 as lupa` | `_internal/lupa/lua54.cpython-39-darwin.so` only | **OK**: `OK Lua 5.4 2` |
| bare `import lupa` | nothing from lupa | **fails**: `FileNotFoundError: ... _internal/lupa` (the `os.listdir` in `_import_newest_lib`) |
| `importlib.import_module('lupa.lua' + '54')` | nothing | **fails**: `ModuleNotFoundError: No module named 'lupa'` |
| bare `import lupa` + `--hidden-import lupa.lua54` | `lua54` `.so` | OK |
| `importlib` + `--hidden-import lupa.lua54` | `lua54` `.so` | OK |
| bare `import lupa` + `--collect-binaries lupa` | nothing (engines are extension modules, not binaries) | fails |

Then a closer replica: a `backend/` tree containing a **verbatim copy of
`backend/packaging/backend.spec`**, a `src` package holding the sketch
(`src/lua_sandbox.py`, `import lupa.lua54 as lupa`), and an entry point that
loads `src.lua_sandbox` only through `importlib.import_module`, exactly how
`uvicorn.run("src.api:app")` reaches `src`:

```
build rc = 0
bundled engines: ['_internal/lupa/lua54.cpython-39-darwin.so']
frozen exe rc = 0 | stdout: FROZEN OK ScriptResult(operations=[{'operation': 'split_item', 'args': {'item_id': 'a1', 'at_sec': 5}}], log=['hi']) | stderr tail:
```

**Conclusion.** With a static `import lupa.lua54` inside `src/`, the existing
`collect_submodules("src")` is sufficient: PyInstaller follows the import, bundles
only the `lua54` extension (the other four engines are not shipped), and the
frozen sandbox runs. **Do not** `import lupa` bare and do not select the engine
with `importlib`. Optional insurance: append `"lupa.lua54"` to `hiddenimports`
and keep a frozen smoke test. Not tested: the real backend build (needs
opencv/onnxruntime), and x86_64 (not executed on this host).

## Sandboxed runtime sketch

`sandbox.py`, verified by running: the escape suite below imports it. About 78
lines of Python plus a 61-line Lua boot chunk. `record` is a stub that appends
`{"operation", "args"}` dictionaries in the `apply_batch` input shape; the
product version would dry-run each one through `apply_operation` (see Open
risks).

```python
"""Sandboxed Lua runtime sketch for Review-chat timeline scripts (lupa 2.8, Lua 5.4)."""
import re
import time
from typing import Any, Dict, List, NamedTuple

import lupa.lua54 as lupa  # pin the engine: bare `import lupa` binds to lua55

MAX_OPS, MAX_LOG_LINES = 1000, 200


class ScriptError(Exception):
    """The script failed; str() is a clean `script:LINE: message` for the Editor."""


class ScriptLimitError(ScriptError):
    """Instruction, wall-clock or memory limit hit."""


class ScriptResult(NamedTuple):
    operations: List[Dict[str, Any]]  # shape of TimelineController.apply_batch input
    log: List[str]


# Runs once per runtime, inside Lua, before the script exists: captures the dangerous
# builtins as upvalues, builds the script's environment, installs the limit hook.
_BOOT = r"""
local api, log, clock, deadline, max_ticks, on_trip = ...
local load, pcall, error, select, tostring, type, rawget, setmetatable =
      load, pcall, error, select, tostring, type, rawget, setmetatable
local sethook, real_rep = debug.sethook, string.rep
local ticks, tripped = 0, nil

local function hook()                       -- fires every 1000 VM instructions
  ticks = ticks + 1
  if ticks > max_ticks then tripped = "instruction limit exceeded"
  elseif clock() > deadline then tripped = "time limit exceeded" end
  if tripped then                           -- re-arm at count 1 so pcall can't swallow it; the
    on_trip(tripped); sethook(hook, "", 1)  -- runtime is now poisoned, so report from here
    error(tripped, 0)
  end
end

-- string is shared with every string's metatable, so patch it in place.
string.dump, string.find, string.match, string.gmatch, string.gsub = nil, nil, nil, nil, nil
string.rep = function(s, n, sep)            -- uninterruptible native loop, cap it
  if n > 1e6 or n * (#tostring(s) + #tostring(sep or "")) > 1e6 then error("string.rep too large", 2) end
  return real_rep(s, n, sep)
end

local function pick(src, ...)
  local t = {}
  for i = 1, select("#", ...) do local k = select(i, ...); t[k] = src[k] end
  return t
end
local env = pick(_G, "assert", "error", "ipairs", "next", "pairs", "pcall", "select", "tonumber", "tostring", "type")
env._G, env.string = env, string
env.math = pick(math, "abs", "ceil", "floor", "fmod", "huge", "max", "min", "pi", "sqrt", "tointeger", "type")
env.table = pick(table, "concat", "insert", "remove", "sort", "unpack")
env.setmetatable = function(t, mt)         -- hooks are off while finalizers run
  if type(mt) == "table" and rawget(mt, "__gc") ~= nil then error("__gc is not allowed", 2) end
  return setmetatable(t, mt)
end
local function guard(fn, level)             -- Python exceptions -> Lua errors at the script's line
  return function(...)
    local ok, res = pcall(fn, ...)
    if not ok then error(tostring(res), level) end
    return res
  end
end
local write = guard(log, 3)                 -- print -> write -> log: one frame deeper
env.print = function(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring(select(i, ...)) end
  write(table.concat(parts, "\t"))
end
env.api = {}
for name, fn in pairs(api) do env.api[name] = guard(fn, 2) end

for _, k in ipairs{"os", "io", "package", "require", "load", "loadfile", "dofile", "debug", "collectgarbage",
                   "getmetatable", "rawset", "rawget", "coroutine", "utf8", "warn", "xpcall", "python"} do
  _G[k] = nil                               -- defence in depth: the real globals are stripped too
end
sethook(hook, "", 1000)
return function(src)
  local fn, err = load(src, "=script", "t", env)   -- "t": text only, never bytecode
  if not fn then return false, err end
  fn()
  return true, nil
end
"""


def _deny(obj, name, is_setting):
    raise AttributeError("access denied")


def _arg(kind, value):  # Lua tables/functions arrive as live runtime proxies: accept plain scalars only
    ok = isinstance(value, str) if kind is str else (isinstance(value, (int, float)) and not isinstance(value, bool))
    if not ok:
        raise ValueError("expected a %s, got %s" % ("string" if kind is str else "number", type(value).__name__))
    return value


def run_script(source: str, items: List[Dict[str, Any]], *, max_instructions=5_000_000,
               timeout_s=2.0, max_memory=16 * 1024 * 1024) -> ScriptResult:
    rt = lupa.LuaRuntime(register_eval=False, register_builtins=False, attribute_filter=_deny,
                         unpack_returned_tuples=False, max_memory=max_memory)
    ops: List[Dict[str, Any]] = []
    log: List[str] = []

    def record(operation, **args):
        if len(ops) >= MAX_OPS:
            raise ValueError("too many operations")
        ops.append({"operation": operation, "args": args})

    def _log(line):
        if len(log) >= MAX_LOG_LINES:
            raise ValueError("too much output")
        log.append(line)

    api = rt.table_from({
        "items": lambda: rt.table_from(items, recursive=True),
        "split_item": lambda item_id, at_sec: record("split_item", item_id=_arg(str, item_id), at_sec=_arg(float, at_sec)),
        "set_speed": lambda item_id, speed: record("set_speed", item_id=_arg(str, item_id), speed=_arg(float, speed)),
    })
    tripped: List[str] = []
    boot = rt.compile(_BOOT, name="=sandbox", mode="t")
    run = boot(api, _log, time.monotonic, time.monotonic() + timeout_s, max_instructions // 1000, tripped.append)
    try:
        ok, err = run(source)
    except lupa.LuaMemoryError:
        raise ScriptLimitError("memory limit exceeded") from None
    except lupa.LuaError as exc:
        if tripped:  # the runtime is poisoned after a trip: never call back into it
            raise ScriptLimitError(tripped[0]) from None
        raise ScriptError(re.sub(r"\n?stack traceback:.*", "", str(exc), flags=re.S)) from None
    if not ok:  # load() failed: syntax error
        raise ScriptError(err)
    return ScriptResult(ops, log)
```

Usage, and what a legitimate script produces (from the suite):

```
legit: ScriptResult(operations=[{'operation': 'split_item', 'args': {'item_id': 'a1', 'at_sec': 5.0}}], log=['done'])
```

for `for _, it in ipairs(api.items()) do api.split_item(it.item_id, it.end_sec / 2) end print('done')`.

## Escape tests

Each script runs in a fresh sandbox; a blocked capability must raise
`ScriptError` (with the expected message and line number) and a runaway must
raise `ScriptLimitError`. The suite was **red first**: the first runs failed
because of a bug in my sketch (`run()` returned one value where two were
unpacked), wrong expectations (`_ENV.os` reports `global 'os'`, the Python
callables were already hidden behind Lua closures) and the hook-poisoning trap
described in §2 (calling back into the tripped runtime raised again), each fixed
in the sketch or the test's *expectation about the sketch's design*, never by
removing an assertion. Naive variants also *escaped*, before the mitigations
were added [E]: a hook that raises once did not stop a `pcall` loop (not stopped
in 8 s); a `__gc` finalizer with `while true do end` was not stopped in 20 s;
`string.rep('', 3e9)` ran 3.6 s inside one native call.

`escape_tests.py`:

```python
"""Every blocked capability must raise ScriptError; every runaway must be stopped by a limit."""
import sys
import time

import lupa.lua54 as lupa
from sandbox import ScriptError, ScriptLimitError, run_script

ITEMS = [{"item_id": "a1", "start_sec": 0.0, "end_sec": 10.0, "speed": 1.0}]

# (name, script, expected exception type, expected message fragment)
CASES = [
    # --- capabilities that must not exist -------------------------------------------------
    ("os.execute", "os.execute('touch /tmp/pwned')", ScriptError, "attempt to index a nil value (global 'os')"),
    ("io.open", "io.open('/etc/passwd')", ScriptError, "global 'io'"),
    ("package", "return package.loaded", ScriptError, "global 'package'"),
    ("require", "require('os')", ScriptError, "global 'require'"),
    ("load", "load('return 1')()", ScriptError, "global 'load'"),
    ("loadstring-via-_G", "_G.load('return 1')()", ScriptError, "field 'load'"),
    ("loadfile", "loadfile('/etc/passwd')", ScriptError, "global 'loadfile'"),
    ("dofile", "dofile('/etc/passwd')", ScriptError, "global 'dofile'"),
    ("debug", "debug.sethook()", ScriptError, "global 'debug'"),
    ("string.dump", "string.dump(function() end)", ScriptError, "field 'dump'"),
    ("string.dump via metatable", "return ('x'):dump()", ScriptError, "attempt to call a nil value (method 'dump')"),
    ("collectgarbage", "collectgarbage('collect')", ScriptError, "global 'collectgarbage'"),
    ("getmetatable", "getmetatable(api.items)", ScriptError, "global 'getmetatable'"),
    ("getmetatable on string", "getmetatable('').__index.dump()", ScriptError, "global 'getmetatable'"),
    ("rawset", "rawset(_G, 'x', 1)", ScriptError, "global 'rawset'"),
    ("rawget", "rawget(_G, 'load')", ScriptError, "global 'rawget'"),
    ("coroutine", "coroutine.wrap(function() end)()", ScriptError, "global 'coroutine'"),
    ("xpcall", "xpcall(print, print)", ScriptError, "global 'xpcall'"),
    ("_ENV escape", "return _ENV.os.execute", ScriptError, "global 'os'"),
    ("syntax error", "local x = 1\nlocal = 2\n", ScriptError, "script:2: <name> expected near '='"),
    ("runtime error line 3", "local a = 1\nlocal b = 2\nlocal c = nil + 1\nreturn c", ScriptError, "script:3: attempt to perform arithmetic on a nil value"),
    ("API error carries script line", "local a = 1\nlocal b = 2\napi.set_speed('a1', 'fast')", ScriptError, "script:3: expected a number, got str"),
    ("Lua table into API is rejected", "api.set_speed({}, 2)", ScriptError, "script:1: expected a string, got _LuaTable"),
    ("Lua function into API is rejected", "api.set_speed(print, 2)", ScriptError, "script:1: expected a string, got _LuaFunction"),
    ("string.match (pattern DoS)", "return ('x'):match('x')", ScriptError, "method 'match'"),
    ("string.gsub (pattern DoS)", "return string.gsub('x', 'x', 'y')", ScriptError, "field 'gsub'"),
    # --- Python reachability --------------------------------------------------------------
    ("python.eval", "return python.eval('1')", ScriptError, "global 'python'"),
    ("python.builtins", "return python.builtins.open", ScriptError, "global 'python'"),
    ("python.as_attrgetter", "return python.as_attrgetter", ScriptError, "global 'python'"),
    ("api is Lua closures, not Python", "return api.set_speed.__globals__", ScriptError, "attempt to index a function value"),
    ("api fn attribute write", "api.set_speed.x = 1", ScriptError, "attempt to index a function value"),
    ("caught API error is a string", "local ok, e = pcall(api.set_speed, 'a1', 'fast') error(type(e) .. ': ' .. e, 0)", ScriptError, "string: expected a number, got str"),
    # --- finalizers run with hooks disabled, so they must be refused ----------------------
    ("__gc finalizer", "setmetatable({}, {__gc = function() while true do end end})", ScriptError, "__gc is not allowed"),
    # --- limits ---------------------------------------------------------------------------
    ("while true", "while true do end", ScriptLimitError, "instruction limit exceeded"),
    ("pcall loop", "while true do pcall(function() while true do end end) end", ScriptLimitError, "instruction limit exceeded"),
    ("recursion", "local function f(n) return 1 + f(n + 1) end return f(1)", ScriptError, "stack overflow"),
    ("string.rep empty x 3e9", "return #string.rep('', 3e9)", ScriptError, "string.rep too large"),
    ("string.rep memory", "return #string.rep('x', 9e5)", ScriptLimitError, "memory limit exceeded"),
    ("table memory", "local t = {} for i = 1, 1e9 do t[i] = i end", ScriptLimitError, "memory limit exceeded"),
    ("string doubling", "local s = 'x' while true do s = s .. s end", ScriptLimitError, "memory limit exceeded"),
    ("table.remove amplification", "local t = {} for i = 1, 100000 do t[i] = i end while true do table.remove(t, 1) table.insert(t, 1, 0) end", ScriptLimitError, "time limit exceeded"),
    ("print flood", "while true do print('x') end", ScriptError, "script:1: too much output"),
    ("op flood", "while true do api.set_speed('a1', 2) end", ScriptError, "too many operations"),
]

DEFAULT = dict(max_instructions=2_000_000, timeout_s=5.0, max_memory=1 << 19)
OVERRIDES = {
    # wall-clock is the binding limit here: instruction budget effectively unlimited
    "table.remove amplification": dict(max_instructions=10 ** 9, timeout_s=1.0, max_memory=1 << 24),
    # enough memory for Lua's own stack-depth limit to trip before the allocator does
    "recursion": dict(max_instructions=10 ** 9, timeout_s=5.0, max_memory=1 << 28),
}
failed = 0
for name, script, exc, fragment in CASES:
    kwargs = OVERRIDES.get(name, DEFAULT)
    t0 = time.perf_counter()
    try:
        run_script(script, ITEMS, **kwargs)
        outcome, ok = "NO ERROR", False
    except ScriptError as e:  # ScriptLimitError is a subclass
        first = str(e).splitlines()[0]
        ok = type(e) is exc and fragment in str(e)
        outcome = f"{type(e).__name__}: {first}"
    dt = time.perf_counter() - t0
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {name:32} {dt:5.2f}s  {outcome[:110]}")

# second layer: even a raw Python callable handed to Lua exposes no attributes
from sandbox import _deny
raw = lupa.LuaRuntime(register_eval=False, register_builtins=False, attribute_filter=_deny)
raw.globals().fn = lambda x: x
for label, src in [("raw fn.__globals__", "return fn.__globals__"), ("raw fn.__self__", "return fn.__self__"),
                   ("raw fn.__class__", "return fn.__class__"), ("raw fn.x = 1", "fn.x = 1"),
                   ("raw fn.__call__", "return fn.__call__"), ("raw fn.__code__", "return fn.__code__")]:
    try:
        raw.execute(src)
        print("FAIL ", label, "-> no error"); failed += 1
    except AttributeError as e:
        print("PASS ", f"{label:32} AttributeError: {e}")
    except lupa.LuaError as e:
        print("PASS ", f"{label:32} {type(e).__name__}: {str(e).splitlines()[0]}")

# text-only loader: a binary chunk is refused even if a script somehow had one
bytecode = lupa.LuaRuntime(encoding=None).eval("string.dump(function() return 1 end)")
try:
    lupa.LuaRuntime().compile(bytecode, name="=script", mode="t")
    print("FAIL  bytecode accepted"); failed += 1
except lupa.LuaError as e:
    print("PASS ", f"{'compile(bytecode, mode=t)':32} {type(e).__name__}: {e}")

# legit script still works
res = run_script("for _, it in ipairs(api.items()) do api.split_item(it.item_id, it.end_sec / 2) end print('done')", ITEMS)
print("legit:", res)
print("FAILED" if failed else "ALL BLOCKED", failed)
sys.exit(1 if failed else 0)
```

Output (`.lupa-venv/bin/python escape_tests.py`, exit code 0):

```
PASS  os.execute                        0.00s  ScriptError: script:1: attempt to index a nil value (global 'os')
PASS  io.open                           0.00s  ScriptError: script:1: attempt to index a nil value (global 'io')
PASS  package                           0.00s  ScriptError: script:1: attempt to index a nil value (global 'package')
PASS  require                           0.00s  ScriptError: script:1: attempt to call a nil value (global 'require')
PASS  load                              0.00s  ScriptError: script:1: attempt to call a nil value (global 'load')
PASS  loadstring-via-_G                 0.00s  ScriptError: script:1: attempt to call a nil value (field 'load')
PASS  loadfile                          0.00s  ScriptError: script:1: attempt to call a nil value (global 'loadfile')
PASS  dofile                            0.00s  ScriptError: script:1: attempt to call a nil value (global 'dofile')
PASS  debug                             0.00s  ScriptError: script:1: attempt to index a nil value (global 'debug')
PASS  string.dump                       0.00s  ScriptError: script:1: attempt to call a nil value (field 'dump')
PASS  string.dump via metatable         0.00s  ScriptError: script:1: attempt to call a nil value (method 'dump')
PASS  collectgarbage                    0.00s  ScriptError: script:1: attempt to call a nil value (global 'collectgarbage')
PASS  getmetatable                      0.00s  ScriptError: script:1: attempt to call a nil value (global 'getmetatable')
PASS  getmetatable on string            0.00s  ScriptError: script:1: attempt to call a nil value (global 'getmetatable')
PASS  rawset                            0.00s  ScriptError: script:1: attempt to call a nil value (global 'rawset')
PASS  rawget                            0.00s  ScriptError: script:1: attempt to call a nil value (global 'rawget')
PASS  coroutine                         0.00s  ScriptError: script:1: attempt to index a nil value (global 'coroutine')
PASS  xpcall                            0.00s  ScriptError: script:1: attempt to call a nil value (global 'xpcall')
PASS  _ENV escape                       0.00s  ScriptError: script:1: attempt to index a nil value (global 'os')
PASS  syntax error                      0.00s  ScriptError: script:2: <name> expected near '='
PASS  runtime error line 3              0.00s  ScriptError: script:3: attempt to perform arithmetic on a nil value
PASS  API error carries script line     0.00s  ScriptError: script:3: expected a number, got str
PASS  Lua table into API is rejected    0.00s  ScriptError: script:1: expected a string, got _LuaTable
PASS  Lua function into API is rejected  0.00s  ScriptError: script:1: expected a string, got _LuaFunction
PASS  string.match (pattern DoS)        0.00s  ScriptError: script:1: attempt to call a nil value (method 'match')
PASS  string.gsub (pattern DoS)         0.00s  ScriptError: script:1: attempt to call a nil value (field 'gsub')
PASS  python.eval                       0.00s  ScriptError: script:1: attempt to index a nil value (global 'python')
PASS  python.builtins                   0.00s  ScriptError: script:1: attempt to index a nil value (global 'python')
PASS  python.as_attrgetter              0.00s  ScriptError: script:1: attempt to index a nil value (global 'python')
PASS  api is Lua closures, not Python   0.00s  ScriptError: script:1: attempt to index a function value (field 'set_speed')
PASS  api fn attribute write            0.00s  ScriptError: script:1: attempt to index a function value (field 'set_speed')
PASS  caught API error is a string      0.00s  ScriptError: string: expected a number, got str
PASS  __gc finalizer                    0.00s  ScriptError: script:1: __gc is not allowed
PASS  while true                        0.00s  ScriptLimitError: instruction limit exceeded
PASS  pcall loop                        0.00s  ScriptLimitError: instruction limit exceeded
PASS  recursion                         0.02s  ScriptError: script:1: stack overflow
PASS  string.rep empty x 3e9            0.00s  ScriptError: script:1: string.rep too large
PASS  string.rep memory                 0.00s  ScriptLimitError: memory limit exceeded
PASS  table memory                      0.00s  ScriptLimitError: memory limit exceeded
PASS  string doubling                   0.00s  ScriptLimitError: memory limit exceeded
PASS  table.remove amplification        1.05s  ScriptLimitError: time limit exceeded
PASS  print flood                       0.00s  ScriptError: script:1: too much output
PASS  op flood                          0.00s  ScriptError: script:1: too many operations
PASS  raw fn.__globals__               AttributeError: access denied
PASS  raw fn.__self__                  AttributeError: access denied
PASS  raw fn.__class__                 AttributeError: access denied
PASS  raw fn.x = 1                     AttributeError: access denied
PASS  raw fn.__call__                  AttributeError: access denied
PASS  raw fn.__code__                  AttributeError: access denied
PASS  compile(bytecode, mode=t)        LuaSyntaxError: attempt to load a binary chunk (mode is 't')
legit: ScriptResult(operations=[{'operation': 'split_item', 'args': {'item_id': 'a1', 'at_sec': 5.0}}], log=['done'])
ALL BLOCKED 0
```

## Open risks

1. **Pattern matching is unavailable, and adding it back needs a subprocess.**
   An Editor script that wants `string.match` / `gsub` cannot have it in-process:
   one crafted pattern held the interpreter for 50 s (§3). Either provide
   `api` helpers for the few cases wanted (e.g. a plain-substring `find`), or
   run scripts in a `multiprocessing`/subprocess worker with a hard kill. The
   latter would also make a `lupa`/Lua VM crash (below) survivable.
2. **The VM is not crash-proof.** The Lua manual says malicious *bytecode* can
   crash the interpreter, and we close that door (no `load`, mode `"t"`), but a
   memory-safety bug in Lua 5.4.8 or in lupa's C glue would take the whole
   FastAPI process down, not one request. In-process embedding is a
   defence-in-depth sandbox, not an isolation boundary.
3. **Limits are the only cancellation.** `asyncio` cancellation cannot stop a
   worker thread running Lua; only the instruction/wall-clock hook and
   `max_memory` can. A bug that lets the hook be uninstalled or bypassed leaves
   a thread spinning. Keep the escape suite (§ Escape tests) in CI.
4. **Native-call overshoot.** The hook cannot interrupt a native call, so the
   deadline can be overshot by the longest single call left in the whitelist
   (measured ≤ ~0.1 s at a 16 MiB cap). Raising `max_memory` raises that bound.
   Removing `table.sort`, `table.insert`, `table.remove`, `table.concat`,
   `table.unpack` would eliminate it at the price of usability.
5. **Non-deterministic `pairs()` order on Lua 5.4** [E]. Harmless for recorded
   Operations, but a script that emits Operations in `pairs()` order over
   string-keyed tables (for example `for id, item in pairs(api.items_by_id())`)
   can produce differently ordered Operations on each run. Mitigations: use
   arrays and `ipairs`, add a sorted `pairs`, or move to `lua55` +
   `string_hash_seed`.
6. **Scripts cannot reference items created by their own earlier Operations.**
   `_add_item` and `_split_item` mint fresh `item_id`s with `uuid`
   (`timeline_ops.py`), so a recording-only API cannot return them. The
   product recorder should dry-run each Operation through `apply_operation` on a
   working copy, return the new ids to the script, and reject invalid ones
   *at the script's line* (the `TimelineOpError` message becomes a Lua error via
   `guard`). It must also carry the `expected_revision` the script's
   `api.items()` snapshot was read at, so `apply_batch` can reject a stale
   Proposal with `TimelineRevisionConflict`.
7. **Lua values that cross into Python are live.** Anything the script passes
   into a Python callable is a `_LuaTable` / `_LuaFunction` proxy tied to the
   runtime and its lock. `_arg()` rejects them today; every future API function
   must validate the same way, and must never *return* a Python container.
   Related: a Python callable raising is caught only if it is behind `guard`.
8. **Untested on x86_64 and against the real backend build.** Wheel tags and
   contents were verified for macOS x86_64, but lupa was executed only on arm64,
   and PyInstaller was run on a replica of the spec rather than the full backend
   (which needs opencv and onnxruntime). Windows and Linux wheels were not
   examined.
9. **Product decision, not researched here:** whether an Editor-authored script's
   Operations apply directly or go through a **Proposal** review step
   (ADR 0002 requires a Proposal for the In-App Review Agent, and lets the
   Editor drive an External Agent directly).
10. **Memory accounting is Lua-side only.** Strings and tables *returned to*
    Python, the recorded Operations and the log live in Python and are not
    counted by `max_memory`; they are bounded by the operation and line caps
    only, and each entry's size by `_arg`.

## Sources

- lupa 2.8 on PyPI (metadata, README, changelog, file list):
  https://pypi.org/project/lupa/2.8/ and https://pypi.org/pypi/lupa/2.8/json
- lupa repository and README: https://github.com/scoder/lupa. Source cited from
  the 2.8 sdist, `lupa/_lupa.pyx`, and the wheel's `lupa/__init__.py`.
- Lua 5.4 Reference Manual: https://www.lua.org/manual/5.4/manual.html, §2.5.3
  (garbage-collection metamethods), `load`, `string.dump`, `string.rep`,
  `collectgarbage`, `debug.sethook`, `lua_sethook`, `pcall`.
- Lua 5.4.7 `lgc.c`, `GCTM`:
  https://github.com/lua/lua/blob/v5.4.7/lgc.c (finalizers run with
  `L->allowhook = 0`).
- PyInstaller, "Listing Hidden Imports":
  https://pyinstaller.org/en/stable/when-things-go-wrong.html#listing-hidden-imports
- This repository: `backend/src/timeline_ops.py`,
  `docs/adr/0002-backend-authoritative-timeline.md`,
  `backend/packaging/backend.spec`, `backend/packaging/entry.py`,
  `backend/requirements.txt`.

## Reproducing

```
python3 -m venv .lupa-venv && .lupa-venv/bin/pip install lupa==2.8   # not committed
.lupa-venv/bin/python escape_tests.py    # needs sandbox.py next to it
```

The measurements in §1, §3, §5 and §6 came from small throwaway scripts
(`determinism.py`, `limits_measure.py`, `threading_check.py`, the PyInstaller
build drivers, `native_worst.py`) kept outside the commit, under
`.lupa-scratch/`. Their results are quoted above.
