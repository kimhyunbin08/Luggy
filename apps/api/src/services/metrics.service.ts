import { query } from '../db/pool.js';

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export interface KpiSnapshot {
  funnel: {
    landing: number;
    search: number;
    detail: number;
    checkout: number;
    paid: number;
    conversion: {
      landingToSearch: number;
      searchToDetail: number;
      detailToCheckout: number;
      checkoutToPaid: number;
      landingToPaid: number;
    };
  };
  bookingsByStatus: Record<string, number>;
  providerOptInRate: number;
  bookingCompletionRate: number;
  disputeRate: number;
  // Informational only — per AGENTS.md/TRD this is a computed KPI, NOT used
  // to automatically gate or block the real-transaction profitability
  // threshold decision (which remains a manual/deferred judgment call).
  avgContributionProfitPerBooking: number | null;
  generatedAt: string;
}

/**
 * Aggregates the MVP's required KPI set: OTA funnel step conversion, provider
 * opt-in rate, booking completion rate, damage/dispute rate, and
 * (informational) per-booking contribution profit.
 */
export async function getKpiSnapshot(): Promise<KpiSnapshot> {
  const funnelResult = await query(
    `SELECT event_type, COUNT(DISTINCT COALESCE(session_id, id::text)) as sessions
     FROM funnel_events
     WHERE event_type IN ('landing_view', 'search_submit', 'detail_view', 'checkout_step1', 'paid')
     GROUP BY event_type`
  );
  const counts: Record<string, number> = {};
  for (const row of funnelResult.rows) {
    counts[row.event_type] = Number(row.sessions);
  }

  const landing = counts['landing_view'] || 0;
  const search = counts['search_submit'] || 0;
  const detail = counts['detail_view'] || 0;
  const checkout = counts['checkout_step1'] || 0;
  const paid = counts['paid'] || 0;

  const bookingStatusResult = await query(
    `SELECT status, COUNT(*)::int as count FROM bookings GROUP BY status`
  );
  const bookingsByStatus: Record<string, number> = {};
  let totalBookings = 0;
  for (const row of bookingStatusResult.rows) {
    bookingsByStatus[row.status] = Number(row.count);
    totalBookings += Number(row.count);
  }
  const completedBookings = bookingsByStatus['completed'] || 0;

  const carrierResult = await query(
    `SELECT COUNT(*) FILTER (WHERE opt_in_rentable) as opted_in, COUNT(*) as total FROM carriers`
  );
  const optedIn = Number(carrierResult.rows[0]?.opted_in || 0);
  const totalCarriers = Number(carrierResult.rows[0]?.total || 0);

  const disputeResult = await query(
    `SELECT COUNT(DISTINCT booking_id)::int as disputed_bookings FROM damage_claims`
  );
  const disputedBookings = Number(disputeResult.rows[0]?.disputed_bookings || 0);

  const contributionResult = await query(
    `SELECT AVG(s.platform_fee - COALESCE(costs.total_cost, 0)) as avg_contribution
     FROM settlements s
     LEFT JOIN (
       SELECT booking_id, SUM(amount) as total_cost FROM cost_entries GROUP BY booking_id
     ) costs ON costs.booking_id = s.booking_id`
  );
  const avgContributionRaw = contributionResult.rows[0]?.avg_contribution;

  return {
    funnel: {
      landing,
      search,
      detail,
      checkout,
      paid,
      conversion: {
        landingToSearch: safeDiv(search, landing),
        searchToDetail: safeDiv(detail, search),
        detailToCheckout: safeDiv(checkout, detail),
        checkoutToPaid: safeDiv(paid, checkout),
        landingToPaid: safeDiv(paid, landing),
      },
    },
    bookingsByStatus,
    providerOptInRate: safeDiv(optedIn, totalCarriers),
    bookingCompletionRate: safeDiv(completedBookings, totalBookings),
    disputeRate: safeDiv(disputedBookings, totalBookings),
    avgContributionProfitPerBooking:
      avgContributionRaw !== null && avgContributionRaw !== undefined ? Number(avgContributionRaw) : null,
    generatedAt: new Date().toISOString(),
  };
}
