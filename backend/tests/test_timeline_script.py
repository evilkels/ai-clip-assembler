"""Tests for the sandboxed Lua script engine (plan 034, slice S3, ADR 0006).

A script runs against a *copy* of the Timeline Document; every mutating API call
is one Operation from ``timeline_ops.OPERATIONS``, applied to the copy and
recorded. Nothing here touches HTTP, models on disk, or the live Timeline.
"""

import asyncio
import json
import subprocess
import sys
import time

import pytest

from src.models import TimelineDocument, TimelineItem
from src.timeline_ops import SourceClip, TimelineController
from src.timeline_script import (
    API_REFERENCE,
    BINDINGS,
    ScriptError,
    ScriptLimits,
    ScriptResult,
    run_script,
    run_script_in_process,
)


SEED = "proposal-1"


# --- fixtures / helpers -----------------------------------------------------


def make_sources():
    return {
        clip_id: SourceClip(clip_id=clip_id, start_sec=start, end_sec=end, source_duration_sec=60.0)
        for clip_id, start, end in [
            ("clip-a", 0.0, 6.0),
            ("clip-b", 10.0, 18.0),
            ("clip-c", 20.0, 22.0),
            ("clip-d", 30.0, 40.0),
            ("clip-e", 50.0, 52.0),
        ]
    }


def make_library():
    """Candidate dicts shaped like ``McpServer._list_candidates``."""
    rows = [
        ("clip-a", "a.mp4", 0.0, 6.0, 0.9, 0.8, "steady"),
        ("clip-b", "b.mp4", 10.0, 18.0, 0.7, None, None),
        ("clip-c", "c.mp4", 20.0, 22.0, 0.95, 0.4, "punchy"),
        ("clip-d", "d.mp4", 30.0, 40.0, 0.5, 0.9, None),
        ("clip-e", "e.mp4", 50.0, 52.0, 0.2, 0.1, None),
    ]
    return [
        {
            "clip_id": clip_id,
            "file_id": "file-1",
            "file_name": file_name,
            "scene_id": None,
            "start_sec": start,
            "end_sec": end,
            "overall_score": score,
            "smoothness_score": smoothness,
            "visual_interest_score": None,
            "ai_reason": reason,
        }
        for clip_id, file_name, start, end, score, smoothness, reason in rows
    ]


def make_document():
    return TimelineDocument(
        revision=3,
        items=[
            TimelineItem(item_id="i1", source_clip_id="clip-a", start_sec=0.0, end_sec=6.0),
            TimelineItem(item_id="i2", source_clip_id="clip-b", start_sec=10.0, end_sec=18.0),
            TimelineItem(item_id="i3", source_clip_id="clip-c", start_sec=20.0, end_sec=22.0),
        ],
        decisions={
            "clip-a": "included",
            "clip-b": "included",
            "clip-c": "included",
            "clip-d": "included",
            "clip-e": "excluded",
        },
    )


def run(source, document=None, **kwargs):
    kwargs.setdefault("limits", ScriptLimits())
    return run_script_in_process(
        source,
        document=document if document is not None else make_document(),
        sources=make_sources(),
        library=make_library(),
        id_seed=SEED,
        **kwargs,
    )


def ok(source, document=None, **kwargs) -> ScriptResult:
    result = run(source, document, **kwargs)
    assert result.error is None, result.error
    return result


def replay(operations, document):
    async def go():
        controller = TimelineController(document, make_sources())
        return await controller.apply_batch(
            operations, expected_revision=document.revision, id_seed=SEED
        )

    return asyncio.run(go())


def same_content(a, b):
    """Documents are equal apart from the revision the controller stamps."""
    return a.model_copy(update={"revision": 0}) == b.model_copy(update={"revision": 0})


# --- 1. each mutating call records the expected Operation -------------------


def test_add_records_add_item_at_end():
    result = ok("timeline:add('clip-d')")
    assert result.operations == [{"operation": "add_item", "args": {"source_clip_id": "clip-d"}}]
    assert [i.source_clip_id for i in result.document.items] == ["clip-a", "clip-b", "clip-c", "clip-d"]


def test_add_accepts_a_clip_table_and_maps_at_to_zero_based():
    result = ok("timeline:add(library:clip('clip-d'), 1)")
    assert result.operations == [
        {"operation": "add_item", "args": {"source_clip_id": "clip-d", "at_index": 0}}
    ]
    assert result.document.items[0].source_clip_id == "clip-d"


def test_add_returns_a_usable_item():
    result = ok("local it = timeline:add('clip-d') it:set_speed(2)")
    assert [op["operation"] for op in result.operations] == ["add_item", "set_speed"]


def test_clear_records_remove_item_for_every_item():
    result = ok("timeline:clear()")
    assert result.operations == [
        {"operation": "remove_item", "args": {"item_id": "i1"}},
        {"operation": "remove_item", "args": {"item_id": "i2"}},
        {"operation": "remove_item", "args": {"item_id": "i3"}},
    ]
    assert result.document.items == []


def test_set_target_duration_and_profile():
    result = ok("timeline:set_target_duration(30) timeline:set_profile('cinematic')")
    assert result.operations == [
        {"operation": "set_target_duration", "args": {"target_duration_sec": 30.0}},
        {"operation": "set_profile", "args": {"profile": "cinematic"}},
    ]
    assert result.document.target_duration_sec == 30.0
    assert result.document.profile == "cinematic"


def test_trim_records_set_bounds():
    result = ok("timeline:item(2):trim(11, 14.5)")
    assert result.operations == [
        {"operation": "set_bounds", "args": {"item_id": "i2", "start_sec": 11.0, "end_sec": 14.5}}
    ]


def test_split_records_split_item_and_returns_two_items():
    result = ok("local a, b = timeline:item(2):split(14) log(a:source_out(), b:source_in())")
    assert result.operations == [{"operation": "split_item", "args": {"item_id": "i2", "at_sec": 14.0}}]
    assert result.log == ["14.0\t14.0"]
    assert len(result.document.items) == 4


def test_move_maps_one_based_to_zero_based():
    result = ok("timeline:item(1):move(3)")
    assert result.operations == [{"operation": "reorder", "args": {"item_id": "i1", "to_index": 2}}]
    assert [i.item_id for i in result.document.items] == ["i2", "i3", "i1"]


def test_set_speed_records_set_speed():
    result = ok("timeline:item(3):set_speed(2)")
    assert result.operations == [{"operation": "set_speed", "args": {"item_id": "i3", "speed": 2.0}}]


def test_reframe_records_set_transform_and_keeps_omitted_fields():
    result = ok("local it = timeline:item(1) it:reframe{ scale = 1.5 } it:reframe{ x = 0.25 }")
    assert result.operations == [
        {
            "operation": "set_transform",
            "args": {"item_id": "i1", "transform": {"scale": 1.5, "x": 0.0, "y": 0.0}},
        },
        {
            "operation": "set_transform",
            "args": {"item_id": "i1", "transform": {"scale": 1.5, "x": 0.25, "y": 0.0}},
        },
    ]


def test_remove_records_remove_item():
    result = ok("timeline:item(2):remove()")
    assert result.operations == [{"operation": "remove_item", "args": {"item_id": "i2"}}]
    assert [i.item_id for i in result.document.items] == ["i1", "i3"]


def test_library_decisions_record_include_exclude_reset():
    result = ok("library:include('clip-d') library:exclude('clip-a') library:reset('clip-b')")
    assert result.operations == [
        {"operation": "include", "args": {"clip_id": "clip-d"}},
        {"operation": "exclude", "args": {"clip_id": "clip-a"}},
        {"operation": "reset_decision", "args": {"clip_id": "clip-b"}},
    ]
    assert result.document.decisions["clip-d"] == "included"
    assert result.document.decisions["clip-a"] == "excluded"
    assert "clip-b" not in result.document.decisions


def test_reads_record_nothing():
    result = ok(
        "local it = timeline:item(1) log(timeline:count(), it:id(), it:clip_id(), it:index(), "
        "it:source_in(), it:source_out(), it:speed(), it:duration(), #timeline:items(), "
        "#library:clips())"
    )
    assert result.operations == []
    assert result.log == ["3\ti1\tclip-a\t1\t0.0\t6.0\t1.0\t6.0\t3\t5"]


def test_item_transform_is_a_plain_table():
    result = ok("local t = timeline:item(1):transform() log(t.scale, t.x, t.y)")
    assert result.log == ["1.0\t0.0\t0.0"]


def test_timeline_item_out_of_range_is_nil():
    result = ok("log(tostring(timeline:item(9)), tostring(timeline:item(0)))")
    assert result.log == ["nil\tnil"]


# --- library ----------------------------------------------------------------


def test_clip_tables_carry_the_documented_fields():
    result = ok(
        "local c = library:clip('clip-a') "
        "log(c.id, c.file_name, c.source_in, c.source_out, c.duration, c.score, c.smoothness, "
        "c.decision, c.reason) "
        "local b = library:clip('clip-b') log(tostring(b.smoothness), tostring(b.reason), b.decision) "
        "log(tostring(library:clip('nope')))"
    )
    assert result.log == [
        "clip-a\ta.mp4\t0.0\t6.0\t6.0\t0.9\t0.8\tincluded\tsteady",
        "nil\tnil\tincluded",
        "nil",
    ]


def test_library_filters_by_decision_in_input_order():
    result = ok(
        "local function ids(list) local t = {} for _, c in ipairs(list) do t[#t + 1] = c.id end "
        "return table.concat(t, ',') end "
        "log(ids(library:clips{ decision = 'included' })) "
        "log(ids(library:clips{ decision = 'excluded' })) "
        "log(ids(library:clips{ decision = 'unreviewed' })) "
        "log(ids(library:clips()))"
    )
    assert result.log == ["clip-a,clip-b,clip-c,clip-d", "clip-e", "", "clip-a,clip-b,clip-c,clip-d,clip-e"]


def test_decision_is_read_live_from_the_working_copy():
    result = ok(
        "log(library:clip('clip-d').decision) library:exclude('clip-d') log(library:clip('clip-d').decision) "
        "library:reset('clip-d') log(library:clip('clip-d').decision)"
    )
    assert result.log == ["included", "excluded", "unreviewed"]


def test_clip_tables_are_plain_copies():
    result = ok("local c = library:clip('clip-a') c.score = 0 log(library:clip('clip-a').score)")
    assert result.log == ["0.9"]
    assert result.operations == []


# --- 2. reads reflect earlier writes ----------------------------------------


def test_trim_then_duration_reads_the_edit():
    result = ok("local it = timeline:item(1) it:trim(0, 2) log(it:duration(), timeline:duration())")
    assert result.log == ["2.0\t12.0"]


def test_add_then_count_and_speed_aware_duration():
    result = ok(
        "timeline:add('clip-d') log(timeline:count(), timeline:duration()) "
        "timeline:item(4):set_speed(2) log(timeline:duration())"
    )
    assert result.log == ["4\t26.0", "21.0"]


# --- 3. split handles are mutable and replay exactly ------------------------


def test_split_handles_record_and_replay_identically():
    document = make_document()
    result = ok("local a, b = timeline:item(2):split(14) b:set_speed(2)", document)
    assert [op["operation"] for op in result.operations] == ["split_item", "set_speed"]
    replayed = replay(result.operations, make_document())
    assert same_content(replayed, result.document)
    assert replayed.items[2].speed == 2.0


def test_add_and_split_replay_identically():
    result = ok(
        "local it = timeline:add('clip-d') local a, b = it:split(35) b:move(1) a:set_speed(0.5)"
    )
    assert same_content(replay(result.operations, make_document()), result.document)


# --- 4. the plan's Goal example --------------------------------------------

GOAL_SCRIPT = """\
-- "keep every shot under 3 seconds, best first, then land near 40s"
local clips = library:clips{ decision = "included" }
table.sort(clips, function(a, b) return a.score > b.score end)
timeline:clear()
for _, clip in ipairs(clips) do
  local item = timeline:add(clip)
  if item:duration() > 3 then item:trim(item:source_in(), item:source_in() + 3) end
  if timeline:duration() >= 40 then break end
end
log(("%d shots, %.1fs"):format(timeline:count(), timeline:duration()))
"""


def test_goal_example_runs_on_fixture():
    result = ok(GOAL_SCRIPT)
    items = result.document.items
    assert [i.source_clip_id for i in items] == ["clip-c", "clip-a", "clip-b", "clip-d"]
    assert [(i.start_sec, i.end_sec) for i in items] == [(20.0, 22.0), (0.0, 3.0), (10.0, 13.0), (30.0, 33.0)]
    assert result.log == ["4 shots, 11.0s"]
    assert same_content(replay(result.operations, make_document()), result.document)


# --- 5. determinism ---------------------------------------------------------


def test_same_script_same_inputs_same_operations():
    first = ok(GOAL_SCRIPT)
    second = ok(GOAL_SCRIPT)
    assert first.operations == second.operations
    assert first.document == second.document


def test_input_document_is_not_mutated():
    document = make_document()
    before = document.model_copy(deep=True)
    ok(GOAL_SCRIPT, document)
    assert document == before


# --- 6. handles and operation errors ---------------------------------------


def test_removed_handle_is_a_runtime_error():
    result = run("local it = timeline:item(1)\nit:remove()\nit:set_speed(2)")
    assert result.error.kind == "runtime"
    assert result.error.line == 3
    assert "item was removed" in result.error.message
    assert result.operations == []


def test_handle_of_a_split_item_is_removed():
    result = run("local it = timeline:item(1)\nit:split(3)\nlog(it:duration())")
    assert result.error.kind == "runtime"
    assert "item was removed" in result.error.message


def test_bad_split_point_is_an_operation_error_with_its_line():
    result = run("local it = timeline:item(1)\n\nit:split(99)")
    assert result.error.kind == "operation"
    assert result.error.line == 3
    assert "split point" in result.error.message
    assert result.operations == []


def test_operation_error_does_not_apply_and_keeps_the_document():
    document = make_document()
    result = run("timeline:item(1):set_speed(2)\ntimeline:item(2):set_speed(-1)", document)
    assert result.error.kind == "operation"
    assert result.error.line == 2
    assert result.document == make_document()
    assert result.operations == []


def test_out_of_range_positions_are_operation_errors():
    for source in ("timeline:add('clip-d', 9)", "timeline:add('clip-d', 0)", "timeline:item(1):move(4)"):
        result = run(source)
        assert result.error.kind == "operation", source
        assert result.error.line == 1


def test_unknown_clip_is_an_operation_error():
    for source in ("timeline:add('nope')", "library:include('nope')", "library:exclude('nope')"):
        result = run(source)
        assert result.error.kind == "operation", source
        assert "unknown candidate clip" in result.error.message


def test_pcall_can_catch_an_operation_error_and_the_run_continues():
    result = ok(
        "local okay, e = pcall(function() timeline:item(1):split(99) end) "
        "log(tostring(okay), type(e)) timeline:item(1):set_speed(2)"
    )
    assert result.log == ["false\tstring"]
    assert [op["operation"] for op in result.operations] == ["set_speed"]


def test_log_is_kept_when_the_run_fails():
    result = run("log('before')\nerror('boom')")
    assert result.error is not None
    assert result.log == ["before"]
    assert result.operations == []


# --- 7. syntax and runtime errors ------------------------------------------


def test_syntax_error_reports_kind_and_line():
    result = run("local x = 1\nlocal = 2\n")
    assert result.error.kind == "syntax"
    assert result.error.line == 2
    assert "line 2:" in result.error.message
    assert result.operations == []
    assert result.document == make_document()


def test_runtime_error_on_line_3():
    result = run("local a = 1\nlocal b = 2\nlocal c = nil + 1\nreturn c")
    assert result.error.kind == "runtime"
    assert result.error.line == 3
    assert result.error.message == "line 3: attempt to perform arithmetic on a nil value"


def test_error_messages_have_no_traceback_or_paths():
    result = run("local t = nil\nreturn t.x")
    assert "traceback" not in result.error.message
    assert "script:" not in result.error.message
    assert "sandbox" not in result.error.message
    assert ".py" not in result.error.message and "/" not in result.error.message


def test_script_error_with_a_table_value_is_still_reported():
    result = run("error({})")
    assert result.error.kind == "runtime"
    assert result.error.message


def test_api_argument_errors_carry_the_script_line():
    result = run("local it = timeline:item(1)\n\nit:set_speed('fast')")
    assert result.error.kind == "runtime"
    assert result.error.line == 3
    assert "number" in result.error.message


def test_calling_a_method_without_self_is_a_clear_error():
    result = run("local it = timeline:item(1)\nit.set_speed(2)")
    assert result.error.kind == "runtime"
    assert result.error.line == 2
    assert "sandbox" not in result.error.message


def test_non_str_source_is_a_programmer_error():
    with pytest.raises(TypeError):
        run(b"timeline:count()")


# --- 8. escape vectors (research table, all 16 rows) ------------------------

# (case id, script, message fragment). Every one must fail as a runtime error on
# line 1 and record nothing.
BLOCKED = [
    # 1. os / io / package / require / dofile / loadfile
    ("os.execute", "os.execute('touch /tmp/pwned')", "global 'os'"),
    ("io.open", "io.open('/etc/passwd')", "global 'io'"),
    ("package", "return package.loaded", "global 'package'"),
    ("require", "require('os')", "global 'require'"),
    ("loadfile", "loadfile('/etc/passwd')", "global 'loadfile'"),
    ("dofile", "dofile('/etc/passwd')", "global 'dofile'"),
    # 2. load of source or bytecode
    ("load", "load('return 1')()", "global 'load'"),
    ("load via _G", "_G.load('return 1')()", "field 'load'"),
    ("loadstring", "loadstring('return 1')()", "global 'loadstring'"),
    # 3. debug
    ("debug", "debug.sethook()", "global 'debug'"),
    ("debug.getinfo", "return debug.getinfo(1)", "global 'debug'"),
    # 4. string.dump, also through the string metatable
    ("string.dump", "string.dump(function() end)", "field 'dump'"),
    ("string.dump via metatable", "return ('x'):dump()", "method 'dump'"),
    # 5. collectgarbage
    ("collectgarbage", "collectgarbage('collect')", "global 'collectgarbage'"),
    # 6. the python global
    ("python.eval", "return python.eval('1')", "global 'python'"),
    ("python.builtins", "return python.builtins.open", "global 'python'"),
    ("python.as_attrgetter", "return python.as_attrgetter", "global 'python'"),
    # 7. getmetatable
    ("getmetatable", "getmetatable(timeline)", "global 'getmetatable'"),
    ("getmetatable on string", "getmetatable('').__index.dump()", "global 'getmetatable'"),
    # 8. Python function attributes are unreachable behind Lua closures
    ("fn.__globals__", "return timeline.add.__globals__", "attempt to index a function value"),
    ("fn attribute write", "timeline.add.x = 1", "attempt to index a function value"),
    ("fn.__self__", "return library.clips.__self__", "attempt to index a function value"),
    # 10. Lua values cannot cross into Python
    ("table into API", "timeline:set_target_duration({})", "expected a number"),
    ("function into API", "timeline:item(1):set_speed(print)", "expected a number"),
    ("table as clip id", "timeline:add({})", "Clip"),
    # 11. rawset / rawget / _ENV
    ("rawset", "rawset(_G, 'x', 1)", "global 'rawset'"),
    ("rawget", "rawget(_G, 'load')", "global 'rawget'"),
    ("_ENV escape", "return _ENV.os.execute", "attempt to index a nil value"),
    ("_G is the env", "return _G.os.execute", "attempt to index a nil value"),
    # 12. coroutines
    ("coroutine", "coroutine.wrap(function() end)()", "global 'coroutine'"),
    ("xpcall", "xpcall(print, print)", "global 'xpcall'"),
    # 13. __gc finalizers run with hooks off
    ("__gc finalizer", "setmetatable({}, {__gc = function() while true do end end})", "__gc is not allowed"),
    # 14. pattern matching
    ("string.match", "return ('x'):match('x')", "method 'match'"),
    ("string.gmatch", "for _ in string.gmatch('x', 'x') do end", "field 'gmatch'"),
    ("string.gsub", "return string.gsub('x', 'x', 'y')", "field 'gsub'"),
    # 15. string.rep amplification
    ("string.rep empty x 3e9", "return #string.rep('', 3e9)", "string.rep too large"),
    ("string.rep huge", "return #('ab'):rep(600000)", "string.rep too large"),
    # random would make runs non-deterministic
    ("math.random", "return math.random()", "field 'random'"),
]


@pytest.mark.parametrize("script,fragment", [(s, f) for _, s, f in BLOCKED], ids=[c for c, _, _ in BLOCKED])
def test_escape_vector_is_blocked(script, fragment):
    result = run(script)
    assert result.error is not None, "capability was not blocked"
    assert result.error.kind == "runtime"
    assert result.error.line == 1
    assert fragment in result.error.message
    assert result.operations == []


def test_bytecode_source_is_refused_as_a_syntax_error():
    result = run("\x1bLuaT\x00\x19\x93\r\n\x1a\n")
    assert result.error.kind == "syntax"


def test_caught_api_error_is_a_string_not_a_python_object():
    result = ok("local okay, e = pcall(function() timeline:item(1):set_speed('x') end) log(type(e))")
    assert result.log == ["string"]


def test_api_values_are_lua_functions_and_tables():
    result = ok("log(type(timeline.add), type(timeline), type(library), type(timeline:item(1)))")
    assert result.log == ["function\ttable\ttable\ttable"]


def test_string_find_is_plain_search_only():
    result = ok("log(tostring(('a.b'):find('.')), tostring(('a.b'):find('%d')), tostring(('a.b'):find('.', 1, false)))")
    assert result.log == ["2\tnil\t2"]


def test_string_rep_within_the_cap_still_works():
    result = ok("log(('ab'):rep(3, '-'))")
    assert result.log == ["ab-ab-ab"]


def test_standard_library_that_should_remain():
    result = ok(
        "log(math.floor(2.5), utf8.len('héé'), select('#', 1, 2), tostring(tonumber('7')), "
        "table.concat({1, 2}, '+'), ('x'):upper(), type(next), math.max(1, 3))"
    )
    assert result.log == ["2\t3\t2\t7\t1+2\tX\tfunction\t3"]


def test_setmetatable_without_gc_is_allowed():
    result = ok("local t = setmetatable({}, {__index = function() return 5 end}) log(t.x)")
    assert result.log == ["5"]


def test_runtime_is_fresh_per_run():
    ok("string.rep = nil x = 1")
    result = ok("log(type(string.rep), tostring(x))")
    assert result.log == ["function\tnil"]


# --- 9. limits --------------------------------------------------------------


def limit_run(source, name, **limit_kwargs):
    limits = ScriptLimits(**limit_kwargs)
    started = time.monotonic()
    result = run(source, limits=limits)
    elapsed = time.monotonic() - started
    assert result.error is not None, "limit did not trip"
    assert result.error.kind == "limit", result.error
    assert name in result.error.message, result.error.message
    assert result.operations == []
    assert result.document == make_document()
    return result, elapsed


def test_instruction_limit():
    _, elapsed = limit_run("while true do end", "instruction limit", max_instructions=1_000_000)
    assert elapsed < 3 * ScriptLimits().timeout_sec


def test_time_limit_on_a_native_heavy_loop():
    source = (
        "local t = {} for i = 1, 50000 do t[i] = i end "
        "while true do table.remove(t, 1) table.insert(t, 1, 0) end"
    )
    _, elapsed = limit_run(source, "time limit", timeout_sec=0.3, max_instructions=10**9)
    assert elapsed < 3 * 0.3


def test_memory_limit_on_table_growth():
    _, elapsed = limit_run("local t = {} for i = 1, 1e9 do t[i] = i end", "memory limit")
    assert elapsed < 3 * ScriptLimits().timeout_sec


def test_memory_limit_on_string_doubling():
    limit_run("local s = 'x' while true do s = s .. s end", "memory limit")


def test_operation_limit():
    source = "local it = timeline:item(1)\nfor i = 1, 1001 do it:set_speed(2) end"
    result, _ = limit_run(source, "operation limit")
    assert result.operations == []


def test_thousand_operations_are_allowed():
    result = ok("local it = timeline:item(1) for i = 1, 1000 do it:set_speed(2) end")
    assert len(result.operations) == 1000


def test_log_limit_keeps_the_log():
    result = run("for i = 1, 201 do log('line ' .. i) end")
    assert result.error.kind == "limit"
    assert "log limit" in result.error.message
    assert len(result.log) == 200
    assert result.log[0] == "line 1"


def test_two_hundred_log_lines_are_allowed():
    result = ok("for i = 1, 200 do print(i) end")
    assert len(result.log) == 200


def test_print_flood_is_a_log_limit():
    result, elapsed = limit_run("while true do print('x') end", "log limit")
    assert elapsed < 3 * ScriptLimits().timeout_sec


def test_oversize_source_is_a_limit_error():
    source = "-- " + "x" * (64 * 1024) + "\ntimeline:clear()"
    result = run(source)
    assert result.error.kind == "limit"
    assert "source too large" in result.error.message
    assert result.operations == []


def test_limits_are_configurable():
    result = run("log('a') log('b')", limits=ScriptLimits(max_log_lines=1))
    assert result.error.kind == "limit"


def test_log_lines_are_joined_with_tabs_and_truncated():
    result = ok("log('a', 1, nil, true) log(('x'):rep(600))", limits=ScriptLimits(max_log_line_chars=500))
    assert result.log[0] == "a\t1\tnil\ttrue"
    assert len(result.log[1]) == 500


def test_recursion_is_a_runtime_error_not_a_crash():
    result = run("local function f(n) return 1 + f(n + 1) end return f(1)", limits=ScriptLimits(max_memory_bytes=1 << 28))
    assert result.error.kind in ("runtime", "limit")


# --- 10. pcall cannot swallow a limit ---------------------------------------


def test_pcall_cannot_swallow_the_instruction_limit():
    _, elapsed = limit_run(
        "while true do pcall(function() while true do end end) end",
        "instruction limit",
        max_instructions=1_000_000,
    )
    assert elapsed < 3 * ScriptLimits().timeout_sec


def test_pcall_cannot_swallow_the_time_limit():
    _, elapsed = limit_run(
        "while true do pcall(function() while true do end end) end",
        "time limit",
        timeout_sec=0.3,
        max_instructions=10**9,
    )
    assert elapsed < 3 * 0.3


def test_pcall_cannot_swallow_the_operation_limit():
    source = "local it = timeline:item(1) for i = 1, 5000 do pcall(function() it:set_speed(2) end) end"
    limit_run(source, "operation limit")


def test_pcall_cannot_swallow_the_log_limit():
    source = "for i = 1, 5000 do pcall(log, 'x') end log('done')"
    limit_run(source, "log limit")


# --- 11. API reference ------------------------------------------------------


def test_api_reference_mentions_every_bound_function():
    assert BINDINGS
    for binding in BINDINGS:
        assert binding.call in API_REFERENCE, binding.call
        assert binding.doc in API_REFERENCE
        if binding.records:
            assert binding.records in API_REFERENCE


def test_every_binding_exists_in_the_runtime():
    lines = ["local it = timeline:item(1)"]
    for binding in BINDINGS:
        holder = {"timeline": "timeline", "library": "library", "item": "it", "": "_G"}[binding.receiver]
        lines.append(f"if type({holder}.{binding.name}) ~= 'function' then error('missing {binding.call}') end")
    result = ok("\n".join(lines))
    assert result.error is None


def test_api_reference_documents_clip_fields_conventions_and_stdlib():
    for text in ("id", "file_name", "source_in", "source_out", "duration", "score", "smoothness", "decision", "reason"):
        assert f"`{text}`" in API_REFERENCE
    assert "1-based" in API_REFERENCE
    assert "seconds" in API_REFERENCE
    for name in ("string.find", "string.rep", "ipairs", "math", "table", "utf8", "pcall"):
        assert name in API_REFERENCE
    for name in ("os", "io", "debug", "coroutine", "string.match"):
        assert name in API_REFERENCE  # the restricted list


def test_result_types_are_frozen():
    result = ok("timeline:count()")
    with pytest.raises(Exception):
        result.error = None  # type: ignore[misc]
    with pytest.raises(Exception):
        ScriptLimits().timeout_sec = 1  # type: ignore[misc]
    assert isinstance(ScriptError("syntax", "x", None), ScriptError)
