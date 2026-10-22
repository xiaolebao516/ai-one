// Child process for the cross-process race tests: `claim` tries to take a slot, `add` registers
// one more slot. All children wait for the same wall-clock start time so they really collide,
// and stay alive until endAt so a finished winner's claim does not look dead to a late loser.
import { addSlots, claimSlot } from '../slots.mjs';

const [mode, home, startAt, endAt, slotId] = process.argv.slice(2);
while (Date.now() < Number(startAt)) { /* align start */ }
if (mode === 'claim') {
  const result = claimSlot(home, Number(slotId));
  process.stdout.write(JSON.stringify({ ok: result.ok }));
} else if (mode === 'add') {
  const slots = addSlots(home, 1);
  process.stdout.write(JSON.stringify({ ids: slots.map((s) => s.id) }));
}
await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(endAt) - Date.now())));
