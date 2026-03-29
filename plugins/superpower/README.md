# Superpower — Extensible Agent Capabilities Plugin

Superpower is an OpenCode plugin that dynamically loads agents, skills, and commands from the [superpowers](https://github.com/obra/superpowers) repository. It extends OpenCode with custom agents and capabilities without requiring code changes.

## Architecture

```
Startup → Clone superpowers repo → Load agents → Register skills → Register commands → Ready
```

- **Dynamic Agent Loading**: Loads agent definitions from `~/.superpowers/agents/`
- **Skill Registry**: Registers skills from `~/.superpowers/skills/`
- **Command Templates**: Registers command templates from `~/.superpowers/commands/`

## How It Works

On first load, Superpower clones the [superpowers](https://github.com/obra/superpowers) repository to `~/.superpowers/`. It then:

1. Scans `~/.superpowers/agents/*.md` and registers agents with OpenCode
2. Scans `~/.superpowers/skills/*/SKILL.md` and registers them as skills
3. Scans `~/.superpowers/commands/*.md` and registers them as commands

The superpowers repo is cloned once and reused on subsequent runs.

## Quick Start

### 1. Register Plugin

In `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/superpower/index.ts"
  ]
}
```

### 2. Use

Use any agent defined in the superpowers repository:

```
@<agent-name> Your task description here
```

For example, if the superpowers repo contains a `reviewer` agent:

```
@reviewer Review the authentication module
```

### 3. Use Skills

Skills are registered with the `superpowers/` prefix:

```
@superpowers/reviewer Review the authentication module
```

### 4. Use Commands

Commands are available directly:

```
/<command-name> argument1 argument2
```

## Agent Format

Agents are defined in Markdown files with YAML frontmatter in `~/.superpowers/agents/`:

```markdown
---
name: reviewer
description: Code reviewer agent that provides constructive feedback
mode: subagent
---

You are an experienced code reviewer. Your role is to:
1. Understand the code changes
2. Identify potential issues
3. Provide constructive feedback
4. Suggest improvements
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | No | Agent name (defaults to filename without .md) |
| `description` | `string` | No | Agent description shown in OpenCode |
| `mode` | `string` | No | Agent mode: `subagent`, `primary`, or `all` (default: `subagent`) |

## Skill Format

Skills are directories in `~/.superpowers/skills/` containing a `SKILL.md` file:

```
~/.superpowers/skills/
└── reviewer/
    └── SKILL.md
```

SKILL.md uses YAML frontmatter:

```markdown
---
description: Review code changes and provide feedback
---

# Code Review Skill

You are an expert code reviewer. When invoked:
1. Read the diff or changed files
2. Analyze for bugs, security issues, performance problems
3. Check for code style consistency
4. Provide actionable feedback
```

## Command Format

Commands are Markdown files in `~/.superpowers/commands/`:

```markdown
---
name: review
description: Review code changes
---

Review the following code changes:
$ARGUMENTS
```

The `$ARGUMENTS` placeholder is replaced with user input.

## Configuration

No configuration required! Superpower automatically clones and loads from `~/.superpowers/`.

### Manual Override

If you want to use a different superpowers location, you can set the environment variable:

```bash
export SUPERPOWERS_DIR=/path/to/your/superpowers
```

## Directory Structure

```
.opencode/
├── opencode.json              # Plugin registration
└── plugins/
    └── superpower/
        └── index.ts           # Plugin entry point
```

## Troubleshooting

### Superpowers not being loaded

1. Check that `~/.superpowers/` exists
2. Verify the directory contains `agents/`, `skills/`, and `commands/` subdirectories
3. Check that Markdown files have proper frontmatter

### Agents not appearing

1. Verify agent files are in `~/.superpowers/agents/*.md`
2. Check that frontmatter has valid `mode` field
3. Ensure the Markdown body is not empty

### Skills/Commands not working

1. Verify skill directories contain `SKILL.md`
2. Check command files have proper frontmatter
3. Ensure `$ARGUMENTS` placeholder is used for commands that need user input

## See Also

- [superpowers Repository](https://github.com/obra/superpowers)
- [OpenCode Documentation](https://opencode.ai)
