# Conductor — seed brain

The Conductor is RyanOS's orchestration planner: given a goal, it reads the roster of
real agent capability manifests (`assets/seed-brains/*/capabilities.yaml`) and produces
a run manifest — one node per required agent, wired into a dependency chain — for the
deterministic engine to dispatch and poll. The Conductor plans; it never dispatches,
polls, or executes work itself.
