const assert = require('node:assert/strict');
const {
  buildCollectionDiff,
  mergeAppSettings,
  mergeRecordsById,
  publicAppSettings,
  sanitizeAppSettings,
  snapshotCollection
} = require('./server');

const manageFormLectureCounts = {
  'B.Tech|semester1|main|program|subject|data structures|cs.101': '4',
  'M.Tech|semester2|main|program|subject|research methods|rm.202': 2
};
const manageFormSubjectSelections = {
  'B.Tech|semester1|main|program|subject|data structures|cs.101': false,
  'M.Tech|semester2|main|program|subject|research methods|rm.202': true
};
const sharedLabSubjects = {
  '["B.Tech","semester1","programming"]': true,
  '["code","B.Tech","semester1","cs101"]': true
};
const labTimetable = {
  'Monday.1|Lab.A': { course: 'B.Tech', subject: 'C.S.E.' }
};

const stored = sanitizeAppSettings({
  manageFormLectureCounts,
  manageFormSubjectSelections,
  sharedLabSubjects,
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
assert.deepEqual(publicAppSettings(stored).sharedLabSubjects, sharedLabSubjects);
assert.deepEqual(publicAppSettings(stored).labTimetable, labTimetable);
const sharedLabCatalog = publicAppSettings(sanitizeAppSettings({
  labCatalog: [{
    id: 'LAB-109',
    name: 'Coding',
    subjects: [{ key: 'cocubes-coding', label: 'Cocubes coding Lab', sharedAcrossBatches: true }]
  }]
}));
assert.equal(
  sharedLabCatalog.labCatalog[0].subjects[0].sharedAcrossBatches,
  true,
  'The shared-batch selection should persist on its assigned lab subject.'
);
const sharedLabUpdate = mergeAppSettings(stored, {
  labCatalog: [{ id: 'Lab-A', name: 'Lab A' }],
  sharedLabSubjects: {}
});
assert.deepEqual(
  publicAppSettings(sharedLabUpdate).sharedLabSubjects,
  sharedLabSubjects,
  'Saving ordinary app settings must preserve shared-lab toggles.'
);

const existingRecords = [
  { id: 1, course: 'B.Tech', value: 'unchanged' },
  { id: 2, course: 'M.Tech', value: 'before' }
];
const baseline = snapshotCollection('timetables', existingRecords);
const changedRecords = [
  existingRecords[0],
  { ...existingRecords[1], value: 'after' },
  { id: 3, course: 'BCA', value: 'new' }
];
const changes = buildCollectionDiff('timetables', changedRecords, baseline);
assert.deepEqual(
  changes.operations.map(operation => operation.replaceOne.filter._id),
  [2, 3],
  'Only changed/new records should be written.'
);
assert.deepEqual(changes.removedIds, [], 'Unrelated records must not be deleted.');

const withDeletion = buildCollectionDiff('timetables', [existingRecords[0]], baseline);
assert.deepEqual(withDeletion.removedIds, [2], 'Explicitly removed records should be deleted.');

assert.deepEqual(
  mergeRecordsById(
    [{ id: 'existing', section: 'A', value: 1 }, { id: 'other', section: 'B', value: 2 }],
    [{ id: 'existing', value: 3 }, { id: 'new', section: 'C', value: 4 }]
  ),
  [
    { id: 'existing', section: 'A', value: 3 },
    { id: 'other', section: 'B', value: 2 },
    { id: 'new', section: 'C', value: 4 }
  ],
  'Updating one timetable should preserve other records and merge partial updates.'
);

console.log('Data persistence checks passed.');
