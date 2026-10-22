// Child process for the cross-process race tests. `claim` tries to take slots slotBase ..
// slotBase+rounds-1, one per round; `add` registers one more slot. Children rendezvous through
// marker files before every round, so each round is a real collision, and nobody exits before
// all of them are done, so a winner's claim never looks dead to a late loser.
import fs from 'node:fs';
import path from 'node:path';
import { addSlots, claimSlot } from '../slots.mjs';

const [mode, home, count, slotBase, rounds] = process.argv.slice(2);
const dir = path.join(home, 'sync');
fs.mkdirSync(dir, { recursive: true });
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function barrier(name) {
  fs.writeFileSync(path.join(dir, `${name}-${process.pid}`), '');
  const giveUpAt = Date.now() + 60_000;
  while (fs.readdirSync(dir).filter((file) => file.startsWith(`${name}-`)).length < Number(count)) {
    if (Date.now() > giveUpAt) process.exit(2);
    pause(1);
  }
}

if (mode === 'claim') {
  const results = [];
  for (let round = 0; round < Number(rounds); round++) {
    barrier(`round${round}`);
    results.push(claimSlot(home, Number(slotBase) + round).ok);
  }
  process.stdout.write(JSON.stringify({ results }));
} else if (mode === 'add') {
  barrier('round0');
  process.stdout.write(JSON.stringify({ ids: addSlots(home, 1).map((s) => s.id) }));
}
barrier('done');
