# OpenCode Plugin: GStack

GStack  plugin for OpenCode -  Virtual software engineering team with specialized AI skills.

##  Overview

This plugin brings gstack's core skills to OpenCode, transforming your AI assistant into a virtual engineering team with specialized roles:

- **CEO** - Product strategy and scope review
- **Designer** - Design system and mockups
- **Staff Engineer** - Code review and bug fixing
- **QA Lead** - Automated testing with real browsers
- **Security Officer** - Security audits
- **Release Engineer** - Ship and deploy

## Skills (Commands)

### Planning Phase
- `/office-hours` - Product framing and design doc creation
- `/plan-ceo-review` - CEO-level product scope and strategy review
- `/plan-eng-review` - Engineering architecture and test planning
- `/plan-design-review` - Senior design audit and improvement

### Design Phase
- `/design-consultation` - Build design system and mockups
- `/design-shotgun` - Generate and compare multiple design variants
- `/design-html` - Generate production-quality HTML layouts

### Development Phase
- `/review` - Staff engineer code review and bug fixing
- `/investigate` - Debugging and root cause analysis

### Testing Phase
- `/qa` - Automated QA testing with real browser interaction

### Security & Operations
- `/cso` - Security audits (OWASP, STRIDE)
- `/canary` - Post-deploy monitoring and alerting

### Ship Phase
- `/ship` - Release engineering, test bootstrapping, PR creation
- `/land-and-deploy` - Merge, deploy, and verify production health

## Usage

```bash
/office-hours
/plan-ceo-review
/design-consultation
/review
/investigate
/qa
/ship
/cso
```

## Installation

Add to your `opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-plugin-gstack"]
}
```

## Configuration

No additional configuration required. The plugin registers commands dynamically.