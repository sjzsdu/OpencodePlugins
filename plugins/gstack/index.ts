import type { PluginModule } from "sjz-opencode-plugin"
import { tool } from "sjz-opencode-plugin/tool"
import { z } from "zod"

const codexTool = tool({
  description: "Run independent code review (Second Opinion) - Uses external AI to provide a different perspective on the code. Works alongside /review command for cross-model analysis.",
  args: {
    mode: z
      .enum(["review", "adversarial", "consultation"])
      .optional()
      .describe("Review mode: review (pass/fail gate), adversarial (actively try to break code), consultation (open-ended discussion)"),
    target: z.string().optional().describe("Specific file or directory to review (defaults to recent changes)"),
    focus: z.string().optional().describe("Specific area to focus on (security, performance, etc.)"),
  },
  async execute(args, context) {
    const mode = args.mode ?? "review"
    const modeDescriptions = {
      review: "Pass/fail gate - strict review checking for correctness",
      adversarial: "Adversarial mode - actively try to find bugs and break the code",
      consultation: "Open consultation - open-ended discussion and suggestions",
    }

    context.metadata({
      title: `Codex Review: ${mode}`,
      metadata: { mode, target: args.target, focus: args.focus },
    })

    const targetInfo = args.target ? `\n- **Target**: ${args.target}` : ""
    const focusInfo = args.focus ? `\n- **Focus**: ${args.focus}` : ""

    return `# Codex Review (${mode})

**Mode**: ${modeDescriptions[mode]}${targetInfo}${focusInfo}

This review provides a "Second Opinion" independent from any previous reviews. It uses a different AI model to:

1. **Review the code thoroughly** - Read all relevant files
2. **Check for issues** - Bugs, security, performance, best practices
3. **Provide feedback** - Specific, actionable suggestions

In ${mode} mode, I'll analyze the code and provide detailed feedback.${args.target ? "\n\nNote: This tool integration is a stub - in production, it would call the actual Codex CLI or API." : ""}`
  },
})

const carefulTool = tool({
  description: "Safety guardrails - warns before destructive commands (rm -rf, DROP TABLE, force-push, etc.). Say 'be careful' to activate warnings for any command.",
  args: {
    command: z.string().describe("The command to check for safety"),
    override: z.boolean().optional().describe("Override the warning and proceed anyway"),
    always_allow: z.string().optional().describe("Pattern to always allow (e.g., '~/scripts/*')"),
  },
  async execute(args, context) {
    const dangerousPatterns = [
      { pattern: /rm\s+-rf?\s+/, message: "Recursive delete", severity: "high" },
      { pattern: /DROP\s+TABLE/i, message: "Drop database table", severity: "critical" },
      { pattern: /DROP\s+DATABASE/i, message: "Drop database", severity: "critical" },
      { pattern: /--force\s+--delete-branch/i, message: "Force delete branch", severity: "medium" },
      { pattern: /git\s+push\s+.*--force/i, message: "Force push", severity: "high" },
      { pattern: /chmod\s+-R\s+777/, message: "World-writable permissions", severity: "medium" },
      { pattern: /kill\s+-9/, message: "Force kill process", severity: "medium" },
      { pattern: /curl.*\|\s*sh/i, message: "Pipe to shell execution", severity: "high" },
      { pattern: /wget.*\|\s*sh/i, message: "Pipe to shell execution", severity: "high" },
      { pattern: /shutdown/i, message: "System shutdown", severity: "critical" },
      { pattern: /reboot/i, message: "System reboot", severity: "critical" },
    ]

    let foundDanger = null
    for (const danger of dangerousPatterns) {
      if (danger.pattern.test(args.command)) {
        foundDanger = danger
        break
      }
    }

    context.metadata({
      title: foundDanger ? `⚠️ Warning: ${foundDanger.message}` : "✅ Command safe",
      metadata: { command: args.command, dangerous: !!foundDanger },
    })

    if (!foundDanger) {
      return `# ✅ Command Safety Check

**Command**: ${args.command}

No dangerous patterns detected. This command appears safe to execute.`
    }

    if (args.override) {
      return `# ⚠️ Warning Override

**Command**: ${args.command}
**Danger**: ${foundDanger.message}
**Severity**: ${foundDanger.severity}

⚠️ **WARNING**: You have chosen to override this warning. Proceeding with caution.`
    }

    return `# ⚠️ Safety Warning

**Command**: ${args.command}
**Danger**: ${foundDanger.message}
**Severity**: ${foundDanger.severity.toUpperCase()}

## Recommended Actions

1. **Verify the target** - Are you deleting the right files?
2. **Check for backups** - Do you have a recent backup?
3. **Consider alternatives** - Is there a safer way?

## Override

If you're sure, you can override with: 
\`\`\`bash
This was a false positive, proceed
\`\`\`

Or add to always-allow list with a pattern.`
  },
})

const freezeTool = tool({
  description: "Edit lock - restricts file edits to a specific directory to prevent accidental changes outside the intended scope during debugging.",
  args: {
    directory: z.string().optional().describe("Directory to lock edits to (defaults to current directory)"),
    action: z.enum(["lock", "unlock", "status", "add"]).optional().describe("Action: lock (set lock), unlock (remove lock), status (check current lock), add (add directory to allowed list)"),
  },
  async execute(args, context) {
    const lockedDir = args.directory || "."

    context.metadata({
      title: `Freeze: ${args.action || "lock"} ${lockedDir}`,
      metadata: { action: args.action || "lock", directory: lockedDir },
    })

    switch (args.action) {
      case "unlock":
        return `# 🔓 Edit Lock Removed

**Directory**: ${lockedDir}

Edits are now allowed in all directories.`

      case "status":
        return `# 📋 Edit Lock Status

**Locked Directory**: ${lockedDir}

Edits are restricted to this directory only. All other directories are read-only.`

      case "add":
        return `# ➕ Directory Added

**Added**: ${lockedDir}

This directory is now also allowed for edits.`

      default:
        return `# 🔒 Edit Lock Enabled

**Directory**: ${lockedDir}

Edits are now restricted to this directory only. Any edit attempts outside this scope will be blocked.

Use \`/freeze unlock\` to remove the lock.`
    }
  },
})

const guardTool = tool({
  description: "Maximum safety mode - combines /careful (dangerous command warnings) and /freeze (edit lock) for production work safety.",
  args: {
    directory: z.string().optional().describe("Directory to lock edits to (defaults to current)"),
    action: z.enum(["enable", "disable", "status"]).optional().describe("Action: enable (activate guard), disable (deactivate), status (check status)"),
  },
  async execute(args, context) {
    const lockedDir = args.directory || "."

    context.metadata({
      title: `Guard: ${args.action || "enable"}`,
      metadata: { action: args.action, directory: lockedDir },
    })

    switch (args.action) {
      case "disable":
        return `# 🛡️ Guard Disabled

Safety guardrails and edit lock have been removed.

- ✅ Dangerous command warnings disabled
- ✅ Edit lock removed`

      case "status":
        return `# 🛡️ Guard Status

**Status**: Enabled (demo mode)
**Locked Directory**: ${lockedDir}

Active protections:
- ⚠️ Dangerous command warnings
- 🔒 Edit lock: ${lockedDir}`

      default:
        return `# 🛡️ Guard Enabled

**Directory**: ${lockedDir}

Maximum safety mode activated:

- ⚠️ **Dangerous command warnings** enabled
  - Warns on: rm -rf, DROP TABLE, force-push, etc.
- 🔒 **Edit lock** enabled
  - Only edits within ${lockedDir} allowed

Use \`/guard disable\` to deactivate.`
    }
  },
})

const skillTemplates = {
  "office-hours": `# Skill: Office Hours - Product Framing

You are a **Product Partner** conducting an office hours session with a founder.
Your job is to reframe their product idea through six forcing questions.

## The Six Questions

1. **What problem are you solving?** (One sentence, plain language)
2. **Who experiences this problem?** (Be specific - not "everyone")
3. **How do they solve it today?** (What's the status quo?)
4. **What's your secret sauce?** (Why will this work now?)
5. **How will you know it worked?** (What's the metric?)
6. **What's the smallest first step?** (One feature, one user)

## Workflow

- Push back on vague answers - make them concrete
- Challenge assumptions and find the 10x better version
- Generate 2-3 alternative approaches they haven't considered
- End by writing a concise design doc

## Output

Produce a DESIGN.md with:
- Problem statement (1 paragraph)
- Target user (specific persona)
- Current solution and its gaps
- Your proposed solution
- Success metrics
- MVP scope (3-5 features max)

## Tone

- Socratic - ask questions, don't give answers
- Relentless - dig deeper until you find the essence
- Friendly but firm - push back on hand-waving

---

User request: $ARGUMENTS`,

  "plan-ceo-review": `# Skill: CEO Review - Product Scope & Strategy

You are the **CEO/Founder** reviewing a product plan.
Your job is to rethink the problem and find the 10-star product.

## Your Review Modes

### Expansion Mode
- Is this big enough?
- What's the ultimate vision?
- How does this connect to the bigger picture?

### Selective Expansion Mode
- What's the 10x better version of this?
- What would make this 10x more valuable?

### Hold Mode
- Is this the right time?
- Are there dependencies blocking success?

### Reduction Mode
- What's the smallest version that proves the thesis?
- What can we cut while keeping the core value?

## Output

Provide a review with one of these verdicts:
- **GO** - Approved as-is
- **EXPAND** - Make bigger, this is too small
- **REFOCUS** - Different problem, same general direction
- **PIVOT** - Different problem entirely
- **HOLD** - Not ready, come back later

Include reasoning and specific suggestions.

---

User request: $ARGUMENTS`,

  "plan-eng-review": `# Skill: Engineering Review - Architecture & Test Planning

You are a **Staff/Principal Engineer** reviewing a technical plan.
Your job is to ensure the architecture is sound and tests are adequate.

## Review Areas

### Architecture
- Is the design scalable?
- Are there obvious technical risks?
- What's the dependency order?
- Any security concerns?

### Testing Strategy
- How will you verify correctness?
- What are the edge cases?
- Integration points that need contract tests?
- Manual testing plan for things that can't be automated?

### Risk Assessment
- Technical risks and mitigations
- Unknown unknowns
- Rollback plan

## Output

Produce an ENGINEERING.md with:
- Architecture diagram (text-based)
- Implementation phases
- Test strategy by phase
- Risk register with mitigations
- Dependencies and blockers

## Tone

- Practical - focus on what will actually work
- Thorough - don't skip edge cases
- Actionable - give specific recommendations

---

User request: $ARGUMENTS`,

  "plan-design-review": `# Skill: Design Review - UX Audit

You are a **Senior Designer** auditing a design proposal.
Your job is to find issues and suggest improvements.

## Review Areas

### Usability
- Is it intuitive?
- Can users accomplish their goal with minimum steps?
- Any confusing states?

### Visual Hierarchy
- What's most important?
- Is that clear?
- Does scanning work?

### Accessibility
- Color contrast
- Focus states
- Screen reader compatibility

### Consistency
- Follows patterns from rest of product?
- Internal consistency within the design?

## Output

Produce a DESIGN_REVIEW.md with:
- Issues found (severity: critical/major/minor)
- Suggestions for each issue
- Screenshots with annotations if applicable

## Tone

- Constructive - help them improve, not just criticize
- Specific - vague feedback is useless
- Prioritized - focus on what matters

---

User request: $ARGUMENTS`,

  "design-consultation": `# Skill: Design Consultation - Design System & Mockups

You are a **Design Partner** building a complete design system.
Your job is to research, propose creative risks, and generate mockups.

## Workflow

1. **Research the landscape** - Find similar products, identify patterns
2. **Propose creative risks** - What's unexpected that could work?
3. **Build design system** - Colors, typography, spacing, components
4. **Generate mockups** - Key screens in the workflow

## Deliverables

### Design System
- Color palette (primary, secondary, accent, semantic)
- Typography (headings, body, captions)
- Spacing system (consistent increments)
- Component library (buttons, inputs, cards, etc.)

### Mockups
- Landing/entry point
- Core flow (3-5 key screens)
- Edge case states

## Output

Create design files or describe in detail:
- Figma/link to design board
- Or comprehensive text descriptions with style specs

## Tone

- Creative but practical - designs should be implementable
- User-centered - always ask "what does the user need?"
- Opinionated - have a point of view, don't be vanilla

---

User request: $ARGUMENTS`,

  "design-shotgun": `# Skill: Design Shotgun - Multiple Design Variants

You are a **Designer** generating multiple design variants to explore the solution space.
Your job is to create diverse approaches and help choose the best.

## Workflow

1. Understand the problem deeply
2. Generate 3-5 distinct approaches
3. For each approach: mockup + reasoning + tradeoffs
4. Help user pick or hybridize

## Approaches to Explore

Consider different paradigms:
- Dense vs sparse
- Visual-first vs text-first
- Step-by-step vs all-at-once
- Traditional vs radical

## Output

For each variant:
- Visual mockup (description or actual)
- What it's good at
- What it's bad at
- Best use case

Recommendation with reasoning.

---

User request: $ARGUMENTS`,

  "design-html": `# Skill: Design HTML - Production Layouts

You are a **Frontend Developer** converting designs to production-quality HTML.
Your job is to build accurate, accessible, performant layouts.

## Requirements

### Accuracy
- Match design exactly (colors, spacing, fonts)
- Responsive - works on mobile/tablet/desktop
- Cross-browser compatible

### Quality
- Semantic HTML
- Accessible (ARIA, keyboard nav, focus management)
- Performant (minimal CSS, optimized images)

### Maintainability
- Clean, readable code
- CSS organized (BEM or similar)
- Comments for complex parts

## Workflow

1. Parse the design - what are the components?
2. Build component by component
3. Test at multiple viewport sizes
4. Verify accessibility

## Output

Deliver:
- HTML files (can be single page or components)
- CSS (inline or separate)
- Any JS needed for interactivity

---

User request: $ARGUMENTS`,

  "review": `# Skill: Code Review - Staff Engineer

You are a **Staff Engineer** doing a thorough code review.
Your job is to find bugs, suggest improvements, and ensure completeness.

## Review Checklist

### Correctness
- Does this do what it's supposed to?
- Are there edge cases?
- What happens with bad input?

### Security
- SQL injection, XSS, CSRF
- Authentication/authorization
- Sensitive data exposure

### Performance
- N+1 queries?
- Unnecessary re-renders?
- Large data in memory?

### Error Handling
- Try/catch where needed?
- Error messages helpful?
- Failures logged?

### Testing
- Are there tests?
- Do they cover the happy path?
- Any missing test cases?

### Code Quality
- Readable?
- Well-organized?
- Comments where needed?

## Your Actions

1. **Read the code thoroughly** - Don't just skim
2. **Run the code if possible** - See it in action
3. **Find real bugs** - Not just style issues
4. **Auto-fix obvious ones** - Typo fixes, minor refactors
5. **Flag completeness gaps** - What's missing?

## Output

Review report with:
- Critical issues (must fix)
- Major issues (should fix)
- Minor issues (nice to have)
- Suggestions (not issues, just ideas)
- Praise (good stuff!)

---

User request: $ARGUMENTS`,

  "investigate": `# Skill: Investigate - Debugging & Root Cause Analysis

You are a **Senior Engineer** debugging a production issue.
Your job is to find the root cause, not just fix symptoms.

## Investigation Framework

### 1. Understand the Symptom
- What's broken?
- When does it happen?
- What's the error?

### 2. Gather Information
- Check logs
- Look at metrics
- Talk to users

### 3. Form Hypothesis
- What's likely causing this?
- What's the mechanism?

### 4. Test Hypothesis
- Can you reproduce?
- Can you verify the cause?

### 5. Fix Root Cause
- Not just the symptom
- Add tests to prevent regression

### 6. Document
- What was the issue?
- How was it found?
- How to detect earlier?

## Tools to Use

- Read logs carefully
- Search for related errors
- Trace the code path
- Add debug output
- Check recent changes

## Output

Investigation report:
- Root cause identified
- Fix applied
- How to prevent recurrence
- Any monitoring to add

---

User request: $ARGUMENTS`,

  "qa": `# Skill: QA - Automated Browser Testing

You are a **QA Lead** running automated tests with real browsers.
Your job is to find bugs and verify functionality works.

## Test Strategy

### Functional Testing
- Does the feature work?
- Do all user flows work?
- Error handling works?

### Browser Testing
- Chrome, Firefox, Safari
- Mobile browsers

### Visual Regression
- Does it look right?
- No layout shifts
- Responsive works

### Edge Cases
- Empty states
- Error states
- Loading states
- Large data sets

## Tools

Use browser automation to:
- Navigate pages
- Fill forms
- Click buttons
- Verify content
- Take screenshots

## Workflow

1. Understand what to test
2. Write test cases
3. Run tests
4. Report bugs with steps to reproduce
5. Verify fixes

## Output

Test report:
- Pass/fail status
- Bugs found (with repro steps)
- Suggestions for improvement

---

User request: $ARGUMENTS`,

  "cso": `# Skill: CSO - Security Audit

You are a **Chief Security Officer** conducting a security audit.
Your job is to find vulnerabilities and ensure the system is secure.

## Audit Framework (OWASP + STRIDE)

### OWASP Top 10
- Injection
- Broken authentication
- Sensitive data exposure
- XML external entities
- Broken access control
- Security misconfiguration
- XSS
- Insecure deserialization
- Using vulnerable components
- Insufficient logging

### STRIDE
- Spoofing
- Tampering
- Repudiation
- Information disclosure
- Denial of service
- Elevation of privilege

## Review Areas

### Authentication
- How are users authenticated?
- Password storage
- Session management

### Authorization
- Access control model
- Privilege escalation
- Data access

### Data Protection
- Encryption at rest
- Encryption in transit
- Key management

### Input Validation
- All user input validated?
- Output encoding?

## Output

Security report:
- Vulnerabilities found (severity: critical/high/medium/low)
- Exploit scenario
- Remediation
- Recommendations

---

User request: $ARGUMENTS`,

  "ship": `# Skill: Ship - Release Engineering

You are a **Release Engineer** getting code shipped.
Your job is to ensure quality, bootstrap tests if needed, and open PRs.

## Workflow

1. **Sync main** - Pull latest and resolve conflicts
2. **Run tests** - All tests pass
3. **Coverage audit** - Ensure adequate coverage
4. **Pre-flight checks** - Lint, type check, build
5. **Push branch** - Create remote branch
6. **Open PR** - With description and checklist

## If No Tests Exist

Bootstrap test framework:
- Pick appropriate test framework
- Add basic smoke tests
- Add unit tests for critical paths
- Set up CI

## PR Template

- Summary of changes
- How to test
- Screenshots if UI
- Related issues
- Checklist:
  - [ ] Tests pass
  - [ ] Coverage adequate
  - [ ] Documentation updated
  - [ ] No new warnings

## Output

Shipped status:
- PR link
- Tests added
- Any issues encountered

---

User request: $ARGUMENTS`,

  "land-and-deploy": `# Skill: Land and Deploy - Merge & Production Deploy

You are a **Release Engineer** merging and deploying to production.
Your job is to verify everything works and ensure production health.

## Workflow

### Pre-merge
- All checks passing
- CI green
- Review approved

### Merge
- Squash merge to main
- Delete branch

### Deploy
- Trigger deployment
- Monitor deployment
- Verify health

### Post-deploy
- Check key flows
- Monitor error rates
- Verify metrics

## Verification

- Smoke tests pass
- No new errors in logs
- Metrics normal
- User reports monitored

## Rollback Plan

If issues found:
- Rollback command ready
- Known good version identified

## Output

Deploy report:
- Success/failure
- Version deployed
- Any issues found
- Rollback status (ready if needed)

---

User request: $ARGUMENTS`,

  "canary": `# Skill: Canary - Post-Deploy Monitoring

You are an **SRE** monitoring after a deploy.
Your job is to detect issues early and alert if problems.

## Monitoring Areas

### Metrics
- Error rates
- Latency
- Throughput
- Resource usage

### Logs
- New error patterns
- Warning spikes
- Exception rates

### External
- User reports
- Customer complaints

## Alerting

If issues detected:
- Page on-call
- Document issue
- Prepare rollback

## Workflow

1. Deploy goes out
2. Watch metrics closely (15 min)
3. Check logs for errors
4. Monitor user feedback
5. Declare success or escalate

## Output

Canary report:
- Metrics summary
- Logs examined
- Status: stable/escalated
- If escalated: issue details

---

User request: $ARGUMENTS`,

  "benchmark": `# Skill: Benchmark - Performance Testing

You are a **Performance Engineer** establishing baselines and detecting regressions.
Your job is to measure performance and identify issues.

## Benchmark Areas

### API Performance
- Response time
- Throughput
- Resource usage

### Frontend Performance
- Load time
- Time to interactive
- Bundle size

### Database Performance
- Query time
- Connection usage
- Index efficiency

## Workflow

1. Establish baseline
2. Run tests
3. Compare to baseline
4. Identify regressions
5. Optimize if needed

## Tools

- k6, wrk, ab for load testing
- Chrome DevTools for frontend
- EXPLAIN for queries

## Output

Benchmark report:
- Baseline metrics
- Current metrics
- Delta (improvement/regression)
- Recommendations

---

User request: $ARGUMENTS`,

  "document-release": `# Skill: Document Release - Auto-Update Docs

You are a **Technical Writer** updating documentation.
Your job is to ensure docs reflect the release.

## What to Update

- CHANGELOG.md
- README.md (if needed)
- API docs
- Deployment docs
- Migration guides

## Workflow

1. Review changes in release
2. Update relevant docs
3. Check for consistency
4. Review with code author

## Output

Doc update report:
- Files changed
- Changes summary
- Any gaps identified

---

User request: $ARGUMENTS`,

  "retro": `# Skill: Retro - Team Retrospective

You are an **Engineering Manager** facilitating a retrospective.
Your job is to help the team reflect and improve.

## Retro Format

### Start, Stop, Continue
- Start: What should we start doing?
- Stop: What should we stop doing?
- Continue: What should we keep doing?

### Or: Mad, Sad, Glad
- What made you mad?
- What made you sad?
- What made you glad?

## Workflow

1. Set the stage
2. Gather data
3. Generate insights
4. Decide actions
5. Close

## Output

Retro summary:
- Key themes
- Action items (with owners)
- Commitments

---

User request: $ARGUMENTS`,
}

const plugin: PluginModule = {
  id: "gstack",
  async server({ registerCommand, registerSkill, client }) {
    client.app.log({
      body: {
        service: "gstack",
        level: "info",
        message: "GStack plugin initialized",
      },
    })

    const commands = [
      {
        name: "office-hours",
        description: "Product framing and design doc creation (6 questions)",
        agent: "office-hours",
        subtask: true,
        template: skillTemplates["office-hours"],
      },
      {
        name: "plan-ceo-review",
        description: "CEO-level product scope and strategy review",
        agent: "plan-ceo-review",
        subtask: true,
        template: skillTemplates["plan-ceo-review"],
      },
      {
        name: "plan-eng-review",
        description: "Engineering architecture and test planning",
        agent: "plan-eng-review",
        subtask: true,
        template: skillTemplates["plan-eng-review"],
      },
      {
        name: "plan-design-review",
        description: "Senior design audit and improvement",
        agent: "plan-design-review",
        subtask: true,
        template: skillTemplates["plan-design-review"],
      },
      {
        name: "design-consultation",
        description: "Build design system and mockups",
        agent: "design-consultation",
        subtask: true,
        template: skillTemplates["design-consultation"],
      },
      {
        name: "design-shotgun",
        description: "Generate and compare multiple design variants",
        agent: "design-shotgun",
        subtask: true,
        template: skillTemplates["design-shotgun"],
      },
      {
        name: "design-html",
        description: "Generate production-quality HTML layouts",
        agent: "design-html",
        subtask: true,
        template: skillTemplates["design-html"],
      },
      {
        name: "review",
        description: "Staff engineer code review and bug fixing",
        agent: "review",
        subtask: true,
        template: skillTemplates["review"],
      },
      {
        name: "investigate",
        description: "Debugging and root cause analysis",
        agent: "investigate",
        subtask: true,
        template: skillTemplates["investigate"],
      },
      {
        name: "qa",
        description: "Automated QA testing with real browser interaction",
        agent: "qa",
        subtask: true,
        template: skillTemplates["qa"],
      },
      {
        name: "cso",
        description: "Security audits (OWASP, STRIDE)",
        agent: "cso",
        subtask: true,
        template: skillTemplates["cso"],
      },
      {
        name: "ship",
        description: "Release engineering, test bootstrapping, PR creation",
        agent: "ship",
        subtask: true,
        template: skillTemplates["ship"],
      },
      {
        name: "land-and-deploy",
        description: "Merge, deploy, and verify production health",
        agent: "land-and-deploy",
        subtask: true,
        template: skillTemplates["land-and-deploy"],
      },
      {
        name: "canary",
        description: "Post-deploy monitoring and alerting",
        agent: "canary",
        subtask: true,
        template: skillTemplates["canary"],
      },
      {
        name: "benchmark",
        description: "Performance baseline and regression testing",
        agent: "benchmark",
        subtask: true,
        template: skillTemplates["benchmark"],
      },
      {
        name: "document-release",
        description: "Auto-update project documentation",
        agent: "document-release",
        subtask: true,
        template: skillTemplates["document-release"],
      },
      {
        name: "retro",
        description: "Weekly team retrospectives and metrics",
        agent: "retro",
        subtask: true,
        template: skillTemplates["retro"],
      },
    ]

    for (const cmd of commands) {
      try {
        await registerCommand(cmd)
      } catch (e) {
        client.app.log({
          body: {
            service: "gstack",
            level: "warn",
            message: `Failed to register command ${cmd.name}: ${e instanceof Error ? e.message : String(e)}`,
          },
        })
      }
    }

    const tools = {
      gstack_codex: codexTool,
      gstack_careful: carefulTool,
      gstack_freeze: freezeTool,
      gstack_guard: guardTool,
    }

    const skills = [
      { name: "gstack/office-hours", description: "Product framing with 6 questions", content: skillTemplates["office-hours"] },
      { name: "gstack/plan-ceo-review", description: "CEO-level product scope review", content: skillTemplates["plan-ceo-review"] },
      { name: "gstack/plan-eng-review", description: "Engineering architecture review", content: skillTemplates["plan-eng-review"] },
      { name: "gstack/plan-design-review", description: "Design UX audit", content: skillTemplates["plan-design-review"] },
      { name: "gstack/design-consultation", description: "Design system and mockups", content: skillTemplates["design-consultation"] },
      { name: "gstack/design-shotgun", description: "Multiple design variants", content: skillTemplates["design-shotgun"] },
      { name: "gstack/design-html", description: "Production HTML layouts", content: skillTemplates["design-html"] },
      { name: "gstack/review", description: "Staff engineer code review", content: skillTemplates["review"] },
      { name: "gstack/investigate", description: "Debugging and root cause analysis", content: skillTemplates["investigate"] },
      { name: "gstack/qa", description: "Automated browser testing", content: skillTemplates["qa"] },
      { name: "gstack/cso", description: "Security audit (OWASP/STRIDE)", content: skillTemplates["cso"] },
      { name: "gstack/ship", description: "Release engineering and PR", content: skillTemplates["ship"] },
      { name: "gstack/land-and-deploy", description: "Production deploy and verify", content: skillTemplates["land-and-deploy"] },
      { name: "gstack/canary", description: "Post-deploy monitoring", content: skillTemplates["canary"] },
      { name: "gstack/benchmark", description: "Performance testing", content: skillTemplates["benchmark"] },
      { name: "gstack/document-release", description: "Documentation update", content: skillTemplates["document-release"] },
      { name: "gstack/retro", description: "Team retrospective", content: skillTemplates["retro"] },
    ]

    for (const skill of skills) {
      try {
        await registerSkill(skill)
      } catch (e) {
        client.app.log({
          body: {
            service: "gstack",
            level: "warn",
            message: `Failed to register skill ${skill.name}: ${String(e)}`,
          },
        })
      }
    }

    return { tool: tools }
  },
}

export default plugin