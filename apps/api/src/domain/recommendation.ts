// "빠른 대여" (Quick Rental) recommendation scoring.
//
// This is intentionally a small, explainable rule-based scorer (per
// ideation.md §13.5: "초기에는 설명 가능한 규칙 기반으로 시작") rather than a
// black-box ranking model. Each carrier gets a numeric score plus a list of
// human-readable reasons ("도보 10분 이내", "평점 4.8" 등) so the UI can show
// *why* a candidate was recommended, and so a renter can trust a suggestion
// without further back-and-forth negotiation.
//
// Quick Rental never replaces the direct map-exploration flow; it only
// narrows the candidate list down to a small, explainable shortlist. Picking
// a recommendation still routes into the existing 1:1 contact-request flow.

export type QuickRentalSize = 'carry_on' | 'medium';

export type RecommendationCandidate = {
  id: string;
  district: string;
  size: QuickRentalSize;
  rating: number;
  reviews: number;
  available: boolean;
  optIn: boolean;
};

export type RecommendationContext = {
  district?: string;
  size?: QuickRentalSize;
};

export type RecommendationScore = {
  score: number;
  reasons: string[];
};

function firstDistrictToken(district: string): string | undefined {
  return district.trim().split(/\s+/).filter(Boolean)[0];
}

/**
 * Scores a single carrier for a Quick Rental request. Higher is better.
 * Pure function - no I/O, easy to unit test in isolation.
 */
export function scoreCarrierForQuickRental(
  candidate: RecommendationCandidate,
  context: RecommendationContext
): RecommendationScore {
  let score = 0;
  const reasons: string[] = [];

  if (context.district && candidate.district) {
    const ctxDistrict = context.district.trim();
    const candDistrict = candidate.district.trim();
    if (candDistrict === ctxDistrict) {
      score += 50;
      reasons.push('같은 동네 매물이에요');
    } else if (firstDistrictToken(ctxDistrict) && firstDistrictToken(ctxDistrict) === firstDistrictToken(candDistrict)) {
      score += 30;
      reasons.push('인접한 지역(같은 구)이에요');
    }
  }

  if (context.size && context.size === candidate.size) {
    score += 20;
    reasons.push('요청하신 사이즈와 일치해요');
  }

  if (candidate.rating >= 4.7) {
    score += 15;
    reasons.push(`평점 ${candidate.rating.toFixed(1)}의 신뢰할 수 있는 이웃이에요`);
  } else if (candidate.rating >= 4.0) {
    score += 8;
  }

  if (candidate.reviews >= 5) {
    score += 5;
    reasons.push('거래 후기가 많아 안심할 수 있어요');
  }

  if (reasons.length === 0) {
    reasons.push('지금 바로 대여 가능한 이웃이에요');
  }

  return { score, reasons };
}

/**
 * Ranks a list of carriers for a Quick Rental request and returns the top
 * `limit` (default 3, per ideation.md §13.2 "가장 적합한 캐리어 3개 내외").
 * Only currently available, opted-in carriers are considered.
 */
export function rankQuickRentalCandidates<T extends RecommendationCandidate>(
  candidates: T[],
  context: RecommendationContext,
  limit = 3
): Array<{ candidate: T; score: number; reasons: string[] }> {
  return candidates
    .filter((c) => c.available && c.optIn)
    .map((c) => ({ candidate: c, ...scoreCarrierForQuickRental(c, context) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
