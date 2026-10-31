const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function extractFunction(name) {
  const match = source.match(new RegExp(`        function ${name}\\([\\s\\S]*?\\n        }`));
  assert.ok(match, `${name} should exist in app.js`);
  return match[0];
}

const normalizeTeacherName = vm.runInNewContext(`(${extractFunction('normalizeTeacherName')})`);
const teacherSubjectDayKey = vm.runInNewContext(
  `(${extractFunction('dashboardTeacherSubjectDayKey')})`,
  { normalizeTeacherName }
);

const sectionAKey = teacherSubjectDayKey('Faculty A', 'Monday', 'B.Tech', 'semester1', 'sectionA');
const sectionBKey = teacherSubjectDayKey('Faculty A', 'Monday', 'B.Tech', 'semester1', 'sectionB');

assert.notEqual(sectionAKey, sectionBKey, 'The same subject can be scheduled on one day for different sections.');
assert.equal(
  sectionAKey,
  teacherSubjectDayKey(' faculty   a ', 'Monday', 'B.Tech', 'semester1', 'sectionA'),
  'Teacher name normalization should preserve same-section duplicate detection.'
);

console.log('Section-scoped weekly subject scheduling checks passed.');
