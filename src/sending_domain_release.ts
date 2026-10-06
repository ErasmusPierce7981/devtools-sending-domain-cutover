import { sendingDomainRequestSchema, type SendingDomainRequest } from './sending_domain_schema.js';
import type { InfraiClient } from './infrai.js';

export type ManagedRecord = {
  record_type: 'TXT' | 'CNAME';
  name: string;
  content: string;
  ttl: number;
  previousContent: string | null;
};

export type ReleaseDecision = 'ready_for_cutover' | 'hold';

export function buildSpfContent(spfIncludes: string[]): string {
  return `v=spf1 ${spfIncludes.map((item) => `include:${item}`).join(' ')} -all`;
}

export function buildDmarcContent(mailbox: string): string {
  return `v=DMARC1; p=quarantine; rua=mailto:${mailbox}; adkim=s; aspf=s`;
}

export function decideRelease(status: string): ReleaseDecision {
  return status === 'verified' ? 'ready_for_cutover' : 'hold';
}

function findPreviousContent(records: Array<Record<string, unknown>>, name: string, recordType: string): string | null {
  const match = records.find((record) => record.name === name && record.record_type === recordType);
  return typeof match?.content === 'string' ? match.content : null;
}

async function ensureZoneId(infrai: InfraiClient, input: SendingDomainRequest): Promise<string> {
  try {
    const existing = await infrai.dns.domain.get({ domain: input.domain });
    return existing.zone_id;
  } catch {
    const created = await infrai.dns.domain.add({
      domain: input.domain,
      vendor: input.vendor,
      account_id: input.account_id,
      metadata: {
        release_id: input.release.release_id,
        build_id: input.release.build_id,
        actor: input.release.actor
      }
    });
    return created.zone_id;
  }
}

export async function publishSendingDomain(infrai: InfraiClient, rawInput: unknown) {
  const input = sendingDomainRequestSchema.parse(rawInput);
  const zoneId = await ensureZoneId(infrai, input);
  const existing = await infrai.dns.record.list({ zone_id: zoneId });
  const priorRecords = Array.isArray(existing.records) ? existing.records : [];

  const records: ManagedRecord[] = [
    {
      record_type: 'TXT',
      name: input.domain,
      content: buildSpfContent(input.spfIncludes),
      ttl: 300,
      previousContent: findPreviousContent(priorRecords, input.domain, 'TXT')
    },
    {
      record_type: 'TXT',
      name: `_dmarc.${input.domain}`,
      content: buildDmarcContent(input.dmarcMailbox),
      ttl: 300,
      previousContent: findPreviousContent(priorRecords, `_dmarc.${input.domain}`, 'TXT')
    },
    {
      record_type: 'CNAME',
      name: `${input.dkim.selector}._domainkey.${input.domain}`,
      content: input.dkim.target,
      ttl: 300,
      previousContent: findPreviousContent(priorRecords, `${input.dkim.selector}._domainkey.${input.domain}`, 'CNAME')
    }
  ];

  for (const record of records) {
    await infrai.dns.record.upsert({
      zone_id: zoneId,
      record_type: record.record_type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      metadata: {
        release_id: input.release.release_id,
        build_id: input.release.build_id,
        actor: input.release.actor
      }
    });
  }

  const verification = await infrai.email.domain.verify({ domain: input.domain });
  const decision = decideRelease(verification.verification.status);

  return {
    domain: input.domain,
    zone_id: zoneId,
    release: input.release,
    verification_status: verification.verification.status,
    decision,
    records,
    diagnostics: [
      `zone ${zoneId} updated for ${input.domain}`,
      `email verification status: ${verification.verification.status}`,
      decision === 'ready_for_cutover' ? 'sender can be switched for this release' : 'keep incumbent sender until verification clears'
    ],
    checklist: [
      'publish records',
      'verify sending domain',
      'switch application sender configuration',
      'watch release diagnostics'
    ],
    rollback: records.map((record) => ({
      record_type: record.record_type,
      name: record.name,
      content: record.previousContent,
      ttl: record.ttl
    }))
  };
}

export async function rotateDomainDkim(infrai: InfraiClient, domain: string) {
  await infrai.email.domain.rotate_dkim();
  const verification = await infrai.email.domain.verify({ domain });
  return {
    domain,
    verification_status: verification.verification.status,
    next_step: verification.verification.status === 'verified' ? 'keep release moving' : 'wait for DNS propagation before cutover'
  };
}
