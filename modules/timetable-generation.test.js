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

function extractAsyncFunction(name) {
  const match = source.match(new RegExp(`        async function ${name}\\([\\s\\S]*?\\n        }`));
  assert.ok(match, `${name} should exist in app.js`);
  return match[0];
}

const subjectCategoryMatches = vm.runInNewContext(`(${extractFunction('subjectCategoryMatches')})`);
const createLabSubjectEntry = vm.runInNewContext(`(${extractFunction('createLabSubjectEntry')})`);
const subjectIdentity = item => [
  item.course || 'B.Tech',
  item.semester || 'semester1',
  item.category || 'main',
  item.electiveType || 'program',
  item.isLab ? 'lab' : 'subject',
  String(item.name || '').trim().toLowerCase(),
  String(item.code || '').trim().toLowerCase()
].join('|');
const sharedLabSubjectName = vm.runInNewContext(`(${extractFunction('sharedLabSubjectName')})`);
const normalizeSubjectValue = vm.runInNewContext(`(${extractFunction('normalizeSubjectValue')})`);
const getManageWorkloadSubjectDisplayKey = vm.runInNewContext(
  `(${extractFunction('getManageWorkloadSubjectDisplayKey')})`,
  { sharedLabSubjectName, normalizeSubjectValue }
);
const getManageWorkloadSubjectForLabToggle = (subjectCatalog) => vm.runInNewContext(
  `(${extractFunction('getManageWorkloadSubjectForLabToggle')})`,
  { sharedLabSubjectName, normalizeSubjectValue, subjectCatalog }
);
const workloadSubjectWithoutCode = getManageWorkloadSubjectForLabToggle([{
  id: 'cocubes-id',
  name: 'Cocubes Coding Lab',
  code: 'CS-605',
  course: 'B.Tech',
  semester: 'semester6',
  isLab: true
}])({
  id: 'cocubes-id',
  name: 'Cocubes Coding Lab'
}, {
  course: 'B.Tech',
  semester: 'semester6'
});
assert.equal(workloadSubjectWithoutCode.code, 'CS-605',
  'Manage Workload should resolve the subject code from its matching catalog ID before reading toggle state.');
assert.equal(workloadSubjectWithoutCode.isLab, true);
const unmatchedWorkloadSubject = getManageWorkloadSubjectForLabToggle([{
  id: 'different-id',
  name: 'Cocubes Coding Lab',
  code: 'CS-605',
  course: 'B.Tech',
  semester: 'semester6'
}, {
  id: 'another-id',
  name: 'Cocubes Coding Lab',
  code: 'CS-606',
  course: 'B.Tech',
  semester: 'semester6'
}])({
  name: 'Cocubes Coding Lab'
}, {
  course: 'B.Tech',
  semester: 'semester6'
});
assert.equal(unmatchedWorkloadSubject.code, '',
  'A workload item without an ID or code must not inherit an ambiguous same-name catalog entry.');
const sharedLabSubjectKey = vm.runInNewContext(
  `(${extractFunction('sharedLabSubjectKey')})`,
  { sharedLabSubjectName }
);
const sharedLabSubjectCodeKey = vm.runInNewContext(
  `(${extractFunction('sharedLabSubjectCodeKey')})`
);
const workloadBadgeState = vm.runInNewContext(
  `(() => {
    ${extractFunction('getManageWorkloadSubjectDisplayKey')};
    ${extractFunction('getManageWorkloadSubjectForLabToggle')};
    ${extractFunction('isSharedLabSubject')};
    ${extractFunction('isManageLabToggleEnabled')};
    ${extractFunction('getManageWorkloadSubjectGroups')};
    return getManageWorkloadSubjectGroups()[0].individualLab;
  })()`,
  {
    document: {
      getElementById: id => ({ value: id === 'manage-workload-course' ? 'B.Tech' : 'semester6' }),
      querySelectorAll: () => []
    },
    manageWorkloadForms: [{
      course: 'B.Tech',
      semester: 'semester6',
      subjects: [{ id: 'cocubes-id', name: 'Cocubes Coding Lab', isLab: true, labCount: 1 }]
    }],
    subjectCatalog: [{
      id: 'cocubes-id',
      name: 'Cocubes Coding Lab',
      code: 'CS-605',
      course: 'B.Tech',
      semester: 'semester6',
      isLab: true
    }],
    sharedLabSubjects: {
      [sharedLabSubjectCodeKey({
        name: 'Cocubes Coding Lab',
        code: 'CS-605',
        course: 'B.Tech',
        semester: 'semester6'
      })]: true
    },
    sharedLabSubjectName,
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    normalizeSubjectValue
  }
);
assert.equal(workloadBadgeState, true,
  'Manage Workload must show an enabled individual-lab state when its subject code is resolved from the catalog.');
const normalizeSharedLabSubjectSettings = vm.runInNewContext(
  `(${extractFunction('normalizeSharedLabSubjectSettings')})`,
  { sharedLabSubjectName }
);
const scopedCocubesKey = JSON.stringify(['B.Tech', 'semester1', 'cocubes coding']);
const pendingSharedLabSettingsStorage = new Map();
const pendingSharedLabSettings = vm.runInNewContext(
  `(() => {
    ${extractFunction('saveSharedLabSubjectsLocally')};
    ${extractFunction('readSavedSharedLabSubjects')};
    return { saveSharedLabSubjectsLocally, readSavedSharedLabSubjects };
  })()`,
  {
    localStorage: {
      getItem: key => pendingSharedLabSettingsStorage.has(key) ? pendingSharedLabSettingsStorage.get(key) : null,
      setItem: (key, value) => pendingSharedLabSettingsStorage.set(key, value)
    },
    SHARED_LAB_SUBJECTS_STORAGE_KEY: 'shared-labs',
    PENDING_SHARED_LAB_SUBJECTS_STORAGE_KEY: 'pending-shared-labs',
    normalizeSharedLabSubjectSettings
  }
);
assert.equal(pendingSharedLabSettings.saveSharedLabSubjectsLocally({ [scopedCocubesKey]: true }), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(pendingSharedLabSettings.readSavedSharedLabSubjects())),
  { [scopedCocubesKey]: true },
  'An enabled shared-lab toggle should be stored in this browser.'
);
assert.equal(pendingSharedLabSettingsStorage.has('shared-labs'), true,
  'Shared lab settings should use persistent browser storage, not only a pending-sync value.');
assert.equal(pendingSharedLabSettings.saveSharedLabSubjectsLocally({ [scopedCocubesKey]: true }), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(pendingSharedLabSettings.readSavedSharedLabSubjects())),
  { [scopedCocubesKey]: true },
  'A successfully saved shared-lab toggle should remain enabled in browser storage across reloads.'
);
assert.equal(pendingSharedLabSettings.saveSharedLabSubjectsLocally({}), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(pendingSharedLabSettings.readSavedSharedLabSubjects())),
  {},
  'An explicitly disabled shared-lab toggle should remain disabled in browser storage.'
);
const addLabSubject = {
  name: 'Cocubes Coding Lab',
  code: 'CS-605',
  course: 'B.Tech',
  semester: 'semester6',
  isLab: true
};
const addLabToggleKeys = {
  name: sharedLabSubjectKey(addLabSubject),
  code: sharedLabSubjectCodeKey(addLabSubject)
};
const addLabToggleControls = [{
  dataset: {
    sharedLabSubject: addLabToggleKeys.name,
    sharedLabCode: addLabToggleKeys.code
  },
  checked: true
}];
const getAddLabToggleSettings = vm.runInNewContext(
  `(${extractFunction('getSelectedManageLabToggleSettings')})`,
  {
    sharedLabSubjects: {},
    subjectIdentity,
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    document: { querySelectorAll: () => addLabToggleControls }
  }
);
const persistedAddLabToggle = getAddLabToggleSettings(
  [subjectIdentity(addLabSubject)],
  [addLabSubject]
);
assert.equal(persistedAddLabToggle[addLabToggleKeys.name], true);
assert.equal(persistedAddLabToggle[addLabToggleKeys.code], true,
  'Adding a selected toggle-on lab must persist individual mode for its scoped subject code and name.');
addLabToggleControls[0].checked = false;
assert.deepEqual(
  JSON.parse(JSON.stringify(getAddLabToggleSettings(
    [subjectIdentity(addLabSubject)],
    [addLabSubject]
  ))),
  {},
  'Adding a selected toggle-off lab must preserve the default P1/P2-paired mode.');
const sharedLabKey = sharedLabSubjectKey({
  name: 'Programming',
  code: 'CS101',
  course: 'B.Tech',
  semester: 'semester1',
  isLab: true
});
assert.equal(sharedLabKey, sharedLabSubjectKey({
  name: 'Programming Lab',
  code: 'CS101L',
  course: 'B.Tech',
  semester: 'semester1',
  category: 'elective',
  electiveType: 'open',
  isLab: true
}));
assert.equal(sharedLabSubjectKey({
  name: 'Cocubes Coding (CS-605)',
  code: 'CS-605'
}), sharedLabSubjectKey({
  name: 'Cocubes coding Lab',
  code: 'CS-605'
}), 'The Manage Lab toggle should match workload names that include a code in parentheses.');
assert.equal(sharedLabSubjectKey({
  name: 'Cocubes Coding (CS-605) Lab'
}), sharedLabSubjectKey({
  name: 'Cocubes Coding Lab'
}), 'The Manage Lab toggle should match workload names with a code before the Lab suffix.');
const migratedSharedLabSettings = normalizeSharedLabSubjectSettings({
  'B.Tech|semester6|main|program|lab|minor project-2|': true
});
assert.deepEqual(
  JSON.parse(JSON.stringify(migratedSharedLabSettings)),
  { [JSON.stringify(['B.Tech', 'semester6', 'minor project-2'])]: true },
  'Previously saved shared-lab toggles should migrate to course/semester-scoped keys.'
);
const migratedLegacyNameSetting = vm.runInNewContext(
  `(${extractFunction('normalizeSharedLabSubjectSettings')})`,
  {
    sharedLabSubjectName,
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    subjectCatalog: [
      { name: 'Cocubes Coding Lab', code: 'CS-605', course: 'B.Tech', semester: 'semester6' },
      { name: 'Cocubes Coding Lab', code: 'CS-605', course: 'M.Tech', semester: 'semester2' }
    ]
  }
)({ '["cocubes coding"]': true });
assert.deepEqual(
  JSON.parse(JSON.stringify(migratedLegacyNameSetting)),
  {},
  'A legacy global toggle must not be copied to unrelated course/semester contexts.'
);
const migratedUniqueLegacyNameSetting = vm.runInNewContext(
  `(${extractFunction('normalizeSharedLabSubjectSettings')})`,
  {
    sharedLabSubjectName,
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    subjectCatalog: [
      { name: 'Cocubes Coding Lab', code: 'CS-605', course: 'B.Tech', semester: 'semester6' }
    ]
  }
)({ '["cocubes coding"]': true });
assert.deepEqual(
  JSON.parse(JSON.stringify(migratedUniqueLegacyNameSetting)),
  {
    [JSON.stringify(['B.Tech', 'semester6', 'cocubes coding'])]: true,
    [JSON.stringify(['code', 'B.Tech', 'semester6', 'cs-605'])]: true
  },
  'An unambiguous legacy toggle should migrate to both scoped subject-name and code keys.'
);
const isSharedLabSubject = vm.runInNewContext(
  `(${extractFunction('isSharedLabSubject')})`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    sharedLabSubjectName,
    localStorage: undefined,
    sharedLabSubjects: { ...migratedSharedLabSettings, [sharedLabKey]: true }
  }
);
const isSharedLabSubjectFromBrowserStorage = vm.runInNewContext(
  `(() => {
    ${extractFunction('isSharedLabSubject')};
    ${extractFunction('readSavedSharedLabSubjects')};
    return isSharedLabSubject;
  })()`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    sharedLabSubjects: {},
    SHARED_LAB_SUBJECTS_STORAGE_KEY: 'shared-labs',
    PENDING_SHARED_LAB_SUBJECTS_STORAGE_KEY: 'pending-shared-labs',
    localStorage: {
      getItem: key => key === 'shared-labs' ? JSON.stringify({ [sharedLabKey]: true }) : null
    },
    normalizeSharedLabSubjectSettings,
    sharedLabSubjectName
  }
);
assert.equal(isSharedLabSubjectFromBrowserStorage({
  name: 'Programming Lab',
  code: 'CS101L'
}), true, 'Previously saved shared-lab settings should be honored from persistent browser storage.');
const restoredLabSettings = vm.runInNewContext(
  `(() => {
    let sharedLabSubjects = {};
    ${extractFunction('restoreSavedSharedLabSubjects')};
    ${extractFunction('readSavedSharedLabSubjects')};
    return {
      restoreSavedSharedLabSubjects,
      get sharedLabSubjects() { return sharedLabSubjects; }
    };
  })()`,
  {
    SHARED_LAB_SUBJECTS_STORAGE_KEY: 'shared-labs',
    PENDING_SHARED_LAB_SUBJECTS_STORAGE_KEY: 'pending-shared-labs',
    localStorage: {
      getItem: key => key === 'shared-labs' ? JSON.stringify({ [sharedLabKey]: true }) : null
    },
    normalizeSharedLabSubjectSettings,
    sharedLabSubjectName
  }
);
assert.equal(restoredLabSettings.restoreSavedSharedLabSubjects(), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(restoredLabSettings.sharedLabSubjects)),
  { [sharedLabKey]: true },
  'Saved shared-lab settings should be restored into the active generation settings.'
);
const authoritativeDatabaseSettings = vm.runInNewContext(
  `(() => { ${extractFunction('readSavedSharedLabSubjects')}; return readSavedSharedLabSubjects(); })()`,
  {
    SHARED_LAB_SUBJECTS_STORAGE_KEY: 'shared-labs',
    PENDING_SHARED_LAB_SUBJECTS_STORAGE_KEY: 'pending-shared-labs',
    appSettingsLoaded: true,
    apiToken: 'admin-session',
    apiRole: 'admin',
    localStorage: {
      getItem: key => key === 'shared-labs' ? JSON.stringify({}) : null
    },
    normalizeSharedLabSubjectSettings,
    sharedLabSubjectName
  }
);
assert.equal(authoritativeDatabaseSettings, null,
  'A stale browser cache should not override loaded database settings for an admin.');
const databaseSharedSettingSurvivesEmptyCache = vm.runInNewContext(
  `(() => { ${extractFunction('isSharedLabSubject')}; ${extractFunction('readSavedSharedLabSubjects')}; return isSharedLabSubject; })()`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    sharedLabSubjects: { [sharedLabSubjectKey({ name: 'Cocubes Coding Lab', code: 'CS-605' })]: true },
    SHARED_LAB_SUBJECTS_STORAGE_KEY: 'shared-labs',
    PENDING_SHARED_LAB_SUBJECTS_STORAGE_KEY: 'pending-shared-labs',
    appSettingsLoaded: true,
    apiToken: 'admin-session',
    apiRole: 'admin',
    localStorage: {
      getItem: key => key === 'shared-labs' ? JSON.stringify({}) : null
    },
    normalizeSharedLabSubjectSettings,
    sharedLabSubjectName
  }
);
assert.equal(databaseSharedSettingSurvivesEmptyCache({ name: 'Cocubes Coding Lab', code: 'CS-605' }), true,
  'An empty old browser cache should not mask an enabled database toggle.');
const isSharedLabSubjectByCode = vm.runInNewContext(
  `(${extractFunction('isSharedLabSubject')})`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    localStorage: undefined,
    sharedLabSubjects: {
      [sharedLabSubjectCodeKey({ name: 'Cocubes coding', code: 'CS-605', course: 'B.Tech', semester: 'semester6' })]: true
    }
  }
);
assert.equal(isSharedLabSubjectByCode({
  name: 'Cocubes Coding Lab',
  code: 'CS-605',
  course: 'B.Tech',
  semester: 'semester6'
}), true, 'A toggle should match its workload lab by subject code when the names differ.');
const isSharedLabSubjectWithDuplicateNames = vm.runInNewContext(
  `(() => { ${extractFunction('isSharedLabSubject')}; return isSharedLabSubject; })()`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    sharedLabSubjectName,
    localStorage: undefined,
    subjectCatalog: [
      { name: 'Project Lab', code: 'CS-605', course: 'B.Tech', semester: 'semester6' },
      { name: 'Project Lab', code: 'CS-606', course: 'B.Tech', semester: 'semester6' }
    ],
    sharedLabSubjects: {
      [sharedLabSubjectKey({ name: 'Project Lab', course: 'B.Tech', semester: 'semester6' })]: true,
      [sharedLabSubjectCodeKey({ name: 'Project Lab', code: 'CS-605', course: 'B.Tech', semester: 'semester6' })]: true
    }
  }
);
assert.equal(isSharedLabSubjectWithDuplicateNames({
  name: 'Project Lab',
  code: 'CS-605',
  course: 'B.Tech',
  semester: 'semester6'
}), true);
assert.equal(isSharedLabSubjectWithDuplicateNames({
  name: 'Project Lab',
  code: 'CS-606',
  course: 'B.Tech',
  semester: 'semester6'
}), false, 'A same-name subject with a different code must not inherit another subject toggle.');
const isSharedLabSubjectByDecoratedName = vm.runInNewContext(
  `(${extractFunction('isSharedLabSubject')})`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    localStorage: undefined,
    sharedLabSubjects: {
      [sharedLabSubjectKey({ name: 'Cocubes Coding (CS-605)', course: 'B.Tech', semester: 'semester6' })]: true
    }
  }
);
assert.equal(isSharedLabSubjectByDecoratedName({
  name: 'Cocubes Coding Lab',
  course: 'B.Tech',
  semester: 'semester6'
}), true, 'A code-decorated toggle name should match the same workload subject without the code.');
const createManageLabToggleChecker = (savedSettingsChecker, toggles = []) => vm.runInNewContext(
  `(${extractFunction('isManageLabToggleEnabled')})`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    document: { querySelectorAll: () => toggles },
    isSharedLabSubject: savedSettingsChecker
  }
);
const isNotSavedSharedLabSubject = vm.runInNewContext(
  `(${extractFunction('isSharedLabSubject')})`,
  { sharedLabSubjectKey, sharedLabSubjectCodeKey, localStorage: undefined, sharedLabSubjects: {} }
);
const cocubesManageLabToggle = {
  dataset: {
    sharedLabSubject: sharedLabSubjectKey({ name: 'Cocubes Coding (CS-605) Lab', course: 'B.Tech', semester: 'semester6' }),
    sharedLabCode: '',
    sharedLabCourse: 'B.Tech',
    sharedLabSemester: 'semester6'
  },
  checked: true
};
const isManageLabToggleEnabledFromUi = createManageLabToggleChecker(
  isNotSavedSharedLabSubject,
  [cocubesManageLabToggle]
);
assert.equal(isManageLabToggleEnabledFromUi({
  name: 'Cocubes Coding Lab',
  course: 'B.Tech',
  semester: 'semester6'
}), true,
  'Workload generation should honor the checked Manage Lab control even if saved settings are stale.');
assert.equal(isManageLabToggleEnabledFromUi({
  subjectName: 'Cocubes Coding',
  subjectCode: 'CS-605',
  course: 'B.Tech',
  semester: 'semester6'
}), true,
  'The generation-time subjectName/subjectCode shape should still match the Manage Lab toggle.');
const isManageLabToggleEnabled = createManageLabToggleChecker(isSharedLabSubject);
const isManageLabToggleEnabledByCode = createManageLabToggleChecker(isSharedLabSubjectByCode);
const isManageLabToggleEnabledByDecoratedName = createManageLabToggleChecker(isSharedLabSubjectByDecoratedName);
const buildDecoratedNameWorkloadRequirements = vm.runInNewContext(
  `(${extractFunction('buildDashboardWorkloadRequirementsBySection')})`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester6' },
    isManageLabToggleEnabled: isManageLabToggleEnabledByDecoratedName
  }
);
const buildUiToggleWorkloadRequirements = vm.runInNewContext(
  `(${extractFunction('buildDashboardWorkloadRequirementsBySection')})`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester6' },
    isManageLabToggleEnabled: isManageLabToggleEnabledFromUi
  }
);
assert.equal(buildUiToggleWorkloadRequirements([{
  status: 'submitted',
  course: 'B.Tech',
  semester: 'semester6',
  selectedSubjectIds: ['cocubes'],
  selectedSubjects: [{
    id: 'cocubes',
    name: 'Cocubes Coding (CS-605) Lab',
    isLab: true,
    labCount: 1,
    assignedSections: ['sectionA']
  }],
  facultyName: 'Faculty A'
}]).sectionA[0].individualLab, true,
'The checked Manage Lab switch should mark the lab as an individual session.');
cocubesManageLabToggle.checked = false;
assert.equal(isManageLabToggleEnabledFromUi({
  name: 'Cocubes Coding Lab',
  course: 'B.Tech',
  semester: 'semester6'
}), false,
  'An unchecked Manage Lab control should disable individual-lab mode even if a saved setting was on.');
const semesterToggleChecker = createManageLabToggleChecker(isNotSavedSharedLabSubject, [
  {
    dataset: {
      sharedLabSubject: sharedLabSubjectKey({ name: 'Cocubes Coding Lab', course: 'B.Tech', semester: 'semester5' }),
      sharedLabCode: '',
      sharedLabCourse: 'B.Tech',
      sharedLabSemester: 'semester5'
    },
    checked: false
  },
  {
    dataset: {
      sharedLabSubject: sharedLabSubjectKey({ name: 'Cocubes Coding Lab', course: 'B.Tech', semester: 'semester6' }),
      sharedLabCode: '',
      sharedLabCourse: 'B.Tech',
      sharedLabSemester: 'semester6'
    },
    checked: true
  }
]);
assert.equal(semesterToggleChecker({
  name: 'Cocubes Coding Lab',
  course: 'B.Tech',
  semester: 'semester6'
}), true, 'A toggle in another semester must not override the selected semester toggle.');
assert.equal(buildDecoratedNameWorkloadRequirements([{
  status: 'submitted',
  course: 'B.Tech',
  semester: 'semester6',
  selectedSubjectIds: ['cocubes'],
  selectedSubjects: [{
    id: 'cocubes',
    name: 'Cocubes Coding Lab',
    isLab: true,
    labCount: 1,
    assignedSections: ['sectionA']
  }],
  facultyName: 'Faculty A'
}]).sectionA[0].individualLab, true,
'A Manage Lab toggle with a code-decorated name should mark the generated lab requirement as individual.');
const decoratedCodeWorkloadRequirements = buildDecoratedNameWorkloadRequirements([{
  status: 'submitted',
  course: 'B.Tech',
  semester: 'semester6',
  selectedSubjectIds: ['cocubes'],
  selectedSubjects: [{
    id: 'cocubes',
    name: 'Cocubes Coding (CS-605) Lab',
    isLab: true,
    labCount: 1,
    assignedSections: ['sectionA']
  }],
  facultyName: 'Faculty A'
}]).sectionA;
assert.equal(decoratedCodeWorkloadRequirements[0].individualLab, true);
assert.equal(decoratedCodeWorkloadRequirements[0].sharedAcrossBatches, false);
assert.equal(isSharedLabSubject({
  name: 'Minor Project-2',
  code: 'CS-608',
  category: 'placement',
  course: 'B.Tech',
  semester: 'semester6',
  isLab: false
}), true, 'A toggle on a lab-catalog entry must also match its workload subject with different metadata.');
assert.equal(isSharedLabSubject({
  name: 'Minor Project-2',
  code: 'CS-608',
  course: 'M.Tech',
  semester: 'semester1',
  isLab: true
}), false, 'A saved shared-lab toggle must not leak into unrelated courses or semesters.');
const normalizeTeacherName = vm.runInNewContext(`(${extractFunction('normalizeTeacherName')})`);
const getDashboardSlotAssignments = vm.runInNewContext(
  `(${extractFunction('getDashboardSlotAssignments')})`,
  { normalizeSubjectValue: value => String(value || '').trim().toLowerCase(), normalizeTeacherName, normalizeLabSubjectValue: value => String(value || '').trim().toLowerCase(), sharedLabSubjectName }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(getDashboardSlotAssignments({
    subject: 'Programming Lab',
    subjectName: 'Programming Lab',
    teacher: 'Faculty A',
    classType: 'Lab',
    sharedAcrossBatches: true
  }))),
  [{
    subject: 'Programming Lab',
    subjectName: 'Programming Lab',
    subjectCode: '',
    teacher: 'Faculty A',
    room: '',
    sharedAcrossBatches: true,
    classType: 'Lab'
  }],
  'A shared lab timetable entry should retain its P1/P2 scope as one assignment.'
);
const sharedSlotAssignments = vm.runInNewContext(
  `(${extractFunction('getDashboardSlotAssignments')})`,
  {
    normalizeSubjectValue: value => String(value || '').trim().toLowerCase(),
    normalizeTeacherName,
    normalizeLabSubjectValue: value => String(value || '').trim().toLowerCase(),
    sharedLabSubjectName
  }
)({
  sharedAcrossBatches: true,
  batchAssignments: [
    { batch: 'P1', subject: 'Cocubes Coding Lab (CS-605)', subjectName: 'Cocubes Coding Lab', subjectCode: 'CS-605', teacher: 'Faculty A', room: 'Lab 1', classType: 'Lab' },
    { batch: 'P2', subject: 'Cocubes Coding Lab (CS-605)', subjectName: 'Cocubes Coding Lab', subjectCode: 'CS-605', teacher: 'Faculty A', room: 'Lab 1', classType: 'Lab' }
  ]
});
assert.equal(sharedSlotAssignments.length, 1, 'A shared P1/P2 session should be exposed as one assignment to views and conflict checks.');
assert.equal(sharedSlotAssignments[0].batch, 'P1 + P2');
const teacherSubjectDayKey = vm.runInNewContext(
  `(${extractFunction('dashboardTeacherSubjectDayKey')})`,
  { normalizeTeacherName }
);
const buildWorkloadRequirements = vm.runInNewContext(
  `(${extractFunction('buildDashboardWorkloadRequirementsBySection')})`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester1' },
    isManageLabToggleEnabled
  }
);
const buildSemesterSixWorkloadRequirements = vm.runInNewContext(
  `(${extractFunction('buildDashboardWorkloadRequirementsBySection')})`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester6' },
    isManageLabToggleEnabled
  }
);
const buildCodeMatchedWorkloadRequirements = vm.runInNewContext(
  `(${extractFunction('buildDashboardWorkloadRequirementsBySection')})`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester6' },
    subjectCatalog: [{ id: 'cocubes-lab', name: 'Cocubes Coding Lab', code: 'CS-605' }],
    subjectIdentity: item => item.id,
    isManageLabToggleEnabled: isManageLabToggleEnabledByCode
  }
);
const canScheduleSessionOnDay = vm.runInNewContext(
  `(${extractFunction('canScheduleDashboardSessionOnDay')})`
);
const partitionDashboardLabRequirements = vm.runInNewContext(
  `(${extractFunction('partitionDashboardLabRequirements')})`
);
const sameDashboardLabSubject = vm.runInNewContext(
  `(() => {
    ${extractFunction('hasAmbiguousDashboardLabSubjectName')};
    return (${extractFunction('sameDashboardLabSubject')});
  })()`,
  {
    normalizeSubjectValue: value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' '),
    sharedLabSubjectName
  }
);
assert.equal(sameDashboardLabSubject(
  { subjectName: 'Project Lab', subjectCode: 'CS-605' },
  { subjectName: 'Project Lab', subjectCode: 'CS-606' }
), false, 'Different coded subjects must never be merged into one shared workload requirement.');
const mergeAmbiguousNameRequirements = vm.runInNewContext(
  `(() => {
    ${extractFunction('hasAmbiguousDashboardLabSubjectName')};
    ${extractFunction('sameDashboardLabSubject')};
    ${extractFunction('mergeSharedDashboardLabRequirements')};
    return mergeSharedDashboardLabRequirements;
  })()`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester6', currentSection: 'sectionA' },
    normalizeSubjectValue: value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' '),
    normalizeTeacherName,
    sharedLabSubjectName,
    subjectCatalog: [
      { name: 'Project Lab', code: 'CS-605', course: 'B.Tech', semester: 'semester6' },
      { name: 'Project Lab', code: 'CS-606', course: 'B.Tech', semester: 'semester6' }
    ]
  }
);
assert.equal(mergeAmbiguousNameRequirements([
  { subjectName: 'Project Lab', teacher: 'Faculty A', course: 'B.Tech', semester: 'semester6', section: 'sectionA', sharedAcrossBatches: true },
  { subjectName: 'Project Lab', teacher: 'Faculty A', course: 'B.Tech', semester: 'semester6', section: 'sectionA', sharedAcrossBatches: true }
]).requirements.length, 2,
'Code-less requirements with an ambiguous same-name catalog entry must not be coalesced.');
const mergeSharedDashboardLabRequirements = vm.runInNewContext(
  `(${extractFunction('mergeSharedDashboardLabRequirements')})`,
  {
    dashboardCourse: 'B.Tech',
    dashboardTimetableState: { currentSemester: 'semester6', currentSection: 'sectionA' },
    normalizeSubjectValue: value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' '),
    normalizeTeacherName,
    sameDashboardLabSubject,
    sharedLabSubjectName
  }
);
const duplicatedCombinedRequirements = mergeSharedDashboardLabRequirements([
  {
    subjectName: 'Cocubes Coding Lab',
    subjectCode: 'CS-605',
    teacher: 'Faculty A',
    course: 'B.Tech',
    semester: 'semester6',
    section: 'sectionA',
    classType: 'Lab',
    lecturesPerWeek: 1,
    sharedAcrossBatches: true
  },
  {
    subjectName: 'Cocubes Coding (CS-605)',
    subjectCode: 'CS-605',
    teacher: ' faculty   a ',
    course: 'B.Tech',
    semester: 'semester6',
    section: 'sectionA',
    classType: 'Lab',
    lecturesPerWeek: 2,
    sharedAcrossBatches: true
  },
  {
    subjectName: 'Cocubes Coding Lab',
    subjectCode: 'CS-605',
    teacher: 'Faculty A',
    course: 'B.Tech',
    semester: 'semester6',
    section: 'sectionB',
    classType: 'Lab',
    lecturesPerWeek: 1,
    sharedAcrossBatches: true
  }
]);
assert.equal(duplicatedCombinedRequirements.requirements.length, 2,
  'Same-subject P1/P2 workload entries should merge once per section, not across sections.');
assert.deepEqual(
  JSON.parse(JSON.stringify(duplicatedCombinedRequirements.requirements.map(({ section, lecturesPerWeek }) => ({ section, lecturesPerWeek })))),
  [{ section: 'sectionA', lecturesPerWeek: 2 }, { section: 'sectionB', lecturesPerWeek: 1 }],
  'Duplicate shared workload counts should use the larger weekly count instead of scheduling both copies.'
);
const conflictingCombinedRequirements = mergeSharedDashboardLabRequirements([
  { subjectName: 'Cocubes Coding Lab', subjectCode: 'CS-605', teacher: 'Faculty A', section: 'sectionA', sharedAcrossBatches: true },
  { subjectName: 'Cocubes Coding Lab', subjectCode: 'CS-605', teacher: 'Faculty B', section: 'sectionA', sharedAcrossBatches: true }
]);
assert.equal(conflictingCombinedRequirements.requirements.length, 0,
  'A combined session must not silently choose between different workload teachers.');
assert.equal(conflictingCombinedRequirements.conflicts.length, 1);
const separateBatchRequirements = mergeSharedDashboardLabRequirements([
  { subjectName: 'Project Lab', subjectCode: 'CS-605', teacher: 'Faculty A', section: 'sectionA', sharedAcrossBatches: false },
  { subjectName: 'Project Lab', subjectCode: 'CS-606', teacher: 'Faculty B', section: 'sectionA', sharedAcrossBatches: false }
]);
assert.equal(separateBatchRequirements.requirements.length, 2,
  'Toggle-off requirements remain separate before the P1/P2 pairing step.');
const createSharedLabBatchAssignments = vm.runInNewContext(
  `(${extractFunction('createDashboardSharedLabBatchAssignments')})`
);
assert.deepEqual(
  JSON.parse(JSON.stringify(createSharedLabBatchAssignments({
    subjectName: 'Cocubes Coding Lab',
    subjectCode: 'CS-605',
    teacher: 'Faculty A'
  }).map(({ batch, subject, teacher, sharedAcrossBatches }) => ({
    batch,
    subject,
    teacher,
    sharedAcrossBatches
  })))),
  [
    { batch: 'P1', subject: 'Cocubes Coding Lab (CS-605)', teacher: 'Faculty A', sharedAcrossBatches: true },
    { batch: 'P2', subject: 'Cocubes Coding Lab (CS-605)', teacher: 'Faculty A', sharedAcrossBatches: true }
  ],
  'One shared physical session must retain explicit P1 and P2 internal attendance records.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify((() => {
    const groups = partitionDashboardLabRequirements(decoratedCodeWorkloadRequirements.concat([{
      classType: 'Lab',
      subjectName: 'Minor Project-2',
      subjectCode: 'CS-608',
      teacher: 'Faculty B',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    }]));
    return {
      shared: groups.shared.map(requirement => requirement.subjectName),
      individual: groups.individual.map(requirement => requirement.subjectName),
      pairable: groups.pairable.map(requirement => requirement.subjectName)
    };
  })())),
  {
  shared: [],
  individual: ['Cocubes Coding (CS-605) Lab'],
  pairable: ['Minor Project-2']
  },
  'A code-decorated Cocubes toggle-on lab should be classified as individual and remain separate from other labs.'
);
let staleBatchSlots = {};
let staleBatchSchedule = {};
const clearStaleLabBatchAssignments = vm.runInNewContext(
  `(${extractFunction('clearStaleDashboardLabBatchAssignments')})`,
  {
    dashboardTimetableState: { currentSemester: 'semester6', currentSection: 'sectionA' },
    dashboardCourse: 'B.Tech',
    getDashboardTimetableSlotData: () => staleBatchSlots,
    setDashboardScheduleCellValue: (course, semester, section, day, slotIndex, value) => {
      staleBatchSchedule[`${semester}|${section}|${day}|${slotIndex}`] = value;
    },
    normalizeTeacherName,
    normalizeSubjectValue: value => String(value || '').trim().toLowerCase(),
    sharedLabSubjectName,
    sameDashboardLabSubject
  }
);
const getManageWorkloadLabSubjects = vm.runInNewContext(
  `(${extractFunction('getManageWorkloadLabSubjects')})`
);
assert.doesNotMatch(extractFunction('renderManageWorkloadSubjects'), /Lab batch rotation/,
  'Manage Workload should not show labs paired through batch rotation.');
assert.match(extractFunction('renderManageWorkloadSubjects'), /Individual lab · no P1\/P2/,
  'Manage Workload should label toggle-on labs as individual sessions without P1/P2.');
assert.match(extractFunction('renderManageWorkloadSubjects'), /P1\/P2 paired by default/,
  'Manage Workload should explain the default pairing for toggle-off lab subjects.');
const getLabSubjectOptions = vm.runInNewContext(
  `(${extractFunction('getLabSubjectOptions')})`,
  {
    subjectCatalog: [
      { name: 'Programming Lab', code: 'CS101', isLab: true, course: 'B.Tech', semester: 'semester1' },
      { name: 'Programming', code: 'CS101', isLab: false, labEnabled: true, course: 'B.Tech', semester: 'semester1', category: 'main' },
      { name: 'Programming', code: 'CS103', isLab: false, labEnabled: true, course: 'B.Tech', semester: 'semester1', category: 'main' },
      { name: 'Programming Lab', isLab: true, course: 'B.Tech', semester: 'semester1', category: 'elective', electiveType: 'open' },
      { name: 'Database', isLab: false, labEnabled: true, code: 'CS102', course: 'B.Tech', semester: 'semester2' },
      { name: 'Network Lab', isLab: false, course: 'B.Tech', semester: 'semester3' },
      { name: 'Mathematics', isLab: false, course: 'B.Tech', semester: 'semester1' }
    ],
    normalizeSubjectValue: value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' '),
    sharedLabSubjectKey,
    sharedLabSubjectName,
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
assert.doesNotMatch(
  extractFunction('renderManageLabSubjects'),
  /removed shared-lab toggle/,
  'Manage Lab should render the persisted combined-lab toggle without stale removal messaging.'
);
assert.match(extractFunction('renderManageLabSubjects'), /data-shared-lab-subject/,
  'Each Manage Lab subject should expose a combined-lab control.');
assert.match(extractFunction('renderManageLabSubjects'), /Individual lab \(no P1\/P2\)/,
  'Manage Lab should describe a checked subject toggle as individual lab mode.');
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

assert.equal(subjectCategoryMatches({ category: 'elective', electiveType: 'open' }, 'elective', 'open'), true);
assert.equal(subjectCategoryMatches({ category: 'elective', electiveType: 'program' }, 'elective', 'open'), false);
assert.equal(subjectCategoryMatches({ category: 'main' }, 'elective', 'program'), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(createLabSubjectEntry(
    { category: 'elective', electiveType: 'open' },
    'Cloud Computing Lab',
    'B.Tech',
    'semester8'
  ))),
  {
    name: 'Cloud Computing Lab',
    code: '',
    isLab: true,
    course: 'B.Tech',
    semester: 'semester8',
    category: 'elective',
    electiveType: 'open'
  },
  'A Lab ON entry should keep the source subject category and elective type.'
);
assert.equal(
  getManageWorkloadSubjectDisplayKey({ name: 'Cocube Coding', category: 'main', course: 'B.Tech', semester: 'semester1' }),
  getManageWorkloadSubjectDisplayKey({ name: 'Cocube Coding Lab', category: 'main', course: 'B.Tech', semester: 'semester1', isLab: true }),
  'A subject and its Lab entry should share one Manage Workload display group.'
);
assert.equal(
  getManageWorkloadSubjectDisplayKey({ name: 'Cocube Coding Lab', category: 'elective', electiveType: 'open', course: 'B.Tech', semester: 'semester1' }),
  getManageWorkloadSubjectDisplayKey({ name: 'Cocube Coding', category: 'main', course: 'B.Tech', semester: 'semester1' }),
  'Same-named subject and lab records should share one Manage Workload display group even if category metadata differs.'
);
assert.notEqual(
  getManageWorkloadSubjectDisplayKey({ name: 'Cocube Coding', course: 'B.Tech', semester: 'semester1' }),
  getManageWorkloadSubjectDisplayKey({ name: 'Cocube Coding', course: 'B.Tech', semester: 'semester2' }),
  'Subjects from different semesters should remain separate.'
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
const sharedRequirementsBySection = buildWorkloadRequirements([{
  status: 'submitted',
  course: 'B.Tech',
  semester: 'semester1',
  selectedSubjectIds: ['cs101'],
  selectedSubjects: [{
    id: 'cs101',
    name: 'Programming',
    code: 'CS101',
    labEnabled: true,
    lectureCount: 3,
    labCount: 1,
    assignedSections: ['sectionA']
  }],
  facultyName: 'Faculty A'
}]);
assert.equal(sharedRequirementsBySection.sectionA[1].individualLab, true);
assert.equal(sharedRequirementsBySection.sectionA[1].sharedAcrossBatches, false);
const semesterSixLabRequirements = buildSemesterSixWorkloadRequirements([
  {
    status: 'submitted',
    course: 'B.Tech',
    semester: 'semester6',
    selectedSubjectIds: ['minor-project'],
    selectedSubjects: [{
      id: 'minor-project',
      name: 'Minor Project-2',
      code: 'CS-608',
      labEnabled: true,
      labCount: 1,
      assignedSections: ['sectionA']
    }],
    facultyName: 'Faculty A'
  },
  ...['Machine Learning', 'Computer Networks'].map((name, index) => ({
    status: 'submitted',
    course: 'B.Tech',
    semester: 'semester6',
    selectedSubjectIds: [`regular-${index}`],
    selectedSubjects: [{
      id: `regular-${index}`,
      name,
      labEnabled: true,
      labCount: 1,
      assignedSections: ['sectionA']
    }],
    facultyName: `Faculty ${index + 1}`
  }))
]).sectionA;
assert.deepEqual(
  JSON.parse(JSON.stringify(semesterSixLabRequirements.map(({ subjectName, individualLab, sharedAcrossBatches }) => ({
    subjectName,
    individualLab,
    sharedAcrossBatches: Boolean(sharedAcrossBatches)
  })))),
  [
    { subjectName: 'Minor Project-2', individualLab: true, sharedAcrossBatches: false },
    { subjectName: 'Machine Learning', individualLab: false, sharedAcrossBatches: false },
    { subjectName: 'Computer Networks', individualLab: false, sharedAcrossBatches: false }
  ],
  'Toggle-on workload settings should be marked individual while unselected toggles remain unchanged.'
);
const semesterSixLabGroups = partitionDashboardLabRequirements(semesterSixLabRequirements);
assert.deepEqual(
  JSON.parse(JSON.stringify({
    shared: semesterSixLabGroups.shared.map(requirement => requirement.subjectName),
    individual: semesterSixLabGroups.individual.map(requirement => requirement.subjectName),
    pairable: semesterSixLabGroups.pairable.map(requirement => requirement.subjectName)
  })),
  {
    shared: [],
    individual: ['Minor Project-2'],
    pairable: ['Machine Learning', 'Computer Networks']
  },
  'Toggle-off labs are paired across P1 and P2; toggle-on labs remain individual.'
);
const codeMatchedRequirements = buildCodeMatchedWorkloadRequirements([
  {
    status: 'submitted',
    course: 'B.Tech',
    semester: 'semester6',
    selectedSubjectIds: ['cocubes-lab'],
    selectedSubjects: [{
      id: 'cocubes-lab',
      name: 'Cocubes Coding Lab',
      isLab: true,
      labCount: 1,
      assignedSections: ['sectionA']
    }],
    facultyName: 'Faculty A'
  },
  ...['Major Project', 'Minor Project-2'].map((name, index) => ({
    status: 'submitted',
    course: 'B.Tech',
    semester: 'semester6',
    selectedSubjectIds: [`project-${index}`],
    selectedSubjects: [{
      id: `project-${index}`,
      name,
      isLab: true,
      labCount: 1,
      assignedSections: ['sectionA']
    }],
    facultyName: `Faculty ${index + 1}`
  }))
]).sectionA;
assert.equal(codeMatchedRequirements[0].individualLab, true);
assert.equal(codeMatchedRequirements[0].sharedAcrossBatches, false);
assert.equal(codeMatchedRequirements[0].subjectCode, 'CS-605',
  'Workload generation should resolve the subject code from the catalog when a saved workload omits it.');
assert.deepEqual(
  JSON.parse(JSON.stringify(partitionDashboardLabRequirements(codeMatchedRequirements).individual.map(
    requirement => requirement.subjectName
  ))),
  ['Cocubes Coding Lab'],
  'Only toggle-on labs should be classified as individual sessions.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(partitionDashboardLabRequirements(codeMatchedRequirements).pairable.map(
    requirement => requirement.subjectName
  ))),
  ['Major Project', 'Minor Project-2'],
  'Toggle-off labs should be grouped for P1/P2 pairing.'
);
const workloadAfterAddingToggleOnLab = buildCodeMatchedWorkloadRequirements([{
  status: 'submitted',
  course: 'B.Tech',
  semester: 'semester6',
  selectedSubjectIds: ['cocubes-lab'],
  selectedSubjects: [{
    id: 'cocubes-lab',
    name: 'Cocubes Coding Lab',
    code: 'CS-605',
    isLab: true,
    labCount: 1,
    assignedSections: ['sectionA']
  }],
  facultyName: 'Faculty A'
}]).sectionA[0];
assert.equal(workloadAfterAddingToggleOnLab.individualLab, true,
  'A toggle-on setting captured during Add Lab should flow into Manage Workload generation requirements.');
assert.match(extractAsyncFunction('addLab'), /getSelectedManageLabToggleSettings/);
assert.match(extractAsyncFunction('addLab'), /renderManageWorkloadSubjects\(\)/,
  'Adding a lab should refresh Manage Workload with the selected individual mode.');
assert.deepEqual(
  JSON.parse(JSON.stringify(getManageWorkloadLabSubjects([
    { id: 'individual', name: 'Cocubes Coding', labEnabled: true, labCount: 1, individualLab: true },
    { id: 'first', name: 'Database', labEnabled: true, labCount: 1 },
    { id: 'second', name: 'Networking', labEnabled: true, labCount: 1 }
  ]))),
  [
    { id: 'individual', name: 'Cocubes Coding', labEnabled: true, labCount: 1, individualLab: true },
  ],
  'Manage Workload should identify toggle-on labs as individual sessions.'
);
const manageWorkloadFormsForSharedLab = [
  ['Minor Project-2 Lab', 'CS-608', 'Faculty A'],
  ['Machine Learning Lab', 'CS-601', 'Faculty B'],
  ['Computer Networks Lab', 'CS-602', 'Faculty C']
].map(([name, code, facultyName], index) => {
  const subject = {
    id: `lab-${index}`,
    name,
    code,
    isLab: true,
    labEnabled: true,
    labCount: 1
  };
  return {
    id: index + 1,
    course: 'B.Tech',
    semester: 'semester6',
    status: 'submitted',
    facultyName,
    selectedSubjectIds: [subject.id],
    selectedSubjects: [{ ...subject, assignedSections: ['sectionA'] }],
    subjects: [subject]
  };
});
const manageWorkloadGroupsForSharedLab = vm.runInNewContext(
  `(() => { ${extractFunction('getManageWorkloadSubjectDisplayKey')}; ${extractFunction('getManageWorkloadSubjectForLabToggle')}; ${extractFunction('getManageWorkloadSubjectGroups')}; return getManageWorkloadSubjectGroups(); })()`,
  {
    document: { getElementById: id => ({ value: id === 'manage-workload-course' ? 'B.Tech' : 'semester6' }) },
    manageWorkloadForms: manageWorkloadFormsForSharedLab,
    subjectCatalog: [],
    isManageLabToggleEnabled,
    sharedLabSubjectName,
    normalizeSubjectValue
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify({
    individual: manageWorkloadGroupsForSharedLab.filter(subject => subject.individualLab).map(subject => subject.name),
    manageable: getManageWorkloadLabSubjects(manageWorkloadGroupsForSharedLab).map(subject => subject.name)
  })),
  {
    individual: ['Minor Project-2'],
    manageable: ['Minor Project-2']
  },
  'Manage Workload should mark toggle-on workload subjects as individual labs.'
);
const stalePairAssignments = [
  { batch: 'P1', subjectName: 'Computer Networks', subjectCode: 'CS-602', teacher: 'Former Faculty' },
  { batch: 'P2', subjectName: 'Minor Project-2', subjectCode: 'CS-608', teacher: 'Former Faculty' }
];
staleBatchSlots = {
  'semester6|sectionA|Monday|1': { batchAssignments: stalePairAssignments },
  'semester6|sectionA|Monday|2': { batchAssignments: stalePairAssignments },
  'semester6|sectionA|Friday|1': {
    subject: 'Computer Networks (CS-602) (P1) / Minor Project-2 (CS-608) (P2)',
    teacher: 'P1: Faculty A / P2: Faculty B',
    classType: 'Lab'
  },
  'semester6|sectionA|Tuesday|1': { batchAssignments: [
    { batch: 'P1', subjectName: 'Machine Learning', subjectCode: 'CS-601', teacher: 'Faculty C' },
    { batch: 'P2', subjectName: 'Computer Networks', subjectCode: 'CS-602', teacher: 'Faculty A' }
  ] }
};
staleBatchSchedule = {
  'semester6|sectionA|Monday|1': 'Computer Networks (P1) / Minor Project-2 (P2)',
  'semester6|sectionA|Monday|2': 'Computer Networks (P1) / Minor Project-2 (P2)',
  'semester6|sectionA|Friday|1': 'Computer Networks (CS-602) (P1) / Minor Project-2 (CS-608) (P2)',
  'semester6|sectionA|Tuesday|1': 'Machine Learning (P1) / Computer Networks (P2)'
};
clearStaleLabBatchAssignments([{
  classType: 'Lab',
  sharedAcrossBatches: true,
  subjectName: 'Minor Project-2',
  subjectCode: 'CS-608',
  teacher: 'Faculty B'
}]);
assert.equal(staleBatchSlots['semester6|sectionA|Monday|1'], undefined);
assert.equal(staleBatchSlots['semester6|sectionA|Monday|2'], undefined);
assert.equal(staleBatchSchedule['semester6|sectionA|Monday|1'], '-');
assert.equal(staleBatchSchedule['semester6|sectionA|Monday|2'], '-');
assert.equal(staleBatchSlots['semester6|sectionA|Friday|1'], undefined);
assert.equal(staleBatchSchedule['semester6|sectionA|Friday|1'], '-');
assert.ok(staleBatchSlots['semester6|sectionA|Tuesday|1'], 'Unrelated P1/P2 lab slots must remain untouched.');
staleBatchSlots = {
  'semester6|sectionA|Friday|1': {
    subject: 'Cocubes coding (P1) / Minor Project-2 (CS-608) (P2)',
    classType: 'Lab',
    batchAssignments: [
      { batch: 'P1', subjectName: 'Cocubes coding', teacher: 'Faculty A' },
      { batch: 'P2', subjectName: 'Minor Project-2', subjectCode: 'CS-608', teacher: 'Faculty B' }
    ]
  }
};
staleBatchSchedule = {
  'semester6|sectionA|Friday|1': 'Cocubes coding (P1) / Minor Project-2 (CS-608) (P2)'
};
clearStaleLabBatchAssignments([{
  classType: 'Lab',
  sharedAcrossBatches: true,
  subjectName: 'Cocubes coding (CS-605) Lab',
  teacher: 'Faculty A'
}]);
assert.equal(staleBatchSlots['semester6|sectionA|Friday|1'], undefined,
  'Regeneration should clear a stale Cocubes P1/Minor Project P2 pair after the Cocubes lab is toggled shared.');
assert.equal(staleBatchSchedule['semester6|sectionA|Friday|1'], '-');
staleBatchSlots = {
  'semester6|sectionA|Monday|1': {
    batchAssignments: [
      { batch: 'P1', subjectName: 'Project Lab', subjectCode: 'CS-606' },
      { batch: 'P2', subjectName: 'Other Lab', subjectCode: 'CS-607' }
    ]
  }
};
staleBatchSchedule = { 'semester6|sectionA|Monday|1': 'Project Lab / Other Lab' };
clearStaleLabBatchAssignments([{
  classType: 'Lab',
  sharedAcrossBatches: true,
  subjectName: 'Project Lab',
  subjectCode: 'CS-605'
}]);
assert.ok(staleBatchSlots['semester6|sectionA|Monday|1'],
  'Regeneration must not clear a different coded subject merely because its name matches.');
staleBatchSlots = {
  'semester6|sectionA|Wednesday|0': {
    subject: 'Cocubes coding (P1) / Minor Project-2 (P2)',
    classType: 'Lab',
    batchAssignments: [
      { batch: 'P1', subjectName: 'Cocubes coding', subjectCode: 'CS-605', teacher: 'Faculty A', classType: 'Lab' },
      { batch: 'P2', subjectName: 'Minor Project-2', subjectCode: 'CS-608', teacher: 'Faculty B', classType: 'Lab' }
    ]
  }
};
staleBatchSchedule = { 'semester6|sectionA|Wednesday|0': 'Cocubes coding (P1) / Minor Project-2 (P2)' };
clearStaleLabBatchAssignments([
  { classType: 'Lab', subjectName: 'Cocubes coding', subjectCode: 'CS-605', sharedAcrossBatches: false },
  { classType: 'Lab', subjectName: 'Minor Project-2', subjectCode: 'CS-608', sharedAcrossBatches: false }
]);
assert.equal(staleBatchSlots['semester6|sectionA|Wednesday|0'], undefined,
  'Regeneration should clear legacy P1/P2 paired lab entries before assigning each lab individually.');

assert.deepEqual(
  JSON.parse(JSON.stringify(buildWorkloadRequirements([{
    status: 'submitted',
    course: 'B.Tech',
    semester: 'semester1',
    selectedSubjectIds: ['cs102'],
    selectedSubjects: [{
      id: 'cs102',
      name: 'Unassigned Subject',
      lectureCount: 4,
      assignedSections: []
    }],
    facultyName: 'Faculty B'
  }]))),
  {},
  'A selected subject without an assigned section must not generate timetable requirements.'
);

const daySessionCounts = new Map([['Monday', 1], ['Tuesday', 2]]);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Monday', 1), false);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Monday', 2), true);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Tuesday', 2), false);
assert.equal(canScheduleSessionOnDay(daySessionCounts, 'Wednesday', 1), true);

assert.deepEqual(
  JSON.parse(JSON.stringify(getLabSubjectOptions().map(({ name, isLab, code }) => ({ name, isLab, ...(code !== undefined ? { code } : {}) })))),
  [
    { name: 'Programming', isLab: true, code: 'CS101' },
    { name: 'Programming', isLab: true, code: 'CS103' },
    { name: 'Programming Lab', isLab: true },
    { name: 'Database', isLab: true, code: 'CS102' },
    { name: 'Network Lab', isLab: true }
  ],
  'Manage Lab should include explicit lab subjects, legacy Lab ON subjects, and subjects named as labs.'
);
const managedProgrammingLab = getLabSubjectOptions().find(subject => subject.code === 'CS101');
const isManagedProgrammingLabShared = vm.runInNewContext(
  `(${extractFunction('isSharedLabSubject')})`,
  {
    sharedLabSubjectKey,
    sharedLabSubjectCodeKey,
    sharedLabSubjects: {
      [sharedLabSubjectCodeKey(managedProgrammingLab)]: true
    }
  }
);
assert.equal(isManagedProgrammingLabShared({
  name: 'Programming',
  code: 'CS101',
  isLab: true
}), true, 'Toggling a duplicate Lab entry should preserve its base subject code for workload matching.');
assert.equal(
  [...getSubjectLabelSet('Programming Lab')].some(label => getSubjectLabelSet('Programming (CS101)').has(label)),
  true,
  'A workload lab assignment should match its allocated lab even when the saved label includes a Lab suffix.'
);

console.log('Section-scoped workload, individual lab scheduling, and daily fallback checks passed.');

function createAutoGeneratorTestHarness(sharedSubjectNames = new Set(), conflicts = {}) {
  const days = ['Monday', 'Tuesday'];
  const periodTimes = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00'];
  const schedule = Object.fromEntries(days.map(day => [day, Array(4).fill('-')]));
  const slotDataStore = {};
  const autoGenerateDashboardTimetable = vm.runInNewContext(
    `(() => {
      ${extractFunction('normalizeTeacherName')};
      ${extractFunction('normalizeSubjectValue')};
      ${extractFunction('sharedLabSubjectName')};
      ${extractFunction('normalizeLabSubjectValue')};
      ${extractFunction('getDashboardSlotAssignments')};
      ${extractFunction('createDashboardSharedLabBatchAssignments')};
      ${extractFunction('hasAmbiguousDashboardLabSubjectName')};
      ${extractFunction('sameDashboardLabSubject')};
      ${extractFunction('mergeSharedDashboardLabRequirements')};
      ${extractFunction('partitionDashboardLabRequirements')};
      ${extractFunction('createDashboardPairedLabBatchAssignment')};
      ${extractFunction('pairDashboardLabRequirements')};
      ${extractFunction('clearStaleDashboardLabBatchAssignments')};
      ${extractFunction('canScheduleDashboardSessionOnDay')};
      ${extractAsyncFunction('autoGenerateDashboardTimetable')};
      return autoGenerateDashboardTimetable;
    })()`,
    {
      dashboardCourse: 'B.Tech',
      dashboardTimetableState: { currentSemester: 'semester6', currentSection: 'sectionA' },
      dashboardTimetableSlotDataByCourse: { 'B.Tech': slotDataStore },
      getDashboardTimetableData: () => ({ semester6: { sectionA: schedule } }),
      getDashboardTimetableSlotData: () => slotDataStore,
      getDashboardWorkingDays: () => days,
      getDashboardPeriodCount: () => 4,
      getDashboardPeriodTimes: () => periodTimes,
      isManageLabToggleEnabled: requirement => sharedSubjectNames.has(sharedLabSubjectName(requirement.subjectName)),
      setDashboardScheduleCellValue: (course, semester, section, day, slotIndex, value) => {
        schedule[day][slotIndex] = value;
      },
      isDashboardSlotEmpty: (semester, section, day, slotIndex) => (
        schedule[day][slotIndex] === '-' && !slotDataStore[`${semester}|${section}|${day}|${slotIndex}`]?.subject
      ),
      isTeacherAssignedInOtherSection: (semester, day, slotIndex, teacher) => conflicts.teacher === teacher,
      getLabsForSubject: (course, semester, subject) => [{
        id: conflicts.sharedMappedLab ? 'LAB-SHARED' : subject
      }],
      findLabAssignmentConflict: (day, slotIndex, course, semester, subject) => (
        conflicts.lab === subject ? { subject } : null
      ),
      shuffledDashboardValues: values => values.slice()
    }
  );
  return { autoGenerateDashboardTimetable, schedule, slotDataStore };
}

function createManualSlotTestHarness({
  individual = false,
  conflict = '',
  p2Subject = 'Database Lab (CS-606)',
  p2Teacher = 'Faculty B',
  p2Room = 'Lab 2'
} = {}) {
  const isIndividualSelection = individual;
  const primarySubject = 'Cocubes Coding (CS-605)';
  const values = {
    editSlotSubject: primarySubject,
    editSlotTeacher: 'Faculty A',
    editSlotRoom: 'Lab 1',
    editSlotP2Subject: p2Subject,
    editSlotP2Teacher: p2Teacher,
    editSlotP2Room: p2Room,
    editSlotClassTeacher: '',
    editSlotStudentNumber: '',
    editSlotAcademicSession: '2025-2026'
  };
  const elements = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
    value,
    selectedOptions: [{
      value,
      dataset: { isLab: id === 'editSlotSubject' || id.endsWith('Subject') ? 'true' : 'false' }
    }]
  }]));
  const conflicts = [];
  const slotDataStore = {};
  const savedCells = {};
  const toggleCalls = [];
  const saveDashboardSlot = vm.runInNewContext(
    `(() => {
      ${extractFunction('extractSubjectNameAndCodeGlobal')};
      ${extractFunction('hasAmbiguousDashboardLabSubjectName')};
      ${extractFunction('sameDashboardLabSubject')};
      ${extractFunction('sharedLabSubjectName')};
      ${extractFunction('normalizeSubjectValue')};
      ${extractFunction('saveDashboardSlot')};
      return saveDashboardSlot;
    })()`,
    {
      dashboardTimetableEditing: {
        key: 'semester6|sectionA|Monday|0'
      },
      dashboardCourse: 'B.Tech',
      dashboardTimetableState: { currentSemester: 'semester6' },
      document: { getElementById: id => elements[id] || null },
      isManageLabToggleEnabled: item => {
        toggleCalls.push(item);
        return isIndividualSelection
          && item.course === 'B.Tech'
          && item.semester === 'semester6'
          && item.code === 'CS-605';
      },
      normalizeTeacherName: value => String(value || '').trim().toLowerCase(),
      normalizeLabSubjectValue: value => String(value || '').trim().toLowerCase(),
      subjectCatalog: [],
      getDashboardTimetableSlotData: () => slotDataStore,
      getDashboardPeriodCount: () => 4,
      findTeacherAssignmentConflict: (day, slotIndex, teacher) => (
        conflict === 'teacher' && teacher === 'Faculty A'
            || conflict === 'teacher2' && teacher === 'Faculty B'
          ? { teacher }
          : null
      ),
      findLabAssignmentConflict: () => null,
      findRoomAssignmentConflict: (day, slotIndex, room) => (
        conflict === 'room' && room === 'Lab 1'
            || conflict === 'room2' && room === 'Lab 2'
          ? { room }
          : null
      ),
      formatTeacherAssignmentConflict: () => 'Monday, 09:00',
      formatLabAssignmentConflict: () => 'Monday, 09:00',
      showConflictModal: message => conflicts.push(message),
      setDashboardScheduleCellValue: (course, semester, section, day, slotIndex, value) => {
        savedCells[`${semester}|${section}|${day}|${slotIndex}`] = value;
      },
      closeDashboardEditModal: () => {},
      renderDashboardTimetable: () => {},
      alert: message => conflicts.push(message),
      console
    }
  );
  saveDashboardSlot();
  return { slotDataStore, conflicts, savedCells, toggleCalls };
}

(async () => {
  const toggleOnWorkloadRequirement = buildCodeMatchedWorkloadRequirements([{
    status: 'submitted',
    course: 'B.Tech',
    semester: 'semester6',
    selectedSubjectIds: ['cocubes-lab'],
    selectedSubjects: [{
      id: 'cocubes-lab',
      name: 'Cocubes Coding Lab',
      isLab: true,
      labCount: 1,
      assignedSections: ['sectionA']
    }],
    facultyName: 'Faculty A'
  }]).sectionA[0];
  assert.equal(toggleOnWorkloadRequirement.individualLab, true);
  assert.equal(toggleOnWorkloadRequirement.sharedAcrossBatches, false);
  const toggleOnHarness = createAutoGeneratorTestHarness();
  const toggleOnResult = await toggleOnHarness.autoGenerateDashboardTimetable([toggleOnWorkloadRequirement]);
  assert.equal(toggleOnResult.filledCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(toggleOnResult.conflicts)), []);
  assert.ok(Object.values(toggleOnHarness.slotDataStore).every(slot => (
    slot.individualLab
    && slot.subject === 'Cocubes Coding Lab (CS-605)'
    && !slot.sharedAcrossBatches
    && !slot.batchAssignments
  )), 'A Manage Lab toggle-on subject should generate an individual lab without P1/P2 pairing.');
  const resolvedToggleHarness = createAutoGeneratorTestHarness(new Set(['cocubes coding']));
  const resolvedToggleResult = await resolvedToggleHarness.autoGenerateDashboardTimetable([{
    subjectName: 'Cocubes Coding',
    subjectCode: 'CS-605',
    teacher: 'Faculty A',
    classType: 'Lab',
    lecturesPerWeek: 1,
    sharedAcrossBatches: false
  }]);
  assert.equal(resolvedToggleResult.filledCount, 2);
  assert.ok(Object.values(resolvedToggleHarness.slotDataStore).every(slot => (
    slot.individualLab && !slot.pairedAcrossBatches
  )), 'Automatic generation should honor the individual toggle even when workload data only says sharedAcrossBatches=false.');

  const singleCombinedHarness = createAutoGeneratorTestHarness();
  const singleCombinedResult = await singleCombinedHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Cocubes Coding',
      subjectCode: 'CS-605',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: true
    }
  ]);
  assert.equal(singleCombinedResult.filledCount, 2,
    'An explicit legacy shared requirement should occupy one two-period P1/P2 session.');
  assert.deepEqual(JSON.parse(JSON.stringify(singleCombinedResult.conflicts)), [],
    'A single explicit shared lab should not require a second lab subject.');

  const combinedHarness = createAutoGeneratorTestHarness();
  const combinedResult = await combinedHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Cocubes Coding Lab',
      subjectCode: 'CS-605',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: true
    },
    {
      subjectName: 'Cocubes Coding (CS-605)',
      subjectCode: 'CS-605',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: true
    }
  ]);
  assert.equal(combinedResult.filledCount, 2,
    'Duplicate combined workload entries should create one two-period lab session, not two sessions.');
  assert.deepEqual(JSON.parse(JSON.stringify(combinedResult.conflicts)), []);
  const combinedSlots = Object.values(combinedHarness.slotDataStore);
  assert.equal(combinedSlots.length, 2, 'A shared lab uses its normal two consecutive timetable periods.');
  assert.ok(combinedSlots.every(slot => slot.subject === 'Cocubes Coding Lab (CS-605)'));
  assert.ok(combinedSlots.every(slot => slot.sharedAcrossBatches));
  assert.ok(combinedSlots.every(slot => slot.batchAssignments.length === 2));
  assert.ok(combinedSlots.every(slot => getDashboardSlotAssignments(slot).length === 1));

  const separateHarness = createAutoGeneratorTestHarness();
  const separateResult = await separateHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Programming Lab',
      subjectCode: 'CS-101',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    },
    {
      subjectName: 'Database Lab',
      subjectCode: 'CS-102',
      teacher: 'Faculty B',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    }
  ]);
  assert.equal(separateResult.filledCount, 2,
    'Two toggle-off lab subjects should share one two-period P1/P2 session.');
  assert.deepEqual(JSON.parse(JSON.stringify(separateResult.conflicts)), []);
  const separateSlots = Object.values(separateHarness.slotDataStore);
  assert.equal(separateSlots.length, 2);
  assert.ok(separateSlots.every(slot => slot.pairedAcrossBatches && !slot.sharedAcrossBatches));
  assert.ok(separateSlots.every(slot => (
    slot.batchAssignments.length === 2
    && slot.batchAssignments.some(assignment => assignment.batch === 'P1' && assignment.subjectCode === 'CS-101')
    && slot.batchAssignments.some(assignment => assignment.batch === 'P2' && assignment.subjectCode === 'CS-102')
  )), 'Toggle-off workload subjects should be assigned as different P1 and P2 lab sessions at the same time.');
  assert.ok(separateSlots.every(slot => /Programming Lab.*P1.*Database Lab.*P2/.test(slot.subject)),
    'The paired timetable cell should display both subject assignments with their batch labels.');
  const blockedPairedHarness = createAutoGeneratorTestHarness(new Set(), { teacher: 'Faculty B' });
  const blockedPairedResult = await blockedPairedHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Programming Lab',
      subjectCode: 'CS-101',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    },
    {
      subjectName: 'Database Lab',
      subjectCode: 'CS-102',
      teacher: 'Faculty B',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    }
  ]);
  assert.equal(blockedPairedResult.filledCount, 0,
    'A P2 teacher conflict must block the whole paired lab session.');
  assert.ok(blockedPairedResult.conflicts.length > 0);
  const sharedResourceHarness = createAutoGeneratorTestHarness(new Set(), { sharedMappedLab: true });
  const sharedResourceResult = await sharedResourceHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Programming Lab',
      subjectCode: 'CS-101',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    },
    {
      subjectName: 'Database Lab',
      subjectCode: 'CS-102',
      teacher: 'Faculty B',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    }
  ]);
  assert.equal(sharedResourceResult.filledCount, 0,
    'Two subjects mapped to the same physical lab must not be paired into a simultaneous session.');
  assert.ok(sharedResourceResult.conflicts.length > 0);
  const repeatedSubjectHarness = createAutoGeneratorTestHarness();
  const repeatedSubjectResult = await repeatedSubjectHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Programming Lab',
      subjectCode: 'CS-101',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 2,
      sharedAcrossBatches: false
    },
    {
      subjectName: 'Database Lab',
      subjectCode: 'CS-102',
      teacher: 'Faculty B',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    },
    {
      subjectName: 'Network Lab',
      subjectCode: 'CS-103',
      teacher: 'Faculty C',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    }
  ]);
  assert.equal(repeatedSubjectResult.filledCount, 4,
    'A subject with two weekly sessions must pair with two different labs instead of counting its first pairing twice.');
  assert.deepEqual(JSON.parse(JSON.stringify(repeatedSubjectResult.conflicts)), []);
  const repeatedPairSlots = Object.values(repeatedSubjectHarness.slotDataStore);
  assert.equal(new Set(repeatedPairSlots.map(slot => slot.subject)).size, 2);
  assert.ok(repeatedPairSlots.every(slot => slot.batchAssignments.length === 2));

  const singleSeparateHarness = createAutoGeneratorTestHarness();
  const singleSeparateResult = await singleSeparateHarness.autoGenerateDashboardTimetable([
    {
      subjectName: 'Cocubes Coding',
      subjectCode: 'CS-605',
      teacher: 'Faculty A',
      classType: 'Lab',
      lecturesPerWeek: 1,
      sharedAcrossBatches: false
    }
  ]);
  assert.ok(singleSeparateResult.conflicts.some(conflict => /needs a second different lab subject/.test(conflict)),
    'A toggle-off lab without a different subject should report that it cannot form a P1/P2 pair.');
  assert.equal(singleSeparateResult.filledCount, 0);
  assert.equal(Object.keys(singleSeparateHarness.slotDataStore).length, 0);

  const manualIndividual = createManualSlotTestHarness({ individual: true });
  const manualIndividualSlot = manualIndividual.slotDataStore['semester6|sectionA|Monday|0'];
  assert.ok(manualIndividualSlot,
    `Manual toggle-on lab assignment should succeed as one individual lab: ${JSON.stringify(manualIndividual.toggleCalls)} ${manualIndividual.conflicts.join('; ')}`);
  assert.equal(manualIndividualSlot.sharedAcrossBatches, false);
  assert.equal(manualIndividualSlot.individualLab, true);
  assert.equal(manualIndividualSlot.batchAssignments, undefined,
    'A toggle-on individual lab should not carry P1/P2 attendance assignments.');
  assert.deepEqual(
    JSON.parse(JSON.stringify(Object.values(manualIndividual.slotDataStore).map(slot => slot.subject))),
    ['Cocubes Coding (CS-605)', 'Cocubes Coding (CS-605)'],
    'A manual individual lab should reserve its two consecutive periods using one displayed subject.'
  );

  const manualSharedAssignments = vm.runInNewContext(
    `(() => {
      ${extractFunction('normalizeSubjectValue')};
      ${extractFunction('normalizeTeacherName')};
      ${extractFunction('sharedLabSubjectName')};
      ${extractFunction('normalizeLabSubjectValue')};
      ${extractFunction('getDashboardSlotAssignments')};
      return getDashboardSlotAssignments;
    })()`,
    {}
  )(manualIndividualSlot);
  assert.equal(manualSharedAssignments.length, 1,
    'A manually saved individual assignment should be exposed once to timetable views and conflict checks.');

  let editorIndividual = true;
  const editorElements = {
    editSlotSubject: {
      value: 'Cocubes Coding (CS-605)',
      selectedOptions: [{ dataset: { isLab: 'true' } }]
    },
    editSlotP2SubjectRow: { hidden: true },
    editSlotP2TeacherRow: { hidden: true },
    editSlotP2RoomRow: { hidden: true },
    editSlotSingleSubjectRow: { hidden: true },
    editSlotSingleTeacherRow: { hidden: true },
    editSlotSingleRoomRow: { hidden: true },
    editSlotLabAssignmentHint: { hidden: true, textContent: '' }
  };
  const updateManualEditorMode = vm.runInNewContext(
    `(() => {
      ${extractFunction('extractSubjectNameAndCodeGlobal')};
      ${extractFunction('updateDashboardSlotEditorMode')};
      return updateDashboardSlotEditorMode;
    })()`,
    {
      document: {
        getElementById: id => editorElements[id] || null,
        querySelector: () => null
      },
      dashboardCourse: 'B.Tech',
      dashboardTimetableState: { currentSemester: 'semester6' },
      dashboardTimetableEditing: { semester: 'semester6' },
      isManageLabToggleEnabled: () => editorIndividual
    }
  );
  updateManualEditorMode();
  assert.equal(editorElements.editSlotSingleSubjectRow.hidden, false);
  assert.equal(editorElements.editSlotSingleTeacherRow.hidden, false);
  assert.equal(editorElements.editSlotSingleRoomRow.hidden, false);
  assert.match(editorElements.editSlotLabAssignmentHint.textContent, /individual lab/i);
  editorIndividual = false;
  updateManualEditorMode();
  assert.equal(editorElements.editSlotP2SubjectRow.hidden, false);
  assert.equal(editorElements.editSlotP2TeacherRow.hidden, false);
  assert.equal(editorElements.editSlotP2RoomRow.hidden, false);
  assert.match(editorElements.editSlotLabAssignmentHint.textContent, /different lab subjects/i);

  const manualSummary = { innerHTML: '' };
  const renderManualSummary = vm.runInNewContext(
    `(() => {
      ${extractFunction('normalizeSubjectValue')};
      ${extractFunction('normalizeTeacherName')};
      ${extractFunction('sharedLabSubjectName')};
      ${extractFunction('normalizeLabSubjectValue')};
      ${extractFunction('getDashboardSlotAssignments')};
      ${extractFunction('renderDashboardSubjectSummary')};
      return renderDashboardSubjectSummary;
    })()`,
    {
      document: { getElementById: () => manualSummary },
      dashboardCourse: 'B.Tech',
      dashboardTimetableState: { currentSemester: 'semester6', currentSection: 'sectionA' },
      getDashboardTimetableSlotData: () => manualIndividual.slotDataStore,
      extractSubjectNameAndCodeGlobal: value => {
        const match = String(value || '').match(/^(.*?)\\s*\\(([^()]*)\\)\\s*$/);
        return match ? { name: match[1].trim(), code: match[2].trim() } : { name: value, code: '' };
      },
      escapeHtml: value => String(value || '')
    }
  );
  renderManualSummary();
  assert.match(manualSummary.innerHTML, /<td[^>]*>0<\/td><td[^>]*>0<\/td><td[^>]*>1<\/td>/,
    'Weekly subject summary should count the shared lab once, not once per batch or period.');

  const reloadedTimetableData = {};
  const reloadedTimetableSlots = {};
  const applyReloadedTimetable = vm.runInNewContext(
    `(${extractFunction('applyDashboardTimetableRecord')})`,
    {
      dashboardTimetableDataByCourse: reloadedTimetableData,
      dashboardTimetableSlotDataByCourse: reloadedTimetableSlots,
      ensureDashboardCourseExists: course => {
        reloadedTimetableData[course] ||= {};
        reloadedTimetableSlots[course] ||= {};
      },
      createEmptyDashboardCourseData: () => ({})
    }
  );
  const persistedRecord = JSON.parse(JSON.stringify({
    id: 'dashboard-state',
    dataByCourse: { 'B.Tech': {} },
    slotDataByCourse: { 'B.Tech': manualIndividual.slotDataStore }
  }));
  assert.equal(applyReloadedTimetable(persistedRecord), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(reloadedTimetableSlots['B.Tech']['semester6|sectionA|Monday|0'])),
    JSON.parse(JSON.stringify(manualIndividualSlot)),
    'Reloading the timetable record should preserve the individual-lab flag and assignment.'
  );

  for (const resource of ['teacher', 'room']) {
    const conflictedManualSession = createManualSlotTestHarness({ individual: true, conflict: resource });
    assert.equal(Object.keys(conflictedManualSession.slotDataStore).length, 0,
      `Manual toggle-on individual-lab assignment must still reject a ${resource} conflict.`);
    assert.ok(conflictedManualSession.conflicts.length > 0);

    const conflictedIndividualSession = createManualSlotTestHarness({ conflict: resource });
    assert.equal(Object.keys(conflictedIndividualSession.slotDataStore).length, 0,
      `Manual individual-lab assignment must still reject a ${resource} conflict.`);
    assert.ok(conflictedIndividualSession.conflicts.length > 0);
  }
  for (const resource of ['teacher2', 'room2']) {
    const conflictedBatch = createManualSlotTestHarness({ conflict: resource });
    assert.equal(Object.keys(conflictedBatch.slotDataStore).length, 0,
      `Manual P1/P2 assignment must reject a ${resource} conflict on P2.`);
    assert.ok(conflictedBatch.conflicts.length > 0);
  }
  for (const invalidPair of [
    { p2Subject: 'Cocubes Coding (CS-605)' },
    { p2Teacher: 'Faculty A' },
    { p2Room: 'Lab 1' }
  ]) {
    const invalidManualPair = createManualSlotTestHarness(invalidPair);
    assert.equal(Object.keys(invalidManualPair.slotDataStore).length, 0,
      'Manual P1/P2 assignment must reject repeated subjects, teachers, or rooms.');
    assert.ok(invalidManualPair.conflicts.length > 0);
  }

  const manualToggleOff = createManualSlotTestHarness();
  const manualToggleOffSlot = manualToggleOff.slotDataStore['semester6|sectionA|Monday|0'];
  assert.ok(manualToggleOffSlot,
    'Manual toggle-off should save a two-subject P1/P2 lab assignment.');
  assert.equal(manualToggleOffSlot.sharedAcrossBatches, false);
  assert.equal(manualToggleOffSlot.pairedAcrossBatches, true);
  assert.match(manualToggleOffSlot.subject, /Cocubes Coding.*P1.*Database Lab.*P2/);
  assert.equal(manualToggleOffSlot.batchAssignments.length, 2);
  assert.equal(manualToggleOffSlot.batchAssignments[0].batch, 'P1');
  assert.equal(manualToggleOffSlot.batchAssignments[1].batch, 'P2');
  assert.equal(manualToggleOffSlot.batchAssignments[0].teacher, 'Faculty A');
  assert.equal(manualToggleOffSlot.batchAssignments[1].teacher, 'Faculty B');
  assert.equal(manualToggleOffSlot.room, 'Lab 1');
  assert.equal(manualToggleOffSlot.batchAssignments[1].room, 'Lab 2');
  console.log('P1/P2-paired and individual auto-generation integration checks passed.');
  console.log('Manual individual/paired-lab assignment, weekly summary, and conflict checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
