const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const pages = ['index.html', 'scorer.html', 'live.html', 'history.html'];

for (const file of pages) {
  test(`${file}: scripts parse, IDs are unique, local assets and DOM targets exist`, () => {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      new vm.Script(script.replace(/import\s+[\s\S]*?\sfrom\s*["'][^"']+["'];/g, ''));
      const targets = [...script.matchAll(/(?:\$|getElementById)\("([^"]+)"\)/g)];
      for (const [, id] of targets) assert.ok(ids.includes(id), `${file}: missing ${id}`);
    }
    for (const [, link] of html.matchAll(/(?:href|src)="(\.\/?[^"#?]+)(?:[?#][^"]*)?"/g)) {
      assert.ok(fs.existsSync(path.join(root, link)), `${file}: missing ${link}`);
    }
  });
}

function historyHarness() {
  const nodes = new Map();
  function element() {
    const classes = new Set();
    return { textContent: '', value: '', children: [],
      classList: {add: c => classes.add(c), remove: c => classes.delete(c),
        toggle(c, enabled) { enabled ? classes.add(c) : classes.delete(c); }},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }, addEventListener() {},
    };
  }
  const calls = [];
  const context = vm.createContext({
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    URL, window: {location: {href: 'https://example.test/history.html'}},
    db: {}, ref: (_, destination) => destination, query: (...args) => args,
    orderByKey: () => 'key', limitToLast: limit => limit,
    onValue: (query, callback) => { calls.push({query, callback}); return () => {}; },
    console,
  });
  const html = fs.readFileSync(path.join(root, 'history.html'), 'utf8');
  vm.runInContext(html.slice(html.indexOf('    const status ='), html.indexOf('    search.addEventListener')), context);
  const run = code => vm.runInContext(code, context);
  run('filter.value="all";');
  return { nodes, calls, run };
}

test('history filters loaded matches by team/status and renders Super Over scores', () => {
  const { nodes, run } = historyHarness();
  run(`allMatches = [{id:'one',record:{updatedAt:1,public:true,message:'A wins',match:{
    names:['Alpha','Beta'],current:3,finished:true,innings:[
      {runs:5},{runs:5},{runs:6,teamIndex:1},{runs:7,teamIndex:0}]}}},
    {id:'two',record:{public:true,match:{names:['Gamma','Delta'],current:0,finished:false,innings:[{runs:0},{runs:0}]}}}];
    renderMatches();`);
  assert.equal(nodes.get('matchList').children.length, 2);
  const text = node => [node.textContent, ...node.children.map(text)].join(' ');
  assert.match(text(nodes.get('matchList')), /Super Over 1/);
  assert.match(text(nodes.get('matchList')), /Yet to bat/);
  run('search.value="alpha"; renderMatches();');
  assert.equal(nodes.get('matchList').children.length, 1);
  assert.match(nodes.get('matchCount').textContent, /1 of 2/);
  run('filter.value="live"; renderMatches();');
  assert.match(text(nodes.get('matchList')), /No matching matches/);
});

test('history uses bounded queries and drops malformed/private records', () => {
  const { calls, nodes, run } = historyHarness();
  run('loadMatches();');
  assert.deepEqual(Array.from(calls[0].query), ['history', 'key', 50]);
  calls[0].callback({exists: () => true, val: () => ({
    private: {public:false,match:{names:['A','B'],innings:[]}},
    malformed: {public:true,match:{names:['A','B'],innings:[null]}},
    valid: {public:true,match:{names:['A','B'],current:0,innings:[{},{}]}},
  })});
  assert.equal(nodes.get('matchList').children.length, 1);
  run('matchLimit+=50; loadMatches();');
  assert.equal(calls[1].query[2], 100);
});
