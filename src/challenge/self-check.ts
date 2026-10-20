/**
 * The layout family's distribution self-check (PADR-0047 decision 9.8): over development seeds, the
 * achieved topologies, lanes and stated clauses (per lane) and their combinations, and every rejection
 * reason with its count, drawn exactly as `generateInstance` draws them. A planned item that appears in
 * fewer than 10 % of the instances (a combination: of the instances with its topology part) fails the
 * self-check, so selection by redrawing cannot silently replace the announced variety. `mode: "draft"`
 * stops at the family's draft (fast; it counts the draft's own rejections only), `"build"` builds and
 * checks every instance as a set would. A test may pass its own draft function.
 */
import { AuthoringError } from '../authoring/project.ts';
import { buildDraft, difficultyAt, draftFor, MAX_ATTEMPTS, redraws, worldIdOf } from './build.ts';
import { ChallengeError } from './errors.ts';
import type { Difficulty, Draft } from './families.ts';

export const SELF_CHECK_FLOOR = 0.1;
/** What the generator plans at every difficulty: the plain chain and each cross-lane extra, every stated
 * clause per lane, and these combinations (a clause kind among the instances with a part). */
export const PLANNED_PARTS = ['plain chain', 'branch', 'fork', 'loop'] as const;
export const PLANNED_CLAUSES = ['O', 'W', 'X', 'C', 'A1', 'E1', 'A2', 'E2'] as const;
export const PLANNED_COMBINATIONS: ReadonlyArray<[string, string]> = [['branch', 'C'], ['fork', 'C'], ['loop', 'C'], ['branch', 'X'], ['fork', 'X'], ['loop', 'X'], ['one lane', 'C']];
/** Lanes per difficulty: one lane only at difficulty 1 (decision 9.2). */
export const plannedLanes = (difficulty: Difficulty | 'mixed'): string[] => difficulty === 1 || difficulty === 'mixed' ? ['1', '2'] : ['2'];

export interface SelfCheck {
  instances: number; mode: 'draft' | 'build'; difficulty: Difficulty | 'mixed';
  /** Instances per achieved topology (`chain+branch+loop`), per part, per number of lanes. */
  topologies: Record<string, number>; parts: Record<string, number>; lanes: Record<string, number>;
  /** Instances stating each clause, per lane (O noOverlap, W within, X arrowsNoCrossing, C arrowsClearOfSteps, A1/A2 aligned and E1/E2 evenlySpaced in lane 1/2). */
  clauses: Record<string, number>;
  /** `part × clause`: how many of the instances with the part state the clause. */
  combinations: Record<string, { with: number; of: number }>;
  /** Drafts drawn again, by reason. */
  rejections: Record<string, number>;
  /** Seeds without an instance after every attempt. */
  failed: number[];
  /** Planned items under the floor, as `part branch: 7/100`. */
  belowFloor: string[];
}

/** The parts of an instance: the plain chain when it has no extra, each extra, and "one lane". */
export function partsOf(parameters: Draft['parameters']): string[] {
  const topology = String(parameters.topology).split('+').filter(part => part !== 'chain');
  return [...(topology.length ? topology : ['plain chain']), ...(parameters.lanes === 1 ? ['one lane'] : [])];
}
const tokensOf = (parameters: Draft['parameters']): string[] => String(parameters.clauses).split(' ').map(token => token.startsWith('O') ? 'O' : token);

export function layoutSelfCheck(seeds: readonly number[], difficulty: Difficulty | 'mixed', mode: 'draft' | 'build' = 'build', floor = SELF_CHECK_FLOOR,
  draft: (seed: number, level: Difficulty, tryIndex: number) => Draft = (seed, level, tryIndex) => draftFor('layout', seed, level, tryIndex)): SelfCheck {
  const topologies: Record<string, number> = {}, parts: Record<string, number> = {}, lanes: Record<string, number> = {}, clauses: Record<string, number> = {}, rejections: Record<string, number> = {};
  const combinations: Record<string, { with: number; of: number }> = Object.fromEntries(PLANNED_COMBINATIONS.map(([part, clause]) => [`${part} × ${clause}`, { with: 0, of: 0 }]));
  const bump = (table: Record<string, number>, key: string): void => { table[key] = (table[key] ?? 0) + 1; };
  const failed: number[] = [];
  let instances = 0;
  seeds.forEach((seed, index) => {
    const level = difficultyAt(difficulty, index);
    for (let tryIndex = 0; tryIndex < MAX_ATTEMPTS; tryIndex++) {
      try {
        const made = draft(seed, level, tryIndex);
        if (mode === 'build') buildDraft(made, worldIdOf('layout', 'self-check'));
        const own = new Set(partsOf(made.parameters)), stated = new Set(tokensOf(made.parameters));
        bump(topologies, String(made.parameters.topology)); bump(lanes, String(made.parameters.lanes));
        for (const part of own) bump(parts, part);
        for (const token of stated) bump(clauses, token);
        for (const [part, clause] of PLANNED_COMBINATIONS) if (own.has(part)) { const entry = combinations[`${part} × ${clause}`]!; entry.of++; if (stated.has(clause)) entry.with++; }
        instances++;
        return;
      } catch (error) {
        if (!redraws(error)) throw error;
        bump(rejections, error instanceof ChallengeError || error instanceof AuthoringError ? error.code : 'unknown');
      }
    }
    failed.push(seed);
  });
  const under = (count: number, of: number): boolean => count < floor * of || of === 0;
  const belowFloor = [
    ...PLANNED_PARTS.filter(part => under(parts[part] ?? 0, seeds.length)).map(part => `part ${part}: ${parts[part] ?? 0}/${seeds.length}`),
    ...plannedLanes(difficulty).filter(count => under(lanes[count] ?? 0, seeds.length)).map(count => `lanes ${count}: ${lanes[count] ?? 0}/${seeds.length}`),
    ...PLANNED_CLAUSES.filter(clause => under(clauses[clause] ?? 0, seeds.length)).map(clause => `clause ${clause}: ${clauses[clause] ?? 0}/${seeds.length}`),
    ...PLANNED_COMBINATIONS.filter(([part]) => part !== 'one lane' || plannedLanes(difficulty).includes('1')).map(([part, clause]) => [`${part} × ${clause}`, combinations[`${part} × ${clause}`]!] as const)
      .filter(([, entry]) => under(entry.with, entry.of)).map(([key, entry]) => `${key}: ${entry.with}/${entry.of}`),
  ];
  return { instances, mode, difficulty, topologies, parts, lanes, clauses, combinations, rejections, failed, belowFloor };
}
