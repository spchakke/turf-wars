const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../boundary-effects.js'), 'utf8').replaceAll('export function', 'function');

function harness() {
  const children = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document: {
      createElement: () => ({ children: [], attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        appendChild(child) { this.children.push(child); },
        remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); },
      }),
      body: { appendChild: element => children.push(element) },
    },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), children, timers };
}

test('four/six flash uses the right label, replaces the last effect and cleans up', () => {
  const { run, children, timers } = harness();
  run('flashBoundary(4)');
  assert.equal(children[0].className, 'tw-boundary tw-boundary-4');
  assert.equal(children[0].children[0].textContent, 'Four!');
  assert.equal(children[0].attributes.role, 'status');
  run('flashBoundary(6)');
  assert.equal(children.length, 1);
  assert.equal(children[0].children[0].textContent, 'Six!');
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(children.length, 0);
  run('flashBoundary(1)');
  assert.equal(children.length, 0);
});

test('spectator celebrates new consecutive boundaries, not initial load, repeated snapshots, or Undo', () => {
  const { run } = harness();
  run(`const celebrations=[]; const observe=createBoundaryObserver(runs=>celebrations.push(runs));
    const four={runs:4,legalBall:true,wicket:false};
    const six={runs:6,legalBall:true,wicket:false};
    const match={innings:[{events:[four]}, {events:[]}]};
    observe(match); observe(match);`);
  assert.equal(run('celebrations.length'), 0);
  run('match.innings[0].events.unshift(four); observe(match);');
  run('match.innings[0].events.unshift(four); observe(match);');
  assert.equal(run('JSON.stringify(celebrations)'), '[4,4]');
  run('match.innings[0].events.shift(); observe(match); observe(match);');
  assert.equal(run('celebrations.length'), 2);
  run('match.innings[0].events.unshift(six); observe(match);');
  assert.equal(run('JSON.stringify(celebrations)'), '[4,4,6]');
});

test('spectator catches innings-ending boundaries and ignores extras, wickets, and empty Super Overs', () => {
  const { run } = harness();
  run(`const celebrations=[]; const observe=createBoundaryObserver(runs=>celebrations.push(runs));
    const match={current:0,innings:[{events:[]},{events:[]}]}; observe(match);
    match.innings[0].events.unshift({runs:6,legalBall:true}); match.current=1; observe(match);
    match.innings[1].events.unshift({runs:4,legalBall:false}); observe(match);
    match.innings[1].events.unshift({runs:4,legalBall:true,wicket:true}); observe(match);
    match.innings.push({events:[]},{events:[]}); match.current=2; observe(match);`);
  assert.equal(run('JSON.stringify(celebrations)'), '[6]');
});
