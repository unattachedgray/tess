import WebSocket from '../../packages/server/node_modules/ws/wrapper.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:18460';
const healthResponse = await fetch(`${base}/api/health`);
if (!healthResponse.ok) throw Error(`Health HTTP ${healthResponse.status}`);
const health = await healthResponse.json();
if (health.status !== 'ok' || health.discovery !== false) throw Error('Health/discovery precondition failed');
const page = await fetch(base);
if (!page.ok || !(await page.text()).includes('<html')) throw Error('Frontend unavailable');
for (const gameType of ['chess', 'janggi', 'go']) {
 await new Promise((resolve, reject) => {
  const ws = new WebSocket(base.replace(/^http/, 'ws'));
  const timer = setTimeout(() => {ws.close();reject(Error(`${gameType} timed out`));}, 45000);
  ws.on('open', () => ws.send(JSON.stringify({type:'NEW_GAME',gameType,difficulty:'beginner',playerColor:gameType === 'go' ? 'black' : 'white',boardSize:9,coaching:false,suggestionCount:1})));
  ws.on('message', raw => {
   const msg=JSON.parse(raw.toString());
   if(msg.type === 'ERROR') {clearTimeout(timer);ws.close();reject(Error(`${gameType}: ${msg.message}`));}
   if(msg.type === 'SUGGESTIONS' && msg.suggestions?.length) {clearTimeout(timer);ws.close();console.log(`${gameType}: engine suggestions verified`);resolve();}
  });
  ws.on('error', reject);
 });
}
console.log('Public frontend, health, and all three engine protocols passed');
