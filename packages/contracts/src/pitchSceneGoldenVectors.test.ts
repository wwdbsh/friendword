import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildPitchSceneV2 } from './pitchSceneBuilder';
import {
  PITCH_SCENE_F1_BUILDER_INPUT,
  PITCH_SCENE_GOLDEN_VECTORS,
  PITCH_SCENE_GOLDEN_VECTORS_SQL_FILE,
  pitchSceneGoldenVectorsSql,
  type PitchSceneGoldenVector,
} from './pitchSceneGoldenVectors';
import { MIN_FLASH_INTERVAL_MS, pitchSceneV2Schema } from './pitchSceneV2';

/**
 * The budget the golden vectors replaced, reimplemented here and NOWHERE ELSE:
 * punch onsets plus lightLeak ONSETS, with a leak counted once however long it
 * pulses and a wordPop or countBadge appearance not counted at all.
 *
 * This is what makes a reject vector a regression witness. Without it, a vector is
 * only "some scene the parser refuses", and the P8 and F3 findings were both about
 * scenes the parser used to WELCOME.
 */
function onsetOnlyViolation(scene: Readonly<Record<string, unknown>>): boolean {
  const onsets: number[] = [];
  for (const shot of scene.shots as readonly Record<string, unknown>[]) {
    for (const effect of (shot.effects ?? []) as readonly Record<string, unknown>[]) {
      if (effect.type === 'punch') {
        onsets.push(effect.atMs as number);
      }
    }
  }
  for (const overlay of scene.overlays as readonly Record<string, unknown>[]) {
    if (overlay.type === 'lightLeak') {
      onsets.push(overlay.startMs as number);
    }
  }
  onsets.sort((left, right) => left - right);
  return onsets.some(
    (onset, index) => index > 0 && onset - (onsets[index - 1] as number) < MIN_FLASH_INTERVAL_MS,
  );
}

const byName = new Map(PITCH_SCENE_GOLDEN_VECTORS.map((vector) => [vector.name, vector]));

function vector(name: string): PitchSceneGoldenVector {
  const found = byName.get(name);
  if (found === undefined) {
    throw new Error(`no golden vector named ${name}`);
  }
  return found;
}

describe('golden vectors — the list itself', () => {
  it('carries at least three of each verdict, under unique names', () => {
    expect(byName.size).toBe(PITCH_SCENE_GOLDEN_VECTORS.length);
    const accepted = PITCH_SCENE_GOLDEN_VECTORS.filter((entry) => entry.verdict.accept);
    expect(accepted.length).toBeGreaterThanOrEqual(3);
    expect(PITCH_SCENE_GOLDEN_VECTORS.length - accepted.length).toBeGreaterThanOrEqual(3);
    for (const entry of PITCH_SCENE_GOLDEN_VECTORS) {
      expect(entry.why.length, entry.name).toBeGreaterThan(40);
    }
  });
});

describe('golden vectors — the zod parser answers what the vector says', () => {
  for (const entry of PITCH_SCENE_GOLDEN_VECTORS) {
    it(`${entry.verdict.accept ? 'accepts' : 'rejects'} ${entry.name}`, () => {
      const parsed = pitchSceneV2Schema.safeParse(entry.scene);
      if (entry.verdict.accept) {
        expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
        return;
      }
      expect(parsed.success).toBe(false);
      const messages = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
      // EVERY issue is the rule under test: a vector that also broke a shot length
      // or a crop would pass this suite while proving nothing about the budget.
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message, entry.name).toContain(entry.verdict.zodMessage);
      }
    });
  }
});

describe('golden vectors — each one is the witness it claims to be', () => {
  for (const entry of PITCH_SCENE_GOLDEN_VECTORS) {
    it(`${entry.name}: the onset-only budget ${
      entry.acceptedByOnsetOnlyBudget ? 'accepted' : 'rejected'
    } it`, () => {
      expect(onsetOnlyViolation(entry.scene)).toBe(!entry.acceptedByOnsetOnlyBudget);
    });
  }

  it('the P8 attack scene really does deliver five events inside one second', () => {
    const scene = pitchSceneV2Schema.safeParse(vector('p8-leak-pulses-between-punches').scene);
    // It does not parse, which is the point, so the count is taken from the vector.
    expect(scene.success).toBe(false);
    const events = [700, 1_200, 1_533, 1_600, 1_866, 2_100, 2_200];
    const inOneSecond = events.filter((at) => at >= 1_200 && at < 2_200);
    expect(inOneSecond).toEqual([1_200, 1_533, 1_600, 1_866, 2_100]);
  });
});

describe('golden vectors — the builder output vector is the builder’s', () => {
  it('f1-builder-output is exactly what the recording builds today', () => {
    const built = buildPitchSceneV2(PITCH_SCENE_F1_BUILDER_INPUT);
    expect(built).not.toBeNull();
    expect(built).toEqual(vector('f1-builder-output').scene);
    // Byte-identical, so a regenerated SQL block cannot differ from this one either.
    expect(JSON.stringify(built)).toBe(JSON.stringify(vector('f1-builder-output').scene));
  });
});

describe('golden vectors — the SQL block carries the same rows', () => {
  const sql = pitchSceneGoldenVectorsSql();

  it('names its source and refuses to be hand-edited', () => {
    expect(sql).toContain('packages/contracts/src/pitchSceneGoldenVectors.ts');
    expect(sql).toContain('GENERATED — DO NOT EDIT');
  });

  it('is byte-identical to the file the database side reads', () => {
    // The whole point of generating it. If this fails, a vector changed and the .sql
    // was not regenerated — pgTAP is now testing a different scene than vitest is.
    const onDisk = readFileSync(
      new URL(PITCH_SCENE_GOLDEN_VECTORS_SQL_FILE, import.meta.url),
      'utf8',
    );
    expect(onDisk.trimEnd()).toBe(sql.trimEnd());
  });

  it('holds every vector, with the scene JSON and verdict unchanged', () => {
    for (const entry of PITCH_SCENE_GOLDEN_VECTORS) {
      const row = sql.split('\n').find((line) => line.includes(`('${entry.name}'`));
      expect(row, entry.name).toBeDefined();
      expect(sql).toContain(`$vector$${JSON.stringify(entry.scene)}$vector$`);
      if (entry.verdict.accept) {
        continue;
      }
      expect(sql).toContain(entry.verdict.dbReason.replaceAll("'", "''"));
    }
    // Dollar quoting is only safe while no scene contains the tag.
    for (const entry of PITCH_SCENE_GOLDEN_VECTORS) {
      expect(JSON.stringify(entry.scene)).not.toContain('$vector$');
    }
  });
});
