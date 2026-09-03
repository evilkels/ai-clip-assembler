# 0005: Harness and In-App Review Agent are chosen independently, under one consent gate

## Status

Accepted (2026-09-03).

## Context

`UBIQUITOUS_LANGUAGE.md` defines two separate concepts. A **Harness** is "a
pluggable scoring or reasoning implementation" that produces Candidate Clips
during analysis. The **In-App Review Agent** is "the hosted conversational
agent inside the app", an MCP client that runs in propose mode and composes
Versions from an existing Candidate Clip library.

The code did not honour that separation. The Review Agent was selected from
the analysis harness:

```python
default_agent_requires_consent = (
    project.get("harness_id") != "pi_agent" or not project.get("cloud_ai_consent")
)
```

Choosing the rule-based Manual Harness therefore replaced the Review Agent
with a stub whose only output is the sentence "Manual analysis is ready.
Creative versions remain deterministic and local." An Editor who wanted
rule-based scoring but a conversational agent had no way to express that, and
nothing explained why the chat had stopped being an agent.

A second gap made this hard to diagnose. `harness_id` names both the harness
the Editor selected and the harness that actually produced the current
Candidate Clips. Those diverge routinely: the provider-backed harness falls
back to the rule-based result when the `pi` CLI is missing, when no frames are
available, or on timeout, and `POST /clips/rederive` legitimately rebuilds the
library from cached Frame Scores with no AI step at all. Because one term
carried both meanings, the same field could be truthful about the clips and
misleading about the Editor's choice at the same time.

## Decision

The Harness and the In-App Review Agent are configured independently. Choosing
the Manual Harness no longer disables the Review Agent, and choosing a
provider-backed harness does not by itself make the chat agentic.

A single per-project cloud-AI consent continues to gate both, so the privacy
boundary established in [ADR 0001](0001-local-first-and-cloud-consent.md) is
unchanged: no frames or clip metadata reach an external provider — for scoring
or for conversation — until the Editor has saved consent for that project. One
consent covers both surfaces rather than asking twice.

`harness_id` splits into two named concepts:

- **Selected Harness** — the harness the Editor chose. It belongs to the
  project and survives navigation.
- **Effective Harness** — the harness that actually produced the current
  Candidate Clip library. It is written by whatever produced that library, and
  it may differ from the Selected Harness after a fallback or a re-derive.

When the two differ, the app says so, with the reason.

## Consequences

- An Editor can keep deterministic local scoring and still hold a conversation
  about the cut, which was previously impossible to express.
- Rule-based analysis is no longer conflated with an absent agent, so the word
  "manual" stops carrying two meanings in the same sentence — the ambiguity
  `UBIQUITOUS_LANGUAGE.md` already flagged.
- A fallback becomes visible. The backend already computes `used_ai`, a
  per-video warning and `models_used`; these become part of the contract the
  UI renders rather than metadata dropped at the client boundary.
- `POST /clips/rederive` keeps writing an Effective Harness of `manual`,
  because a re-derived library genuinely is rule-based. What changes is that
  it no longer overwrites the Editor's selection, and the downgrade is stated
  rather than inferred.
- Two fields must now be persisted and kept in step, and any future producer
  of a Candidate Clip library has to record which harness produced it. That is
  the cost of making fallback legible.

## Alternatives considered

**Keep one AI mode covering both surfaces.** Fewer controls and one mental
model, but it contradicts the vocabulary the project already uses and
preserves the surprise this ADR exists to remove.

**Separate consent per surface.** The most precise privacy story, and it was
rejected only because two consent prompts for one provider is friction without
a matching gain: the same data boundary and the same provider are involved in
both cases.
