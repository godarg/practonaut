/**
 * Fixed process vocabularies for the challenge generators (PADR-0040): each domain lists its steps in
 * process order, a decision question, two lane names (frames) and spare steps. Near-identical
 * distractor labels are made from a label by fixed rules, so they look like a real board's leftovers
 * ("Ship parcel", "Ship parcels", "Shipping parcel").
 */
import type { Random } from './random.ts';

export interface Domain { id: string; steps: readonly string[]; question: string; lanes: readonly [string, string]; spare: readonly string[] }

export const DOMAINS: readonly Domain[] = Object.freeze([
  { id: 'orders', question: 'In stock?', steps: ['Receive order', 'Check stock', 'Reserve items', 'Take payment', 'Pick items', 'Pack parcel', 'Print label', 'Ship parcel', 'Send invoice', 'Track delivery', 'Close order', 'Archive order'], lanes: ['Warehouse', 'Office'], spare: ['Gift wrap', 'Split shipment', 'Refund payment', 'Notify customer'] },
  { id: 'hiring', question: 'Good fit?', steps: ['Post job', 'Screen CVs', 'Phone screen', 'Plan interview', 'Interview', 'Check references', 'Make offer', 'Sign contract', 'Order laptop', 'Onboard', 'First review', 'Close hiring'], lanes: ['Recruiting', 'Team'], spare: ['Second interview', 'Reject politely', 'Update job post', 'Ask for portfolio'] },
  { id: 'release', question: 'Tests green?', steps: ['Write code', 'Open review', 'Review code', 'Run tests', 'Fix findings', 'Merge branch', 'Build image', 'Deploy staging', 'Smoke test', 'Deploy production', 'Watch metrics', 'Write notes'], lanes: ['Development', 'Operations'], spare: ['Roll back', 'Hotfix', 'Tag release', 'Update changelog'] },
  { id: 'support', question: 'Reproduced?', steps: ['Open ticket', 'Triage ticket', 'Ask for details', 'Reproduce issue', 'Find cause', 'Fix issue', 'Verify fix', 'Reply to customer', 'Close ticket', 'Survey customer', 'Review ticket', 'Update docs'], lanes: ['First level', 'Engineering'], spare: ['Escalate ticket', 'Merge duplicates', 'Offer refund', 'Schedule call'] },
  { id: 'travel', question: 'Approved?', steps: ['Plan trip', 'Get approval', 'Book flight', 'Book hotel', 'Book train', 'Pack bags', 'Check in', 'Attend meeting', 'Collect receipts', 'File expenses', 'Get refund', 'Share notes'], lanes: ['Traveller', 'Finance'], spare: ['Rebook flight', 'Rent car', 'Cancel hotel', 'Buy ticket'] },
  { id: 'publishing', question: 'Facts OK?', steps: ['Pitch story', 'Approve pitch', 'Research', 'Write draft', 'Edit draft', 'Check facts', 'Lay out page', 'Proofread', 'Publish', 'Share online', 'Read comments', 'Archive story'], lanes: ['Editorial', 'Production'], spare: ['Correct error', 'Add photos', 'Translate story', 'Update headline'] },
  { id: 'purchasing', question: 'Budget OK?', steps: ['Request item', 'Approve request', 'Compare offers', 'Choose supplier', 'Send order', 'Confirm order', 'Receive goods', 'Inspect goods', 'Store goods', 'Pay invoice', 'Rate supplier', 'Close purchase'], lanes: ['Department', 'Purchasing'], spare: ['Return goods', 'Chase supplier', 'Split order', 'Renew contract'] },
  { id: 'incident', question: 'Users affected?', steps: ['Detect alert', 'Page on-call', 'Acknowledge', 'Assess impact', 'Open incident', 'Mitigate', 'Find root cause', 'Deploy fix', 'Monitor', 'Resolve incident', 'Write postmortem', 'Track actions'], lanes: ['On-call', 'Leads'], spare: ['Notify users', 'Escalate', 'Roll back change', 'Update status page'] },
]);

/** Near-identical variants of a label, in a fixed order; none equals the label. */
export function similarLabels(label: string): string[] {
  const words = label.split(' ');
  const first = words[0]!, rest = words.slice(1).join(' ');
  const out = [
    label.endsWith('s') ? label.slice(0, -1) : `${label}s`,
    rest ? `${first.endsWith('e') ? first.slice(0, -1) : first}ing ${rest}` : `${label}ing`,
    `${label} (old)`,
    words.length > 1 ? words.join('-') : `${label} 2`,
    `${label} v2`,
  ];
  return [...new Set(out)].filter(value => value !== label);
}

/** A subtle typo: two neighbouring letters of the longest word swapped (never the first letter). */
export function typo(label: string, random: Random): string {
  const words = label.split(' ');
  const index = words.reduce((best, word, i) => word.length > words[best]!.length ? i : best, 0);
  const word = words[index]!;
  if (word.length < 4) return `${label}s`;
  const at = random.int(1, word.length - 3);
  const swapped = word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
  if (swapped === word) return `${label}s`;
  words[index] = swapped;
  return words.join(' ');
}
