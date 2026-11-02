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
const buildWorkloadRequirements = vm.runInNewContext(
  `(${extractFunction('buildDashboardWorkloadRequirementsBySection')})`,
  { dashboardCourse: 'B.Tech', dashboardTimetableState: { currentSemester: 'semester1' } }
);
const createLabBatchAssignments = vm.runInNewContext(
  `(${extractFunction('createDashboardLabBatchAssignments')})`
);
const canScheduleSessionOnDay = vm.runInNewContext(
  `(${extractFunction('canScheduleDashboardSessionOnDay')})`
);
const hasSameLabBatchAssignments = vm.runInNewContext(
  `(${extractFunction('hasSameDashboardLabBatchAssignments')})`,
  { normalizeSubjectValue: value => String(value || '').trim().toLowerCase(), normalizeTeacherName }
);
const getLabSubjectOptions = vm.runInNewContext(
  `(${extractFunction('getLabSubjectOptions')})`,
  {
    subjectCatalog: [
      { name: 'Programming Lab', isLab: true, course: 'B.Tech', semester: 'semester1' },
      { name: 'Database', isLab: false, labEnabled: true, code: 'CS102', course: 'B.Tech', semester: 'semester2' },
      { name: 'Network Lab', isLab: false, course: 'B.Tech', semester: 'semester3' },
      { name: 'Mathematics', isLab: false, course: 'B.Tech', semester: 'semester1' }
    ],
    subjectIdentity: item => [
      item.course || 'B.Tech',
      item.semester || 'semester1',
      item.isLab ? 'lab' : 'subject',
      String(item.name || '').trim().toLowerCase(),
      String(item.code || '').trim().toLowerCase()
    ].join('|'),
    getManageFormLabName: item => /\blab\b/i.test(item.name) ? item.name : `${item.name} Lab`
  }
);
const getSubjectLabelSet = vm.runInNewContext(
  `(${extractFunction('getSubjectLabelSet')})`,
  {
    normalizeLabSubjectValue: value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    extractSubjectNameAndCodeGlobal: value => {
      const match = String(value || '').match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      return match ? { name: match[1].trim(), code: match[2].trim() } : { name: String(value || '').trim(), code: '' };
    }
  }
);

const sectionAKey = teacherSubjectDayKey('Faculty A', 'Monday', 'B.Tech', 'semester1', 'sectionA');
const sectionBKey = teacherSubjectDayKey('Faculty A', 'Monday', 'B.Tech', 'semester1', 'sectionB');

assert.notEqual(sectionAKey, sectionBKey, 'The same subject can be scheduled on one day for different sections.');
assert.equal(
  sectionAKey,
  teacherSubjectDayKey(' faculty   a ', 'Monday', 'B.Tech', 'semester1', 'sectionA'),
  'Teacher name normalization should preserve same-section duplicate detection.'
);

const requirementsBySection = buildWorkloadRequirements([{
  status: 'submitted',
  course: 'B.Tech',
  semester: 'semester1',
  selectedSubjectIds: ['cs101'],
  selectedSubjects: [{
    id: 'cs101',
    name: 'Programming',
    code: 'CS101',
    isLab: false,
    labEnabled: true,
    lectureCount: 3,
    labCount: 1,
    assignedSections: ['sectionA']
  }],
  facultyName: 'Faculty A'
}]);
assert.deepEqual(
  JSON.parse(JSON.stringify(requirementsBySection.sectionA.map(({ classType, lecturesPerWeek }) => ({ classType, lecturesPerWeek })))),
  [
    { classType: 'Lecture', lecturesPerWeek: 3 },
    { classType: 'Lab', lecturesPerWeek: 1 }
  ],
  'A Lab ON workload should generate both lecture and lab requirements for the assigned section.'
);

const firstLab = { subjectName: 'Programming Lab', subjectCode: 'CS101L', teacher: 'Faculty A' };
const secondLab = { subjectName: 'Database Lab', subjectCode: 'CS102L', teacher: 'Faculty B' };
const firstSession = createLabBatchAssignments(firstLab, secondLab, 0);
const nextSession = createLabBatchAssignments(firstLab, secondLab, 1);
assert.deepEqual(
  JSON.parse(JSON.stringify(firstSession.map(({ batch, subjectCode }) => ({ batch, subjectCode })))),
  [{ batch: 'P1', subjectCode: 'CS101L' }, { batch: 'P2', subjectCode: 'CS102L' }],
  'The first paired lab session should assign the first/second subjects to P1/P2.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(nextSession.map(({ batch, subjectCode }) => ({ batch, subjectCode })))),
  [{ batch: 'P1', subjectCode: 'CS102L' }, { batch: 'P2', subjectCode: 'CS101L' }],
  'The next paired lab session should swap the P1/P2 subjects.'
);
assert.equal(
  hasSameLabBatchAssignments(firstSession, firstSession.map(assignment => ({ ...assignment }))),
  true,
  'The two timetable cells for one paired lab session should be recognized as the same session.'
);
assert.equal(
  hasSameLabBatchAssignments(firstSession, nextSession),
  false,
  'Back-to-back paired lab sessions with swapped batches should count as separate sessions.'
);

const daySessionCounts = new Map([['Monday', 1], ['Tuesday', 2]]);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Monday', 1), false);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Monday', 2), true);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Tuesday', 2), false);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Wednesday', 1), true);

assert.deepEqual(
  JSON.parse(JSON.stringify(getLabSubjectOptions().map(({ name, isLab, code }) => ({ name, isLab, ...(code !== undefined ? { code } : {}) })))),
  [
    { name: 'Programming Lab', isLab: true },
    { name: 'Database', isLab: true, code: 'CS102' },
    { name: 'Network Lab', isLab: true }
  ],
  'Manage Lab should include explicit lab subjects, legacy Lab ON subjects, and subjects named as labs.'
);
assert.equal(
  [...getSubjectLabelSet('Programming Lab')].some(label => getSubjectLabelSet('Programming (CS101)').has(label)),
  true,
  'A workload lab assignment should match its allocated lab even when the saved label includes a Lab suffix.'
);

console.log('Section-scoped workload, lab picker, P1/P2 rotation, and daily fallback checks passed.');
