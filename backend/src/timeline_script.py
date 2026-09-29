"""Sandboxed Lua script engine for Review scripts (plan 034, ADR 0006).

A script runs in a fresh, locked-down Lua 5.4 runtime against a *copy* of the
Timeline Document. Every mutating API call is one Operation from
:data:`src.timeline_ops.OPERATIONS`: it is applied to the copy and recorded in
the shape ``TimelineController.apply_batch`` takes. The recording is the result;
nothing here touches the live Timeline (ADR 0002), so a script is all or nothing.

The API is described once, in :data:`BINDINGS`. The Lua wrappers the script sees
and :data:`API_REFERENCE` (the text an Editor or the Review Agent reads) are both
built from that table, so they cannot drift.

Sandbox and limits follow ``docs/specs/2026-09-29-lua-scripting-runtime-research.md``.
"""

from __future__ import annotations

import math
import json
import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import lupa.lua54 as lupa  # never a bare `import lupa`: it binds the newest engine at runtime

from .models import TimelineDocument
from .timeline_ops import Sources, TimelineOpError, apply_operation, seeded_item_ids


@dataclass(frozen=True)
class ScriptLimits:
    max_source_bytes: int = 64 * 1024
    max_instructions: int = 20_000_000
    timeout_sec: float = 2.0
    max_memory_bytes: int = 16 * 1024 * 1024
    max_operations: int = 1000
    max_log_lines: int = 200
    max_log_line_chars: int = 500


@dataclass(frozen=True)
class ScriptError:
    kind: Literal["syntax", "runtime", "operation", "limit"]
    message: str  # human-readable, no Python traceback, no file paths
    line: Optional[int]  # 1-based script line when known


@dataclass(frozen=True)
class ScriptResult:
    operations: List[dict]  # [{"operation": name, "args": {...}}]; empty when error is set
    document: TimelineDocument  # resulting working copy (== input copy when error is set)
    log: List[str]  # kept even when error is set
    error: Optional[ScriptError]


# --- the API, described once ------------------------------------------------


@dataclass(frozen=True)
class Binding:
    """One function of the script API: its Lua body, and how it is documented."""

    receiver: str  # "timeline" | "library" | "item" | "" (a global function)
    name: str
    signature: str  # argument list and result, e.g. "(clip_or_id [, at]) -> Item"
    doc: str  # one line
    records: Optional[str]  # the Operation it records; None for a read
    lua: str  # Lua function expression; `api` is the Python natives, errors use level 0

    @property
    def call(self) -> str:
        return f"{self.receiver}:{self.name}" if self.receiver else self.name


def _binding(receiver, name, signature, doc, records, lua) -> Binding:
    return Binding(receiver, name, signature, doc, records, lua.strip())


BINDINGS: List[Binding] = [
    # timeline
    _binding(
        "timeline", "items", "() -> {Item}", "Every Item on the Timeline, in order (an array).", None,
        """function(self)
  local items = {}
  for i = 1, api.count() do items[i] = wrap(api.item_id_at(i)) end
  return items
end""",
    ),
    _binding(
        "timeline", "item", "(i) -> Item | nil", "The i-th Item (1-based), or nil when i is out of range.", None,
        """function(self, i)
  local id = api.item_id_at(i)
  if id == nil then return nil end
  return wrap(id)
end""",
    ),
    _binding(
        "timeline", "count", "() -> number", "How many Items the Timeline has.", None,
        "function(self) return api.count() end",
    ),
    _binding(
        "timeline", "duration", "() -> seconds",
        "Effective Timeline length in seconds, after each Item's speed.", None,
        "function(self) return api.duration() end",
    ),
    _binding(
        "timeline", "add", "(clip_or_id [, at]) -> Item",
        "Add a Clip (or its id) at 1-based position `at`, default the end; returns the new Item.",
        "add_item",
        "function(self, clip, at) return wrap(api.add(clip_key(clip), at)) end",
    ),
    _binding(
        "timeline", "clear", "()", "Remove every Item, one operation per Item.", "remove_item",
        "function(self) api.clear() end",
    ),
    _binding(
        "timeline", "set_target_duration", "(sec)",
        "Set the target duration in seconds (nil clears it).", "set_target_duration",
        "function(self, sec) api.set_target_duration(sec) end",
    ),
    _binding(
        "timeline", "set_profile", "(name)", "Set the assembly profile by name (nil clears it).",
        "set_profile",
        "function(self, name) api.set_profile(name) end",
    ),
    # item
    _binding(
        "item", "id", "() -> string", "The Item's id.", None,
        "function(self) local id = iid(self) api.item_index(id) return id end",
    ),
    _binding(
        "item", "clip_id", "() -> string", "The id of the Clip the Item plays.", None,
        "function(self) return api.item_clip_id(iid(self)) end",
    ),
    _binding(
        "item", "index", "() -> number", "The Item's current 1-based position on the Timeline.", None,
        "function(self) return api.item_index(iid(self)) end",
    ),
    _binding(
        "item", "source_in", "() -> seconds", "Start of the Item in its source video, in seconds.", None,
        "function(self) return api.item_source_in(iid(self)) end",
    ),
    _binding(
        "item", "source_out", "() -> seconds", "End of the Item in its source video, in seconds.", None,
        "function(self) return api.item_source_out(iid(self)) end",
    ),
    _binding(
        "item", "speed", "() -> number", "Playback speed (1 = normal).", None,
        "function(self) return api.item_speed(iid(self)) end",
    ),
    _binding(
        "item", "duration", "() -> seconds",
        "Seconds the Item occupies on the Timeline, after speed.", None,
        "function(self) return api.item_duration(iid(self)) end",
    ),
    _binding(
        "item", "transform", "() -> { scale, x, y }", "A copy of the Item's zoom and pan.", None,
        """function(self)
  local scale, x, y = api.item_transform(iid(self))
  return { scale = scale, x = x, y = y }
end""",
    ),
    _binding(
        "item", "trim", "(in_sec, out_sec)",
        "Set the Item's source bounds (clamped to the source video).", "set_bounds",
        "function(self, in_sec, out_sec) api.trim(iid(self), in_sec, out_sec) end",
    ),
    _binding(
        "item", "split", "(at_sec) -> Item, Item",
        "Split at a source time strictly inside the Item; the old handle is then removed.",
        "split_item",
        """function(self, at_sec)
  local first, second = api.split(iid(self), at_sec)
  return wrap(first), wrap(second)
end""",
    ),
    _binding(
        "item", "move", "(to)", "Move the Item to 1-based position `to`.", "reorder",
        "function(self, to) api.move(iid(self), to) end",
    ),
    _binding(
        "item", "set_speed", "(x)", "Set the playback speed; must be > 0.", "set_speed",
        "function(self, x) api.set_speed(iid(self), x) end",
    ),
    _binding(
        "item", "reframe", "{ scale=, x=, y= }",
        "Set the zoom and pan; fields you leave out keep their current value.", "set_transform",
        """function(self, fields)
  local id = iid(self)
  if type(fields) ~= "table" then error("reframe expects a table like { scale = 1.2, x = 0, y = 0 }", 0) end
  for key in pairs(fields) do
    if key ~= "scale" and key ~= "x" and key ~= "y" then
      error("unknown reframe field '" .. tostring(key) .. "'", 0)
    end
  end
  local scale, x, y = api.item_transform(id)
  if fields.scale ~= nil then scale = fields.scale end
  if fields.x ~= nil then x = fields.x end
  if fields.y ~= nil then y = fields.y end
  api.reframe(id, scale, x, y)
end""",
    ),
    _binding(
        "item", "remove", "()", "Remove the Item; the handle is dead afterwards.", "remove_item",
        "function(self) api.remove(iid(self)) end",
    ),
    # library
    _binding(
        "library", "clips", '([{ decision = "included" | "excluded" | "unreviewed" }]) -> {Clip}',
        "Plain Clip tables in library order, optionally filtered by decision.", None,
        """function(self, filter)
  local wanted = nil
  if filter ~= nil then
    if type(filter) ~= "table" then error('clips expects a table like { decision = "included" }', 0) end
    for key in pairs(filter) do
      if key ~= "decision" then error("unknown clips option '" .. tostring(key) .. "'", 0) end
    end
    wanted = filter.decision
    if wanted ~= nil and wanted ~= "included" and wanted ~= "excluded" and wanted ~= "unreviewed" then
      error('decision must be "included", "excluded" or "unreviewed"', 0)
    end
  end
  local clips = {}
  for i = 1, api.clip_count() do
    local clip = clip_from(api.clip_at(i))
    if wanted == nil or clip.decision == wanted then clips[#clips + 1] = clip end
  end
  return clips
end""",
    ),
    _binding(
        "library", "clip", "(id) -> Clip | nil", "One Clip table by id, or nil when there is none.", None,
        "function(self, id) return clip_from(api.clip_by_id(id)) end",
    ),
    _binding(
        "library", "include", "(clip_or_id)",
        "Mark the Clip included and place it if it is not on the Timeline.", "include",
        "function(self, clip) api.include(clip_key(clip)) end",
    ),
    _binding(
        "library", "exclude", "(clip_or_id)", "Mark the Clip excluded and drop its Items.", "exclude",
        "function(self, clip) api.exclude(clip_key(clip)) end",
    ),
    _binding(
        "library", "reset", "(clip_or_id)", "Clear the Clip's decision and drop its Items.",
        "reset_decision",
        "function(self, clip) api.reset(clip_key(clip)) end",
    ),
    # globals
    _binding(
        "", "log", "(...)", "Append a line to the run log; arguments are joined with tabs.", None,
        "function(...) api.log(join(...)) end",
    ),
    _binding(
        "", "print", "(...)", "Same as `log`.", None,
        "function(...) api.log(join(...)) end",
    ),
]

_CLIP_FIELDS: List[Tuple[str, str]] = [
    ("id", "string"),
    ("file_name", "string"),
    ("source_in", "seconds"),
    ("source_out", "seconds"),
    ("duration", "seconds, source_out - source_in"),
    ("score", "number, the overall score"),
    ("smoothness", "number or nil"),
    ("decision", '"included", "excluded" or "unreviewed"; read when the table is made'),
    ("reason", "string or nil, why it was picked"),
]

_STDLIB_KEPT = (
    "`math` (no `random`), `table` (`concat`, `insert`, `remove`, `sort`, `unpack`, `pack`), `utf8`, "
    "`ipairs`, `pairs`, `next`, `select`, `type`, `tostring`, `tonumber`, `error`, `assert`, `pcall`, "
    "`setmetatable` (only approved keys and Lua-function metamethods are allowed) and `string` without `dump`, `match`, "
    "`gmatch` and `gsub`. `string.find` searches for a plain substring only, and `string.rep` "
    "is capped at 1,000,000 characters. `string.find` is capped at 10,000,000 input-pattern character pairs. "
    "`table.move` is capped at a range of 1,000,000 values."
)
_STDLIB_REMOVED = (
    "`os`, `io`, `package`, `require`, `load`, `loadfile`, `dofile`, `debug`, `collectgarbage`, "
    "`getmetatable`, `rawget`, `rawset`, `coroutine`, `xpcall`, `string.match`, `string.gmatch`, "
    "`string.gsub`, `string.dump`, `math.random`"
)

_RECEIVER_TITLES = {
    "timeline": "timeline",
    "item": "Item (from `timeline:item(i)`, `timeline:add(...)`, `item:split(...)`)",
    "library": "library",
    "": "Global functions",
}


def _build_reference(limits: ScriptLimits = ScriptLimits()) -> str:
    lines = [
        "# Script API (Lua 5.4)",
        "",
        "A script edits a copy of the Timeline. Each call that changes it records one Operation; the "
        "Editor applies the whole recording or none of it. Scripts read the Timeline and the Clip "
        "library and nothing else.",
        "",
        "## Conventions",
        "",
        "- Indices and positions are 1-based (`timeline:item(1)` is the first Item).",
        "- Times are source seconds; `duration` values are seconds. `timeline:duration()` and "
        "`item:duration()` are effective: they include each Item's speed.",
        "- Item handles read the working copy live. A handle whose Item was removed (or split) "
        "raises `item was removed`.",
        "- An invalid edit (bad split point, unknown Clip, position out of range) is a Lua error at "
        "that line and the run records nothing.",
        "- Later lines see earlier edits.",
        "- `pairs` order over string keys is unspecified; iterate arrays with `ipairs` so a script "
        "records the same Operations every run. Every list the API returns is an array.",
        "",
        "## Clip tables",
        "",
        "`library:clips()` and `library:clip(id)` return plain Lua tables (changing one changes nothing):",
        "",
    ]
    lines += [f"- `{name}`: {kind}" for name, kind in _CLIP_FIELDS]
    for receiver in ("timeline", "item", "library", ""):
        lines += ["", f"## {_RECEIVER_TITLES[receiver]}", ""]
        for binding in BINDINGS:
            if binding.receiver != receiver:
                continue
            effect = f" Records `{binding.records}`." if binding.records else ""
            lines.append(f"- `{binding.call}{binding.signature}`: {binding.doc}{effect}")
    lines += [
        "",
        "## Standard library",
        "",
        f"Available: {_STDLIB_KEPT}",
        "",
        f"Not available: {_STDLIB_REMOVED}.",
        "",
        "## Limits",
        "",
        f"Source up to {limits.max_source_bytes // 1024} KiB, {limits.max_instructions:,} instructions, "
        f"{limits.timeout_sec:g} s, {limits.max_memory_bytes // (1024 * 1024)} MiB of Lua memory, "
        f"{limits.max_operations} recorded Operations, {limits.max_log_lines} log lines. "
        "A script that reaches one is stopped and records nothing.",
    ]
    return "\n".join(lines) + "\n"


API_REFERENCE: str = _build_reference()


# --- the Lua side -----------------------------------------------------------

_LUA_TABLE = {"timeline": "timeline", "library": "library", "item": "ITEM", "": "globals"}

# Runs once per runtime, before the script exists. It captures what it needs as
# upvalues, patches the shared `string` table, builds the script's environment
# from the binding table, installs the limit hook, and only then strips the real
# globals (including `debug`).
_BOOT = r"""
local api, check, on_trip, max_ticks = ...
local error, pcall, pairs, ipairs, select, setmetatable, rawget, tostring, type, load =
      error, pcall, pairs, ipairs, select, setmetatable, rawget, tostring, type, load
local sethook, getinfo = debug.sethook, debug.getinfo
local pack, unpack, concat = table.pack, table.unpack, table.concat
local real_string, real_find, real_rep = string, string.find, string.rep
local real_utf8, real_math, real_table = utf8, math, table
local real_next = next

local ticks, tripped = 0, nil
local function hook()                       -- every 1000 VM instructions
  ticks = ticks + 1
  if not tripped then
    if ticks > max_ticks then tripped = "instruction limit" else tripped = check() end
  end
  if tripped then                           -- re-arm at count 1 so no pcall can swallow the limit
    on_trip(tripped)
    sethook(hook, "", 1)
    error(tripped .. " exceeded", 0)
  end
end

-- `string` is shared with every string's metatable, so patch the real table.
real_string.dump, real_string.match, real_string.gmatch, real_string.gsub = nil, nil, nil, nil
real_string.find = function(s, pattern, init)
  if #s * #pattern > 1e7 then error("string.find too large", 2) end
  return real_find(s, pattern, init, true)
end
real_string.rep = function(s, n, sep)       -- an uninterruptible native loop: cap it
  local count = tonumber(n)
  if count == nil then error("string.rep count must be a number", 2) end
  local text, separator = tostring(s), sep == nil and "" or tostring(sep)
  if count > 1e6 or count * (#text + #separator) > 1e6 then error("string.rep too large", 2) end
  return real_rep(text, count, separator)
end

local function pick(source, names)
  local t = {}
  for _, key in ipairs(names) do t[key] = source[key] end
  return t
end
local env = pick(_G, {"assert", "error", "ipairs", "next", "pairs", "pcall", "select", "tonumber",
                      "tostring", "type"})
env._G, env.string, env.utf8 = env, real_string, real_utf8
env.math = {}
for key, value in pairs(real_math) do
  if key ~= "random" and key ~= "randomseed" then env.math[key] = value end
end
env.table = pick(real_table, {"concat", "insert", "remove", "sort", "unpack", "pack"})
env.table.move = function(t, f, e, target, dest)
  if e - f + 1 > 1e6 then error("table.move range too large", 2) end
  return real_table.move(t, f, e, target, dest)
end
local metamethods = {
  __index=true, __newindex=true, __call=true, __tostring=true, __eq=true, __lt=true, __le=true,
  __unm=true, __add=true, __sub=true, __mul=true, __div=true, __mod=true, __pow=true,
  __idiv=true, __band=true, __bor=true, __bxor=true, __shl=true, __shr=true, __bnot=true,
  __concat=true, __close=true, __name=true,
}
env.setmetatable = function(t, mt)
  if type(mt) == "table" then
    for key, value in real_next, mt do
      if type(key) ~= "string" or not metamethods[key] then
        error("metatable key '" .. tostring(key) .. "' is not allowed", 2)
      end
      if key == "__name" then
        if type(value) ~= "string" then error("metatable key '__name' must be a string", 2) end
      elseif key == "__index" or key == "__newindex" then
        if type(value) ~= "table" and not (type(value) == "function" and getinfo(value, "S").what == "Lua") then
          error("metatable key '" .. key .. "' must be a Lua function or table", 2)
        end
      elseif type(value) ~= "function" or getinfo(value, "S").what ~= "Lua" then
        error("metatable key '" .. key .. "' must be a Lua function", 2)
      end
    end
  end
  return setmetatable(t, mt)
end

-- Python exceptions and API errors become strings at the calling script line.
local function guard(fn)
  return function(...)
    local results = pack(pcall(fn, ...))
    if not results[1] then error(tostring(results[2]), 2) end
    return unpack(results, 2, results.n)
  end
end

local ITEM = {}
local ITEM_MT = {
  __index = ITEM,
  __eq = function(a, b) return a._id == b._id end,
  __tostring = function(self) return "Item(" .. tostring(self._id) .. ")" end,
}
local function wrap(id) return setmetatable({ _id = id }, ITEM_MT) end
local function iid(self)
  local id = type(self) == "table" and self._id
  if type(id) ~= "string" then error("call Item methods with ':' (item:trim(...))", 0) end
  return id
end
local function clip_key(clip)
  if type(clip) == "table" then clip = clip.id end
  if type(clip) ~= "string" then error("expected a Clip or a clip id", 0) end
  return clip
end
local function clip_from(id, file_name, source_in, source_out, duration, score, smoothness, decision, reason)
  if id == nil then return nil end
  return { id = id, file_name = file_name, source_in = source_in, source_out = source_out,
           duration = duration, score = score, smoothness = smoothness, decision = decision,
           reason = reason }
end
local function join(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
  return concat(parts, "\t")
end

local timeline, library, globals = {}, {}, {}
--BINDINGS--

for name, fn in pairs(globals) do env[name] = fn end
env.timeline, env.library = timeline, library

for _, key in ipairs{"os", "io", "package", "require", "load", "loadfile", "dofile", "debug",
                     "collectgarbage", "getmetatable", "rawset", "rawget", "coroutine", "utf8", "warn",
                     "xpcall", "python"} do
  _G[key] = nil                             -- defence in depth: the real globals are stripped too
end
sethook(hook, "", 1000)
return function(source)
  local fn, err = load(source, "=script", "t", env)   -- "t": text only, never bytecode
  if not fn then return false, err end
  fn()
  return true, nil
end
"""


def _boot_source() -> str:
    body = "\n".join(
        f"{_LUA_TABLE[b.receiver]}.{b.name} = guard({b.lua})" for b in BINDINGS
    )
    return _BOOT.replace("--BINDINGS--", body)


_BOOT_SOURCE = _boot_source()


# --- the Python side --------------------------------------------------------


class _Fault(Exception):
    """A script fault that is not an Operation error (bad argument, dead handle)."""


class _LimitReached(_Fault):
    """The operation or log budget ran out; the run is then reported as a limit."""


def _deny(obj, name, is_setting):
    raise AttributeError("access denied")


def _typename(value: Any) -> str:
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    name = type(value).__name__
    return {"_LuaTable": "table", "_LuaFunction": "function"}.get(name, "userdata")


def _str(value: Any, what: str) -> str:
    if not isinstance(value, str):
        raise _Fault(f"expected a string for {what}, got {_typename(value)}")
    return value


def _num(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _Fault(f"expected a number for {what}, got {_typename(value)}")
    if not math.isfinite(value):
        raise _Fault(f"{what} must be a finite number")
    return float(value)


def _int(value: Any, what: str) -> int:
    number = _num(value, what)
    if not number.is_integer():
        raise _Fault(f"{what} must be a whole number, got {value}")
    return int(number)


def _scalar(value: Any) -> Any:
    """Only plain numbers and strings may cross into Lua; anything else becomes nil."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    return float(value) if isinstance(value, (int, float)) else value


class _Session:
    """One run: the working copy, the recording, the log, and the API natives."""

    def __init__(
        self, document: TimelineDocument, sources: Sources, library: List[dict], limits: ScriptLimits
    ) -> None:
        self.document = document.model_copy(deep=True)
        self.sources = sources
        self.limits = limits
        self.operations: List[dict] = []
        self.log_lines: List[str] = []
        self.limit: Optional[str] = None  # a budget the Python side found spent
        self.tripped: Optional[str] = None  # the limit the Lua hook stopped the run for
        self.last_op_error: Optional[str] = None
        self.deadline = 0.0
        self._clips = [self._clip_row(entry) for entry in library]
        self._clip_positions: Dict[str, int] = {}
        for position, row in enumerate(self._clips, start=1):
            self._clip_positions.setdefault(row[0], position)

    @staticmethod
    def _clip_row(entry: dict) -> tuple:
        start, end = entry.get("start_sec"), entry.get("end_sec")
        duration = entry.get("duration")
        if duration is None and isinstance(start, (int, float)) and isinstance(end, (int, float)):
            duration = end - start
        smoothness = entry.get("smoothness_score", entry.get("smoothness"))
        reason = entry.get("reason", entry.get("ai_reason"))
        return (
            entry["clip_id"],
            _scalar(entry.get("file_name")),
            _scalar(start),
            _scalar(end),
            _scalar(duration),
            _scalar(entry.get("overall_score")),
            _scalar(smoothness),
            _scalar(reason),
        )

    # -- limits --------------------------------------------------------------

    def check(self) -> Optional[str]:
        """Called from the Lua hook every 1000 instructions."""
        if self.limit is not None:
            return self.limit
        if time.monotonic() > self.deadline:
            return "time limit"
        return None

    def on_trip(self, name: str) -> None:
        if self.tripped is None:
            self.tripped = name

    def _spend(self, name: str) -> _LimitReached:
        self.limit = self.limit or name
        return _LimitReached(f"{name} exceeded")

    # -- recording -----------------------------------------------------------

    def _record(self, operation: str, **args: Any) -> None:
        if len(self.operations) >= self.limits.max_operations:
            raise self._spend("operation limit")
        self.document = apply_operation(self.document, self.sources, operation, **args)
        self.operations.append({"operation": operation, "args": args})

    def _locate(self, item_id: Any) -> int:
        item_id = _str(item_id, "an Item")
        for index, item in enumerate(self.document.items):
            if item.item_id == item_id:
                return index
        raise _Fault("item was removed")

    def _require_clip(self, clip_id: str) -> None:
        if clip_id not in self.sources:
            raise TimelineOpError(f"unknown candidate clip: {clip_id}")

    # -- natives (every value that crosses is validated to a plain scalar) ---

    def count(self) -> int:
        return len(self.document.items)

    def duration(self) -> float:
        return sum(item.effective_duration_sec for item in self.document.items)

    def item_id_at(self, i: Any) -> Optional[str]:
        position = _int(i, "an Item position")
        items = self.document.items
        return items[position - 1].item_id if 1 <= position <= len(items) else None

    def item_index(self, item_id: Any) -> int:
        return self._locate(item_id) + 1

    def item_clip_id(self, item_id: Any) -> str:
        return self.document.items[self._locate(item_id)].source_clip_id

    def item_source_in(self, item_id: Any) -> float:
        return self.document.items[self._locate(item_id)].start_sec

    def item_source_out(self, item_id: Any) -> float:
        return self.document.items[self._locate(item_id)].end_sec

    def item_speed(self, item_id: Any) -> float:
        return self.document.items[self._locate(item_id)].speed

    def item_duration(self, item_id: Any) -> float:
        return self.document.items[self._locate(item_id)].effective_duration_sec

    def item_transform(self, item_id: Any) -> Tuple[float, float, float]:
        transform = self.document.items[self._locate(item_id)].transform
        return transform.scale, transform.x, transform.y

    def clip_count(self) -> int:
        return len(self._clips)

    def _clip_at_position(self, position: int) -> Optional[tuple]:
        if not 1 <= position <= len(self._clips):
            return None
        clip_id, file_name, source_in, source_out, duration, score, smoothness, reason = self._clips[
            position - 1
        ]
        decision = self.document.decisions.get(clip_id)
        if decision not in ("included", "excluded"):
            decision = "unreviewed"
        return (clip_id, file_name, source_in, source_out, duration, score, smoothness, decision, reason)

    def clip_at(self, i: Any) -> Optional[tuple]:
        return self._clip_at_position(_int(i, "a Clip position"))

    def clip_by_id(self, clip_id: Any) -> Optional[tuple]:
        position = self._clip_positions.get(_str(clip_id, "a clip id"))
        return self._clip_at_position(position) if position else None

    def add(self, clip_id: Any, at: Any = None) -> str:
        clip_id = _str(clip_id, "a clip id")
        self._require_clip(clip_id)
        args: Dict[str, Any] = {"source_clip_id": clip_id}
        count = len(self.document.items)
        if at is not None:
            position = _int(at, "a position")
            if not 1 <= position <= count + 1:
                raise TimelineOpError(f"position {position} out of range [1, {count + 1}]")
            args["at_index"] = position - 1
        self._record("add_item", **args)
        return self.document.items[args.get("at_index", count)].item_id

    def clear(self) -> None:
        for item in list(self.document.items):
            self._record("remove_item", item_id=item.item_id)

    def remove(self, item_id: Any) -> None:
        self._locate(item_id)
        self._record("remove_item", item_id=item_id)

    def split(self, item_id: Any, at_sec: Any) -> Tuple[str, str]:
        at = _num(at_sec, "a split point")
        index = self._locate(item_id)
        self._record("split_item", item_id=item_id, at_sec=at)
        items = self.document.items
        return items[index].item_id, items[index + 1].item_id

    def trim(self, item_id: Any, in_sec: Any, out_sec: Any) -> None:
        start, end = _num(in_sec, "in_sec"), _num(out_sec, "out_sec")
        self._locate(item_id)
        self._record("set_bounds", item_id=item_id, start_sec=start, end_sec=end)

    def move(self, item_id: Any, to: Any) -> None:
        position = _int(to, "a position")
        self._locate(item_id)
        count = len(self.document.items)
        if not 1 <= position <= count:
            raise TimelineOpError(f"move target {position} out of range [1, {count}]")
        self._record("reorder", item_id=item_id, to_index=position - 1)

    def set_speed(self, item_id: Any, speed: Any) -> None:
        value = _num(speed, "speed")
        self._locate(item_id)
        self._record("set_speed", item_id=item_id, speed=value)

    def reframe(self, item_id: Any, scale: Any, x: Any, y: Any) -> None:
        transform = {"scale": _num(scale, "scale"), "x": _num(x, "x"), "y": _num(y, "y")}
        self._locate(item_id)
        if transform["scale"] <= 0:
            raise TimelineOpError("transform scale must be > 0")
        self._record("set_transform", item_id=item_id, transform=transform)

    def set_target_duration(self, sec: Any) -> None:
        value = None if sec is None else _num(sec, "a duration")
        self._record("set_target_duration", target_duration_sec=value)

    def set_profile(self, name: Any) -> None:
        value = None if name is None else _str(name, "a profile name")
        self._record("set_profile", profile=value)

    def include(self, clip_id: Any) -> None:
        self._decide("include", clip_id)

    def exclude(self, clip_id: Any) -> None:
        self._decide("exclude", clip_id)

    def reset(self, clip_id: Any) -> None:
        self._decide("reset_decision", clip_id)

    def _decide(self, operation: str, clip_id: Any) -> None:
        clip_id = _str(clip_id, "a clip id")
        self._require_clip(clip_id)
        self._record(operation, clip_id=clip_id)

    def log(self, line: Any) -> None:
        line = _str(line, "a log line")
        if len(self.log_lines) >= self.limits.max_log_lines:
            raise self._spend("log limit")
        self.log_lines.append(line[: self.limits.max_log_line_chars])

    def natives(self) -> Dict[str, Callable[..., Any]]:
        names = (
            "count duration item_id_at item_index item_clip_id item_source_in item_source_out "
            "item_speed item_duration item_transform clip_count clip_at clip_by_id add clear remove "
            "split trim move set_speed reframe set_target_duration set_profile include exclude reset log"
        ).split()
        return {name: self._tracked(getattr(self, name)) for name in names}

    def _tracked(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        """Remember the text of an Operation error, to tell it from other runtime errors."""

        def call(*args: Any) -> Any:
            try:
                return fn(*args)
            except TimelineOpError as exc:
                self.last_op_error = str(exc)
                raise

        return call


# --- errors -----------------------------------------------------------------

_TRACEBACK = re.compile(r"\n?stack traceback:.*", re.S)
_LINE = re.compile(r"script:(\d+):")
_CHUNK_PREFIX = re.compile(r"(?:script|sandbox):\d+: ?")


def _describe(raw: Any) -> Tuple[Optional[int], str]:
    """Split a Lua error message into (script line, text) with lupa's chunk names removed."""
    text = _TRACEBACK.sub("", str(raw)).strip()
    found = _LINE.search(text)
    line = int(found.group(1)) if found else None
    text = _CHUNK_PREFIX.sub("", text).strip() or "the script raised an error"
    return line, text


def _limit_message(name: str, limits: ScriptLimits) -> str:
    detail = {
        "instruction limit": f"over {limits.max_instructions:,} instructions",
        "time limit": f"over {limits.timeout_sec:g} s",
        "memory limit": f"over {limits.max_memory_bytes // (1024 * 1024)} MiB of Lua memory",
        "operation limit": f"more than {limits.max_operations} operations",
        "log limit": f"more than {limits.max_log_lines} log lines",
    }[name]
    return f"{name} exceeded ({detail})"


def run_script_in_process(
    source: str,
    *,
    document: TimelineDocument,
    sources: Sources,
    library: List[dict],
    id_seed: str,
    limits: ScriptLimits = ScriptLimits(),
) -> ScriptResult:
    """Run ``source`` against a copy of ``document`` and return what it recorded.

    All or nothing: any error gives no Operations and the input document back,
    with the log kept. Script faults are reported in the result, never raised;
    only bad Python arguments raise.
    """
    if not isinstance(source, str):
        raise TypeError("source must be a str")
    if not isinstance(document, TimelineDocument):
        raise TypeError("document must be a TimelineDocument")
    if not isinstance(id_seed, str):
        raise TypeError("id_seed must be a str")
    if not isinstance(limits, ScriptLimits):
        raise TypeError("limits must be a ScriptLimits")

    session = _Session(document, sources, library, limits)

    def failure(kind: str, message: str, line: Optional[int] = None) -> ScriptResult:
        return ScriptResult(
            operations=[],
            document=document.model_copy(deep=True),
            log=list(session.log_lines),
            error=ScriptError(kind, message, line),
        )

    try:
        encoded_size = len(source.encode("utf-8"))
    except UnicodeEncodeError:
        return failure("syntax", "the script is not valid text")
    if encoded_size > limits.max_source_bytes:
        return failure(
            "limit", f"source too large ({encoded_size} bytes, limit {limits.max_source_bytes})"
        )

    runtime = lupa.LuaRuntime(
        register_eval=False,
        register_builtins=False,
        unpack_returned_tuples=True,
        max_memory=limits.max_memory_bytes,
        attribute_filter=_deny,
    )
    outcome: Optional[ScriptResult] = None
    api = boot = run = None
    try:
        api = runtime.table_from(session.natives())
        boot = runtime.compile(_BOOT_SOURCE, name="=sandbox", mode="t")
        run = boot(api, session.check, session.on_trip, max(1, limits.max_instructions // 1000))
        session.deadline = time.monotonic() + limits.timeout_sec
        loaded, load_error = True, None
        raised: Optional[BaseException] = None
        with seeded_item_ids(id_seed):
            try:
                loaded, load_error = run(source)
            except lupa.LuaMemoryError:
                session.tripped = session.tripped or "memory limit"
            except lupa.LuaError as exc:
                raised = exc
        # The hook poisons the runtime once it trips: never call back into it here.
        limit = session.tripped or session.limit
        if limit is not None:
            outcome = failure("limit", _limit_message(limit, limits))
        elif raised is not None:
            line, text = _describe(raised)
            is_operation = session.last_op_error is not None and text.endswith(session.last_op_error)
            outcome = failure("operation" if is_operation else "runtime", _with_line(line, text), line)
        elif not loaded:
            line, text = _describe(load_error)
            outcome = failure("syntax", _with_line(line, text), line)
        else:
            outcome = ScriptResult(
                operations=session.operations,
                document=session.document,
                log=session.log_lines,
                error=None,
            )
    finally:
        # A fresh runtime per run: drop every reference so the spent (or poisoned) one is freed.
        api = boot = run = None
        del runtime
    return outcome


def _worker_command() -> List[str]:
    """Return the worker command in both source and frozen backend builds."""
    if getattr(sys, "frozen", False):
        return [sys.executable, "--script-worker"]
    return [sys.executable, "-m", "src.script_worker"]


def run_script(
    source: str,
    *,
    document: TimelineDocument,
    sources: Sources,
    library: List[dict],
    id_seed: str,
    limits: ScriptLimits = ScriptLimits(),
) -> ScriptResult:
    """Run a script in a killable worker process, preserving all-or-nothing results."""
    if not isinstance(source, str):
        raise TypeError("source must be a str")
    if not isinstance(document, TimelineDocument):
        raise TypeError("document must be a TimelineDocument")
    if not isinstance(id_seed, str):
        raise TypeError("id_seed must be a str")
    if not isinstance(limits, ScriptLimits):
        raise TypeError("limits must be a ScriptLimits")

    def failure(kind: Literal["runtime", "limit"], message: str) -> ScriptResult:
        return ScriptResult([], document.model_copy(deep=True), [], ScriptError(kind, message, None))

    backend_dir = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(backend_dir)
    request = {
        "source": source,
        "document": document.model_dump(mode="json"),
        "sources": {clip_id: clip.model_dump(mode="json") for clip_id, clip in sources.items()},
        "library": library,
        "id_seed": id_seed,
        "limits": limits.__dict__,
    }
    try:
        completed = subprocess.run(
            _worker_command(),
            input=json.dumps(request),
            capture_output=True,
            text=True,
            timeout=limits.timeout_sec + 1.0,
            env=env,
            cwd=backend_dir,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return failure("limit", "time limit exceeded (the script was stopped)")
    except OSError as exc:
        logging.getLogger(__name__).warning("Lua script worker could not start: %s", exc)
        return failure("runtime", "the script runner stopped unexpectedly")

    if completed.returncode != 0:
        if completed.stderr:
            logging.getLogger(__name__).warning("Lua script worker stopped: %s", completed.stderr.rstrip())
        return failure("runtime", "the script runner stopped unexpectedly")
    try:
        payload = json.loads(completed.stdout)
        result_error = payload["error"]
        error = ScriptError(**result_error) if result_error is not None else None
        return ScriptResult(
            operations=payload["operations"],
            document=TimelineDocument.model_validate(payload["document"]),
            log=payload["log"],
            error=error,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        if completed.stderr:
            logging.getLogger(__name__).warning("Lua script worker returned invalid output: %s", completed.stderr.rstrip())
        return failure("runtime", "the script runner stopped unexpectedly")


def _with_line(line: Optional[int], text: str) -> str:
    return f"line {line}: {text}" if line is not None else text
