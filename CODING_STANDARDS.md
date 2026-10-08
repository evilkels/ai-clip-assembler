# Coding standards

- When a fix protects one async path from a stale project or session, protect
  every sibling path in the same hook or module.
- New and changed tests must pass the test-audit authoring gate. Show regression
  tests failing on the pre-fix code, and explain how in the PR.
- Make each assertion prove the behavior named by its test; visibility alone
  does not prove playback, scrolling, or saving.
- Use a wall-clock bound only when the deadline itself is part of the contract.
