---
type: Reference
title: Project Wiki Conventions
description: Concise rules for maintaining the project-local OKF v0.1 wiki.
tags: [okf, knowledge-management]
---

# Project Wiki Conventions

This wiki is the project's durable knowledge layer. Keep it concise: preserve
decisions, constraints, rationale, current truth, and unresolved questions—not
a transcript of work.

# Workflow

Before substantive work, read `/index.md` and only the concepts relevant to the
task. Use them automatically when answering project questions; the user does
not need to request a separate query.

Update the wiki when:

- a discussion settles or changes a durable decision, design, or expectation;
- implementation changes a documented fact or status;
- supplied information or repository evidence corrects or extends key context.

Skip transient discussion, rejected ideas, routine implementation detail, and
information already represented accurately. Prefer editing an existing concept
to adding a new one. Distinguish facts, intentions, decisions, and open
questions; never invent missing information.

After a material edit, update the nearest index and add one concise entry to
`/log.md`. Reading alone does not change the wiki or log.

# Authoring

- Lead with the key insight; remove repetition and details recoverable cheaply
  from the repository.
- Treat indexes as routing maps, not concept pages. Limit them to a title,
  optional one-sentence scope, and grouped links with one-line descriptions;
  put decisions, rationale, policies, and design detail in typed concepts.
- Keep concepts at the wiki root. Add subject-based folders only when several
  related pages justify them; each folder gets an `index.md`.
- Keep source files outside the wiki. Cite URLs or repository paths when claims
  need support; do not create a `raw/` layer unless explicitly requested.
- Prefer bundle-absolute links beginning with `/` for links inside the wiki.

# OKF rules

- Every concept Markdown file requires YAML frontmatter with a non-empty,
  descriptive `type`; preserve unknown keys when editing.
- Only root `/index.md` may define `okf_version: "0.1"` in frontmatter.
  Concept pages have typed frontmatter. Nested indexes and logs have none.
- Use structured Markdown and `# Schema`, `# Examples`, or `# Citations` when
  useful.
- Keep log entries newest-first under ISO `YYYY-MM-DD` headings.

# Maintenance

While editing, check the affected pages for stale claims, contradictions,
broken links, missing index entries, invalid frontmatter, and unlogged material
changes. Run a wider lint when requested or when drift is likely. Report
findings by default; repair them only when the task authorizes changes.
