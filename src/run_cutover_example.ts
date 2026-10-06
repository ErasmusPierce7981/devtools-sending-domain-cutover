import { createInfraiClient } from './infrai.js';

async function main() {
  const infrai = createInfraiClient();
  const domain = 'mail.example.dev';
  const zone = await infrai.dns.domain.get({ domain });
  const records = await infrai.dns.record.list({ zone_id: zone.zone_id });
  const verification = await infrai.email.domain.verify({ domain });

  console.log(JSON.stringify({ domain, zone_id: zone.zone_id, records: records.records ?? [], verification }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
