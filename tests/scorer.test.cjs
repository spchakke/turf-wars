const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../scorer.html'), 'utf8');
const source = html.slice(html.indexOf('const $ ='), html.indexOf('\ndocument.querySelectorAll("[data-runs]")'));

function harness() {
  const writes = [];
  const elements = new Map();
  const element = () => {
    const classes = new Set();
    return { textContent: '', className: '', href: '',
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
        contains: name => classes.has(name) },
      append() {}, appendChild() {},
    };
  };
  const context = vm.createContext({
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    }, querySelectorAll: () => [], createElement: element },
    URL, window: { location: { href: 'https://example.test/scorer.html' } },
    localStorage: { setItem() {} },
    auth: { currentUser: { uid: 'owner' } }, db: {},
    ref: (_, destination) => destination,
    set: async (destination, payload) => { writes.push({ destination, payload }); },
    console,
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`match = { names: ['A', 'B'], maxOvers: 1, current: 0,
    target: null, finished: false, innings: [newInnings(), newInnings()] };`);
  return { run, writes, elements };
}

for (const [name, setup, action] of [
  ['last ball of first innings', 'match.innings[0].legalBalls = 5;', 'scoreRuns(4)'],
  ['tenth wicket', 'match.innings[0].wickets = 9;', 'addWicket()'],
  ['winning runs', 'match.current = 1; match.target = 2; match.innings[0].runs = 1;', 'scoreRuns(2)'],
  ['winning extra', 'match.current = 1; match.target = 1;', 'addExtra("WIDE")'],
  ['last ball of chase', 'match.current = 1; match.target = 20; match.innings[1].legalBalls = 5;', 'scoreRuns(0)'],
  ['manual innings end', '', 'endInnings()'],
  ['manual finish', '', 'finishMatch()'],
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
  vm.runInContext(live.slice(live.indexOf('    const $ ='), live.indexOf('    if (!matchId)')), context);
  vm.runInContext(`const record = {public:true, message:'B win by 7 wicket(s)!', match:{
    names:['A','B'], current:1, finished:true, maxOvers:1,
    innings:[{runs:5,wickets:0,legalBalls:6},{runs:6,wickets:3,legalBalls:4}]}};
    render(record);`, context);
  assert.equal(elements.get('resultBanner').textContent, 'B win by 7 wicket(s)!');
  assert.equal(elements.get('resultBanner').classList.contains('hidden'), false);
  vm.runInContext('record.match.finished=false; render(record);', context);
  assert.equal(elements.get('resultBanner').textContent, '');
  assert.equal(elements.get('resultBanner').classList.contains('hidden'), true);
});
