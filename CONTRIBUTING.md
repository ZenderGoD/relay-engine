# Contributing

Keep changes small, dependency-free where practical, and project-neutral. Use synthetic examples and environment references. Exclude private runtime state and credentials.

Describe the user problem, changed behavior, tests and limitations in each change. Run `node --test` and inspect every tracked file for private paths, people, project data, endpoints and credentials before sharing. Changes to scheduling, process ownership or live-test gates need focused failure-path checks.

Do not include generated local state. Propose integrations separately rather than adding automatic publication or deployment. Repository maintainers decide release timing.
