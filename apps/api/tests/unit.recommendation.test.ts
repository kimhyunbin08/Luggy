import { describe, expect, it } from 'vitest';
import { rankQuickRentalCandidates, scoreCarrierForQuickRental } from '../src/domain/recommendation.js';

const baseCandidate = {
  id: 'c1',
  district: '강남구 역삼동',
  size: 'carry_on' as const,
  rating: 4.2,
  reviews: 2,
  available: true,
  optIn: true
};

describe('recommendation: scoreCarrierForQuickRental', () => {
  it('gives the highest bonus for an exact district match', () => {
    const exact = scoreCarrierForQuickRental(baseCandidate, { district: '강남구 역삼동' });
    const sameGu = scoreCarrierForQuickRental(baseCandidate, { district: '강남구 삼성동' });
    const noContext = scoreCarrierForQuickRental(baseCandidate, {});
    expect(exact.score).toBeGreaterThan(sameGu.score);
    expect(sameGu.score).toBeGreaterThan(noContext.score);
    expect(exact.reasons.some((r) => r.includes('같은 동네'))).toBe(true);
  });

  it('rewards a matching size and a strong rating', () => {
    const sizeMatch = scoreCarrierForQuickRental(baseCandidate, { size: 'carry_on' });
    const sizeMismatch = scoreCarrierForQuickRental(baseCandidate, { size: 'medium' });
    expect(sizeMatch.score).toBeGreaterThan(sizeMismatch.score);

    const highRating = scoreCarrierForQuickRental({ ...baseCandidate, rating: 4.9 }, {});
    const lowRating = scoreCarrierForQuickRental({ ...baseCandidate, rating: 3.5 }, {});
    expect(highRating.score).toBeGreaterThan(lowRating.score);
    expect(highRating.reasons.some((r) => r.includes('평점'))).toBe(true);
  });

  it('always returns at least one reason, even with no matching context', () => {
    const result = scoreCarrierForQuickRental({ ...baseCandidate, rating: 3.0, reviews: 0 }, {});
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe('recommendation: rankQuickRentalCandidates', () => {
  const candidates = [
    { ...baseCandidate, id: 'c1', district: '강남구 역삼동', rating: 4.9, reviews: 10 },
    { ...baseCandidate, id: 'c2', district: '마포구 합정동', rating: 4.0, reviews: 1 },
    { ...baseCandidate, id: 'c3', district: '강남구 삼성동', rating: 4.5, reviews: 3 },
    { ...baseCandidate, id: 'c4', district: '강남구 역삼동', rating: 3.0, reviews: 0, available: false }
  ];

  it('excludes unavailable or opted-out carriers', () => {
    const ranked = rankQuickRentalCandidates(candidates, { district: '강남구 역삼동' });
    expect(ranked.some((r) => r.candidate.id === 'c4')).toBe(false);
  });

  it('returns at most `limit` results, ranked by score descending', () => {
    const ranked = rankQuickRentalCandidates(candidates, { district: '강남구 역삼동' }, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[0].candidate.id).toBe('c1');
  });
});
