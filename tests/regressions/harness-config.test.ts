/**
 * Regression: the harness configuration silently drifting back to V1 syntax or
 * losing a normative harness invariant.
 *
 * This failed before.
 *
 * The repository's `.opencode/` configuration was written with OpenCode V1
 * conventions (`permission`, `bash`, `task`, agent `temperature`) and used the
 * legacy `command/` directory. OpenCode V2 normalises supported V1 fields, so
 * the drift is quiet: a legacy field or a missing harness invariant would not
 * break a session, it would only weaken the delegation model without anyone
 * noticing. The development contract now makes delegated execution normative
 * (section 17), so the configuration that implements it is part of the
 * contract.
 *
 * This must continue working.
 *
 * The suite lives here, not beside the files, because the development contract
 * requires regression coverage in tests/regressions/ and because it must be
 * visible to the regression gate in scripts/verify.sh.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(`${ROOT}${relativePath}`, 'utf8');
}

/** Extract the YAML frontmatter between the first pair of `---` fences. */
function frontmatter(relativePath: string): string {
  const match = read(relativePath).match(/^---\n([\s\S]*?)\n---/);
  if (!match || match[1] === undefined) {
    throw new Error(`missing frontmatter in ${relativePath}`);
  }
  return match[1];
}

interface Rule {
  action: string;
  resource: string;
  effect: string;
}

/** Parse the simple `- action: … / resource: "…" / effect: …` YAML list. */
function rules(frontmatterText: string): Rule[] {
  const parsed: Rule[] = [];
  const pattern =
    /-\s*action:\s*(\S+)\s*\n\s*resource:\s*([^\n]+?)\s*\n\s*effect:\s*(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(frontmatterText)) !== null) {
    // YAML permits the resource quoted or bare; normalise away the quotes.
    const resource = match[2]!.replace(/^"(.*)"$/, '$1');
    parsed.push({ action: match[1]!, resource, effect: match[3]! });
  }
  return parsed;
}

/** V2 whole-value wildcard matching (`*` = any chars, `?` = one char). */
function matches(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  // A shell pattern ending in " *" also matches the command without arguments.
  if (pattern.endsWith(' *')) {
    const base = pattern.slice(0, -2);
    if (value === base) return true;
  }
  return new RegExp(`^${escaped}$`).test(value);
}

/** Effective effect under V2 semantics: the last matching rule wins. */
function effective(ruleList: Rule[], action: string, resource: string): string {
  let effect = 'ask';
  for (const rule of ruleList) {
    if (matches(rule.action, action) && matches(rule.resource, resource)) {
      effect = rule.effect;
    }
  }
  return effect;
}

describe('regression: OpenCode harness configuration stays native V2', () => {
  it('opencode.json uses the ordered V2 permissions array and no legacy keys', () => {
    const config = JSON.parse(read('opencode.json')) as Record<string, unknown>;

    expect(Array.isArray(config.permissions)).toBe(true);
    expect(config).not.toHaveProperty('permission');
    expect(config).not.toHaveProperty('agent');
    expect(config).not.toHaveProperty('command');
    expect(config.default_agent).toBe('orchestrator');
    expect(config.worktree).toMatchObject({ directory: expect.any(String) });

    for (const rule of config.permissions as Array<Record<string, unknown>>) {
      expect(typeof rule.action).toBe('string');
      expect(typeof rule.resource).toBe('string');
      expect(['allow', 'ask', 'deny']).toContain(rule.effect);
      // V1 action names must not survive into a V2 rule.
      expect(['bash', 'task', 'write', 'patch']).not.toContain(rule.action);
    }
  });

  it('agent files use V2 permissions and the correct modes', () => {
    const agents: Array<{ file: string; mode: string }> = [
      { file: '.opencode/agents/orchestrator.md', mode: 'primary' },
      { file: '.opencode/agents/reviewer.md', mode: 'subagent' },
      { file: '.opencode/agents/subreviewer.md', mode: 'subagent' },
    ];

    for (const { file, mode } of agents) {
      const fm = frontmatter(file);
      expect(fm).toContain(`mode: ${mode}`);
      expect(fm).toMatch(/^permissions:/m);
      // Legacy V1 agent fields must not return.
      expect(fm).not.toMatch(/^permission:/m);
      expect(fm).not.toMatch(/^temperature:/m);
      expect(fm).not.toMatch(/^\s+bash:/m);
      expect(fm).not.toMatch(/^\s+task:/m);
      expect(fm).not.toMatch(/^\s+disable:/m);
    }
  });

  it('enforces the reviewer boundary under V2 last-match-wins', () => {
    const reviewer = rules(frontmatter('.opencode/agents/reviewer.md'));
    // Read-only: the last matching edit rule must be a deny.
    expect(effective(reviewer, 'edit', 'src/index.ts')).toBe('deny');
    // Cannot move known-good, even though a broad `git tag *` allow exists.
    expect(effective(reviewer, 'shell', 'git tag -f known-good HEAD')).toBe('deny');
    // May delegate to the subreviewer only, never to an editing worker.
    expect(effective(reviewer, 'subagent', 'subreviewer')).toBe('allow');
    expect(effective(reviewer, 'subagent', 'general')).toBe('deny');
    // Can still inspect.
    expect(effective(reviewer, 'shell', 'git diff known-good...HEAD')).toBe('allow');
  });

  it('keeps the subreviewer read-only and non-delegating', () => {
    const subreviewer = rules(frontmatter('.opencode/agents/subreviewer.md'));
    expect(effective(subreviewer, 'edit', 'src/index.ts')).toBe('deny');
    expect(effective(subreviewer, 'subagent', 'subreviewer')).toBe('deny');
    expect(effective(subreviewer, 'shell', 'git commit -m x')).toBe('deny');
    expect(effective(subreviewer, 'shell', 'git show HEAD')).toBe('allow');
  });

  it('lets the orchestrator edit and delegate while gating irreversible shell', () => {
    const orchestrator = rules(frontmatter('.opencode/agents/orchestrator.md'));
    expect(effective(orchestrator, 'edit', 'src/index.ts')).toBe('allow');
    expect(effective(orchestrator, 'subagent', 'general')).toBe('allow');
    expect(effective(orchestrator, 'shell', 'git push origin main')).toBe('ask');
    expect(effective(orchestrator, 'shell', './scripts/verify.sh')).toBe('allow');
  });

  it('discovers commands from the V2 commands directory only', () => {
    expect(existsSync(`${ROOT}.opencode/commands`)).toBe(true);
    expect(existsSync(`${ROOT}.opencode/command`)).toBe(false);
    for (const command of ['quickfix.md', 'iterate.md', 'evidence.md', 'gate.md']) {
      expect(existsSync(`${ROOT}.opencode/commands/${command}`)).toBe(true);
    }
  });
});

describe('regression: the harness invariants are documented and guarded', () => {
  it('the development contract makes delegated execution normative', () => {
    const contract = read('docs/DEVELOPMENT_CONTRACT.md');
    expect(contract).toContain('Harness v3');
    expect(contract).toContain('17.1 Implementation isolation');
    expect(contract).toContain('1 delegated implementation task = 1 branch = 1 worktree');
    expect(contract).toContain('ITERATION_PROFILE=QUICKFIX');
  });

  it('the operational docs describe tasks, worktrees and profiles', () => {
    const orchestration = read('docs/orchestration.md');
    expect(orchestration).toContain('sessionID');
    expect(orchestration).toContain('CHERRY-PICK');
    expect(orchestration).toContain('background: true');
    expect(orchestration).toContain('1 delegated implementation task');

    const profiles = read('docs/iteration-profiles.md');
    expect(profiles).toContain('TARGETED');
    expect(profiles).toContain('HUMAN APPROVES PROFILE');
    expect(profiles).toContain('HUMAN CHECKPOINT');
    expect(profiles).toContain('escalation');

    expect(read('docs/review-state.md')).toContain('targeted');
  });

  it('the worktree helper exists, is executable and parses', () => {
    const script = `${ROOT}scripts/harness/worktree.sh`;
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).toBeGreaterThan(0);
    // A syntax error here would break every delegated task.
    expect(() => execFileSync('bash', ['-n', script], { stdio: 'pipe' })).not.toThrow();
  });

  it('runtime orchestration state stays out of Git', () => {
    const ignore = read('.gitignore');
    expect(ignore).toContain('.orchestration/');
    expect(ignore).toContain('.worktrees/');
  });
});
