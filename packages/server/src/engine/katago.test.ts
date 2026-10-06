import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
it('advances across blank, malformed, complete and partial engine lines without hanging', () => {
 const file = fileURLToPath(new URL('./katago.ts', import.meta.url));
 const loader = fileURLToPath(new URL('../../node_modules/tsx/dist/esm/index.mjs', import.meta.url));
 const code = `import {KataGoAdapter} from ${JSON.stringify(file)};
 const a=Object.create(KataGoAdapter.prototype); const results=[];
 a.handleResponse=x=>results.push(x.id);
 a.buffer='\\n  \\nstartup\\n{"id":"first"}\\n{"id":'; a.processBuffer();
 if(a.buffer !== '{"id":' || results.join() !== 'first') process.exit(1);
 a.buffer+='"second"}\\n\\n';a.processBuffer();
 if(a.buffer !== '' || results.join() !== 'first,second') process.exit(2);`;
 const child=spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',code],{timeout:3000,encoding:'utf8'});
 expect(child.error).toBeUndefined();
 expect(child.status, child.stderr).toBe(0);
});
