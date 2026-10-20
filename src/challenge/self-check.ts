/**
 * The layout family's distribution self-check (PADR-0047 decision 9.8): over development seeds, the
 * achieved topologies and stated clause kinds and every rejection reason with its count, drawn exactly
 * as `generateInstance` draws them. A planned topology part or clause kind that appears in fewer than
 * 10 % of the instances fails the self-check, so selection by redrawing cannot silently replace the
 * announced variety. `mode: "draft"` stops at the family's draft (fast; it counts the draft's own
 * rejections only), `"build"` builds and checks every instance as a set would.
 */
import { AuthoringError } from '../authoring/project.ts';
import { buildDraft, difficultyAt, draftFor, MAX_ATTEMPTS, redraws, worldIdOf } from './build.ts';
import { ChallengeError } from './errors.ts';
import type { Difficulty } from './families.ts';
import { LAYOUT_CLAUSE_KINDS, LAYOUT_TOPOLOGY_PARTS } from './layout.ts';

export const SELF_CHECK_FLOOR = 0.1;
export interface SelfCheck {
  instances: number; mode: 'draft' | 'build';
  /** Instances per achieved topology (`chain+branch+loop`) and per planned part. */
  topologies: Record<string, number>; parts: Record<string, number>;
  /** Instances stating each clause kind (O noOverlap, W within, X arrowsNoCrossing, C arrowsClearOfSteps, A aligned, E evenlySpaced). */
  clauses: Record<string, number>;
  /** Drafts drawn again, by reason. */
  rejections: Record<string, number>;
  /** Seeds without an instance after every attempt. */
  failed: number[];
  /** Planned parts and kinds under the floor, as `part branch: 7/100`. */
  belowFloor: string[];
}

const kindOf = (token: string): string => token.charAt(0);
export function layoutSelfCheck(seeds: readonly number[], difficulty: Difficulty | 'mixed', mode: 'draft' | 'build' = 'build', floor = SELF_CHECK_FLOOR): SelfCheck {
  const topologies: Record<string, number> = {}, parts: Record<string, number> = {}, clauses: Record<string, number> = {}, rejections: Record<string, number> = {};
  const bump = (table: Record<string, number>, key: string): void => { table[key] = (table[key] ?? 0) + 1; };
  const failed: number[] = [];
  let instances = 0;
  seeds.forEach((seed, index) => {
    const level = difficultyAt(difficulty, index);
    for (let tryIndex = 0; tryIndex < MAX_ATTEMPTS; tryIndex++) {
      try {
        const draft = draftFor('layout', seed, level, tryIndex);
        if (mode === 'build') buildDraft(draft, worldIdOf('layout', 'self-check'));
        const topology = String(draft.parameters.topology), stated = String(draft.parameters.clauses).split(' ');
        bump(topologies, topology);
        for (const part of new Set(topology.split('+'))) bump(parts, part);
        for (const kind of new Set(stated.map(kindOf))) bump(clauses, kind);
        instances++;
        return;
      } catch (error) {
        if (!redraws(error)) throw error;
        bump(rejections, error instanceof ChallengeError || error instanceof AuthoringError ? error.code : 'unknown');
      }
    }
    failed.push(seed);
  });
  const belowFloor = [
    ...LAYOUT_TOPOLOGY_PARTS.filter(part => (parts[part] ?? 0) < floor * seeds.length).map(part => `part ${part}: ${parts[part] ?? 0}/${seeds.length}`),
    ...LAYOUT_CLAUSE_KINDS.filter(kind => (clauses[kind] ?? 0) < floor * seeds.length).map(kind => `clause ${kind}: ${clauses[kind] ?? 0}/${seeds.length}`),
  ];
  return { instances, mode, topologies, parts, clauses, rejections, failed, belowFloor };
}
