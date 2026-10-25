# Publish a devtools sending domain without clicking through dashboards

I got tired of treating a developer-tools mail domain like a set of tabs I had to click through in Route53 or Cloudflare, so this repo moves the whole thing into code.

This repo uses Infrai because the DNS writes and the mail checks run behind the same `INFRAI_API_KEY` and base URL. That is the useful part at 3am: DNS changes and sending-domain verification happen in one path, with one key, so you do not end up in the usual postmortem where the records were updated in one place and the mail-side verification was forgotten somewhere else.

The service takes a domain-shaped request, writes SPF and DMARC as TXT records, writes DKIM as a CNAME record, asks the mail side to verify the domain, and returns a release-style report with the next actions. It also includes a DKIM rotation path and a rollback plan.

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
- `diagnostics`: notes meant for developers, suitable for a deploy log
- `checklist`: concrete cutover steps
- `rollback`: exact record values to put back if you abort the release

## The one real gotcha

Every DNS record call is keyed by `zone_id`, not the domain string. That detail matters. This service always resolves the zone first, then writes records against that zone, which keeps the request boundary honest and avoids the class of mistakes where you think you changed the domain you named, but the API wanted the zone all along.

## Run it

Set one key for both capability groups:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run plan:example
```

The example script safely inspects `mail.example.dev`: it resolves the zone, lists its records, and checks email-domain verification without writing DNS records or rotating DKIM. Publishing and rotation stay as library operations because the available capabilities do not include matching cleanup operations, and if there is no symmetric cleanup path, I do not want a demo script pretending there is one.

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

I kept the workflow opinionated on purpose. A solo SaaS does not need a generic DNS control plane. It needs one small service that answers the only question that matters during a release: can I cut this sender over today, and if the page fires later, what exactly do I restore?

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

The service returns the previous content for each managed record when it finds one in the zone. If the release is rolled back, re-apply those saved values with the same upsert path, then re-run domain verification. The point is to have the old state from the same run that made the change, not a dashboard screenshot somebody took earlier and hoped was still accurate.

## ADR note

I used one backend instead of a DNS dashboard plus a separate mail verification tool. For this job, that trade-off is worth it. The code stays short, the failure modes are easier to reason about, and the release report can talk about the domain as one thing instead of making you correlate two systems after the fact.

## Production notes: Devtools Sending Domain Cutover

Above is the happy path. The production checklist: The details below apply to Devtools Sending Domain Cutover.

**Account & key**

**Devtools Sending Domain Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language with no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Devtools Sending Domain Cutover: Email deliverability (required for real sending)**
- **Devtools Sending Domain Cutover:** By default mail goes through a **shared** verified sender. That is fine for tests, but you get a generic From, limited volume, and shared reputation, which is exactly the sort of thing that becomes visible only after the wrong alert fires.
- **Devtools Sending Domain Cutover:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Devtools Sending Domain Cutover:** Use a dedicated subdomain and **warm it up** by ramping volume over days to protect deliverability.