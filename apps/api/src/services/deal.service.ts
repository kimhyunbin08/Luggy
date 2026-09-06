// '동네 직거래(P2P Direct Deal)' 요청/채팅 서비스.
//
// 결제/배송/검수를 거치지 않는 새 메인 플로우: Renter가 지도에서 캐리어를 보고
// 요청을 보내면 그 즉시 채팅방이 열리고, 두 사용자가 직접 만나서 전달/반납을
// 조율한다(§ideation.md 가설4와 배치되는 의도적 정책 전환 — prd.md §19 참조).
// Booking/Payment/Inspection 테이블과는 완전히 분리된 별도 상태머신이다.
import { getConnection, query } from '../db/pool.js';
import { DealRequest, DealRequestStatus, ChatMessage } from '../models/types.js';

export class DealError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'DealError';
    this.statusCode = statusCode;
  }
}

function mapRowToDealRequest(row: any): DealRequest {
  return {
    id: row.id,
    carrierId: row.carrier_id,
    requesterId: row.requester_id,
    ownerId: row.owner_id,
    status: row.status,
    startDate: row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : undefined,
    endDate: row.end_date ? new Date(row.end_date).toISOString().slice(0, 10) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    dealRequestId: row.deal_request_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: new Date(row.created_at),
  };
}

export interface CreateDealRequestInput {
  carrierId: string;
  requesterId: string;
  message: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Creates a deal request and opens its chat thread with the requester's
 * first message, atomically (mirrors the atomic-create pattern used by
 * carrier.service.ts's createCarrier for the same "don't leave a half-done
 * row behind" reason).
 */
export async function createDealRequest(input: CreateDealRequestInput): Promise<DealRequest> {
  const client = await getConnection();
  try {
    await client.query('BEGIN');
    const carrierResult = await client.query(
      'SELECT provider_id FROM carriers WHERE id = $1 FOR UPDATE',
      [input.carrierId]
    );
    if (carrierResult.rows.length === 0) {
      throw new DealError('Carrier not found', 404);
    }
    const ownerId = carrierResult.rows[0].provider_id;
    if (ownerId === input.requesterId) {
      throw new DealError('Cannot send a request for your own carrier', 400);
    }

    const dealResult = await client.query(
      `INSERT INTO deal_requests (carrier_id, requester_id, owner_id, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.carrierId, input.requesterId, ownerId, input.startDate || null, input.endDate || null]
    );
    const deal = dealResult.rows[0];

    await client.query(`INSERT INTO chat_messages (deal_request_id, sender_id, body) VALUES ($1, $2, $3)`, [
      deal.id,
      input.requesterId,
      input.message,
    ]);

    await client.query('COMMIT');
    return mapRowToDealRequest(deal);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getDealRequestById(id: string): Promise<DealRequest | null> {
  const result = await query('SELECT * FROM deal_requests WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return mapRowToDealRequest(result.rows[0]);
}

function assertParticipant(deal: DealRequest, userId: string): void {
  if (deal.requesterId !== userId && deal.ownerId !== userId) {
    throw new DealError('Not a participant in this deal request', 403);
  }
}

/** Requests where userId is either the requester (렌탈자) or the owner (맡긴 사람). */
export async function listDealRequestsForUser(userId: string): Promise<DealRequest[]> {
  const result = await query(
    `SELECT * FROM deal_requests WHERE requester_id = $1 OR owner_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map(mapRowToDealRequest);
}

const VALID_TRANSITIONS: Record<DealRequestStatus, DealRequestStatus[]> = {
  requested: ['accepted', 'declined', 'cancelled'],
  accepted: ['completed', 'cancelled'],
  declined: [],
  cancelled: [],
  completed: [],
};

export interface UpdateDealStatusInput {
  dealRequestId: string;
  actingUserId: string;
  nextStatus: DealRequestStatus;
}

/**
 * Owner-only: accept/decline. Either participant: cancel. Owner-only: complete
 * (marks the direct hand-off as done). No payment/settlement side-effects —
 * this flow deliberately has none in this phase (see prd.md §19.4 Deferred).
 */
export async function updateDealStatus(input: UpdateDealStatusInput): Promise<DealRequest> {
  const deal = await getDealRequestById(input.dealRequestId);
  if (!deal) throw new DealError('Deal request not found', 404);
  assertParticipant(deal, input.actingUserId);

  const isOwnerAction = input.nextStatus === 'accepted' || input.nextStatus === 'declined' || input.nextStatus === 'completed';
  if (isOwnerAction && deal.ownerId !== input.actingUserId) {
    throw new DealError('Only the carrier owner can perform this action', 403);
  }

  if (!VALID_TRANSITIONS[deal.status].includes(input.nextStatus)) {
    throw new DealError(`Cannot transition deal request from ${deal.status} to ${input.nextStatus}`, 409);
  }

  const result = await query(
    `UPDATE deal_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [input.nextStatus, input.dealRequestId]
  );
  return mapRowToDealRequest(result.rows[0]);
}

export async function addChatMessage(
  dealRequestId: string,
  senderId: string,
  body: string
): Promise<ChatMessage> {
  const deal = await getDealRequestById(dealRequestId);
  if (!deal) throw new DealError('Deal request not found', 404);
  assertParticipant(deal, senderId);
  if (deal.status === 'declined' || deal.status === 'cancelled') {
    throw new DealError(`Cannot message a ${deal.status} deal request`, 409);
  }

  const result = await query(
    `INSERT INTO chat_messages (deal_request_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [dealRequestId, senderId, body]
  );
  await query(`UPDATE deal_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [dealRequestId]);
  return mapRowToChatMessage(result.rows[0]);
}

export async function listChatMessages(dealRequestId: string, requestingUserId: string): Promise<ChatMessage[]> {
  const deal = await getDealRequestById(dealRequestId);
  if (!deal) throw new DealError('Deal request not found', 404);
  assertParticipant(deal, requestingUserId);

  const result = await query(
    `SELECT * FROM chat_messages WHERE deal_request_id = $1 ORDER BY created_at ASC`,
    [dealRequestId]
  );
  return result.rows.map(mapRowToChatMessage);
}
