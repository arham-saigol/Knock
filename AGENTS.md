Core Rules:

- Add packages with an install command. Do not edit package.json manually.
- Run the project's check, format, and lint commands before considering the task complete. For larger tasks consider running them after every batch of changes.
- Avoid explicit return types unless they add real value.
- Treat 'as any' as a last resort. Use real type safety and rely on type inference where possible.
- Put performance first. When two options are sound, choose the one that makes the app feel fastest and works better.
- Use good defaults and keep setup to a minimum. Users should get value with no setup.
- Never trade security for ease of use.