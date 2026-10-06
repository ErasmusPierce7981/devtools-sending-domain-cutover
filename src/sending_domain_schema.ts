import { z } from 'zod';

export const sendingDomainRequestSchema = z.object({
  domain: z.string().min(3),
  vendor: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  spfIncludes: z.array(z.string().min(1)).min(1),
  dmarcMailbox: z.string().email(),
  dkim: z.object({
    selector: z.string().min(1),
    target: z.string().min(1)
  }),
  release: z.object({
    build_id: z.string().min(1),
    release_id: z.string().min(1),
    actor: z.string().min(1)
  })
});

export type SendingDomainRequest = z.infer<typeof sendingDomainRequestSchema>;
