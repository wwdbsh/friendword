import { describe, expect, it } from 'vitest';

import {
  canTransitionPitchDraft,
  isPubliclyVisible,
  PITCH_DRAFT_STATUSES,
} from './pitchDraftState';
import { canTransitionInterest } from './interestState';

describe('pitch draft state machine', () => {
  it('follows the approval path from the handoff', () => {
    expect(canTransitionPitchDraft('draft', 'consent_pending')).toBe(true);
    expect(canTransitionPitchDraft('consent_pending', 'approved')).toBe(true);
    expect(canTransitionPitchDraft('approved', 'published')).toBe(true);
  });

  it('never becomes visible before dater approval', () => {
    for (const status of PITCH_DRAFT_STATUSES) {
      if (status !== 'published') {
        expect(isPubliclyVisible(status)).toBe(false);
      }
    }
  });

  it('cannot skip approval to publish', () => {
    expect(canTransitionPitchDraft('draft', 'published')).toBe(false);
    expect(canTransitionPitchDraft('consent_pending', 'published')).toBe(false);
  });

  it('deleted is terminal', () => {
    for (const status of PITCH_DRAFT_STATUSES) {
      expect(canTransitionPitchDraft('deleted', status)).toBe(false);
    }
  });
});

describe('interest state machine', () => {
  it('requires verification before submission', () => {
    expect(canTransitionInterest('started', 'submitted')).toBe(false);
    expect(canTransitionInterest('started', 'verification_pending')).toBe(true);
    expect(canTransitionInterest('verification_pending', 'submitted')).toBe(true);
  });

  it('only submitted interests can be accepted', () => {
    expect(canTransitionInterest('submitted', 'accepted')).toBe(true);
    expect(canTransitionInterest('verification_pending', 'accepted')).toBe(false);
  });
});
