import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  SASProtocol,
} from '@azure/storage-blob';

export type UploadCategory = 'intake' | 'inspection';

export interface UploadSignResult {
  mode: 'azure-sas' | 'local';
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  blobUrl: string;
  token?: string;
  expiresInSeconds: number;
}

interface AzureCreds {
  accountName: string;
  accountKey: string;
  endpointSuffix: string;
}

function parseConnectionString(connectionString: string): AzureCreds | null {
  const parts = Object.fromEntries(
    connectionString.split(';').filter(Boolean).map((pair) => {
      const idx = pair.indexOf('=');
      return [pair.slice(0, idx), pair.slice(idx + 1)];
    })
  );
  if (!parts.AccountName || !parts.AccountKey) return null;
  return {
    accountName: parts.AccountName,
    accountKey: parts.AccountKey,
    endpointSuffix: parts.EndpointSuffix || 'core.windows.net',
  };
}

function containerForCategory(category: UploadCategory): string {
  if (category === 'intake') {
    return process.env.AZURE_BLOB_CONTAINER_INTAKE || 'intake-photos';
  }
  return process.env.AZURE_BLOB_CONTAINER_INSPECTION || 'inspection-photos';
}

const SAS_TTL_SECONDS = 15 * 60;

function signAzureUpload(category: UploadCategory, fileExtension: string): UploadSignResult {
  const creds = parseConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING as string);
  if (!creds) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is set but could not be parsed');
  }

  const container = containerForCategory(category);
  const blobName = `${category}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${fileExtension}`;
  const credential = new StorageSharedKeyCredential(creds.accountName, creds.accountKey);

  const startsOn = new Date(Date.now() - 60 * 1000); // small clock-skew allowance
  const expiresOn = new Date(Date.now() + SAS_TTL_SECONDS * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName,
      permissions: BlobSASPermissions.parse('cw'), // create + write only
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    },
    credential
  ).toString();

  const host = `https://${creds.accountName}.blob.${creds.endpointSuffix}`;
  const uploadUrl = `${host}/${container}/${blobName}?${sas}`;
  const blobUrl = `${host}/${container}/${blobName}`;

  return {
    mode: 'azure-sas',
    uploadUrl,
    uploadMethod: 'PUT',
    blobUrl,
    expiresInSeconds: SAS_TTL_SECONDS,
  };
}

// ---- Local-disk fallback (used whenever no Azure connection string is
// configured, e.g. this sandbox / local dev without real Azure credentials).
// The contract seen by the client is intentionally similar: sign -> upload ->
// store the returned blobUrl. Only the transport (PUT to Azure vs. multipart
// POST to our own API) differs.

interface LocalUploadTicket {
  category: UploadCategory;
  fileName: string;
  expiresAt: number;
}

const localTickets = new Map<string, LocalUploadTicket>();
const LOCAL_TICKET_TTL_MS = SAS_TTL_SECONDS * 1000;

export function getLocalUploadDir(): string {
  const dir = process.env.LOCAL_UPLOAD_DIR
    ? path.resolve(process.env.LOCAL_UPLOAD_DIR)
    : path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function signLocalUpload(category: UploadCategory, fileExtension: string): UploadSignResult {
  const token = crypto.randomUUID();
  const fileName = `${category}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${fileExtension}`;
  localTickets.set(token, { category, fileName, expiresAt: Date.now() + LOCAL_TICKET_TTL_MS });

  const publicBase = process.env.PUBLIC_API_URL || 'http://localhost:3001';
  return {
    mode: 'local',
    uploadUrl: `${publicBase}/uploads/local/${token}`,
    uploadMethod: 'POST',
    blobUrl: `${publicBase}/uploads/files/${fileName}`,
    token,
    expiresInSeconds: SAS_TTL_SECONDS,
  };
}

export function consumeLocalUploadTicket(token: string): LocalUploadTicket | null {
  const ticket = localTickets.get(token);
  if (!ticket) return null;
  localTickets.delete(token);
  if (ticket.expiresAt < Date.now()) return null;
  return ticket;
}

export function isAzureConfigured(): boolean {
  return Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING);
}

/**
 * Issues a short-lived, write-only upload target for a photo. Prefers real
 * Azure Blob Storage (SAS URL, direct browser PUT) when
 * AZURE_STORAGE_CONNECTION_STRING is configured; otherwise falls back to a
 * local-disk adapter with the same sign -> upload -> blobUrl contract, so the
 * whole flow works out of the box without real Azure credentials.
 */
export function signUpload(category: UploadCategory, fileName: string): UploadSignResult {
  const ext = path.extname(fileName) || '.jpg';
  if (isAzureConfigured()) {
    return signAzureUpload(category, ext);
  }
  return signLocalUpload(category, ext);
}
