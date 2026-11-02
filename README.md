# clawd-pet

Clawd stands above the top-right corner of the prompt in the Claude desktop app's Code tab. Each conversation state (thinking, coding, debug, creating, writing and so on) has two or three animations; Clawd picks one when the state begins and loops it until the state changes. Click it and it reacts; it cannot be dragged, and the band it sits in is only as tall as Clawd itself.

## Commands

- `/clawd off`, `/clawd on`: hide or show Clawd
- `/clawd ai off`, `/clawd ai on`: turn the small model's per-message judgement off or on; off, the state follows the tools alone
- `/clawd 190`: preview one animation by its Clawd 400 number

Which animations belong to which state is in `hooks/pools.ts`.

## Install

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `wideryan/clawd-pet`, then Add plugin.

At the prompt of a terminal session:

```
/plugin install clawd-pet --marketplace wideryan/clawd-pet
```

From a shell:

```bash
claude plugin install clawd-pet --marketplace wideryan/clawd-pet
```

Clawd draws only in the desktop app's Code tab, from a session's first message on. To remove it:

```bash
claude plugin uninstall clawd-pet@clawd-pet --scope user
claude plugin marketplace remove clawd-pet
```

## What it sends to a model

When you send a message, Clawd asks a small model (Haiku, on your account) what kind of work it is. It sends the first 600 characters of your message and the first 300 of Claude's last reply. `/clawd ai off` turns this off.

## Credits

This is an unofficial fan project, not made or endorsed by Anthropic. Artwork credit is in `NOTICE.md`.
