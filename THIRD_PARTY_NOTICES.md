# Third-party notices

## json-render agent skills

The following agent skills are vendored from
[vercel-labs/json-render](https://github.com/vercel-labs/json-render) at commit
`72568f990e5502c4d3115691facb8ca928a5c9fc`, directory `skills/`:

| Vendored path | Upstream path |
|---|---|
| `.agents/skills/json-render-core/SKILL.md` | `skills/core/SKILL.md` |
| `.agents/skills/json-render-react/SKILL.md` | `skills/react/SKILL.md` |
| `.agents/skills/json-render-next/SKILL.md` | `skills/next/SKILL.md` |
| `.agents/skills/json-render-shadcn/SKILL.md` | `skills/shadcn/SKILL.md` |
| `.agents/skills/json-render-directives/SKILL.md` | `skills/directives/SKILL.md` |

Licensed under the Apache License, Version 2.0 — full text in
[`third_party/licenses/json-render-LICENSE.txt`](third_party/licenses/json-render-LICENSE.txt).

Changes made to each file: the frontmatter `name` was namespaced
(`core` → `json-render-core`, and so on) and a one-line HTML comment stating the
source and that change was added below the frontmatter. The skill bodies are
otherwise unmodified.
