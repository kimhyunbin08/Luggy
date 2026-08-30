// Thin wrapper around Azure OpenAI's REST API (chat completions, with image
// input for vision). Deliberately dependency-free (uses the platform's
// native fetch, Node 18+) to match this codebase's minimal-dependency style
// — no @azure/openai or openai SDK added.
//
// Powers the '동네 직거래' AI-assisted registration flow:
//   1. analyzeCarrierPhoto — guesses brand/model/size/condition from a photo.
//   2. runRegistrationChatTurn — a conversational assistant that gathers the
//      same fields through dialogue and returns a structured draft the user
//      edits before submitting.
// See POST /providers/carriers/ai-register/photo and /chat in server.ts.
//
// Azure OpenAI is not auto-provisioned by `azd provision` yet (see
// infra/resources.bicep's `azureOpenAi` resource, which the operator must
// opt into — it costs money). Until AZURE_OPENAI_* env vars are set, every
// function here throws AiNotConfiguredError, which routes turn into a clear
// 503 instead of a crash, so the rest of the app keeps working without it.

export interface CarrierDraft {
  brand?: string;
  model?: string;
  size?: 'carry_on' | 'medium';
  condition?: string;
  confidence?: number;
}

export class AiNotConfiguredError extends Error {
  statusCode = 503;
  constructor() {
    super('Azure OpenAI is not configured (AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT)');
    this.name = 'AiNotConfiguredError';
  }
}

interface AzureOpenAiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

function config(): AzureOpenAiConfig | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-06-01';
  if (!endpoint || !apiKey || !deployment) return null;
  return { endpoint: endpoint.replace(/\/+$/, ''), apiKey, deployment, apiVersion };
}

export function isAiConfigured(): boolean {
  return config() !== null;
}

type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

async function callChatCompletion(
  messages: { role: ChatRole; content: string | ChatContentPart[] }[]
): Promise<string> {
  const cfg = config();
  if (!cfg) throw new AiNotConfiguredError();

  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=${cfg.apiVersion}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
    body: JSON.stringify({
      messages,
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Azure OpenAI request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Azure OpenAI response did not include message content');
  }
  return content;
}

function parseDraft(jsonText: string): CarrierDraft {
  try {
    const parsed = JSON.parse(jsonText);
    const draft: CarrierDraft = {};
    if (typeof parsed.brand === 'string' && parsed.brand.trim()) draft.brand = parsed.brand.trim().slice(0, 100);
    if (typeof parsed.model === 'string' && parsed.model.trim()) draft.model = parsed.model.trim().slice(0, 100);
    if (parsed.size === 'carry_on' || parsed.size === 'medium') draft.size = parsed.size;
    if (typeof parsed.condition === 'string' && parsed.condition.trim()) draft.condition = parsed.condition.trim().slice(0, 50);
    if (typeof parsed.confidence === 'number') draft.confidence = Math.max(0, Math.min(1, parsed.confidence));
    return draft;
  } catch {
    return {};
  }
}

const PHOTO_SYSTEM_PROMPT = `당신은 캐리어(여행가방) 등록을 돕는 어시스턴트입니다. 사진 속 캐리어를 보고
브랜드(brand), 모델명(model), 사이즈(size: "carry_on" 기내용 또는 "medium" 중형 중 하나),
상태(condition: 한 단어, 예: "양호"/"사용감있음"/"손상")를 추정하세요.
확신이 없으면 빈 문자열로 두고 확신도를 낮게 주세요.
반드시 JSON만 응답: {"brand": string, "model": string, "size": "carry_on"|"medium", "condition": string, "confidence": number(0~1)}`;

/** Analyzes an already-uploaded photo (public https URL) and guesses structured fields. */
export async function analyzeCarrierPhoto(photoUrl: string): Promise<CarrierDraft> {
  const content = await callChatCompletion([
    { role: 'system', content: PHOTO_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '이 캐리어의 브랜드/모델/사이즈/상태를 JSON으로 알려주세요.' },
        { type: 'image_url', image_url: { url: photoUrl } },
      ],
    },
  ]);
  return parseDraft(content);
}

const CHAT_SYSTEM_PROMPT = `당신은 Luggy 서비스에서 캐리어(여행가방) 등록을 도와주는 챗봇입니다.
사용자와 대화하며 브랜드(brand), 모델명(model), 사이즈(size: "carry_on" 기내용 / "medium" 중형),
상태(condition)를 자연스럽게 물어보고 파악하세요. 사진이 이미 분석되어 대화에 초안으로 주어졌다면
그 값을 확인하는 질문만 하세요. 답변은 반드시 JSON 한 개로만 응답하세요:
{"reply": "사용자에게 보여줄 다음 챗봇 메시지", "draft": {"brand": string, "model": string, "size": "carry_on"|"medium"|"", "condition": string}, "done": boolean}
done은 brand/model/size가 모두 채워져 사용자가 확인 폼으로 넘어갈 준비가 되면 true로 설정하세요.`;

export interface ChatTurnResult {
  reply: string;
  draft: CarrierDraft;
  done: boolean;
}

/**
 * Runs one turn of the AI-guided registration chat given the full
 * conversation so far. Stateless by design (no DB table for this chat) —
 * the frontend keeps the running message history and resends it each turn,
 * same shape as a typical stateless chat-completion client.
 */
export async function runRegistrationChatTurn(history: ChatTurn[]): Promise<ChatTurnResult> {
  const content = await callChatCompletion([{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...history]);
  try {
    const parsed = JSON.parse(content);
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '죄송해요, 다시 한번 말씀해주시겠어요?',
      draft: parseDraft(JSON.stringify(parsed.draft || {})),
      done: Boolean(parsed.done),
    };
  } catch {
    return { reply: '죄송해요, 다시 한번 말씀해주시겠어요?', draft: {}, done: false };
  }
}
