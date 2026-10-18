const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../scorer.html'), 'utf8');
const source = html.slice(html.indexOf('const $ ='), html.indexOf('\ndocument.querySelectorAll("[data-runs]")'));

function harness() {
  const writes = [];
  const atomicWrites = [];
  const elements = new Map();
  const element = () => {
    const classes = new Set();
    return { textContent: '', className: '', href: '',
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
        contains: name => classes.has(name) },
      append() {}, appendChild() {}, replaceChildren() {},
    };
  };
  const context = vm.createContext({
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    }, querySelectorAll: () => [], createElement: element },
    URL, window: { location: { href: 'https://example.test/scorer.html' } },
    localStorage: { setItem() {}, getItem() { return null; } },
    auth: { currentUser: { uid: 'owner' } }, db: {},
    ref: (_, destination) => destination,
    update: async (_, payloads) => {
      atomicWrites.push(payloads);
      for (const [destination, payload] of Object.entries(payloads)) writes.push({ destination, payload });
    },
    serverTimestamp: () => Date.now(),
    console,
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`match = { names: ['A', 'B'], maxOvers: 1, current: 0,
    target: null, finished: false, innings: [newInnings(), newInnings()] };`);
  return { run, writes, atomicWrites, elements };
}

for (const [name, setup, action] of [
  ['last ball of first innings', 'match.innings[0].legalBalls = 5;', 'scoreRuns(4)'],
  ['tenth wicket', 'match.innings[0].wickets = 9;', 'addWicket()'],
  ['winning runs', 'match.current = 1; match.target = 2; match.innings[0].runs = 1;', 'scoreRuns(2)'],
  ['winning extra', 'match.current = 1; match.target = 1;', 'addExtra("WIDE")'],
  ['last ball of chase', 'match.current = 1; match.target = 20; match.innings[1].legalBalls = 5;', 'scoreRuns(0)'],
  ['manual innings end', '', 'endInnings()'],
  ['manual finish', 'match.current=1;', 'finishMatch()'],
]) {
  test(`one Undo restores ${name}`, () => {
    const { run } = harness();
    run(setup);
    const before = run('JSON.stringify(match)');
    run(action);
    assert.equal(run('undoStack.length'), 1);
    run('undo()');
    assert.equal(run('JSON.stringify(match)'), before);
    assert.equal(run('canScore()'), true);
  });
}

test('cannot score past a restored innings limit or achieved target', () => {
  const { run } = harness();
  for (const setup of [
    'match.innings[0].legalBalls = 6;',
    'match.innings[0].legalBalls = 0; match.innings[0].wickets = 10;',
    'match.current = 1; match.target = 1; match.innings[1].runs = 1;',
  ]) {
    run(setup);
    const before = run('JSON.stringify(match)');
    run('scoreRuns(6); addWicket(); addExtra("WIDE");');
    assert.equal(run('JSON.stringify(match)'), before);
  }
});

test('queued saves retain their destination across match replacement', async () => {
  const { run, writes, elements } = harness();
  run('cloudMatchId = "old"; save(); cloudMatchId = null;');
  await run('cloudSaveQueue');
  assert.deepEqual(writes.map(w => w.destination), ['matches/old', 'history/old']);
  assert.notEqual(elements.get('cloudStatus').textContent, 'Live synced');
  run('cloudMatchId = "new"; match.names[0] = "New team"; save();');
  await run('cloudSaveQueue');
  assert.deepEqual(writes.map(w => w.destination),
    ['matches/old', 'history/old', 'matches/new', 'history/new']);
  assert.equal(writes[0].payload.match.names[0], 'A');
  assert.equal(writes[2].payload.match.names[0], 'New team');
  assert.equal(elements.get('cloudStatus').textContent, 'Live synced');
});

for (const [name, setup, action, expected] of [
  ['chase won', 'match.innings[0].runs=5; match.target=6; match.innings[1].wickets=3;', 'scoreRuns(6)', 'B win by 7 wicket(s)!'],
  ['defended on last ball', 'match.innings[0].runs=10; match.target=11; match.innings[1].runs=7; match.innings[1].legalBalls=5;', 'scoreRuns(1)', 'A win by 2 run(s)!'],
  ['all out', 'match.innings[0].runs=10; match.target=11; match.innings[1].runs=7; match.innings[1].wickets=9;', 'addWicket()', 'A win by 3 run(s)!'],
  ['winning wide', 'match.innings[0].runs=5; match.target=6; match.innings[1].runs=5;', 'addExtra("WIDE")', 'B win by 10 wicket(s)!'],
  ['tie', 'match.innings[0].runs=5; match.target=6; match.innings[1].runs=4; match.innings[1].legalBalls=5;', 'scoreRuns(1)', 'Match tied!'],
]) {
  test(`${name}: result is visible, synced, restored, and cleared by Undo`, async () => {
    const { run, elements, writes } = harness();
    run('match.current=1; cloudMatchId="result-test";');
    run(setup);
    run(action);
    const banner = elements.get('resultBanner');
    assert.equal(banner.textContent, expected);
    assert.equal(banner.classList.contains('hidden'), false);
    await run('cloudSaveQueue');
    assert.equal(writes[0].payload.message, expected);
    assert.equal(writes[1].payload.message, expected);
    run('render()');
    assert.equal(banner.textContent, expected);
    run('undo()');
    assert.equal(banner.textContent, '');
    assert.equal(banner.classList.contains('hidden'), true);
  });
}

test('spectator result banner displays the winner and clears on a reopened match', () => {
  const live = fs.readFileSync(path.join(__dirname, '../live.html'), 'utf8');
  const elements = new Map();
  function element() {
    const classes = new Set();
    return { textContent: '', style: {}, append() {}, replaceChildren() {},
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        toggle(c, enabled) { enabled ? classes.add(c) : classes.delete(c); },
        contains: c => classes.has(c) } };
  }
  const context = vm.createContext({ document: {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
  } });
  vm.runInContext('let connected=true; let finished=false;\n' + live.slice(live.indexOf('    const $ ='), live.indexOf('    $("joinForm").addEventListener')), context);
  vm.runInContext(`const record = {public:true, message:'B win by 7 wicket(s)!', match:{
    names:['A','B'], current:1, finished:true, maxOvers:1,
    innings:[{runs:5,wickets:0,legalBalls:6},{runs:6,wickets:3,legalBalls:4}]}};
    render(record);`, context);
  assert.equal(elements.get('resultBanner').textContent, 'B win by 7 wicket(s)!');
  assert.equal(elements.get('resultBanner').classList.contains('hidden'), false);
  vm.runInContext('record.match.finished=false; render(record);', context);
  assert.equal(elements.get('resultBanner').textContent, '');
  assert.equal(elements.get('resultBanner').classList.contains('hidden'), true);
  vm.runInContext(`record.match.innings.push(
    {runs:4,wickets:2,legalBalls:3,teamIndex:1,superOver:1},
    {runs:0,wickets:0,legalBalls:0,teamIndex:0,superOver:1});
    record.match.current=3; record.match.target=5; render(record);`, context);
  assert.equal(elements.get('battingLabel').textContent, 'A · SUPER OVER 1 · INNINGS 2');
  assert.equal(elements.get('oversLimit').textContent, '1');
  assert.equal(elements.get('targetText').textContent, 'Target: 5 · 5 runs needed');
});

function tiedMatch() {
  const h = harness();
  h.run('match.current=1; match.target=6; match.innings[0].runs=5; match.innings[1].runs=5; finishMatch();');
  return h;
}

test('Super Over is offered only after a tie; starting and undoing preserves regulation scores', () => {
  const { run, elements } = tiedMatch();
  assert.equal(elements.get('superOverBtn').classList.contains('hidden'), false);
  const original = run('JSON.stringify(match)');
  run('startSuperOver()');
  assert.equal(run('match.current'), 2);
  assert.equal(run('teamIndex()'), 1);
  assert.equal(run('totalOvers()'), 6);
  assert.equal(run('wicketLimit()'), 2);
  assert.equal(run('match.target'), null);
  assert.equal(elements.get('superOverBtn').classList.contains('hidden'), true);
  run('startSuperOver()');
  assert.equal(run('match.innings.length'), 4);
  run('undo()');
  assert.equal(run('JSON.stringify(match)'), original);
  assert.equal(elements.get('resultBanner').textContent, 'Match tied!');
});

test('Super Over ends at two wickets, chases its own target, syncs and supports winning-ball Undo', async () => {
  const { run, elements, writes } = tiedMatch();
  run('cloudMatchId="super"; startSuperOver(); scoreRuns(4); addWicket(); addWicket();');
  assert.equal(run('match.current'), 3);
  assert.equal(run('match.target'), 5);
  assert.equal(run('teamIndex()'), 0);
  run('scoreRuns(6)');
  assert.equal(elements.get('resultBanner').textContent, 'A win by 2 wicket(s)! (Super Over 1)');
  await run('cloudSaveQueue');
  const saved = writes.at(-1).payload;
  assert.equal(saved.match.innings.length, 4);
  assert.equal(saved.match.innings[0].runs, 5);
  assert.equal(saved.match.innings[1].runs, 5);
  assert.equal(saved.match.finished, true);
  run('undo()');
  assert.equal(run('match.innings[3].runs'), 0);
  assert.equal(run('canScore()'), true);
});

test('six-ball Super Over tie offers another round with reversed batting order', () => {
  const { run, elements } = tiedMatch();
  run('startSuperOver(); for(let i=0;i<12;i++) scoreRuns(0);');
  assert.equal(run('isTied()'), true);
  assert.equal(run('match.innings[2].legalBalls'), 6);
  assert.equal(run('match.innings[3].legalBalls'), 6);
  assert.equal(elements.get('superOverBtn').classList.contains('hidden'), false);
  run('startSuperOver()');
  assert.equal(run('match.current'), 4);
  assert.equal(run('teamIndex()'), 0);
  run('scoreRuns(4); endInnings(); for(let i=0;i<6;i++) scoreRuns(0);');
  assert.equal(elements.get('resultBanner').textContent, 'A win by 4 run(s)! (Super Over 2)');
  assert.equal(elements.get('superOverBtn').classList.contains('hidden'), true);
});

test('one atomic cloud update contains both scoreboard and history', async () => {
  const { run, atomicWrites } = harness();
  run('cloudMatchId="atomic"; scoreRuns(4);');
  await run('cloudSaveQueue');
  assert.equal(atomicWrites.length, 1);
  assert.deepEqual(Object.keys(atomicWrites[0]), ['matches/atomic', 'history/atomic']);
  assert.equal(atomicWrites[0]['matches/atomic'], atomicWrites[0]['history/atomic']);
});

test('browser storage failure does not prevent rendering or cloud save', async () => {
  const { run, elements, writes } = harness();
  run('cloudMatchId="storage"; localStorage.setItem=()=>{throw Error("quota")}; scoreRuns(4);');
  await run('cloudSaveQueue');
  assert.equal(elements.get('runs').textContent, 4);
  assert.match(elements.get('storageWarning').textContent, /backup failed/i);
  assert.equal(writes[0].payload.match.innings[0].runs, 4);
});

test('restoration validates stored state and keeps matching Undo messages', () => {
  const { run } = harness();
  run('scoreRuns(4); const saved=JSON.stringify({match, undoStack, undoMessages, message}); localStorage.getItem=()=>saved; match=null;');
  assert.equal(run('restoreLocal()'), true);
  assert.equal(run('match.innings[0].runs'), 4);
  run('undo()');
  assert.equal(run('match.innings[0].runs'), 0);
  run('localStorage.getItem=()=>JSON.stringify({match:{names:["A","B"],current:99}});');
  assert.equal(run('restoreLocal()'), false);
});

test('finished tied match restores its result and offers Super Over', () => {
  const { run, elements } = tiedMatch();
  run('const saved=JSON.stringify({match, message:"stale message"}); localStorage.getItem=()=>saved; match=null;');
  assert.equal(run('restoreLocal()'), true);
  run('render()');
  assert.equal(elements.get('resultBanner').textContent, 'Match tied!');
  assert.equal(elements.get('superOverBtn').classList.contains('hidden'), false);
});

test('another-tab conflict blocks scoring, Undo, transitions and saves', () => {
  const { run } = harness();
  run('scoreRuns(4); otherTabChanged=true;');
  const before = run('JSON.stringify(match)');
  run('scoreRuns(6); addWicket(); addExtra("WIDE"); undo(); endInnings(); finishMatch(); save();');
  assert.equal(run('JSON.stringify(match)'), before);
});

test('an ownership mismatch does not write cloud records', async () => {
  const { run, writes, elements } = harness();
  run('cloudMatchId="owned"; ownerUid="someone-else"; scoreRuns(4);');
  await run('cloudSaveQueue');
  assert.equal(writes.length, 0);
  assert.equal(elements.get('cloudStatus').textContent, 'Account mismatch');
});

test('cannot finish before the chase and invalid scoring input is ignored', () => {
  const { run, elements } = harness();
  const before = run('JSON.stringify(match)');
  run('finishMatch(); scoreRuns(-1); scoreRuns(1.5); scoreRuns(7); addExtra("invalid"); render();');
  assert.equal(run('JSON.stringify(match)'), before);
  assert.equal(run('undoStack.length'), 0);
  assert.equal(elements.get('finishBtn').disabled, true);
});

test('remaining overs use cricket notation and every delivery is retained', () => {
  const { run, elements } = harness();
  run('match.maxOvers=10; scoreRuns(0);');
  assert.equal(elements.get('oversLeft').textContent, '9.5');
  run('for(let i=0;i<35;i++) scoreRuns(0);');
  assert.equal(run('match.innings[0].events.length'), 36);
});

test('failed cloud save can be retried without losing the latest local score', async () => {
  const { run, elements } = harness();
  run('console.error=()=>{}; cloudMatchId="retry"; update=async()=>{throw Error("denied")}; scoreRuns(4);');
  await run('cloudSaveQueue');
  assert.equal(elements.get('cloudStatus').textContent, 'Sync error');
  assert.equal(run('match.innings[0].runs'), 4);
  run('let retried=null; update=async(_,payload)=>{retried=payload}; save();');
  await run('cloudSaveQueue');
  assert.equal(run('retried["matches/retry"].match.innings[0].runs'), 4);
  assert.equal(elements.get('cloudStatus').textContent, 'Live synced');
});

test('Undo restores the innings-break message, not a generic progress message', () => {
  const { run, elements } = harness();
  run('scoreRuns(4); endInnings(); scoreRuns(1); undo();');
  assert.equal(elements.get('matchStatus').textContent, 'First innings complete. Target: 5');
});
