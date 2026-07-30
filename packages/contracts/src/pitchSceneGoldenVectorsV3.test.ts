import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PITCH_SCENE_GOLDEN_VECTORS_V3_SQL_FILE,
  PITCH_SCENE_V3_GOLDEN_VECTORS,
  pitchSceneV3GoldenVectorsSql,
} from './pitchSceneGoldenVectors';
import { pitchSceneV2Schema } from './pitchSceneV2';
import { pitchSceneV3Schema } from './pitchSceneV3';

const byName = new Map(PITCH_SCENE_V3_GOLDEN_VECTORS.map((vector) => [vector.name, vector]));

describe('v3 golden vectors — the list itself', () => {
  it('carries three accepts and four rejects at least, under unique names', () => {
    expect(byName.size).toBe(PITCH_SCENE_V3_GOLDEN_VECTORS.length);
    const accepted = PITCH_SCENE_V3_GOLDEN_VECTORS.filter((entry) => entry.verdict.accept);
    expect(accepted.length).toBeGreaterThanOrEqual(3);
    expect(PITCH_SCENE_V3_GOLDEN_VECTORS.length - accepted.length).toBeGreaterThanOrEqual(4);
    for (const entry of PITCH_SCENE_V3_GOLDEN_VECTORS) {
      expect(entry.why.length, entry.name).toBeGreaterThan(40);
      expect(entry.scene.schemaVersion, entry.name).toBe(3);
    }
  });

  it('holds only scenes that are about the clip shot', () => {
    for (const entry of PITCH_SCENE_V3_GOLDEN_VECTORS) {
      const shots = entry.scene.shots as readonly Record<string, unknown>[];
      expect(
        shots.some((shot) => shot.level === 'clip'),
        entry.name,
      ).toBe(true);
      // A v3 vector the v2 parser would also accept would be testing nothing new.
      expect(pitchSceneV2Schema.safeParse(entry.scene).success, entry.name).toBe(false);
    }
  });
});

describe('v3 golden vectors — the zod parser answers what the vector says', () => {
  for (const entry of PITCH_SCENE_V3_GOLDEN_VECTORS) {
    it(`${entry.verdict.accept ? 'accepts' : 'rejects'} ${entry.name}`, () => {
      const parsed = pitchSceneV3Schema.safeParse(entry.scene);
      if (entry.verdict.accept) {
        expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
        return;
      }
      expect(parsed.success).toBe(false);
      const messages = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
      // EVERY issue is the rule under test: a vector that also broke a shot length or
      // a crop would pass this suite while proving nothing about clips.
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message, entry.name).toContain(entry.verdict.zodMessage);
      }
      // ...and it fails ONE rule, not a family of them, so the message a mirror must
      // return does not depend on the order it checks in.
      expect(new Set(messages).size, entry.name).toBe(1);
    });
  }
});

describe('v3 golden vectors — the SQL block carries the same rows', () => {
  const sql = pitchSceneV3GoldenVectorsSql();

  it('names its source and refuses to be hand-edited', () => {
    expect(sql).toContain('packages/contracts/src/pitchSceneGoldenVectors.ts');
    expect(sql).toContain('GENERATED — DO NOT EDIT');
    // Its own table, so it can never collide with the v2 block in one pgTAP session.
    expect(sql).toContain('pitch_scene_golden_vector_v3');
  });

  it('is byte-identical to the file the database side will read', () => {
    const onDisk = readFileSync(
      new URL(PITCH_SCENE_GOLDEN_VECTORS_V3_SQL_FILE, import.meta.url),
      'utf8',
    );
    expect(onDisk.trimEnd()).toBe(sql.trimEnd());
  });

  it('holds every vector, with the scene JSON and verdict unchanged', () => {
    for (const entry of PITCH_SCENE_V3_GOLDEN_VECTORS) {
      const row = sql.split('\n').find((line) => line.includes(`('${entry.name}'`));
      expect(row, entry.name).toBeDefined();
      expect(sql).toContain(`$vector$${JSON.stringify(entry.scene)}$vector$`);
      if (entry.verdict.accept) {
        continue;
      }
      expect(sql).toContain(entry.verdict.dbReason.replaceAll("'", "''"));
    }
    // Dollar quoting is only safe while no scene contains the tag.
    for (const entry of PITCH_SCENE_V3_GOLDEN_VECTORS) {
      expect(JSON.stringify(entry.scene)).not.toContain('$vector$');
    }
  });
});
