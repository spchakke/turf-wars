const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../scorer.html'), 'utf8');
const source = html.slice(html.indexOf('const $ ='), html.indexOf('function render()'));

function harness() {
  const writes = [];
  const elements = new Map();
  const context = vm.createContext({
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '' });
      return elements.get(id);
    } },
    localStorage: { setItem() {} },
    auth: { currentUser: { uid: 'owner' } }, db: {},
    ref: (_, destination) => destination,
    set: async (destination, payload) => { writes.push({ destination, payload }); },
    console,
  });
  vm.runInContext(source + '\nfunction render() {}', context);
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
