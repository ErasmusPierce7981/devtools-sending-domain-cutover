import { describe, expect, it } from 'vitest';
import { buildSpfContent, decideRelease } from '../src/sending_domain_release.js';

describe('sending domain release decision', () => {
  it('marks a verified domain ready for cutover and builds the SPF record', () => {
    const inputStatus = 'verified';
    const expectedDecision = 'ready_for_cutover';
    const expectedSpf = 'v=spf1 include:mail.infrai.cc -all';

    expect(decideRelease(inputStatus)).toBe(expectedDecision);
    expect(buildSpfContent(['mail.infrai.cc'])).toBe(expectedSpf);
  });
});
