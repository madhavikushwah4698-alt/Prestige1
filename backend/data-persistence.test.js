const assert = require('node:assert/strict');
const { publicAppSettings, sanitizeAppSettings } = require('./server');

const manageFormLectureCounts = {
  'B.Tech|semester1|main|program|subject|data structures|cs.101': '4',
  'M.Tech|semester2|main|program|subject|research methods|rm.202': 2
};
const manageFormSubjectSelections = {
  'B.Tech|semester1|main|program|subject|data structures|cs.101': false,
  'M.Tech|semester2|main|program|subject|research methods|rm.202': true
};
const labTimetable = {
  'Monday.1|Lab.A': { course: 'B.Tech', subject: 'C.S.E.' }
};

const stored = sanitizeAppSettings({
  manageFormLectureCounts,
  manageFormSubjectSelections,
  labTimetable
});

assert.deepEqual(stored.manageFormLectureCounts, [
  { key: 'B.Tech|semester1|main|program|subject|data structures|cs.101', value: '4' },
  { key: 'M.Tech|semester2|main|program|subject|research methods|rm.202', value: 2 }
]);
assert.deepEqual(stored.manageFormSubjectSelections, [
  { key: 'B.Tech|semester1|main|program|subject|data structures|cs.101', value: false },
  { key: 'M.Tech|semester2|main|program|subject|research methods|rm.202', value: true }
]);
assert.deepEqual(publicAppSettings(stored).manageFormLectureCounts, manageFormLectureCounts);
assert.deepEqual(publicAppSettings(stored).manageFormSubjectSelections, manageFormSubjectSelections);
assert.deepEqual(publicAppSettings(stored).labTimetable, labTimetable);

console.log('Manage Form settings persistence checks passed.');
