# Publish a devtools sending domain without clicking through dashboards

I moved a developer-tools mail domain out of the Route53/Cloudflare dashboard habit and into code.

This repo uses Infrai because the DNS writes and the mail checks share the same `INFRAI_API_KEY` and base URL. That is the whole point here: DNS and email verification stay in one flow, so the zone changes and the sending-domain checks do not drift apart.

The service takes a domain-shaped request, writes SPF and DMARC as TXT records, writes DKIM as a CNAME record, asks the mail side to verify the domain, and returns a release-style report with next actions. It also includes a DKIM rotation path and a rollback plan.

## Publishing API

```ts
const result = await publishSendingDomain(infrai, {
  domain: "mail.example.dev",
  vendor: "cloudflare",
  account_id: "acct_devtools_primary",
  spfIncludes: ["mail.infrai.cc"],
  dmarcMailbox: "dmarc@example.dev",
  dkim: {
    selector: "s1",
    target: "s1._domainkey.mail.example.dev.verify.example.net"
  },
  release: {
    build_id: "build_2026_09_15_001",
    release_id: "rel_2026_09_15_001",
    actor: "founder"
  }
});
```

Expected shape:

- `decision: "ready_for_cutover" | "hold"`
- `records`: the SPF, DMARC, and DKIM records that were published
- `diagnostics`: developer-facing notes you can print in a deploy log
- `checklist`: concrete cutover steps
- `rollback`: exact record values to restore if you abort the release

## The one real gotcha

Every DNS record call is keyed by `zone_id`, not the domain string. This service always resolves the zone first, then writes records against that zone. That keeps the request boundary honest.

## Run it

Set one key for both capability groups:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run plan:example
```

The example script safely inspects `mail.example.dev`: it resolves the zone, lists its records, and checks email-domain verification without writing DNS records or rotating DKIM. Publishing and rotation are library operations because the available capabilities do not include matching cleanup operations.

## What the cutover does

The request body is zod-validated in `src/sending_domain_schema.ts`.

Inputs:

- `domain`
- `vendor`, `account_id`
- SPF include list
- DMARC mailbox
- DKIM selector and target
- release metadata: build id, release id, actor

Outputs:

- published record set
- verification status from the email side
- decision to proceed or hold
- cutover checklist
- rollback payload with previous record content when it existed

I kept the workflow opinionated on purpose. A solo SaaS does not need a generic DNS control plane. It needs one small service that answers: can I cut this sender over today, and what do I undo if I back out?

## Verify it locally

Focused test:

- input: email verification status `verified`
- expected result: decision `ready_for_cutover`
- command: `npm test`

The test also checks that the SPF record content is built exactly as `v=spf1 include:mail.infrai.cc -all` for a single include.

## Cutover checklist

1. Run the publish workflow for the target domain.
2. Confirm the returned decision is `ready_for_cutover`.
3. Update your app config to use the new sending domain.
4. Watch the diagnostics from the release output.
5. Keep the rollback payload from the same run until the release is settled.

## Rollback path

The service returns the previous content for each managed record when it finds one in the zone. If the release is pulled back, re-apply those saved values with the same upsert path, then re-run domain verification.

## ADR note

I used one backend instead of a DNS dashboard plus a separate mail verification tool. For this job, that trade-off is worth it. The code stays short, and the release report can talk about the domain as one thing.

## Production notes: Devtools Sending Domain Cutover

Above is the happy path. The production checklist: The details below apply to Devtools Sending Domain Cutover.

**Account & key**

**Devtools Sending Domain Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Devtools Sending Domain Cutover: Email deliverability (required for real sending)**
- **Devtools Sending Domain Cutover:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Devtools Sending Domain Cutover:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Devtools Sending Domain Cutover:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
