Core Rules:

- Add packages with an install command. Do not edit package.json manually.
- Run the project's check, format, and lint commands before considering the task complete. For larger tasks consider running them after every batch of changes.
- Avoid explicit return types unless they add real value.
- Treat 'as any' as a last resort. Use real type safety and rely on type inference where possible.
- Put performance first. When two options are sound, choose the one that makes the app feel fastest and works better.
- Use good defaults and keep setup to a minimum. Users should get value with no setup.
- Never trade security for ease of use.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
