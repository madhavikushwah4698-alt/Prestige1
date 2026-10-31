        /* ============ IN-MEMORY UI STATE + MONGODB-BACKED API ============ */
        const API_BASE_URL = window.PRESTIGE_API_BASE_URL || window.location.origin;
        const LOCAL_API_BASE_URL = 'http://localhost:4000';
        let apiToken = '';
        let apiRole = '';
        let apiOnline = false;

        async function apiRequest(path, options = {}) {
            const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
            if (apiToken && options.auth !== false) headers.Authorization = `Bearer ${apiToken}`;
            let response;
            const requestOptions = {
                ...options,
                headers,
                body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
            };
            try {
                response = await fetch(`${API_BASE_URL}${path}`, requestOptions);
            } catch (error) {
                const canTryLocalApi = API_BASE_URL !== LOCAL_API_BASE_URL && ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
                if (canTryLocalApi) {
                    try {
                        response = await fetch(`${LOCAL_API_BASE_URL}${path}`, requestOptions);
                    } catch {
                        error.network = true;
                        throw error;
                    }
                } else {
                error.network = true;
                throw error;
                }
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(payload.error || 'Backend request failed');
                error.status = response.status;
                error.payload = payload;
                throw error;
            }
            apiOnline = true;
            return payload;
        }

        function setApiSession(token, role) {
            apiToken = token || '';
            apiRole = role || '';
        }

        function normalizeInvite(invite) {
            const inviteCode = invite.inviteCode || '';
            return {
                ...invite,
                sentOn: invite.sentOn || invite.createdOn || '',
                sentTime: invite.sentTime || invite.createdAt || '',
                status: invite.status === 'pending' ? 'sent' : invite.status,
                emailSent: Boolean(invite.emailSent),
                emailError: invite.emailError || '',
                inviteLink: invite.inviteLink || getInviteLink(encodeURIComponent(inviteCode))
            };
        }

        async function loadFacultyFromApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/faculty');
                facultyDB = payload.faculty || [];
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                console.warn('Faculty records were not loaded from MongoDB:', error);
                return false;
            }
        }

        async function loadAdminsFromApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/admins');
                adminDB = payload.admins || [];
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                return false;
            }
        }

        async function loadInvitesFromApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/invites');
                inviteDB = (payload.invites || []).map(normalizeInvite);
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                return false;
            }
        }

        function applyTimeSettingRecord(record) {
            if (!record || !record.course || !record.semester) return;
            ensureDashboardCourseExists(record.course);
            const settings = getDashboardCourseSettings(record.course, record.semester);
            Object.assign(settings, {
                start: record.start || settings.start,
                end: record.end || settings.end,
                startDate: record.startDate || '',
                endDate: record.endDate || '',
                duration: Number(record.duration) || settings.duration,
                labDuration: Number(record.labDuration) || settings.labDuration,
                lunchStart: record.lunchStart || settings.lunchStart,
                lunchEnd: record.lunchEnd || settings.lunchEnd,
                workingDays: Array.isArray(record.workingDays) && record.workingDays.length ? record.workingDays.slice() : settings.workingDays,
                periodTimes: Array.isArray(record.periodTimes) && record.periodTimes.length ? record.periodTimes.slice() : settings.periodTimes,
                periodCount: Number(record.periodCount) || (Array.isArray(record.periodTimes) ? record.periodTimes.length : settings.periodCount)
            });
        }

        async function loadTimeSettingsFromApi() {
            if (!apiToken) return false;
            try {
                const payload = await apiRequest('/api/time-settings');
                (payload.settings || []).forEach(applyTimeSettingRecord);
                if (typeof loadTimeSettingCourseSettings === 'function') {
                    loadTimeSettingCourseSettings(dashboardCourse);
                }
                if (typeof renderDashboardTimetable === 'function') {
                    renderDashboardTimetable();
                }
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                return false;
            }
        }

        async function saveTimeSettingsToApi(records) {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                await apiRequest('/api/time-settings', {
                    method: 'POST',
                    body: { settings: records }
                });
                return true;
            } catch (error) {
                console.warn('Time settings were not saved to MongoDB:', error);
                return false;
            }
        }

        async function loadSubjectsFromApi() {
            if (!apiToken) return false;
            try {
                const payload = await apiRequest('/api/subjects');
                if (Array.isArray(payload.subjects)) {
                    const subjectKey = (item) => [
                        item.course || 'B.Tech',
                        item.semester || 'semester1',
                        item.category || 'main',
                        item.electiveType || 'program',
                        item.isLab ? 'lab' : 'subject',
                        String(item.name || '').trim().toLowerCase(),
                        String(item.code || '').trim().toLowerCase()
                    ].join('|');
                    const merged = new Map(subjectCatalog.map(item => [subjectKey(item), item]));
                    payload.subjects.forEach(subject => merged.set(subjectKey(subject), subject));
                    subjectCatalog = Array.from(merged.values());
                    renderSubjects(document.getElementById('subjectSearch')?.value || '');
                    renderManageLabs();
                    renderManageFormSubjects();
                    try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                }
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                console.warn('Subjects were not loaded from MongoDB:', error);
                return false;
            }
        }

        async function saveSubjectsToApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/subjects', {
                    method: 'PUT',
                    body: { subjects: subjectCatalog }
                });
                if (Array.isArray(payload.subjects)) {
                    subjectCatalog = payload.subjects;
                }
                return true;
            } catch (error) {
                console.warn('Subjects were not saved to MongoDB:', error);
                return false;
            }
        }

        async function loadDashboardHistoryFromApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/history');
                dashboardTimetableHistory.length = 0;
                (payload.history || []).forEach(entry => dashboardTimetableHistory.push(entry));
                selectedDashboardHistoryEntryId = null;
                renderDashboardHistoryPanel();
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                console.warn('Timetable history was not loaded from MongoDB:', error);
                return false;
            }
        }

        async function saveDashboardHistoryToApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/history', {
                    method: 'PUT',
                    body: { history: dashboardTimetableHistory }
                });
                dashboardTimetableHistory.length = 0;
                (payload.history || []).forEach(entry => dashboardTimetableHistory.push(entry));
                return true;
            } catch (error) {
                console.warn('Timetable history was not saved to MongoDB:', error);
                return false;
            }
        }

        function applyDashboardTimetableRecord(record) {
            if (!record || record.id !== 'dashboard-state') return false;
            const dataByCourse = record.dataByCourse || {};
            const slotDataByCourse = record.slotDataByCourse || {};

            Object.keys(dataByCourse).forEach(course => {
                ensureDashboardCourseExists(course);
                dashboardTimetableDataByCourse[course] = dataByCourse[course] || createEmptyDashboardCourseData();
            });

            Object.keys(slotDataByCourse).forEach(course => {
                ensureDashboardCourseExists(course);
                dashboardTimetableSlotDataByCourse[course] = slotDataByCourse[course] || {};
            });

            return true;
        }

        async function loadDashboardTimetablesFromApi() {
            if (!apiToken) return false;
            try {
                const payload = await apiRequest('/api/timetables');
                const record = (payload.timetables || []).find(item => item.id === 'dashboard-state');
                if (applyDashboardTimetableRecord(record)) {
                    try { renderDashboardTimetable(); } catch (e) { /* ignore */ }
                    try { renderFacultyPersonalSchedulePanel(); } catch (e) { /* ignore */ }
                }
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                console.warn('Timetables were not loaded from MongoDB:', error);
                return false;
            }
        }

        async function saveDashboardTimetablesToApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                await apiRequest('/api/timetables', {
                    method: 'PUT',
                    body: {
                        timetables: [{
                            id: 'dashboard-state',
                            dataByCourse: dashboardTimetableDataByCourse,
                            slotDataByCourse: dashboardTimetableSlotDataByCourse
                        }]
                    }
                });
                return true;
            } catch (error) {
                console.warn('Timetables were not saved to MongoDB:', error);
                return false;
            }
        }

        let dashboardTimetableSaveTimer = null;

        function queueDashboardTimetableSave() {
            if (!apiToken || apiRole !== 'admin') return;
            clearTimeout(dashboardTimetableSaveTimer);
            const status = document.getElementById('dashboard-save-status');
            if (status) {
                status.textContent = 'Saving timetable to database...';
                status.style.color = '';
            }
            dashboardTimetableSaveTimer = setTimeout(async () => {
                const saved = await saveDashboardTimetablesToApi();
                if (status) {
                    status.textContent = saved ? 'Timetable saved to database.' : 'Timetable was not saved to database. Please retry.';
                    status.style.color = saved ? '' : '#b91c1c';
                }
            }, 500);
        }

        async function saveTeacherViewToApi(viewData) {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                await apiRequest('/api/teacher-views', {
                    method: 'POST',
                    body: viewData
                });
                return true;
            } catch (error) {
                console.warn('Teacher view data was not saved to MongoDB:', error);
                return false;
            }
        }

        let adminDB = [];
        let facultyDB = [];
        let inviteDB = [];
        let manageWorkloadForms = [];

let nextId = 3;
        let loginRole = "faculty";
        let currentFacultyId = null;
        let currentFaculty = null;
        let currentInviteCode = null;
        let pendingFacultyStatusToken = '';
        let pendingFacultyStatusTimer = null;
        let pendingFacultyRecord = null;
        const PENDING_FACULTY_STATUS_POLL_INTERVAL_MS = 1000;
        let inviteRegistrationMode = (() => {
            try {
                return sessionStorage.getItem('prestigeInviteFacultyMode') === 'true';
            } catch (error) {
                console.warn('Invite session preference could not be read:', error);
                return false;
            }
        })();
        let lastPendingCount = 0;
        let lastSeenPendingFaculty = [];

        function showScreen(name) {
            document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
            document.getElementById("screen-" + name).classList.add("active");
            clearErrors();
            if (name === "login") setLoginRole(loginRole);
        }

        function clearErrors() {
            document.querySelectorAll(".error-msg").forEach(e => { e.classList.remove("show"); e.textContent = ""; });
        }

        function showNotification(title, message, action = null) {
            const toast = document.getElementById("notification-toast");
            const titleEl = document.getElementById("notification-title");
            const messageEl = document.getElementById("notification-message");
            
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            toast.classList.remove("hide");
            toast.classList.add("show");
            
            // Remove any existing click handler
            const newToast = toast.cloneNode(true);
            toast.parentNode.replaceChild(newToast, toast);
            
            if (action) {
                newToast.addEventListener("click", action);
            }
            
            // Auto-close after 5 seconds
            setTimeout(() => {
                closeNotification();
            }, 5000);
        }

        function closeNotification() {
            const toast = document.getElementById("notification-toast");
            toast.classList.remove("show");
            toast.classList.add("hide");
            setTimeout(() => {
                toast.classList.remove("hide");
            }, 300);
        }

        function generateInviteCode() {
            return 'INV-' + Math.random().toString(36).substr(2, 9).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
        }

        function getInviteLink(inviteCode) {
            return window.location.origin + window.location.pathname + '?inviteCode=' + inviteCode;
        }

        async function sendFacultyInvite() {
            const email = document.getElementById("invite-email").value.trim().toLowerCase();
            const errBox = document.getElementById("invite-error");
            const successBox = document.getElementById("invite-success");
            const linkContainer = document.getElementById("invite-link-container");

            errBox.classList.remove("show");
            successBox.classList.remove("show");
            linkContainer.style.display = "none";

            if (!email) {
                errBox.textContent = "Please enter an email address.";
                errBox.classList.add("show");
                return;
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                errBox.textContent = "Please enter a valid email address.";
                errBox.classList.add("show");
                return;
            }

            if (facultyDB.some(u => u.email.toLowerCase() === email)) {
                errBox.textContent = "This email is already registered. Faculty cannot be invited twice.";
                errBox.classList.add("show");
                return;
            }

            if (inviteDB.some(i => i.email.toLowerCase() === email)) {
                errBox.textContent = "An invite has already been sent to this email.";
                errBox.classList.add("show");
                return;
            }

            try {
                const result = await apiRequest('/api/invites', {
                    method: 'POST',
                    body: { email }
                });
                const invite = normalizeInvite(result.invite);
                inviteDB.push(invite);
                document.getElementById("invite-link-display").textContent = invite.inviteLink;
                linkContainer.style.display = "block";
                successBox.textContent = result.emailSent
                    ? `Invite email sent to ${email} via Gmail. The registration link is also shown below.`
                    : `Invite created for ${email}, but Gmail did not send it: ${result.emailError || 'Email service is not configured.'}`;
                successBox.classList.add("show");
                document.getElementById("invite-email").value = "";
                renderPendingInvites();
                renderInvitationsStatus();
                return;
            } catch (error) {
                errBox.textContent = error.network ? 'Backend unavailable. Invite was not saved.' : (error.message || 'Unable to create invite.');
                errBox.classList.add("show");
                return;
            }
        }

        function copyInviteLink() {
            const linkText = document.getElementById("invite-link-display").textContent;
            navigator.clipboard.writeText(linkText).then(() => {
                alert('Invite link copied to clipboard!');
            }).catch(() => {
                alert('Failed to copy link. Please copy manually.');
            });
        }

        function validateBulkEmails() {
            const textarea = document.getElementById("bulk-invite-emails");
            const errBox = document.getElementById("bulk-invite-error");
            const successBox = document.getElementById("bulk-invite-success");
            const previewContainer = document.getElementById("bulk-preview-container");
            const previewList = document.getElementById("bulk-preview-list");

            errBox.classList.remove("show");
            successBox.classList.remove("show");
            previewContainer.style.display = "none";

            const emailText = textarea.value.trim();
            if (!emailText) {
                errBox.textContent = "Please enter at least one email address.";
                errBox.classList.add("show");
                return;
            }

            // Parse emails - split by newline, comma, or semicolon
            const rawEmails = emailText.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(e => e);
            const validEmails = [];
            const invalidEmails = [];
            const alreadyInvited = [];
            const alreadyRegistered = [];

            rawEmails.forEach(email => {
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    invalidEmails.push(email);
                } else if (inviteDB.some(i => i.email.toLowerCase() === email)) {
                    alreadyInvited.push(email);
                } else if (facultyDB.some(u => u.email.toLowerCase() === email)) {
                    alreadyRegistered.push(email);
                } else if (!validEmails.includes(email)) {
                    validEmails.push(email);
                }
            });

            // Show errors if any
            let errorMsg = "";
            if (invalidEmails.length > 0) {
                errorMsg += `Error Invalid emails: ${invalidEmails.join(", ")}\n`;
            }
            if (alreadyInvited.length > 0) {
                errorMsg += `Warning Already invited: ${alreadyInvited.join(", ")}\n`;
            }
            if (alreadyRegistered.length > 0) {
                errorMsg += `Warning Already registered: ${alreadyRegistered.join(", ")}\n`;
            }

            if (validEmails.length === 0) {
                errBox.innerHTML = `<div>${errorMsg}</div>`;
                errBox.classList.add("show");
                return;
            }

            // Show preview
            if (errorMsg) {
                successBox.innerHTML = `<div>${errorMsg}</div>`;
                successBox.classList.add("show");
            }

            previewList.innerHTML = validEmails.map((email, idx) => 
                `<div style="padding: 8px; background: white; border-radius: 4px; margin-bottom: 8px; border-left: 3px solid var(--sky);">
                    <strong>${idx + 1}.</strong> ${email}
                </div>`
            ).join("");
            
            successBox.textContent = `OK Ready to invite ${validEmails.length} faculty member${validEmails.length !== 1 ? 's' : ''}`;
            successBox.classList.add("show");
            previewContainer.style.display = "block";
            
            // Store validated emails for sending
            window.validEmailsToInvite = validEmails;
        }

        async function sendBulkInvites() {
            const validEmails = window.validEmailsToInvite || [];
            if (validEmails.length === 0) {
                alert("No valid emails to invite");
                return;
            }

            if (apiToken && apiRole === 'admin') {
                let sentCount = 0;
                let emailedCount = 0;
                const failed = [];
                const mailWarnings = [];
                for (const email of validEmails) {
                    try {
                        const result = await apiRequest('/api/invites', {
                            method: 'POST',
                            body: { email }
                        });
                        inviteDB.push(normalizeInvite(result.invite));
                        sentCount++;
                        if (result.emailSent) {
                            emailedCount++;
                        } else {
                            mailWarnings.push(`${email}: ${result.emailError || 'Gmail is not configured or rejected the email'}`);
                        }
                    } catch (error) {
                        failed.push(`${email}: ${error.message || 'failed'}`);
                    }
                }
                document.getElementById("bulk-invite-emails").value = "";
                document.getElementById("bulk-preview-container").style.display = "none";
                document.getElementById("bulk-invite-success").classList.remove("show");
                const successBox = document.getElementById("bulk-invite-success");
                const summary = `Created ${sentCount} invite(s), Gmail sent ${emailedCount} email(s).`;
                const warnings = mailWarnings.length ? ` Email warnings: ${mailWarnings.join(", ")}` : '';
                const failures = failed.length ? ` Failed: ${failed.join(", ")}` : '';
                successBox.textContent = `${summary}${warnings}${failures}`;
                successBox.classList.add("show");
                window.validEmailsToInvite = [];
                await renderInvitationsStatus();
                renderPendingInvites();
                return;
            }

            alert('Please sign in as admin. Invites are saved only through MongoDB.');
            return;
        }
        async function renderInvitationsStatus() {
            await loadInvitesFromApi();
            const container = document.getElementById("invitations-status-list");
            
            if (inviteDB.length === 0) {
                container.innerHTML = '<div style="color: var(--slate); padding: 12px; text-align: center;">No invitations sent yet</div>';
                return;
            }

            container.innerHTML = inviteDB.map(invite => {
                const statusColor = {
                    "sent": "var(--sky)",
                    "accepted": "var(--forest)",
                    "rejected": "var(--error-color)"
                }[invite.status] || "var(--slate)";

                return `<div style="padding: 12px; background: white; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid ${statusColor}; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600; color: var(--ink);">${escapeHtml(invite.email)}</div>
                        <div style="font-size: 12px; color: var(--slate); margin-top: 4px;">Sent: ${invite.sentOn}</div>
                        <div style="font-size: 12px; color: ${invite.emailSent ? 'var(--forest)' : 'var(--error-color)'}; margin-top: 4px;">${invite.emailSent ? 'Gmail sent' : escapeHtml(invite.emailError || 'Gmail not sent')}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 12px; font-weight: 600; color: ${statusColor}; text-transform: uppercase;">${invite.status}</div>
                    </div>
                </div>`;
            }).join("");
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                // Silently copy without notification
            }).catch(() => {
                alert('Failed to copy');
            });
        }

        async function renderPendingInvites() {
            await loadInvitesFromApi();
            const container = document.getElementById("pending-invites-list");
            if (inviteDB.length === 0) {
                container.innerHTML = '<div style="color: var(--slate);">No pending invites</div>';
                return;
            }

            let html = '<div style="border: 1px solid var(--line); border-radius: 6px; overflow: hidden;">';
            inviteDB.forEach((invite, index) => {
                html += `
                    <div style="padding: 12px; border-bottom: ${index < inviteDB.length - 1 ? '1px solid var(--line)' : 'none'}; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600; color: var(--ink);">${escapeHtml(invite.email)}</div>
                            <div style="font-size: 12px; color: var(--slate);">Sent on ${invite.sentOn}</div>
                        </div>
                        <button class="btn btn-ghost btn-small" onclick="removeInvite('${invite.id}')">Cancel</button>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        }

        async function removeInvite(inviteId) {
            try {
                await apiRequest(`/api/invites/${inviteId}`, { method: 'DELETE' });
                inviteDB = inviteDB.filter(i => String(i.id) !== String(inviteId));
                renderPendingInvites();
                renderInvitationsStatus();
                document.getElementById("invite-link-container").style.display = "none";
                return;
            } catch (error) {
                alert(error.network ? 'Backend unavailable. Invite was not cancelled.' : (error.message || 'Unable to cancel invite.'));
                return;
            }
        }

        function getInviteByCode(code) {
            if (!code) return null;
            return inviteDB.find(i => i.inviteCode && i.inviteCode.trim() === code.trim());
        }

        async function validateAndUseInvite(code) {
            if (!code) return null;
            const invite = getInviteByCode(code);
            if (invite) {
                currentInviteCode = code;
                return invite.email;
            }
            try {
                const result = await apiRequest(`/api/invites/lookup/${encodeURIComponent(code)}`, { auth: false });
                currentInviteCode = code;
                return result.invite.email;
            } catch (error) {
                if (!error.network) console.warn('Backend invite lookup failed:', error.message);
            }
            console.warn('Invite code not found:', code, 'Available codes:', inviteDB.map(i => i.inviteCode));
            return null;
        }

        function setLoginRole(role) {
            if (inviteRegistrationMode && role === 'admin') role = 'faculty';
            loginRole = role;
            document.getElementById("tab-faculty").classList.toggle("active", role === "faculty");
            const adminTab = document.getElementById("tab-admin");
            adminTab.classList.toggle("active", role === "admin");
            adminTab.hidden = inviteRegistrationMode;
            adminTab.setAttribute('aria-hidden', String(inviteRegistrationMode));
            document.getElementById("login-title").textContent = role === "admin" ? "Admin sign in" : "Faculty sign in";
            document.getElementById("login-sub").textContent = role === "admin"
                ? "Reach the registrar console to manage requests."
                : "Enter your credentials to reach your dashboard.";
            const loginHint = document.getElementById("login-hint");
            loginHint.hidden = role !== "admin";
            loginHint.style.display = role === "admin" ? "block" : "none";
            document.getElementById("login-email").value = "";
            document.getElementById("login-password").value = "";
        }

        function setInviteRegistrationMode(enabled) {
            inviteRegistrationMode = Boolean(enabled);
            try {
                if (inviteRegistrationMode) {
                    sessionStorage.setItem('prestigeInviteFacultyMode', 'true');
                } else {
                    sessionStorage.removeItem('prestigeInviteFacultyMode');
                }
            } catch (error) {
                console.warn('Invite session preference could not be saved:', error);
            }
            document.documentElement.classList.toggle('invite-faculty-only', inviteRegistrationMode);
            if (inviteRegistrationMode) {
                loginRole = 'faculty';
            }
            const adminTab = document.getElementById("tab-admin");
            adminTab.hidden = inviteRegistrationMode;
            adminTab.setAttribute('aria-hidden', String(inviteRegistrationMode));
            const inviteNotice = document.getElementById('invite-registration-notice');
            if (inviteNotice) inviteNotice.hidden = !inviteRegistrationMode;
            const signupButton = document.getElementById('signup-submit-button');
            if (signupButton && inviteRegistrationMode) signupButton.disabled = true;
            if (inviteRegistrationMode) setLoginRole('faculty');
        }

        function updateHeaderStats() {
            const approved = facultyDB.filter(f => f.status === "approved").length;
            const pending = facultyDB.filter(f => f.status === "pending").length;
            document.getElementById("stat-approved-count").textContent = approved;
            document.getElementById("stat-pending-count").textContent = pending;
        }

        /* ============ LOGIN ============ */
        async function handleLogin() {
            clearErrors();
            const email = document.getElementById("login-email").value.trim().toLowerCase();
            const password = document.getElementById("login-password").value;
            const errBox = document.getElementById("login-error");

            if (!email || !password) {
                errBox.textContent = "Enter both email and password.";
                errBox.classList.add("show");
                return;
            }

            try {
                const result = await apiRequest('/api/auth/login', {
                    method: 'POST',
                    auth: false,
                    body: { email, password, role: loginRole }
                });
                setApiSession(result.token, result.role);
                if (result.role === 'admin') {
                    await loadFacultyFromApi();
                    await loadAdminsFromApi();
                    await loadInvitesFromApi();
                    await loadTimeSettingsFromApi();
                    await loadSubjectsFromApi();
                    await loadDashboardTimetablesFromApi();
                    await loadDashboardHistoryFromApi();
                    if (!await loadAppSettingsFromApi()) {
                        setApiSession('', '');
                        throw new Error('Application settings could not be loaded from the database. Please try again.');
                    }
                    openAdmin();
                } else {
                    await loadTimeSettingsFromApi();
                    await loadSubjectsFromApi();
                    await loadDashboardTimetablesFromApi();
                    openFaculty(result.user);
                }
                return;
            } catch (error) {
                if (error.status === 403 && error.payload?.faculty) {
                    showPendingScreen(error.payload.faculty.status === 'rejected' ? 'rejected' : 'pending', error.payload.faculty);
                    return;
                }
                errBox.textContent = error.network ? 'Backend unavailable. Start the backend server and check MongoDB connection.' : (error.message || 'Unable to sign in.');
                errBox.classList.add("show");
                return;
            }
        }

        /* ============ SIGNUP ============ */
        async function handleSignup() {
            clearErrors();
            if (inviteRegistrationMode && !currentInviteCode) {
                const errBox = document.getElementById("signup-error");
                errBox.textContent = 'This invitation is invalid or expired. Please contact your administrator for a new invite.';
                errBox.classList.add("show");
                return;
            }
            const name = document.getElementById("su-name").value.trim();
            const dept = document.getElementById("su-dept").value.trim();
            const empid = document.getElementById("su-empid").value.trim();
            const email = document.getElementById("su-email").value.trim().toLowerCase();
            const password = document.getElementById("su-password").value;
            const errBox = document.getElementById("signup-error");

            if (!name || !dept || !empid || !email || !password) {
                errBox.textContent = "Please fill in every field.";
                errBox.classList.add("show");
                return;
            }
            if (facultyDB.some(u => u.email.toLowerCase() === email)) {
                errBox.textContent = "An account with this email already exists.";
                errBox.classList.add("show");
                return;
            }

            // If invite code is present, validate it
            if (currentInviteCode) {
                const invite = getInviteByCode(currentInviteCode);
                if (invite && invite.email.toLowerCase() !== email) {
                    errBox.textContent = "The email does not match the invited email address.";
                    errBox.classList.add("show");
                    return;
                }
            }

            try {
                const result = await apiRequest('/api/faculty/signup', {
                    method: 'POST',
                    auth: false,
                    body: { name, dept, empid, email, password, inviteCode: currentInviteCode }
                });
                const record = result.faculty;
                pendingFacultyStatusToken = result.statusToken || '';
                pendingFacultyRecord = record;
                facultyDB.push(record);
                if (currentInviteCode) {
                    await loadInvitesFromApi();
                    currentInviteCode = null;
                }
                ["su-name", "su-dept", "su-empid", "su-email", "su-password"].forEach(id => document.getElementById(id).value = "");
                updateHeaderStats();
                renderManageFaculty();
                startManageFacultyAutoRefresh();
                showPendingScreen("pending", record);
                startPendingFacultyStatusChecks();
                return;
            } catch (error) {
                errBox.textContent = error.network ? 'Backend unavailable. Registration was not saved.' : (error.message || 'Unable to submit registration.');
                errBox.classList.add("show");
                return;
            }
        }

        function showPendingScreen(kind, record) {
            showScreen("pending");
            const stamp = document.getElementById("pending-stamp");
            const stampText = document.getElementById("pending-stamp-text");
            const title = document.getElementById("pending-title");
            const text = document.getElementById("pending-text");
            const action = document.getElementById("pending-login-button");
            const statusNote = document.getElementById("pending-status-note");
            pendingFacultyRecord = record;

            stamp.classList.remove("approved");
            if (kind === "pending") {
                stampText.innerHTML = "PENDING<br>REVIEW";
                title.textContent = "Request received";
                text.textContent = `Hi ${record.name.split(' ')[0]}, your registration has been sent to the admin office. You'll be able to sign in as soon as it's approved.`;
                statusNote.textContent = "Checking for approval automatically.";
                action.textContent = "Back to sign in";
            } else if (kind === "approved") {
                stamp.classList.add("approved");
                stampText.textContent = "ACCESS GRANTED";
                title.textContent = "Your faculty access is approved";
                text.textContent = `Hi ${record.name.split(' ')[0]}, your account is ready. Sign in with the email and password you registered with.`;
                statusNote.textContent = "";
                action.textContent = "Sign in now";
            } else {
                stampText.innerHTML = "NOT<br>APPROVED";
                title.textContent = "Access not granted";
                text.textContent = "The admin office did not approve this registration. Contact the registrar for details.";
                statusNote.textContent = "";
                action.textContent = "Back to sign in";
            }
        }

        function continueFromPendingScreen() {
            const email = pendingFacultyRecord?.email || '';
            showScreen("login");
            setLoginRole("faculty");
            document.getElementById("login-email").value = email;
        }

        function stopPendingFacultyStatusChecks() {
            if (pendingFacultyStatusTimer) {
                clearTimeout(pendingFacultyStatusTimer);
                pendingFacultyStatusTimer = null;
            }
            pendingFacultyStatusToken = '';
        }

        async function checkPendingFacultyStatus() {
            if (!pendingFacultyStatusToken || !document.getElementById("screen-pending").classList.contains("active")) {
                stopPendingFacultyStatusChecks();
                return;
            }

            try {
                const result = await apiRequest('/api/faculty/status', {
                    method: 'POST',
                    auth: false,
                    body: { statusToken: pendingFacultyStatusToken }
                });
                pendingFacultyRecord = result.faculty;
                document.getElementById("pending-status-note").textContent =
                    "Checking for approval automatically.";
                if (result.faculty.status === 'approved' || result.faculty.status === 'rejected') {
                    stopPendingFacultyStatusChecks();
                    showPendingScreen(result.faculty.status, result.faculty);
                    return;
                }
            } catch (error) {
                console.warn('Faculty approval status could not be checked; retrying shortly:', error.message);
                document.getElementById("pending-status-note").textContent =
                    "Unable to check right now. We'll retry automatically.";
            }

            pendingFacultyStatusTimer = setTimeout(checkPendingFacultyStatus, PENDING_FACULTY_STATUS_POLL_INTERVAL_MS);
        }

        function startPendingFacultyStatusChecks() {
            if (pendingFacultyStatusTimer) {
                clearTimeout(pendingFacultyStatusTimer);
                pendingFacultyStatusTimer = null;
            }
            if (pendingFacultyStatusToken) {
                void checkPendingFacultyStatus();
            }
        }

        /* ============ ADMIN DASHBOARD ============ */
        async function openAdmin() {
            showScreen("admin");
            setAdminPanel("convertor");
            await loadFacultyFromApi();
            await loadAdminsFromApi();
            await loadInvitesFromApi();
            await loadTimeSettingsFromApi();
            renderManageFaculty();
            const dateStr = formatToday();
            // Update all admin date chips
            document.getElementById("admin-date").textContent = dateStr;
            document.getElementById("admin-date-admin").textContent = dateStr;
            document.getElementById("admin-date-form").textContent = dateStr;
            document.getElementById("admin-date-workload").textContent = dateStr;
            document.getElementById("admin-date-lab").textContent = dateStr;
            document.getElementById("admin-date2").textContent = dateStr;
            document.getElementById("admin-date3").textContent = dateStr;
            document.getElementById("admin-date4").textContent = dateStr;
            document.getElementById("admin-date5").textContent = dateStr;
            document.getElementById("admin-date6").textContent = dateStr;
            document.getElementById("admin-date7").textContent = dateStr;
            document.getElementById("admin-date8").textContent = dateStr;
            renderManageLabs();
        }

        let manageFacultyRefreshInterval = null;
        let manageFacultyRefreshInFlight = false;
        let viewFacultyRefreshInterval = null;
        let viewFacultyRefreshInFlight = false;
        
        function startManageFacultyAutoRefresh() {
            stopManageFacultyAutoRefresh();
            manageFacultyRefreshInterval = setInterval(() => {
                if (document.getElementById("panel-manage")?.classList.contains("active") && !manageFacultyRefreshInFlight) {
                    manageFacultyRefreshInFlight = true;
                    void renderManageFaculty().finally(() => {
                        manageFacultyRefreshInFlight = false;
                    });
                }
            }, 2000);
        }
        
        function stopManageFacultyAutoRefresh() {
            if (manageFacultyRefreshInterval) {
                clearInterval(manageFacultyRefreshInterval);
                manageFacultyRefreshInterval = null;
            }
        }

        function startViewFacultyAutoRefresh() {
            stopViewFacultyAutoRefresh();
            void refreshViewFaculty();
            viewFacultyRefreshInterval = setInterval(() => {
                if (document.getElementById("panel-add-faculty")?.classList.contains("active")) {
                    void refreshViewFaculty();
                }
            }, 3000);
        }

        function stopViewFacultyAutoRefresh() {
            if (viewFacultyRefreshInterval) {
                clearInterval(viewFacultyRefreshInterval);
                viewFacultyRefreshInterval = null;
            }
        }

        function setAdminPanel(which) {
            document.querySelectorAll('.sidebar .side-item').forEach(item => item.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
            const navItem = document.getElementById(`nav-${which}`);
            const panelItem = document.getElementById(`panel-${which}`);
            if (navItem) navItem.classList.add('active');
            if (panelItem) panelItem.classList.add('active');
            if (which === "manage") {
                renderManageFaculty();
                renderInvitationsStatus();  // Refresh invitation status
                startManageFacultyAutoRefresh();
            } else {
                stopManageFacultyAutoRefresh();
            }
            if (which !== "add-faculty") stopViewFacultyAutoRefresh();
            if (which === "manage-admin") {
                loadAdminsFromApi();
                renderManageAdmin();
                renderInvitationsStatus();  // Show invitation status
            }
            if (which === "add-faculty") {
                startViewFacultyAutoRefresh();
            }
            if (which === "manage-lab") {
                renderManageLabs();
            }
            if (which === "manage-form") {
                renderManageFormSubjects();
                void loadFacultyFromApi().then(renderWorkloadFacultyOptions, renderWorkloadFacultyOptions);
            }
            if (which === "manage-workload") void renderManageWorkload();
            if (which === "see-workload") renderTeacherWorkload();
        }

        async function handleAddAdmin() {
            const name = document.getElementById("admin-name").value.trim();
            const email = document.getElementById("admin-email").value.trim().toLowerCase();
            const password = document.getElementById("admin-password").value;
            const errBox = document.getElementById("admin-add-error");
            const successBox = document.getElementById("admin-add-success");

            errBox.classList.remove("show");
            successBox.classList.remove("show");
            errBox.textContent = "";
            successBox.textContent = "";

            if (!name || !email || !password) {
                errBox.textContent = "Please fill in every field.";
                errBox.classList.add("show");
                return;
            }

            if (adminDB.some(a => a.email.toLowerCase() === email) || facultyDB.some(f => f.email.toLowerCase() === email)) {
                errBox.textContent = "An account with this email already exists.";
                errBox.classList.add("show");
                return;
            }

            try {
                const result = await apiRequest('/api/admins', {
                    method: 'POST',
                    body: { name, email, password }
                });
                adminDB.push(result.admin);
                document.getElementById("admin-name").value = "";
                document.getElementById("admin-email").value = "";
                document.getElementById("admin-password").value = "";
                await renderManageAdmin();
                successBox.textContent = "Admin account created successfully.";
                successBox.classList.add("show");
                return;
            } catch (error) {
                errBox.textContent = error.network ? 'Backend unavailable. Admin account was not saved.' : (error.message || 'Unable to create admin account.');
                errBox.classList.add("show");
                return;
            }
        }

        async function renderManageAdmin() {
            await loadAdminsFromApi();
            const adminList = document.getElementById("admin-list");
            adminList.innerHTML = "";
            if (adminDB.length === 0) {
                adminList.innerHTML = `<div class="empty-note">No admin accounts yet.</div>`;
                return;
            }

            adminDB.slice().reverse().forEach(admin => {
                const row = document.createElement("div");
                row.className = "req-row";
                row.innerHTML = `
        <div class="avatar">${initials(admin.name)}</div>
        <div class="req-info">
          <div class="req-name">${escapeHtml(admin.name)}</div>
          <div class="req-meta">${escapeHtml(admin.email)}</div>
        </div>
        <span class="status-pill approved">Admin</span>`;
                adminList.appendChild(row);
            });
        }

        async function renderManageFaculty() {
            const loaded = await loadFacultyFromApi();
            const errorMessage = document.getElementById('manage-faculty-load-error');
            if (errorMessage) {
                errorMessage.textContent = loaded ? '' : 'Faculty records could not be loaded from the database. Check the backend connection and refresh.';
                errorMessage.classList.toggle('show', !loaded);
            }
            if (!loaded) return;
            console.log('renderManageFaculty called, facultyDB length:', facultyDB.length, 'facultyDB:', facultyDB);
            const pending = facultyDB.filter(f => f.status === "pending");
            const approved = facultyDB.filter(f => f.status === "approved");
            const all = facultyDB.filter(f => f.status !== "pending");

            console.log('Pending faculty:', pending.length, 'Approved faculty:', approved.length);

            // Track pending count changes (without notifications)
            lastSeenPendingFaculty = [...pending];
            lastPendingCount = pending.length;

            document.getElementById("stat-a").textContent = pending.length;
            document.getElementById("stat-b").textContent = approved.length;
            document.getElementById("stat-c").textContent = facultyDB.length;
            document.getElementById("sidebar-pending-badge").textContent = pending.length;
            updateHeaderStats();

            const pendingList = document.getElementById("pending-list");
            pendingList.innerHTML = "";
            if (pending.length === 0) {
                pendingList.innerHTML = `<div class="empty-note">No pending requests right now. New faculty registrations will appear here.</div>`;
            } else {
                pending.forEach(f => {
                    const row = document.createElement("div");
                    row.className = "req-row";
                    row.innerHTML = `
        <div class="avatar">${initials(f.name)}</div>
        <div class="req-info">
          <div class="req-name">${escapeHtml(f.name)}</div>
          <div class="req-meta">${escapeHtml(f.dept)} | <span class="mono">${escapeHtml(f.empid)}</span> | ${escapeHtml(f.email)} | applied ${f.appliedOn}</div>
        </div>
        <div class="req-actions">
          <button class="act-btn act-approve" onclick="decide(${f.id}, 'approved')">Grant access</button>
          <button class="act-btn act-reject" onclick="decide(${f.id}, 'rejected')">Deny</button>
          <button class="act-btn act-reject" onclick="removeFaculty(${f.id})">Remove</button>
        </div>`;
                    pendingList.appendChild(row);
                });
            }

            const allList = document.getElementById("all-list");
            allList.innerHTML = "";
            if (all.length === 0) {
                allList.innerHTML = `<div class="empty-note">No faculty registrations yet.</div>`;
            } else {
                all.slice().reverse().forEach(f => {
                    const row = document.createElement("div");
                    row.className = "req-row";
                    row.innerHTML = `
        <div class="avatar">${initials(f.name)}</div>
        <div class="req-info">
          <div class="req-name">${escapeHtml(f.name)}</div>
          <div class="req-meta">${escapeHtml(f.dept)} | <span class="mono">${escapeHtml(f.empid)}</span> | ${escapeHtml(f.email)}</div>
        </div>
        <div class="req-actions">
          <button class="act-btn act-reject" onclick="removeFaculty(${f.id})">Remove</button>
          <span class="status-pill ${f.status}">${f.status}</span>
        </div>`;
                    allList.appendChild(row);
                });
            }
        }

        async function refreshViewFaculty() {
            if (!apiToken || apiRole !== 'admin' || viewFacultyRefreshInFlight) return false;
            viewFacultyRefreshInFlight = true;
            const errorMessage = document.getElementById('view-faculty-load-error');
            try {
                const [facultyPayload, settingsPayload] = await Promise.all([
                    apiRequest('/api/faculty'),
                    apiRequest('/api/app-settings')
                ]);
                facultyDB = facultyPayload.faculty || [];
                const settings = settingsPayload.settings || {};
                manualTeacherRoster = Array.isArray(settings.teacherRoster)
                    ? [...new Set(settings.teacherRoster.map(name => String(name || '').trim()).filter(Boolean))]
                    : [];
                syncApprovedFacultyNamesToTeacherRoster();
                renderTeachers(document.getElementById('teacherSearch')?.value || '');
                if (errorMessage) {
                    errorMessage.textContent = '';
                    errorMessage.classList.remove('show');
                }
                return true;
            } catch (error) {
                console.warn('View Faculty records could not be refreshed from MongoDB:', error);
                if (error.status === 401) setApiSession('', '');
                if (errorMessage) {
                    errorMessage.textContent = 'Faculty list could not be refreshed from the database. Check the connection and retry.';
                    errorMessage.classList.add('show');
                }
                return false;
            } finally {
                viewFacultyRefreshInFlight = false;
            }
        }

        async function refreshManageFaculty() {
            console.log('Manual refresh clicked');
            await renderManageFaculty();
        }

        function syncApprovedFacultyNamesToTeacherRoster() {
            const existing = new Set();
            teacherRoster.length = 0;
            manualTeacherRoster.forEach(name => {
                const normalized = normalizeTeacherName(name);
                if (!normalized || existing.has(normalized)) return;
                teacherRoster.push(name);
                existing.add(normalized);
            });
            facultyDB
                .filter(f => f.status === 'approved' && f.name)
                .forEach(f => {
                    const normalized = normalizeTeacherName(f.name);
                    if (!normalized || existing.has(normalized)) return;
                    teacherRoster.push(f.name.trim());
                    existing.add(normalized);
                });
        }

        async function decide(id, decision) {
            const f = facultyDB.find(x => x.id === id);
            if (!f) return;

            try {
                const action = decision === 'approved' ? 'approve' : 'reject';
                const result = await apiRequest(`/api/faculty/${id}/${action}`, { method: 'PATCH' });
                Object.assign(f, result.faculty);
                if (decision === "approved") syncApprovedFacultyNamesToTeacherRoster();
                await renderManageFaculty();
                await renderInvitationsStatus();
                renderTeachers(document.getElementById('teacherSearch')?.value || '');
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotTeacherDropdown(); } catch (e) {}
                return;
            } catch (error) {
                alert(error.network ? 'Backend unavailable. Faculty status was not changed.' : (error.message || 'Unable to update faculty status.'));
                return;
            }
        }

        async function removeFaculty(id) {
            if (confirm("Are you sure you want to remove this faculty record? This action cannot be undone.")) {
                try {
                    await apiRequest(`/api/faculty/${id}`, { method: 'DELETE' });
                    facultyDB = facultyDB.filter(f => f.id !== id);
                    syncApprovedFacultyNamesToTeacherRoster();
                    if (currentFacultyId === id) {
                        currentFacultyId = null;
                        currentFaculty = null;
                    }
                    await renderManageFaculty();
                    await renderInvitationsStatus();
                    return;
                } catch (error) {
                    alert(error.network ? 'Backend unavailable. Faculty record was not removed.' : (error.message || 'Unable to remove faculty record.'));
                    return;
                }
            }
        }

        function initials(name) {
            return name.split(' ').filter(w => w[0] && w[0] !== 'D' && w[0] !== '.').slice(0, 1)
                .concat(name.split(' ').slice(-1))
                .map(w => (w || '').replace(/[^A-Za-z]/g, '')[0] || '')
                .join('').toUpperCase().slice(0, 2) || name[0].toUpperCase();
        }

        function escapeHtml(str) {
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        }

        function formatToday() {
            return new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
        }

        const teacherRoster = [];
        let manualTeacherRoster = [];
        let subjectCatalog = [];
        let labCatalog = [];
        let labTimetable = {};
        let manageFormLectureCounts = {};
        let manageFormSubjectSelections = {};
        const LAB_CATALOG_STORAGE_KEY = 'prestigeLabCatalog';
        const LAB_TIMETABLE_STORAGE_KEY = 'prestigeLabTimetable';
        const MANAGE_FORM_COUNTS_STORAGE_KEY = 'prestigeManageFormLectureCounts';
        const MANAGE_FORM_SUBJECTS_STORAGE_KEY = 'prestigeManageFormSubjectSelections';
        const LEGACY_APP_SETTINGS_KEYS = [
            LAB_CATALOG_STORAGE_KEY,
            LAB_TIMETABLE_STORAGE_KEY,
            MANAGE_FORM_COUNTS_STORAGE_KEY,
            MANAGE_FORM_SUBJECTS_STORAGE_KEY
        ];
        let appSettingsLoaded = false;
        let appSettingsSaveQueue = Promise.resolve();
        let appSettingsSaveTimer = null;

        function parseLegacyAppSetting(key, fallback, isValid) {
            try {
                const rawValue = localStorage.getItem(key);
                if (rawValue === null) return { found: false, value: fallback };
                const value = JSON.parse(rawValue);
                return isValid(value)
                    ? { found: true, value }
                    : { found: true, value: fallback };
            } catch (error) {
                console.warn(`Legacy app setting ${key} could not be read:`, error);
                return { found: false, value: fallback };
            }
        }

        function readLegacyAppSettings() {
            const labCatalog = parseLegacyAppSetting(LAB_CATALOG_STORAGE_KEY, [], Array.isArray);
            const labTimetable = parseLegacyAppSetting(LAB_TIMETABLE_STORAGE_KEY, {}, value => value && typeof value === 'object' && !Array.isArray(value));
            const lectureCounts = parseLegacyAppSetting(MANAGE_FORM_COUNTS_STORAGE_KEY, {}, value => value && typeof value === 'object' && !Array.isArray(value));
            const subjectSelections = parseLegacyAppSetting(MANAGE_FORM_SUBJECTS_STORAGE_KEY, {}, value => value && typeof value === 'object' && !Array.isArray(value));
            return {
                settings: {
                    labCatalog: labCatalog.value,
                    labTimetable: labTimetable.value,
                    manageFormLectureCounts: lectureCounts.value,
                    manageFormSubjectSelections: subjectSelections.value
                }
            };
        }

        function applyAppSettings(settings = {}) {
            labCatalog = Array.isArray(settings.labCatalog) ? settings.labCatalog : [];
            labTimetable = settings.labTimetable && typeof settings.labTimetable === 'object' && !Array.isArray(settings.labTimetable)
                ? settings.labTimetable
                : {};
            manageFormLectureCounts = settings.manageFormLectureCounts && typeof settings.manageFormLectureCounts === 'object' && !Array.isArray(settings.manageFormLectureCounts)
                ? settings.manageFormLectureCounts
                : {};
            manageFormSubjectSelections = settings.manageFormSubjectSelections && typeof settings.manageFormSubjectSelections === 'object' && !Array.isArray(settings.manageFormSubjectSelections)
                ? settings.manageFormSubjectSelections
                : {};
            manualTeacherRoster = Array.isArray(settings.teacherRoster)
                ? [...new Set(settings.teacherRoster.map(name => String(name || '').trim()).filter(Boolean))]
                : [];
            syncApprovedFacultyNamesToTeacherRoster();
            renderManageLabs();
            renderManageFormSubjects();
        }

        function setAppSettingsSaveStatus(message, failed = false) {
            document.querySelectorAll('[data-app-settings-save-status]').forEach(status => {
                status.textContent = message;
                status.style.color = failed ? '#b91c1c' : '';
            });
        }

        function getAppSettingsSnapshot() {
            return {
                labCatalog,
                labTimetable,
                manageFormLectureCounts,
                manageFormSubjectSelections,
                teacherRoster: manualTeacherRoster
            };
        }

        async function saveAppSettingsToApi() {
            if (!appSettingsLoaded || !apiToken || apiRole !== 'admin') return false;
            clearTimeout(appSettingsSaveTimer);
            const settings = getAppSettingsSnapshot();
            const request = appSettingsSaveQueue.catch(() => {}).then(() => apiRequest('/api/app-settings', {
                method: 'PUT',
                body: { settings }
            }));
            appSettingsSaveQueue = request;

            try {
                await request;
                setAppSettingsSaveStatus('Saved to database.');
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                console.warn('App settings were not saved to MongoDB:', error);
                setAppSettingsSaveStatus('Not saved to database. Retry when the backend is available.', true);
                return false;
            }
        }

        function queueAppSettingsSave() {
            if (!appSettingsLoaded || !apiToken || apiRole !== 'admin') return;
            clearTimeout(appSettingsSaveTimer);
            setAppSettingsSaveStatus('Saving to database...');
            appSettingsSaveTimer = setTimeout(() => {
                saveAppSettingsToApi();
            }, 400);
        }

        async function loadAppSettingsFromApi() {
            if (!apiToken || apiRole !== 'admin') return false;
            try {
                const payload = await apiRequest('/api/app-settings');
                if (payload.settings) {
                    applyAppSettings(payload.settings);
                } else {
                    const legacy = readLegacyAppSettings();
                    applyAppSettings(legacy.settings);
                    await apiRequest('/api/app-settings', {
                        method: 'PUT',
                        body: { settings: legacy.settings }
                    });
                }
                appSettingsLoaded = true;
                LEGACY_APP_SETTINGS_KEYS.forEach(key => {
                    try {
                        localStorage.removeItem(key);
                    } catch (error) {
                        console.warn(`Legacy app setting ${key} could not be removed:`, error);
                    }
                });
                setAppSettingsSaveStatus('Loaded from database.');
                return true;
            } catch (error) {
                if (error.status === 401) setApiSession('', '');
                console.warn('App settings were not loaded from MongoDB:', error);
                setAppSettingsSaveStatus('Database settings could not be loaded.', true);
                return false;
            }
        }

        function subjectIdentity(item = {}) {
            return [
                item.course || 'B.Tech',
                item.semester || 'semester1',
                item.category || 'main',
                item.electiveType || 'program',
                item.isLab ? 'lab' : 'subject',
                String(item.name || '').trim().toLowerCase(),
                String(item.code || '').trim().toLowerCase()
            ].join('|');
        }

        function getLabSubjectOptions() {
            return subjectCatalog
                .filter(item => item?.isLab && item.name)
                .slice()
                .sort((a, b) => {
                    const courseCompare = String(a.course || '').localeCompare(String(b.course || ''));
                    if (courseCompare) return courseCompare;
                    const semesterCompare = String(a.semester || '').localeCompare(String(b.semester || ''));
                    if (semesterCompare) return semesterCompare;
                    return String(a.name || '').localeCompare(String(b.name || ''));
                });
        }

        function renderManageLabSubjects() {
            const list = document.getElementById('lab-subject-list');
            if (!list) return;

            const labSubjects = getLabSubjectOptions();
            if (!labSubjects.length) {
                list.innerHTML = '<div class="lab-empty">No lab subjects added yet. Use Add Subject and select "Is Lab".</div>';
                return;
            }

            list.innerHTML = labSubjects.map((item) => {
                const key = subjectIdentity(item);
                const label = item.code ? `${item.name} (${item.code})` : item.name;
                const meta = [item.course, semesterToRomanLabel(item.semester)].filter(Boolean).join(' | ');
                return `
                    <label class="lab-subject-option">
                        <input type="checkbox" value="${escapeHtml(key)}">
                        <span>${escapeHtml(label)}${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span>
                    </label>
                `;
            }).join('');
        }

        function renderLabs() {
            const list = document.getElementById('lab-list');
            if (!list) return;

            if (!labCatalog.length) {
                list.innerHTML = '<div class="lab-empty">No labs created yet.</div>';
                return;
            }

            list.innerHTML = labCatalog.map((lab) => {
                const subjects = (lab.subjects || []).map(subject => escapeHtml(subject.label)).join(', ') || 'No subjects assigned';
                return `
                    <div class="lab-item">
                        <div>
                            <div class="lab-item-title">${escapeHtml(lab.name)}</div>
                            <div class="lab-item-meta">${escapeHtml(lab.id)} | ${subjects}</div>
                        </div>
                        <button type="button" class="btn btn-ghost" style="width:auto;" data-lab-delete="${escapeHtml(lab.id)}">Delete</button>
                    </div>
                `;
            }).join('');

            list.querySelectorAll('[data-lab-delete]').forEach((button) => {
                button.addEventListener('click', () => deleteLab(button.dataset.labDelete || ''));
            });
        }

        function renderManageLabs() {
            renderManageLabSubjects();
            renderLabs();
            renderLabTimetable();
        }

        function getLabTimetableSubjects(lab) {
            return (lab.subjects || []).filter(subject => subject?.label);
        }

        function normalizeLabSubjectValue(value) {
            return String(value || '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();
        }

        function getSlotSubjectLabels(slot = {}) {
            const labels = [];
            if (slot.subject) labels.push(slot.subject);
            if (slot.subjectName) labels.push(slot.subjectName);
            if (slot.subjectName && slot.subjectCode) labels.push(`${slot.subjectName} (${slot.subjectCode})`);
            return labels.map(normalizeLabSubjectValue).filter(Boolean);
        }

        function getDashboardSlotAssignments(slot = {}) {
            if (Array.isArray(slot.batchAssignments) && slot.batchAssignments.length) {
                return slot.batchAssignments;
            }
            if (!slot.subject && !slot.teacher) return [];
            return [{
                subject: slot.subject || '',
                subjectName: slot.subjectName || '',
                subjectCode: slot.subjectCode || '',
                teacher: slot.teacher || '',
                room: slot.room || '',
                classType: slot.classType || 'Lecture'
            }];
        }

        function getTeacherSlotAssignment(slot = {}, teacherName) {
            const normalizedTeacher = normalizeTeacherName(teacherName);
            return getDashboardSlotAssignments(slot).find(assignment => (
                normalizeTeacherName(assignment.teacher) === normalizedTeacher
            ));
        }

        function getSubjectLabelSet(label) {
            const labels = new Set([normalizeLabSubjectValue(label)]);
            const parsed = extractSubjectNameAndCodeGlobal(label || '');
            if (parsed.name) labels.add(normalizeLabSubjectValue(parsed.name));
            if (parsed.name && parsed.code) labels.add(normalizeLabSubjectValue(`${parsed.name} (${parsed.code})`));
            return labels;
        }

        function getLabsForSubject(course, semester, subjectLabel) {
            const subjectLabels = getSubjectLabelSet(subjectLabel);
            return labCatalog.filter((lab) => {
                return getLabTimetableSubjects(lab).some((subject) => {
                    if ((subject.course || 'B.Tech') !== course || (subject.semester || 'semester1') !== semester) return false;
                    const labLabels = getSubjectLabelSet(subject.label || '');
                    return Array.from(subjectLabels).some(label => labLabels.has(label));
                });
            });
        }

        function findLabReservationsForSlot(day, slotIndex, lab) {
            const labSubjects = getLabTimetableSubjects(lab);
            if (!labSubjects.length) return [];

            const labSubjectMatches = [];
            labSubjects.forEach((subject) => {
                const labels = new Set([normalizeLabSubjectValue(subject.label)]);
                const parsed = extractSubjectNameAndCodeGlobal(subject.label || '');
                if (parsed.name) labels.add(normalizeLabSubjectValue(parsed.name));
                if (parsed.name && parsed.code) labels.add(normalizeLabSubjectValue(`${parsed.name} (${parsed.code})`));
                labSubjectMatches.push({
                    course: subject.course || 'B.Tech',
                    semester: subject.semester || 'semester1',
                    labels
                });
            });

            const reservations = [];
            const courses = Array.from(new Set([
                ...Object.keys(dashboardTimetableSlotDataByCourse || {}),
                ...Object.keys(dashboardCourseSettings || {}),
                ...labSubjectMatches.map(subject => subject.course)
            ].filter(Boolean)));

            courses.forEach((courseName) => {
                const slotDataStore = getDashboardTimetableSlotData(courseName);
                Object.keys(slotDataStore).forEach((key) => {
                    const [slotSemester, section, slotDay, slotIndexText] = key.split('|');
                    if (slotDay !== day || Number(slotIndexText) !== slotIndex) return;

                    const slot = slotDataStore[key];
                    if (!slot || !slot.subject) return;

                    const isLabSlot = /lab/i.test(slot.classType || slot.subject || '');
                    if (!isLabSlot) return;

                    getDashboardSlotAssignments(slot).forEach(assignment => {
                        if (!/lab/i.test(assignment.classType || slot.classType || slot.subject || '')) return;
                        const slotLabels = getSlotSubjectLabels(assignment);
                        const matchingLabSubject = labSubjectMatches.find((subject) => (
                            subject.course === courseName
                            && subject.semester === slotSemester
                            && slotLabels.some(label => subject.labels.has(label))
                        ));
                        if (!matchingLabSubject) return;

                        reservations.push({
                            subject: assignment.subject || assignment.subjectName,
                            teacher: assignment.teacher || '',
                            room: assignment.room || '',
                            batch: assignment.batch || '',
                            course: courseName,
                            slotKey: key,
                            semester: semesterToRomanLabel(slotSemester),
                            section: section ? section.replace('section', 'Section ') : ''
                        });
                    });
                });
            });

            return reservations;
        }

        function findLabAssignmentConflict(day, slotIndex, course, semester, subjectLabel, excludedKeys = new Set()) {
            const labs = getLabsForSubject(course, semester, subjectLabel);
            for (const lab of labs) {
                const reservation = findLabReservationsForSlot(day, slotIndex, lab)
                    .find(item => !excludedKeys.has(`${item.course}|${item.slotKey}`));
                if (reservation) {
                    return { lab, reservation };
                }
            }
            return null;
        }

        function formatLabAssignmentConflict(conflict, day, slotIndex, course, semester) {
            if (!conflict) return '';
            const reservation = conflict.reservation || {};
            const lab = conflict.lab || {};
            const periodLabel = getDashboardPeriodTimes(course, semester)[slotIndex] || `slot ${slotIndex + 1}`;
            const classLabel = [reservation.course, reservation.semester, reservation.section].filter(Boolean).join(' - ');
            return [
                lab.name || lab.id || 'this lab',
                reservation.subject || '',
                day,
                periodLabel,
                classLabel
            ].filter(Boolean).join(' - ');
        }

        function renderLabTimetable() {
            const container = document.getElementById('lab-timetable');
            if (!container) return;

            const course = document.getElementById('time-setting-course')?.value || dashboardCourse || 'B.Tech';
            const semester = document.getElementById('time-setting-current-semester')?.value || dashboardTimetableState?.currentSemester || 'semester1';
            const periodTimes = getDashboardPeriodTimes(course, semester);
            const workingDays = getDashboardWorkingDays(course, semester);

            if (!labCatalog.length) {
                container.innerHTML = '<div class="lab-empty">Add labs first to build a lab timetable.</div>';
                return;
            }

            if (!periodTimes.length) {
                container.innerHTML = '<div class="lab-empty">No time slots found. Configure them in Time Setting.</div>';
                return;
            }

            const days = workingDays.length ? workingDays : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            container.innerHTML = days.map((day) => {
                const rows = labCatalog.map((lab) => {
                    const cells = periodTimes.map((time, slotIndex) => {
                        if (time === 'Lunch') {
                            return '<td class="lunch"><div class="slot-content">Lunch Break</div></td>';
                        }
                        const reservations = findLabReservationsForSlot(day, slotIndex, lab);
                        if (!reservations.length) {
                            return '<td><div class="slot-content">-</div></td>';
                        }
                        const subject = Array.from(new Set(reservations.map(item => (
                            item.batch ? `${item.batch}: ${item.subject}` : item.subject
                        ))).values()).join(', ');
                        const classes = Array.from(new Set(reservations.map((item) => {
                            return [item.course, item.semester, item.section].filter(Boolean).join(' - ');
                        }).filter(Boolean))).join(', ');
                        const teachers = Array.from(new Set(reservations.map(item => item.teacher).filter(Boolean))).join(', ');
                        const rooms = Array.from(new Set(reservations.map(item => item.room).filter(Boolean))).join(', ');
                        return `
                            <td class="reserved">
                                <div class="slot-content">Reserved</div>
                                <div class="lab-reserved-subject">${escapeHtml(subject)}</div>
                                ${classes ? `<div class="lab-reserved-meta">${escapeHtml(classes)}</div>` : ''}
                                ${teachers ? `<div class="lab-reserved-meta">${escapeHtml(teachers)}</div>` : ''}
                                ${rooms ? `<div class="lab-reserved-meta">${escapeHtml(rooms)}</div>` : ''}
                            </td>
                        `;
                    }).join('');
                    return `
                        <tr>
                            <th>
                                <span class="lab-row-name">${escapeHtml(lab.name)}</span>
                                <small>${escapeHtml(lab.id)}</small>
                            </th>
                            ${cells}
                        </tr>
                    `;
                }).join('');

                return `
                    <div class="lab-day-block">
                        <h3 class="lab-day-title">${escapeHtml(day)}</h3>
                        <div class="lab-timetable-grid">
                            <table class="lab-timetable-table">
                                <thead>
                                    <tr>
                                        <th>Lab Name/Time</th>
                                        ${periodTimes.map(time => `<th>${escapeHtml(time)}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function saveManageFormLectureCounts() {
            document.querySelectorAll('[data-manage-form-count]').forEach(input => {
                manageFormLectureCounts[input.dataset.manageFormCount] = input.value;
            });
            queueAppSettingsSave();
        }

        function saveManageFormSubjectSelections() {
            document.querySelectorAll('[data-manage-form-subject]').forEach(input => {
                manageFormSubjectSelections[input.dataset.manageFormSubject] = input.checked;
            });
            queueAppSettingsSave();
        }

        function getManageFormControls() {
            const controls = document.querySelectorAll('.manage-form-controls select');
            const activeTab = document.querySelector('.manage-form-tab.active');
            const tabText = String(activeTab?.textContent || 'Main').trim().toLowerCase();
            const category = tabText.includes('departmental')
                ? 'departmental'
                : tabText.includes('open')
                    ? 'open'
                    : tabText.includes('placement')
                        ? 'placement'
                        : 'main';
            const semesterText = String(controls[1]?.value || 'semester 1').toLowerCase().replace(/\s+/g, '');

            return {
                course: controls[0]?.value || dashboardCourse || 'B.Tech',
                semester: semesterText || 'semester1',
                category
            };
        }

        function subjectMatchesManageFormCategory(item, category) {
            const itemCategory = item.category || 'main';
            if (category === 'departmental') return itemCategory === 'elective' && (item.electiveType || 'program') === 'program';
            if (category === 'open') return itemCategory === 'elective' && item.electiveType === 'open';
            if (category === 'placement') return itemCategory === 'placement';
            return itemCategory === 'main';
        }

        function getManageFormLabName(item = {}) {
            const baseName = String(item.name || '').replace(/\s*lab\s*$/i, '').trim();
            return /lab\b/i.test(String(item.name || '')) ? String(item.name || '').trim() : `${baseName} Lab`;
        }

        function getManageFormLabCountKey(item = {}, course, semester) {
            return subjectIdentity({
                ...item,
                name: getManageFormLabName(item),
                code: item.code || '',
                course,
                semester,
                isLab: true
            });
        }

        function renderManageFormSubjects() {
            const list = document.getElementById('manage-form-subject-list');
            if (!list) return;

            const { course, semester, category } = getManageFormControls();
            const normalizedName = (value = '') => String(value || '').replace(/\s*lab\s*$/i, '').trim().toLowerCase();
            const subjects = subjectCatalog
                .filter(item => {
                    const itemCourse = item.course || dashboardCourse || 'B.Tech';
                    const itemSemester = item.semester || dashboardTimetableState?.currentSemester || 'semester1';
                    return itemCourse === course
                        && itemSemester === semester
                        && item.name
                        && subjectMatchesManageFormCategory(item, category);
                })
                .filter(item => {
                    if (!item.isLab) return true;
                    const baseName = normalizedName(item.name);
                    return !subjectCatalog.some(entry => {
                        if (entry.isLab || !entry.name) return false;
                        const entryCourse = entry.course || dashboardCourse || 'B.Tech';
                        const entrySemester = entry.semester || dashboardTimetableState?.currentSemester || 'semester1';
                        return entryCourse === course
                            && entrySemester === semester
                            && subjectMatchesManageFormCategory(entry, category)
                            && normalizedName(entry.name) === baseName;
                    });
                })
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

            if (!subjects.length) {
                list.innerHTML = '<div class="manage-form-empty">No subjects added yet.</div>';
                return;
            }

            list.innerHTML = subjects.map((item) => {
                const key = subjectIdentity(item);
                const labCountKey = getManageFormLabCountKey(item, course, semester);
                const labEnabled = item.isLab || subjectCatalog.some(entry => {
                    const entryCourse = entry.course || dashboardCourse || 'B.Tech';
                    const entrySemester = entry.semester || dashboardTimetableState?.currentSemester || 'semester1';
                    return entry.isLab
                        && entryCourse === course
                        && entrySemester === semester
                        && normalizedName(entry.name) === normalizedName(item.name);
                });
                const countValue = manageFormLectureCounts[key] ?? (item.isLab ? 1 : 4);
                const labCountValue = manageFormLectureCounts[labCountKey] ?? 1;
                return `
                    <div class="manage-form-row">
                        <label class="manage-form-subject">
                            <input type="checkbox" ${manageFormSubjectSelections[key] !== false ? 'checked' : ''} data-manage-form-subject="${escapeHtml(key)}">
                            <span>${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ''}</span>
                            ${item.isLab ? '<span class="manage-form-lab-pill">Lab</span>' : ''}
                        </label>
                        <label class="manage-form-switch">
                            <input type="checkbox" data-manage-form-lab="${escapeHtml(item.name)}" data-manage-form-lab-count="${escapeHtml(labCountKey)}" data-course="${escapeHtml(course)}" data-semester="${escapeHtml(semester)}" ${labEnabled ? 'checked' : ''}>
                            <span></span>
                            <strong>${labEnabled ? 'Lab ON' : 'Lab OFF'}</strong>
                        </label>
                        <div class="manage-form-count-group">
                            <label class="manage-form-count-field">
                                <small>${item.isLab ? 'Labs / Week' : 'Lectures / Week'}</small>
                                <input class="manage-form-count" type="number" min="0" max="12" value="${escapeHtml(String(countValue))}" data-manage-form-count="${escapeHtml(key)}">
                            </label>
                            ${labEnabled && !item.isLab ? `
                                <label class="manage-form-count-field">
                                    <small>Labs / Week</small>
                                    <input class="manage-form-count" type="number" min="0" max="12" value="${escapeHtml(String(labCountValue))}" data-manage-form-count="${escapeHtml(labCountKey)}">
                                </label>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            initializeManageFormControls();
        }

        function renderWorkloadFacultyOptions() {
            const options = document.getElementById('manage-form-faculty-options');
            const picker = document.getElementById('manage-form-faculty-picker');
            const toggle = document.getElementById('manage-form-faculty-toggle');
            const menu = document.getElementById('manage-form-faculty-menu');
            if (!options || !picker || !toggle || !menu) return;
            const approvedFaculty = facultyDB.filter(item => item.status === 'approved');
            options.innerHTML = approvedFaculty.length
                ? approvedFaculty.map(item => `
                    <label class="manage-form-faculty-option">
                        <input type="checkbox" value="${escapeHtml(String(item.id))}" data-faculty-name="${escapeHtml(item.name)}">
                        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.email)}</small></span>
                    </label>`
                ).join('')
                : '<p class="manage-form-faculty-empty">No approved faculty members.</p>';

            options.querySelectorAll('input[type="checkbox"]').forEach(input => {
                input.addEventListener('change', updateWorkloadFacultySelectionLabel);
            });
            if (!toggle.dataset.workloadBound) {
                toggle.addEventListener('click', () => {
                    const expanded = toggle.getAttribute('aria-expanded') === 'true';
                    toggle.setAttribute('aria-expanded', String(!expanded));
                    menu.hidden = expanded;
                });
                document.addEventListener('click', event => {
                    if (!picker.contains(event.target)) {
                        menu.hidden = true;
                        toggle.setAttribute('aria-expanded', 'false');
                    }
                });
                toggle.dataset.workloadBound = 'true';
            }
            updateWorkloadFacultySelectionLabel();
        }

        function getSelectedWorkloadFacultyIds() {
            return Array.from(document.querySelectorAll('#manage-form-faculty-options input[type="checkbox"]:checked'))
                .map(input => input.value);
        }

        function updateWorkloadFacultySelectionLabel() {
            const label = document.getElementById('manage-form-faculty-selection');
            if (!label) return;
            const selected = Array.from(document.querySelectorAll('#manage-form-faculty-options input[type="checkbox"]:checked'));
            if (!selected.length) {
                label.textContent = 'Select faculty member(s)';
            } else if (selected.length === 1) {
                label.textContent = selected[0].dataset.facultyName;
            } else {
                label.textContent = `${selected.length} faculty members selected`;
            }
        }

        async function forwardToFacultySequentially(facultyIds, formData, results = []) {
            if (!facultyIds.length) return results;
            const [facultyId, ...remainingIds] = facultyIds;
            const result = await apiRequest('/api/workload-forms', {
                method: 'POST',
                body: { ...formData, facultyId }
            });
            return forwardToFacultySequentially(remainingIds, formData, [...results, result]);
        }

        function populateManageWorkloadFilters() {
            const courseSelect = document.getElementById('manage-workload-course');
            const semesterSelect = document.getElementById('manage-workload-semester');
            if (!courseSelect || !semesterSelect) return;
            const currentCourse = courseSelect.value;
            const courses = [...new Set(manageWorkloadForms.map(form => form.course).filter(Boolean))].sort();
            courseSelect.innerHTML = courses.map(course => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join('');
            courseSelect.value = courses.includes(currentCourse) ? currentCourse : (courses[0] || '');

            const currentSemester = semesterSelect.value;
            const semesters = [...new Set(manageWorkloadForms
                .filter(form => form.course === courseSelect.value)
                .map(form => form.semester)
                .filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            semesterSelect.innerHTML = semesters.map(semester => `<option value="${escapeHtml(semester)}">${escapeHtml(semester.replace(/semester/i, 'Semester '))}</option>`).join('');
            semesterSelect.value = semesters.includes(currentSemester) ? currentSemester : (semesters[0] || '');

            if (!courseSelect.dataset.workloadBound) {
                courseSelect.addEventListener('change', () => {
                    populateManageWorkloadFilters();
                    renderManageWorkloadSubjects();
                });
                courseSelect.dataset.workloadBound = 'true';
            }
            if (!semesterSelect.dataset.workloadBound) {
                semesterSelect.addEventListener('change', renderManageWorkloadSubjects);
                semesterSelect.dataset.workloadBound = 'true';
            }
        }

        function getManageWorkloadSubjectGroups() {
            const course = document.getElementById('manage-workload-course')?.value;
            const semester = document.getElementById('manage-workload-semester')?.value;
            const groups = new Map();
            manageWorkloadForms
                .filter(form => form.course === course && form.semester === semester)
                .forEach(form => {
                    (form.subjects || []).forEach(subject => {
                        const subjectId = String(subject.id || `${subject.name}|${subject.code || ''}`);
                        if (!groups.has(subjectId)) groups.set(subjectId, { ...subject, id: subjectId, teachers: new Map() });
                        const selected = form.status === 'submitted'
                            && (form.selectedSubjectIds || []).includes(subject.id);
                        if (selected) {
                            const teacherKey = String(form.facultyId || form.facultyEmail || form.facultyName).toLowerCase();
                            const selection = (form.selectedSubjects || []).find(item => item.id === subject.id);
                            if (!groups.get(subjectId).teachers.has(teacherKey)) {
                                groups.get(subjectId).teachers.set(teacherKey, {
                                    name: form.facultyName || 'Faculty',
                                    email: form.facultyEmail || '',
                                    formId: form.id,
                                    subjectId: subject.id,
                                    assignedSections: selection?.assignedSections || []
                                });
                            }
                        }
                    });
                });
            return [...groups.values()];
        }

        function getManageWorkloadLabRotationPairs(subjects = getManageWorkloadSubjectGroups()) {
            const labSubjects = subjects.filter(subject => (
                (subject.isLab || subject.labEnabled)
                && Number(subject.labCount || (subject.isLab ? subject.lectureCount : 0)) > 0
            ));
            const pairs = [];
            for (let index = 0; index + 1 < labSubjects.length; index += 2) {
                pairs.push([labSubjects[index], labSubjects[index + 1]]);
            }
            return {
                pairs,
                unpaired: labSubjects.length % 2 ? labSubjects[labSubjects.length - 1] : null
            };
        }

        function renderManageWorkloadSubjects() {
            const container = document.getElementById('manageWorkloadContent');
            if (!container) return;
            const subjects = getManageWorkloadSubjectGroups();
            if (!subjects.length) {
                container.innerHTML = '<div class="manage-workload-empty">No subjects or workload forms match this course and semester.</div>';
                return;
            }

            const rotations = getManageWorkloadLabRotationPairs(subjects);
            const batchLabelBySubject = new Map();
            rotations.pairs.forEach(([first, second]) => {
                batchLabelBySubject.set(first.id, 'P1');
                batchLabelBySubject.set(second.id, 'P2');
            });
            const rotationPreview = rotations.pairs.length || rotations.unpaired
                ? `<section class="manage-workload-lab-rotation" aria-label="P1 and P2 lab rotation">
                    <h3>Lab batch rotation</h3>
                    <p>First session: first lab goes to P1 and second lab goes to P2. In the next session, the batches swap labs.</p>
                    ${rotations.pairs.map(([first, second], index) => `
                        <div class="manage-workload-lab-pair">
                            <strong>Pair ${index + 1}</strong>
                            <span>Session 1: <b>P1</b> ${escapeHtml(first.name)} / <b>P2</b> ${escapeHtml(second.name)}</span>
                            <span>Session 2: <b>P1</b> ${escapeHtml(second.name)} / <b>P2</b> ${escapeHtml(first.name)}</span>
                        </div>
                    `).join('')}
                    ${rotations.unpaired ? `<p class="manage-workload-lab-unpaired">${escapeHtml(rotations.unpaired.name)} needs another lab subject to form a P1/P2 rotation.</p>` : ''}
                </section>`
                : '';

            container.innerHTML = `${rotationPreview}<div class="manage-workload-subject-list">${subjects.map(subject => {
                const subjectCode = subject.code ? ' <span class="manage-workload-subject-code">' + escapeHtml(subject.code) + '</span>' : '';
                const batchLabel = batchLabelBySubject.get(subject.id);
                const batchPill = batchLabel ? ` <span class="manage-workload-batch-pill">${batchLabel}</span>` : '';
                const teacherCount = subject.teachers.size;
                const selectedLabel = `${teacherCount} ${teacherCount === 1 ? 'faculty member' : 'faculty members'}`;
                const teachers = teacherCount
                    ? [...subject.teachers.values()].map(teacher => {
                        const teacherEmail = teacher.email ? ' <span>' + escapeHtml(teacher.email) + '</span>' : '';
                        const assignedSections = new Set(teacher.assignedSections);
                        const sectionChecks = [
                            ['sectionA', 'A'],
                            ['sectionB', 'B'],
                            ['sectionC', 'C']
                        ].map(([section, label]) => `<label class="manage-workload-section-option">
                            <input type="checkbox" class="manage-workload-section-assignment" data-form-id="${escapeHtml(String(teacher.formId))}" data-subject-id="${escapeHtml(teacher.subjectId)}" value="${section}" ${assignedSections.has(section) ? 'checked' : ''}>
                            <span>Section ${label}</span>
                        </label>`).join('');
                        return `<li class="manage-workload-teacher-row">
                            <div class="manage-workload-teacher-identity"><strong>${escapeHtml(teacher.name)}</strong>${teacherEmail}</div>
                            <div class="manage-workload-section-options" aria-label="Assign sections to ${escapeHtml(teacher.name)}">${sectionChecks}</div>
                        </li>`;
                    }).join('')
                    : '<li class="manage-workload-pending">No faculty member has selected this subject yet.</li>';
                return `<article class="manage-workload-subject-entry">
                    <button type="button" class="manage-workload-subject-toggle" aria-expanded="false" data-subject-key="${escapeHtml(subject.id)}">
                        <span><strong>${escapeHtml(subject.name)}</strong>${subjectCode}${batchPill}</span>
                        <span class="manage-workload-subject-count">${selectedLabel}</span>
                    </button>
                    <div class="manage-workload-teachers" hidden><ul>${teachers}</ul></div>
                </article>`;
            }).join('')}</div>`;

            container.querySelectorAll('.manage-workload-subject-toggle').forEach(button => {
                button.addEventListener('click', () => {
                    const details = button.nextElementSibling;
                    const expanded = button.getAttribute('aria-expanded') === 'true';
                    button.setAttribute('aria-expanded', String(!expanded));
                    details.hidden = expanded;
                });
            });

            container.querySelectorAll('.manage-workload-section-assignment').forEach(input => {
                input.addEventListener('change', async () => {
                    const row = input.closest('.manage-workload-teacher-row');
                    const formId = input.dataset.formId;
                    const subjectId = input.dataset.subjectId;
                    const selectedInputs = row.querySelectorAll('.manage-workload-section-assignment:checked');
                    if (input.checked && selectedInputs.length > 2) {
                        input.checked = false;
                        alert('A faculty member can be assigned to a maximum of two sections for this subject.');
                        return;
                    }
                    const sections = Array.from(row.querySelectorAll('.manage-workload-section-assignment:checked'))
                        .map(checkbox => checkbox.value);
                    row.querySelectorAll('.manage-workload-section-assignment').forEach(checkbox => { checkbox.disabled = true; });
                    try {
                        await apiRequest(`/api/workload-forms/${encodeURIComponent(formId)}/subjects/${encodeURIComponent(subjectId)}/sections`, {
                            method: 'PATCH',
                            body: { sections }
                        });
                        const form = manageWorkloadForms.find(item => String(item.id) === String(formId));
                        const selected = form?.selectedSubjects?.find(item => item.id === subjectId);
                        if (selected) selected.assignedSections = sections;
                    } catch (error) {
                        alert(error.message || 'Unable to save the section assignment.');
                        void renderManageWorkload();
                    } finally {
                        row.querySelectorAll('.manage-workload-section-assignment').forEach(checkbox => { checkbox.disabled = false; });
                    }
                });
            });
        }

        async function renderManageWorkload() {
            const container = document.getElementById('manageWorkloadContent');
            if (!container) return;
            container.innerHTML = '<p class="status">Loading workload subjects...</p>';
            try {
                const payload = await apiRequest('/api/workload-forms');
                manageWorkloadForms = payload.forms || [];
                if (!manageWorkloadForms.length) {
                    container.innerHTML = '<div class="manage-workload-empty">No workload forms have been forwarded yet.</div>';
                    return;
                }
                populateManageWorkloadFilters();
                renderManageWorkloadSubjects();
            } catch (error) {
                container.innerHTML = `<div class="manage-workload-empty">${escapeHtml(error.message || 'Unable to load workload subjects.')}</div>`;
            }
        }

        async function forwardManageFormToFaculty() {
            const facultyIds = getSelectedWorkloadFacultyIds();
            if (!facultyIds.length) {
                alert('Select at least one approved faculty member first.');
                return;
            }

            const { course, semester, category } = getManageFormControls();
            const subjects = Array.from(document.querySelectorAll('.manage-form-row')).flatMap(row => {
                const checkbox = row.querySelector('[data-manage-form-subject]');
                if (!checkbox?.checked) return [];
                const subject = subjectCatalog.find(item => subjectIdentity(item) === checkbox.dataset.manageFormSubject);
                if (!subject) return [];
                const counts = Array.from(row.querySelectorAll('.manage-form-count')).map(input => Number(input.value) || 0);
                const labEnabled = Boolean(row.querySelector('.manage-form-switch input')?.checked);
                let lectureCount = 0;
                let labCount = 0;
                if (subject.isLab) {
                    labCount = counts[0] || 0;
                } else {
                    lectureCount = counts[0] || 0;
                    if (labEnabled) labCount = counts[1] || 0;
                }
                return [{
                    id: subjectIdentity(subject),
                    name: subject.name,
                    code: subject.code || '',
                    course: subject.course || course,
                    semester: subject.semester || semester,
                    category: subject.category || category,
                    isLab: Boolean(subject.isLab),
                    labEnabled,
                    lectureCount,
                    labCount
                }];
            });
            if (!subjects.length) {
                alert('Select at least one subject to forward.');
                return;
            }

            const button = document.querySelector('.manage-form-forward');
            if (button) button.disabled = true;
            saveManageFormLectureCounts();
            saveManageFormSubjectSelections();
            try {
                if (!await saveAppSettingsToApi()) {
                    throw new Error('Manage Form changes could not be saved to the database. Please try again.');
                }
                const results = await forwardToFacultySequentially(facultyIds, { course, semester, category, subjects });
                setAdminPanel('manage-workload');
                const savedForms = results.length;
                const emailsSent = results.filter(result => result.emailSent).length;
                if (savedForms === emailsSent) {
                    alert(`Form forwarded to ${savedForms} faculty member(s).`);
                } else {
                    alert(`Forms saved for ${savedForms} faculty member(s); ${emailsSent} email(s) sent. Check Gmail configuration for failed emails.`);
                }
            } catch (error) {
                alert(error.message || 'Unable to forward the workload form to all selected faculty.');
            } finally {
                if (button) button.disabled = false;
            }
        }

        function loadDemoSubjects() {
            const demoSubjects = [
                // semseter 1
                { name: 'Engineering Chemistry', code: 'BT-101', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                { name: 'Mathematics-II', code: 'BT-202', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                { name: 'English for Communication', code: 'BT-103', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                { name: 'Basic Electrical & Electronics Engineering', code: 'BT-104', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                { name: 'Engineering Graphics', code: 'BT-105', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                { name: 'Manufacturing Practices', code: 'BT-106', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                // { name: 'Evaluation of Internship-I', code: 'BT-107', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                { name: 'Rural Outreach', code: 'BT-108', course: 'B.Tech', semester: 'semester1', category: 'main', isLab: false },
                
                
                
                // semester 2
                { name: 'Engineering Physics', code: 'BT-201', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                { name: 'Mathematics-I', code: 'BT-102', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                { name: 'Basic Mechanical Engineering', code: 'BT-203', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                { name: 'Basic Civil Engineering & Mechanics', code: 'BT-204', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                { name: 'Basic Computer Engineering', code: 'BT-205', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                { name: 'Language Lab & Seminars', code: 'BT-206', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                // { name: 'Design Thinking', code: 'BT-207', course: 'B.Tech', semester: 'semester2', category: 'main', isLab: false },
                //  semester 3

                { name: 'Energy & Environmental Engineering', code: 'ES-301', course: 'B.Tech', semester: 'semester3', category: 'main', isLab: false },
                { name: 'Discrete Structure', code: 'CS-302', course: 'B.Tech', semester: 'semester3', category: 'main', isLab: false },
                { name: 'Data Structure', code: 'CS-303', course: 'B.Tech', semester: 'semester3', category: 'main', isLab: false },
                { name: 'Digital Systems', code: 'CS-304', course: 'B.Tech', semester: 'semester3', category: 'main', isLab: false },
                { name: 'Object Oriented Programming and Methodology', code: 'CS-305', course: 'B.Tech', semester: 'semester3', category: 'main', isLab: false },
                { name: 'Computer Workshop', code: 'CS-306', course: 'B.Tech', semester: 'semester3', category: 'main', isLab: false },
                // { name: 'Web Development Basics', code: 'CS-306', course: 'B.Tech', semester: 'semester3', category: 'elective', isLab: false },
                // { name: 'Soft Skills', code: 'CS-307', course: 'B.Tech', semester: 'semester3', category: 'elective', isLab: false },
               
                // semestre 4
                { name: 'Mathematics-III', code: 'BT-401', course: 'B.Tech', semester: 'semester4', category: 'main', isLab: false },
                { name: 'Analysis Design of Algorithm', code: 'CS-402', course: 'B.Tech', semester: 'semester4', category: 'main', isLab: false },
                { name: 'Software Engineering', code: 'CS-403', course: 'B.Tech', semester: 'semester4', category: 'main', isLab: false },
                { name: 'Computer Org. & Architecture', code: 'CS-404', course: 'B.Tech', semester: 'semester4', category: 'main', isLab: false },
                { name: 'Operating Systems', code: 'CS-405', course: 'B.Tech', semester: 'semester4', category: 'main', isLab: false },
                { name: 'Programming Practices', code: 'CS-406', course: 'B.Tech', semester: 'semester4', category: 'main', isLab: false },
                // { name: 'Cyber Security', code: 'CS-406', course: 'B.Tech', semester: 'semester4', category: 'elective', isLab: false },
                // { name: 'IoT Fundamentals', code: 'CS-407', course: 'B.Tech', semester: 'semester4', category: 'elective', isLab: false },
                
                // semestre 5
                { name: 'Theory of Computation', code: 'CS-501', course: 'B.Tech', semester: 'semester5', category: 'main', isLab: false },
                { name: 'Database Management Systems', code: 'CS-502', course: 'B.Tech', semester: 'semester5', category: 'main', isLab: false },
                { name: 'Data Analytics', code: 'CS-503 (A)', course: 'B.Tech', semester: 'semester5', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Pattern Recognition', code: 'CS-503 (B)', course: 'B.Tech', semester: 'semester5', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Cyber Security', code: 'CS-503 (C)', course: 'B.Tech', semester: 'semester5', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Internet and Web Technology', code: 'CS-504 (A)', course: 'B.Tech', semester: 'semester5', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Object Oriented Programming', code: 'CS-504 (B)', course: 'B.Tech', semester: 'semester5', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Introduction to Database Management Systems', code: 'CS-504 (C)', course: 'B.Tech', semester: 'semester5', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Lab (Linux)', code: 'CS-505', course: 'B.Tech', semester: 'semester5', category: 'main', isLab: true },
                { name: 'Lab (Python)', code: 'CS-506', course: 'B.Tech', semester: 'semester5', category: 'main', isLab: true },
                { name: 'Minor Project', code: 'CS-508', course: 'B.Tech', semester: 'semester5', category: 'main', isLab: false },
                
                // semsetr 6
                { name: 'Machine Learning', code: 'CS-601', course: 'B.Tech', semester: 'semester6', category: 'main', isLab: false },
                { name: 'Computer Networks', code: 'CS-602', course: 'B.Tech', semester: 'semester6', category: 'main', isLab: false },
                { name: 'Advanced Computer Architecture', code: 'CS-603 (A)', course: 'B.Tech', semester: 'semester6', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Computer Graphics & Visualization', code: 'CS-603 (B)', course: 'B.Tech', semester: 'semester6', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Compiler Design', code: 'CS-603 (C)', course: 'B.Tech', semester: 'semester6', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Knowledge Management', code: 'CS-604 (A)', course: 'B.Tech', semester: 'semester6', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Project Management', code: 'CS-604 (B)', course: 'B.Tech', semester: 'semester6', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Rural Technology & Community Development', code: 'CS-604 (C)', course: 'B.Tech', semester: 'semester6', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Data Analytics Lab', code: 'CS-605', course: 'B.Tech', semester: 'semester6', category: 'main', isLab: true },
                { name: 'Skill Development Lab', code: 'CS-606', course: 'B.Tech', semester: 'semester6', category: 'main', isLab: true },
                // { name: 'Internship-III', code: 'CS-607', course: 'B.Tech', semester: 'semester6', category: 'main', isLab: false },
                { name: 'Minor Project-2', code: 'CS-608', course: 'B.Tech', semester: 'semester6', category: 'main', isLab: false },
                //  semester 7
                { name: 'Software Architectures', code: 'CS-701', course: 'B.Tech', semester: 'semester7', category: 'main', isLab: false },
                { name: 'Computational Intelligence', code: '702(A)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Deep & Reinforcement Learning', code: '702(B)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Wireless & Mobile Computing', code: '702(C)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Big Data', code: '702(D)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Cryptography & Information Security', code: '703(A)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Data Mining and Warehousing', code: '703(B)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Agile Software Development', code: '703(C)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Disaster Management', code: '703(D)', course: 'B.Tech', semester: 'semester7', category: 'elective', electiveType: 'open', isLab: false },
                // { name: 'Departmental Elective Lab', code: 'CS-704', course: 'B.Tech', semester: 'semester7', category: 'main', isLab: true },
                // { name: 'Open Elective Lab', code: 'CS-705', course: 'B.Tech', semester: 'semester7', category: 'main', isLab: true },
                { name: 'Major Project-I', code: 'CS-706', course: 'B.Tech', semester: 'semester7', category: 'main', isLab: false },
                // { name: 'Evaluation of Internship -III', code: 'CS-707', course: 'B.Tech', semester: 'semester7', category: 'main', isLab: false },
               
               
                // semester 8
                { name: 'Internet of Things', code: 'CS-801', course: 'B.Tech', semester: 'semester8', category: 'main', isLab: false },
                { name: 'Block Chain Technologies', code: '802(A)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Cloud Computing', code: '802(B)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'High Performance computing', code: '802(C)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Object Oriented Software Engineering', code: '802(D)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'program', isLab: false },
                { name: 'Image Processing and Computer Vision', code: '803(A)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Game Theory with Engineering applications', code: '803(B)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Internet of Things', code: '803(C)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'open', isLab: false },
                { name: 'Managing Innovation and Entrepreneurship', code: '803(D)', course: 'B.Tech', semester: 'semester8', category: 'elective', electiveType: 'open', isLab: false },
                // { name: 'D/O elective lab', code: 'CS-804', course: 'B.Tech', semester: 'semester8', category: 'main', isLab: true },
                { name: 'Major Project-II', code: 'CS-805', course: 'B.Tech', semester: 'semester8', category: 'main', isLab: false }
            ];

            const existingKeys = new Set(subjectCatalog.map(item => `${item.course}|${item.semester}|${item.name}|${item.category || 'main'}|${item.isLab ? 'lab' : 'sub'}`));
            demoSubjects.forEach((item) => {
                const key = `${item.course}|${item.semester}|${item.name}|${item.category || 'main'}|${item.isLab ? 'lab' : 'sub'}`;
                if (!existingKeys.has(key)) {
                    subjectCatalog.push({
                        name: item.name,
                        code: item.code,
                        course: item.course,
                        semester: item.semester,
                        category: item.category || 'main',
                        isLab: Boolean(item.isLab)
                    });
                    existingKeys.add(key);
                }
            });

            renderSubjects(document.getElementById('subjectSearch')?.value || '');
            renderManageLabs();
            renderManageFormSubjects();
        }

        function toggleTeachersSection() {
            const panel = document.getElementById('teachersManagementSection');
            const icon = document.getElementById('teachersToggleIcon');
            if (!panel || !icon) return;
            const open = panel.classList.toggle('section-content--open');
            panel.classList.toggle('section-content--closed', !open);
            icon.textContent = open ? 'v' : '^';
        }

        document.addEventListener('DOMContentLoaded', function () {
            const excelInput = document.getElementById('teacherExcelFileInput');
            const fileNameText = document.querySelector('.file-picker-name');
            if (excelInput && fileNameText) {
                excelInput.addEventListener('change', function () {
                    fileNameText.textContent = excelInput.files && excelInput.files.length
                        ? excelInput.files[0].name
                        : 'No file chosen';
                });
            }

            if (typeof renderDashboardHistoryPanel === 'function') {
                renderDashboardHistoryPanel();
            }
            if (typeof loadTimeSettingCourseSettings === 'function') {
                loadTimeSettingCourseSettings(dashboardCourse);
            }
            loadDemoSubjects();
            initializeManageFormFilters();
            initializeFromUrlParams();
        });

        function renderTeachers(search = '') {
            syncApprovedFacultyNamesToTeacherRoster();
            const list = document.getElementById('teacherList');
            if (!list) return;

            const term = (search || '').trim().toLowerCase();
            const filtered = teacherRoster.filter(name => name.toLowerCase().includes(term));

            if (!filtered.length) {
                list.innerHTML = '<div class="teacher-empty">No teachers added yet</div>';
                return;
            }

            list.innerHTML = filtered.map(name => {
                const arg = JSON.stringify(name);
                const faculty = getFacultyForTeacherName(name);
                return `
                <div class="teacher-item">
                    <span class="teacher-item-name">${escapeHtml(name)}</span>
                    <div class="teacher-actions">
                        <button class="btn btn-ghost btn-small" type="button" onclick='showTeacherTimetable(${arg})'>View</button>
                        <button class="teacher-delete" type="button" onclick='${faculty ? `removeFaculty(${Number(faculty.id)})` : `deleteTeacher(${arg})`}'>${faculty ? 'Remove faculty' : 'Delete'}</button>
                    </div>
                </div>
            `;
            }).join('');
        }

        function escapeAttribute(str) {
            return String(str || '')
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '&quot;');
        }

        function getFacultyForTeacherName(teacherName) {
            const normalizedTeacher = normalizeTeacherName(teacherName);
            return facultyDB.find((faculty) => {
                return faculty.status === 'approved' && normalizeTeacherName(faculty.name) === normalizedTeacher;
            }) || null;
        }

        async function showTeacherTimetable(teacherName) {
            const normalizedTeacher = normalizeTeacherName(teacherName);
            const courseTables = [];
            Object.keys(dashboardTimetableDataByCourse).forEach(course => {
                const slotStore = getDashboardTimetableSlotData(course);
                const courseData = getDashboardTimetableData(course);
                const semesters = Object.keys(courseData);
                if (!semesters.length) return;

                const headerSemester = semesters[0];
                const days = getDashboardWorkingDays(course, headerSemester);
                const periodTimes = getDashboardPeriodTimes(course, headerSemester);
                const periodCount = periodTimes.length;
                const cells = {};
                days.forEach(day => {
                    cells[day] = Array.from({ length: periodCount }, () => []);
                });

                let found = false;
                const sectionHints = {};
                semesters.forEach(semester => {
                    Object.keys(courseData[semester] || {}).forEach(section => {
                        // collect section-wide hint values from any assigned slot in this course/semester/section
                        for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
                            const day = days[dayIndex];
                            for (let idx = 0; idx < periodCount; idx += 1) {
                                const key = `${semester}|${section}|${day}|${idx}`;
                                const slot = slotStore[key];
                                if (slot) {
                                    const hintKey = `${course}|${semester}|${section}`;
                                    sectionHints[hintKey] = sectionHints[hintKey] || { room: '', classTeacher: '', studentNumber: '', academicSession: '' };
                                    if (!sectionHints[hintKey].room && slot.room) sectionHints[hintKey].room = slot.room;
                                    if (!sectionHints[hintKey].classTeacher && slot.classTeacher) sectionHints[hintKey].classTeacher = slot.classTeacher;
                                    if (!sectionHints[hintKey].studentNumber && slot.studentNumber) sectionHints[hintKey].studentNumber = slot.studentNumber;
                                    if (!sectionHints[hintKey].academicSession && slot.academicSession) sectionHints[hintKey].academicSession = slot.academicSession;
                                }
                            }
                        }
                    });
                });

                semesters.forEach(semester => {
                    Object.keys(courseData[semester] || {}).forEach(section => {
                        days.forEach(day => {
                            for (let idx = 0; idx < periodCount; idx += 1) {
                                const key = `${semester}|${section}|${day}|${idx}`;
                                const slot = slotStore[key];
                                const assignment = getTeacherSlotAssignment(slot, teacherName);
                                if (assignment) {
                                    const hintKey = `${course}|${semester}|${section}`;
                                    cells[day][idx].push({
                                        ...slot,
                                        subject: assignment.batch ? `${assignment.subject} (${assignment.batch})` : assignment.subject,
                                        teacher: assignment.teacher,
                                        room: assignment.room || slot.room,
                                        semester,
                                        section,
                                        hintKey
                                    });
                                    found = true;
                                }
                            }
                        });
                    });
                });
                if (found) {
                    courseTables.push({ course, days, periodTimes, cells, sectionHints });
                }
            });

            const content = document.getElementById('teacherTimetableModalContent');
            if (!content) return;

            let html = `<div class="modal-title" style="margin-bottom:14px; font-size:18px; font-weight:700;">Teacher Timetable - ${escapeHtml(teacherName)}</div>`;
            if (!courseTables.length) {
                html += '<div class="empty-note">No timetable assignments found for this teacher.</div>';
            } else {
                courseTables.forEach(table => {
                    html += `
                        <div style="margin-bottom:24px;">
                            <div class="section-label">${escapeHtml(table.course)}</div>
                            <div style="overflow-x:auto; background: #fff; border-radius: 18px; padding: 14px; box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05);">
                                <table class="teacher-timetable-table" style="min-width:760px; margin-bottom:0;">
                                    <thead>
                                        <tr><th>Day / Time</th>${table.periodTimes.map(t => `<th>${escapeHtml(t)}</th>`).join('')}</tr>
                                    </thead>
                                    <tbody>
                                        ${table.days.map(day => {
                                            const cells = table.cells[day];
                                            let rowHtml = '';
                                            for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
                                                const entries = cells[cellIndex];
                                                if (!entries.length) {
                                                    rowHtml += '<td>-</td>';
                                                    continue;
                                                }

                                                const entry = entries[0];
                                                const semesterLabel = semesterToRomanLabel(entry.semester);
                                                const sectionLabel = entry.section.replace('section', 'Section ');
                                                const hintKey = entry.hintKey || `${table.course}|${entry.semester}|${entry.section}`;
                                                const hint = table.sectionHints?.[hintKey] || {};
                                                const assignedRoom = entry.room || hint.room || '';
                                                const roomLabel = assignedRoom ? `Room ${escapeHtml(assignedRoom)}` : 'Room not assigned';
                                                const isLabCell = /lab/i.test(entry.classType || entry.subject || '');
                                                let colspan = '';

                                                if (isLabCell && cellIndex + 1 < cells.length) {
                                                    const nextEntries = cells[cellIndex + 1];
                                                    if (nextEntries.length) {
                                                        const nextEntry = nextEntries[0];
                                                        const sameSlot = normalizeTeacherName(nextEntry.teacher) === normalizeTeacherName(entry.teacher)
                                                            && nextEntry.subject === entry.subject
                                                            && nextEntry.section === entry.section
                                                            && nextEntry.semester === entry.semester
                                                            && /lab/i.test(nextEntry.classType || nextEntry.subject || '');
                                                        if (sameSlot) {
                                                            colspan = ' colspan="2"';
                                                        }
                                                    }
                                                }

                                                const blocks = `
                                                    <div class="slot-block">
                                                        <strong>${escapeHtml(entry.subject || '')}</strong>
                                                        <div class="slot-meta"><span>${escapeHtml(entry.classType || 'Lecture')}</span><span>${escapeHtml(semesterLabel)}</span><span>${escapeHtml(sectionLabel)}</span><span>${roomLabel}</span></div>
                                                    </div>
                                                `;

                                                rowHtml += `<td class="filled${isLabCell ? ' lab-session' : ''}"${colspan}>${blocks}</td>`;
                                                if (colspan) {
                                                    cellIndex += 1;
                                                }
                                            }
                                            return `<tr><th>${escapeHtml(day)}</th>${rowHtml}</tr>`;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                });
            }

            content.innerHTML = html;
            document.getElementById('teacherTimetableModal')?.classList.add('active');

            const faculty = getFacultyForTeacherName(teacherName);
            const viewSaved = await saveTeacherViewToApi({
                facultyId: faculty?.id || null,
                teacherName,
                normalizedTeacherName: normalizedTeacher,
                email: faculty?.email || '',
                dept: faculty?.dept || '',
                empid: faculty?.empid || '',
                viewedAt: new Date().toISOString(),
                courseTables
            });
            const viewStatus = document.getElementById('view-faculty-save-status');
            if (viewStatus) {
                viewStatus.textContent = viewSaved
                    ? 'Faculty timetable view saved to the database.'
                    : 'Timetable opened, but the view record was not saved to the database.';
                viewStatus.style.color = viewSaved ? '' : '#b91c1c';
            }
        }

        function closeTeacherTimetableModal() {
            const modal = document.getElementById('teacherTimetableModal');
            if (modal) modal.classList.remove('active');
        }

        async function toggleSubjectLab(itemName, course = dashboardCourse || 'B.Tech', semester = dashboardTimetableState?.currentSemester || 'semester1') {
            const baseName = String(itemName || '').trim();
            if (!baseName) return false;
            const previousCatalog = subjectCatalog.slice();

            const normalizedBase = baseName.replace(/\s*lab\s*$/i, '').trim();
            const labName = /lab\b/i.test(baseName) ? baseName : `${normalizedBase} Lab`;
            const existingLab = subjectCatalog.find((item) => {
                const sameName = item.name && item.name.toLowerCase() === labName.toLowerCase();
                const sameCourse = (item.course || '') === (course || '');
                const sameSemester = (item.semester || '') === (semester || '');
                return item.isLab && sameName && sameCourse && sameSemester;
            });

            if (existingLab) {
                const indexToRemove = subjectCatalog.findIndex((item) => {
                    return item.isLab && item.name && item.name.toLowerCase() === labName.toLowerCase() && (item.course || '') === (course || '') && (item.semester || '') === (semester || '');
                });
                if (indexToRemove >= 0) {
                    subjectCatalog.splice(indexToRemove, 1);
                }
                renderSubjects(document.getElementById('subjectSearch')?.value || '');
                renderManageLabs();
                renderManageFormSubjects();
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
            } else {
                subjectCatalog.push({
                    name: labName,
                    code: '',
                    isLab: true,
                    course: course || 'B.Tech',
                    semester: semester || 'semester1'
                });

                renderSubjects(document.getElementById('subjectSearch')?.value || '');
                renderManageLabs();
                renderManageFormSubjects();
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
            }

            if (!await saveSubjectsToApi()) {
                subjectCatalog = previousCatalog;
                renderSubjects(document.getElementById('subjectSearch')?.value || '');
                renderManageLabs();
                renderManageFormSubjects();
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                alert('Lab subject change was not saved to the database. Please retry.');
                return false;
            }
            return true;
        }

        function toggleSubjectElectiveType() {
            const category = document.getElementById('subjectCategory')?.value || 'main';
            const field = document.getElementById('subjectElectiveTypeField');
            if (field) {
                field.style.display = category === 'elective' ? 'block' : 'none';
            }
        }

        function renderSubjects(search = '') {
            const list = document.getElementById('subjectList');
            if (!list) return;

            const course = document.getElementById('subjectCourse')?.value || dashboardCourse || 'B.Tech';
            const semester = document.getElementById('subjectSemester')?.value || dashboardTimetableState?.currentSemester || 'semester1';
            const term = (search || '').trim().toLowerCase();
            const normalizedName = (value = '') => String(value || '').replace(/\s*lab\s*$/i, '').trim().toLowerCase();

            const filtered = subjectCatalog
                .filter((item) => {
                    const itemCourse = item.course || dashboardCourse || 'B.Tech';
                    const itemSemester = item.semester || dashboardTimetableState?.currentSemester || 'semester1';
                    return itemCourse === course && itemSemester === semester && item.name.toLowerCase().includes(term);
                })
                .sort((a, b) => Number(a.isLab) - Number(b.isLab));

            const visible = filtered.filter((item) => {
                if (!item.isLab) return true;
                const baseName = normalizedName(item.name);
                return !subjectCatalog.some((entry) => {
                    if (entry.isLab || !entry.name) return false;
                    return normalizedName(entry.name) === baseName && (entry.course || '') === (course || '') && (entry.semester || '') === (semester || '');
                });
            });

            const groups = {
                main: [],
                elective: {
                    program: [],
                    open: []
                },
                placement: []
            };

            visible.forEach((item) => {
                if ((item.category || 'main') === 'elective') {
                    const electiveKey = item.electiveType === 'open' ? 'open' : 'program';
                    groups.elective[electiveKey].push(item);
                } else if ((item.category || 'main') === 'placement') {
                    groups.placement.push(item);
                } else {
                    groups.main.push(item);
                }
            });

            const hasAny = groups.main.length || groups.elective.program.length || groups.elective.open.length || groups.placement.length;
            if (!hasAny) {
                list.innerHTML = '<div class="subject-empty">No subjects for this semester and course yet.</div>';
                return;
            }

            const renderGroup = (groupTitle, items, groupClass = '') => `
                <div class="subject-group ${groupClass}">
                    <div class="subject-group-title">${groupTitle}</div>
                    <div class="subject-group-list">
                        ${items.map((item) => {
                            const courseLabel = item.course ? ` | ${escapeHtml(item.course)}` : '';
                            const semesterLabel = item.semester ? ` | ${semesterToRomanLabel(item.semester)}` : '';
                            const baseName = item.isLab ? normalizedName(item.name) : item.name;
                            const hasLab = subjectCatalog.some((entry) => {
                                if (!entry.isLab) return false;
                                return normalizedName(entry.name) === normalizedName(baseName) && (entry.course || '') === (course || '') && (entry.semester || '') === (semester || '');
                            });
                            const labButtonLabel = hasLab ? 'Lab On' : 'Lab Off';
                            const labButtonClass = hasLab ? 'toggle-lab-btn active' : 'toggle-lab-btn';
                            const buttonName = item.isLab ? item.name : baseName;
                            return `
                                <div class="subject-item ${item.category === 'elective' ? 'elective' : item.category === 'placement' ? 'placement' : 'main'} ${item.isLab ? 'lab' : ''}">
                                    <span class="subject-item-name">
                                        ${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ''}
                                        ${item.isLab ? '<span class="lab-badge">LAB</span>' : ''}
                                    </span>
                                    <div class="subject-actions">
                                        ${(item.course || item.semester) ? `<span class="subject-meta">${courseLabel}${semesterLabel}</span>` : ''}
                                        <button type="button" class="${labButtonClass}" aria-label="Toggle lab for ${escapeHtml(buttonName)}" data-name="${escapeHtml(buttonName)}" data-course="${escapeHtml(course)}" data-semester="${escapeHtml(semester)}" title="${labButtonLabel}"></button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;

            const sections = [
                groups.main.length ? renderGroup('Main Subjects', groups.main, 'main') : '',
                groups.elective.program.length ? renderGroup('Departmental Elective', groups.elective.program, 'elective') : '',
                groups.elective.open.length ? renderGroup('Open Elective', groups.elective.open, 'elective') : '',
                groups.placement.length ? renderGroup('Placement & Training', groups.placement, 'placement') : ''
            ].filter(Boolean).join('');

            list.innerHTML = sections;

            list.querySelectorAll('.toggle-lab-btn').forEach((button) => {
                button.addEventListener('click', async () => {
                    const name = button.dataset.name || '';
                    const courseValue = button.dataset.course || dashboardCourse || 'B.Tech';
                    const semesterValue = button.dataset.semester || dashboardTimetableState?.currentSemester || 'semester1';
                    await toggleSubjectLab(name, courseValue, semesterValue);
                });
            });
        }

        async function addSubject() {
            const input = document.getElementById('subjectName');
            if (!input) return;

            const name = input.value.trim();
            if (!name) return;

            const course = document.getElementById('subjectCourse')?.value || dashboardCourse || 'B.Tech';
            const semester = document.getElementById('subjectSemester')?.value || dashboardTimetableState?.currentSemester || 'semester1';
            const category = document.getElementById('subjectCategory')?.value || 'main';
            const electiveType = category === 'elective' ? (document.getElementById('subjectElectiveType')?.value || 'program') : 'program';
            const isLab = document.getElementById('isLab')?.checked;
            if (subjectCatalog.some((item) => item.name === name && item.isLab === isLab && (item.course || '') === course && (item.semester || '') === semester && (item.category || 'main') === category && (item.electiveType || 'program') === electiveType)) {
                input.value = '';
                return;
            }

            const subject = { name, code: '', category, electiveType, isLab: Boolean(isLab), course, semester };
            subjectCatalog.push(subject);
            input.value = '';
            document.getElementById('isLab').checked = false;
            renderSubjects();
            renderManageLabs();
            renderManageFormSubjects();
            try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}

            const saved = await saveSubjectsToApi();
            if (!saved) {
                subjectCatalog = subjectCatalog.filter((item) => item !== subject);
                renderSubjects(document.getElementById('subjectSearch')?.value || '');
                renderManageLabs();
                renderManageFormSubjects();
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                alert('Backend unavailable. Subject was not saved to MongoDB.');
            }
        }

        async function addLab() {
            const nameInput = document.getElementById('lab-name');
            const idInput = document.getElementById('lab-id');
            const errorBox = document.getElementById('manage-lab-error');
            const successBox = document.getElementById('manage-lab-success');
            const name = nameInput?.value.trim() || '';
            const id = idInput?.value.trim() || '';

            if (errorBox) {
                errorBox.textContent = '';
                errorBox.classList.remove('show');
            }
            if (successBox) {
                successBox.textContent = '';
                successBox.classList.remove('show');
            }

            if (!name || !id) {
                if (errorBox) {
                    errorBox.textContent = 'Enter both lab name and lab ID.';
                    errorBox.classList.add('show');
                }
                return;
            }

            if (labCatalog.some(lab => String(lab.id || '').toLowerCase() === id.toLowerCase())) {
                if (errorBox) {
                    errorBox.textContent = 'A lab with this ID already exists.';
                    errorBox.classList.add('show');
                }
                return;
            }

            const selectedKeys = Array.from(document.querySelectorAll('#lab-subject-list input[type="checkbox"]:checked')).map(input => input.value);
            if (!selectedKeys.length) {
                if (errorBox) {
                    errorBox.textContent = 'Select at least one lab subject.';
                    errorBox.classList.add('show');
                }
                return;
            }

            const subjects = getLabSubjectOptions()
                .filter(item => selectedKeys.includes(subjectIdentity(item)))
                .map(item => ({
                    key: subjectIdentity(item),
                    label: item.code ? `${item.name} (${item.code})` : item.name,
                    course: item.course || 'B.Tech',
                    semester: item.semester || 'semester1'
                }));

            const previousCatalog = labCatalog.slice();
            labCatalog.push({
                name,
                id,
                subjects,
                createdAt: new Date().toISOString()
            });
            if (!await saveAppSettingsToApi()) {
                labCatalog = previousCatalog;
                renderLabs();
                if (errorBox) {
                    errorBox.textContent = 'Lab was not saved to the database. Please retry.';
                    errorBox.classList.add('show');
                }
                return;
            }

            if (nameInput) nameInput.value = '';
            if (idInput) idInput.value = '';
            document.querySelectorAll('#lab-subject-list input[type="checkbox"]').forEach(input => input.checked = false);
            renderLabs();

            if (successBox) {
                successBox.textContent = 'Lab added successfully.';
                successBox.classList.add('show');
            }
            renderLabTimetable();
        }

        async function deleteLab(id) {
            const previousCatalog = labCatalog.slice();
            const previousTimetable = { ...labTimetable };
            labCatalog = labCatalog.filter(lab => lab.id !== id);
            Object.keys(labTimetable).forEach((key) => {
                if (key.endsWith(`|${id}`)) delete labTimetable[key];
            });
            if (!await saveAppSettingsToApi()) {
                labCatalog = previousCatalog;
                labTimetable = previousTimetable;
                renderLabs();
                renderLabTimetable();
                alert('Lab was not deleted because the change could not be saved to the database.');
                return;
            }
            renderLabs();
            renderLabTimetable();
        }

        function filterSubjects() {
            const search = document.getElementById('subjectSearch')?.value || '';
            renderSubjects(search);
        }

        function uploadLabsAndSubjectsFromExcel() {
            const input = document.getElementById('excelLabSubjectInput');
            if (!input || !input.files.length) {
                alert('Please select an Excel file first.');
                return;
            }

            if (typeof XLSX === 'undefined') {
                alert('The Excel import library is not loaded. Refresh and try again.');
                return;
            }

            const file = input.files[0];
            const reader = new FileReader();

            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                    if (!rows || !rows.length) {
                        alert('No rows were found in the uploaded file.');
                        return;
                    }

                    const cols = Object.keys(rows[0]);
                    const normalize = (text) => String(text || '').trim().toLowerCase().replace(/[_\s]+/g, '');
                    const subjCol = cols.find((c) => {
                        const lower = normalize(c);
                        return lower === 'subjectname' || lower === 'subject' || (lower.includes('subject') && lower.includes('name'));
                    });
                    const labCol = cols.find((c) => {
                        const lower = normalize(c);
                        return lower === 'labname' || lower === 'lab' || (lower.includes('lab') && lower.includes('name'));
                    });
                    const codeCol = cols.find((c) => {
                        const lower = normalize(c);
                        return lower === 'subjectcode' || lower === 'code' || lower.includes('code');
                    });

                    if (!subjCol && !labCol) {
                        alert('Cannot find Subject Name or Lab Name columns in the uploaded file.');
                        return;
                    }

                    let subjectsAdded = 0;
                    let labsAdded = 0;
                    const previousCatalog = subjectCatalog.slice();

                    rows.forEach((row) => {
                        if (subjCol) {
                            const subjectName = String(row[subjCol] || '').trim();
                            if (subjectName) {
                                const normalizedName = normalize(subjectName);
                                const exists = subjectCatalog.some((item) => !item.isLab && normalize(item.name) === normalizedName);
                                if (!exists) {
                                    subjectCatalog.push({
                                        name: subjectName,
                                        code: codeCol ? String(row[codeCol] || '').trim() : '',
                                        isLab: false
                                    });
                                    subjectsAdded += 1;
                                }
                            }
                        }

                        if (labCol) {
                            const labName = String(row[labCol] || '').trim();
                            if (labName) {
                                const normalizedName = normalize(labName);
                                const exists = subjectCatalog.some((item) => item.isLab && normalize(item.name) === normalizedName);
                                if (!exists) {
                                    subjectCatalog.push({
                                        name: labName,
                                        code: '',
                                        isLab: true
                                    });
                                    labsAdded += 1;
                                }
                            }
                        }
                    });

                    if (subjectsAdded + labsAdded === 0) {
                        alert('No new subjects or labs were added. The upload may contain duplicates only.');
                    } else {
                        renderSubjects(document.getElementById('subjectSearch')?.value || '');
                        renderManageLabs();
                        renderManageFormSubjects();
                        try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                        const saved = await saveSubjectsToApi();
                        if (!saved) {
                            subjectCatalog = previousCatalog;
                            renderSubjects(document.getElementById('subjectSearch')?.value || '');
                            renderManageLabs();
                            renderManageFormSubjects();
                            try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                            alert('Import was not saved to the database. Please check the backend connection and retry.');
                            return;
                        }
                        alert(`Imported ${subjectsAdded} subject${subjectsAdded !== 1 ? 's' : ''} and ${labsAdded} lab${labsAdded !== 1 ? 's' : ''}.`);
                    }
                } catch (error) {
                    console.error('Subject Excel import failed:', error);
                    alert('Failed to import subjects from Excel: ' + (error.message || 'Unknown error'));
                } finally {
                    input.value = '';
                }
            };

            reader.readAsArrayBuffer(file);
        }

        async function addTeacher() {
            const input = document.getElementById('teacherName');
            if (!input) return;

            const name = input.value.trim();
            if (!name) return;

            const normalizedName = normalizeTeacherName(name);
            if (teacherRoster.some((t) => normalizeTeacherName(t) === normalizedName)) {
                input.value = '';
                return;
            }

            const previousRoster = manualTeacherRoster.slice();
            manualTeacherRoster.push(name);
            syncApprovedFacultyNamesToTeacherRoster();
            if (!await saveAppSettingsToApi()) {
                manualTeacherRoster = previousRoster;
                syncApprovedFacultyNamesToTeacherRoster();
                alert('Faculty name was not saved to the database. Please retry.');
                return;
            }
            input.value = '';
            renderTeachers();
            // If edit modal is open, refresh the teacher dropdown
            try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotTeacherDropdown(); } catch (e) {}
        }

        async function deleteTeacher(name) {
            const faculty = getFacultyForTeacherName(name);
            if (faculty) {
                await removeFaculty(faculty.id);
                return;
            }
            const previousRoster = manualTeacherRoster.slice();
            manualTeacherRoster = manualTeacherRoster.filter(item => normalizeTeacherName(item) !== normalizeTeacherName(name));
            syncApprovedFacultyNamesToTeacherRoster();
            if (!await saveAppSettingsToApi()) {
                manualTeacherRoster = previousRoster;
                syncApprovedFacultyNamesToTeacherRoster();
                alert('Faculty name was not deleted because the change could not be saved to the database.');
                return;
            }
            renderTeachers(document.getElementById('teacherSearch')?.value || '');
        }

        function filterTeachers() {
            const search = document.getElementById('teacherSearch')?.value || '';
            renderTeachers(search);
        }

        function uploadTeachersFromExcel() {
            const input = document.getElementById('teacherExcelFileInput');
            if (!input || !input.files.length) {
                alert('Please select an Excel or CSV file first.');
                return;
            }

            if (typeof XLSX === 'undefined') {
                alert('The Excel import library is not loaded. Refresh and try again.');
                return;
            }

            const file = input.files[0];
            const reader = new FileReader();

            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                    if (!rows || !rows.length) {
                        alert('No teacher rows were found in the uploaded file.');
                        return;
                    }

                    const headerMap = {};
                    const firstRow = rows[0] || {};
                    Object.keys(firstRow).forEach((key) => {
                        const normalizedKey = String(key || '').trim().toLowerCase().replace(/\s+/g, ' ');
                        headerMap[normalizedKey] = key;
                    });

                    const existingNames = teacherRoster.map(normalizeTeacherName);
                    const previousRoster = manualTeacherRoster.slice();
                    let addedCount = 0;
                    let skippedCount = 0;

                    rows.forEach((row) => {
                        let teacherName = '';
                        const possibleKeys = ['teacher name', 'teacher', 'name', 'teacher_name', 'teachername'];
                        for (const normalizedKey of possibleKeys) {
                            if (headerMap[normalizedKey]) {
                                teacherName = row[headerMap[normalizedKey]];
                                break;
                            }
                        }

                        if (!teacherName) {
                            const values = Object.values(row)
                                .map((value) => String(value || '').trim())
                                .filter(Boolean);
                            teacherName = values.length ? values[0] : '';
                        }

                        const trimmedName = String(teacherName || '').trim();
                        if (!trimmedName) return;

                        const normalized = normalizeTeacherName(trimmedName);
                        if (existingNames.includes(normalized)) {
                            skippedCount += 1;
                            return;
                        }

                        manualTeacherRoster.push(trimmedName);
                        existingNames.push(normalized);
                        addedCount += 1;
                    });

                    if (addedCount === 0) {
                        alert('No new teacher names were imported. The file may contain only duplicates or no valid teacher name column.');
                    } else {
                        syncApprovedFacultyNamesToTeacherRoster();
                        renderTeachers(document.getElementById('teacherSearch')?.value || '');
                        try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotTeacherDropdown(); } catch(e){}
                        if (!await saveAppSettingsToApi()) {
                            manualTeacherRoster = previousRoster;
                            syncApprovedFacultyNamesToTeacherRoster();
                            renderTeachers(document.getElementById('teacherSearch')?.value || '');
                            alert('Faculty import was not saved to the database. Please check the backend connection and retry.');
                            return;
                        }
                        alert(`Imported ${addedCount} teacher${addedCount !== 1 ? 's' : ''}${skippedCount ? ' and skipped ' + skippedCount + ' duplicate' + (skippedCount !== 1 ? 's' : '') : ''}.`);
                    }
                } catch (error) {
                    console.error('Teacher Excel import failed:', error);
                    alert('Failed to import teacher file: ' + (error.message || 'Unknown error'));
                } finally {
                    input.value = '';
                }
            };

            reader.readAsArrayBuffer(file);
        }

        async function generateDashboardTimetable() {
            const generateButton = document.getElementById('dashboardGenerateTimetableButton');
            if (generateButton) generateButton.disabled = true;
            try {
                const payload = await apiRequest('/api/workload-forms');
                const requirementsBySection = buildDashboardWorkloadRequirementsBySection(payload.forms || []);
                const sections = Object.keys(requirementsBySection);
                if (!sections.length) {
                    alert(`No submitted workload assignments have sections assigned for ${dashboardCourse}, ${dashboardTimetableState.currentSemester.replace(/semester/i, 'Semester ')}. Check Manage Workload and assign faculty to sections first.`);
                    return;
                }

                const previousSection = dashboardTimetableState.currentSection;
                const result = { filledCount: 0, conflicts: [] };
                try {
                    for (const section of sections) {
                        dashboardTimetableState.currentSection = section;
                        const sectionResult = await autoGenerateDashboardTimetable(requirementsBySection[section]);
                        result.filledCount += sectionResult.filledCount;
                        result.conflicts.push(...sectionResult.conflicts.map(conflict => (
                            `${sectionLabelForDashboard(section)}: ${conflict}`
                        )));
                    }
                } finally {
                    dashboardTimetableState.currentSection = previousSection;
                    renderDashboardTimetable();
                }

                const message = `${result.filledCount} timetable slot${result.filledCount === 1 ? '' : 's'} scheduled across ${sections.map(sectionLabelForDashboard).join(', ')} from assigned workload.`;
                if (result.conflicts.length) {
                    showConflictModal(`${message}\nWeekly counts could not be fully met:\n${result.conflicts.join('; ')}`);
                } else {
                    alert(`${message} All requested weekly counts were met.`);
                }
            } catch (error) {
                console.error('Workload-based timetable generation failed:', error);
                alert(error.message || 'Unable to load Manage Workload assignments. Timetable was not generated.');
            } finally {
                if (generateButton) generateButton.disabled = false;
            }
        }

        function normalizeTeacherName(name) {
            return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        }

        function normalizeSubjectValue(value) {
            return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
        }

        function sectionLabelForDashboard(section) {
            return String(section || '').replace(/^section/i, 'Section ');
        }

        function dashboardTeacherSubjectDayKey(teacher, day, course, semester, section) {
            return `${normalizeTeacherName(teacher)}|${course}|${semester}|${section}|${day}`;
        }

        function buildDashboardWorkloadRequirementsBySection(workloadForms) {
            const requirementsBySection = {};
            const course = dashboardCourse;
            const semester = dashboardTimetableState.currentSemester;
            const weeklyCount = value => Math.max(0, Math.floor(Number(value) || 0));

            workloadForms
                .filter(form => form.status === 'submitted'
                    && form.course === course
                    && form.semester === semester)
                .forEach(form => {
                    const selectedIds = new Set((form.selectedSubjectIds || []).map(String));
                    (form.selectedSubjects || []).forEach(subject => {
                        if (!selectedIds.has(String(subject.id))) return;

                        const common = {
                            subjectName: subject.name,
                            subjectCode: subject.code || '',
                            teacher: form.facultyName,
                            classType: 'Lecture'
                        };
                        if (subject.isLab) {
                            const labCount = weeklyCount(subject.labCount || subject.lectureCount);
                            if (labCount > 0) {
                                (subject.assignedSections || []).forEach(section => {
                                    if (!['sectionA', 'sectionB', 'sectionC'].includes(section)) return;
                                    requirementsBySection[section] ||= [];
                                    requirementsBySection[section].push({ ...common, classType: 'Lab', lecturesPerWeek: labCount });
                                });
                            }
                            return;
                        }

                        const lectureCount = weeklyCount(subject.lectureCount);
                        const labCount = subject.labEnabled ? weeklyCount(subject.labCount) : 0;
                        (subject.assignedSections || []).forEach(section => {
                            if (!['sectionA', 'sectionB', 'sectionC'].includes(section)) return;
                            requirementsBySection[section] ||= [];
                            if (lectureCount > 0) requirementsBySection[section].push({ ...common, lecturesPerWeek: lectureCount });
                            if (labCount > 0) requirementsBySection[section].push({ ...common, classType: 'Lab', lecturesPerWeek: labCount });
                        });
                    });
                });

            return requirementsBySection;
        }

        function parseTimeRangeToMinutes(range) {
            const match = String(range || '').trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
            if (!match) return 0;
            const [, start, end] = match;
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
        }

        function formatHours(minutes) {
            return (minutes / 60).toFixed(2);
        }

        function formatHourMinuteLabel(minutes) {
            const mins = Math.max(0, Math.round(minutes));
            const hours = Math.floor(mins / 60);
            const remainder = mins % 60;
            const hourLabel = hours ? `${hours}hr${hours === 1 ? '' : 's'}` : '';
            const minuteLabel = remainder ? `${remainder} min` : '';
            return [hourLabel, minuteLabel].filter(Boolean).join(' ').trim() || '0 min';
        }

        function getTeacherWorkloadData() {
            const data = {};
            Object.keys(dashboardTimetableSlotDataByCourse).forEach(course => {
                const slotStore = getDashboardTimetableSlotData(course);
                const periodTimes = getDashboardPeriodTimes(course);

                Object.keys(slotStore).forEach(key => {
                    const slot = slotStore[key];
                    if (!slot) return;
                    const parts = key.split('|');
                    if (parts.length < 4) return;
                    const [semester, section, day, slotIndexStr] = parts;
                    const slotIndex = Number(slotIndexStr);
                    if (Number.isNaN(slotIndex)) return;

                    getDashboardSlotAssignments(slot).forEach(assignment => {
                        if (!assignment.teacher) return;
                        const isLab = /lab/i.test(assignment.classType || slot.classType || assignment.subject || '');
                        const previousKey = `${semester}|${section}|${day}|${slotIndex - 1}`;
                        const previousSlot = slotStore[previousKey];
                        const previousAssignment = getDashboardSlotAssignments(previousSlot).find(item => (
                            normalizeTeacherName(item.teacher) === normalizeTeacherName(assignment.teacher)
                            && (item.subject || '') === (assignment.subject || '')
                        ));
                        if (isLab && previousAssignment) return;

                        const normName = normalizeTeacherName(assignment.teacher);
                        if (!data[normName]) {
                            data[normName] = {
                                teacher: assignment.teacher.trim(),
                                lectureHours: 0,
                                labHours: 0,
                                totalMinutes: 0,
                                courses: new Set(),
                                sections: new Set()
                            };
                        }

                        const row = data[normName];
                        let durationMinutes = parseTimeRangeToMinutes(periodTimes[slotIndex]);
                        if (isLab) {
                            let nextIndex = slotIndex + 1;
                            while (nextIndex < periodTimes.length) {
                                const nextKey = `${semester}|${section}|${day}|${nextIndex}`;
                                const nextSlot = slotStore[nextKey];
                                const nextAssignment = getDashboardSlotAssignments(nextSlot).find(item => (
                                    normalizeTeacherName(item.teacher) === normName
                                    && (item.subject || '') === (assignment.subject || '')
                                ));
                                if (!nextAssignment || !/lab/i.test(nextAssignment.classType || nextSlot.classType || nextAssignment.subject || '')) break;
                                durationMinutes += parseTimeRangeToMinutes(periodTimes[nextIndex]);
                                nextIndex += 1;
                            }
                        }

                        if (isLab) row.labHours += durationMinutes;
                        else row.lectureHours += durationMinutes;
                        row.totalMinutes += durationMinutes;
                        row.courses.add(course);
                        row.sections.add(`${course} ${semesterToRomanLabel(semester)} ${section.replace('section', 'Section ')}`);
                    });
                });
            });

            teacherRoster.forEach(name => {
                const normName = normalizeTeacherName(name);
                if (!data[normName]) {
                    data[normName] = {
                        teacher: name.trim(),
                        lectureHours: 0,
                        labHours: 0,
                        totalMinutes: 0,
                        courses: new Set(),
                        sections: new Set()
                    };
                }
            });

            return Object.values(data).sort((a, b) => b.totalMinutes - a.totalMinutes || a.teacher.localeCompare(b.teacher));
        }

        function renderTeacherWorkload() {
            const container = document.getElementById('workloadOverviewContent');
            if (!container) return;
            const workload = getTeacherWorkloadData();
            if (!workload.length) {
                container.innerHTML = '<p class="status">No teacher assignments found in the current timetable.</p>';
                return;
            }

            const totalTeachers = workload.length;
            const totalLectureMinutes = workload.reduce((sum, item) => sum + item.lectureHours, 0);
            const totalLabMinutes = workload.reduce((sum, item) => sum + item.labHours, 0);
            const totalMinutes = workload.reduce((sum, item) => sum + item.totalMinutes, 0);
            const averageHours = totalTeachers ? totalMinutes / totalTeachers / 60 : 0;
            const maxHours = Math.max(...workload.map(item => item.totalMinutes)) / 60;
            const minHours = Math.min(...workload.map(item => item.totalMinutes)) / 60;

            const summaryHtml = `
                <div class="info-grid" style="margin-bottom:18px;">
                    <div class="info-item"><div class="k">Teachers</div><div class="v">${totalTeachers}</div></div>
                    <div class="info-item"><div class="k">Total Load</div><div class="v">${formatHourMinuteLabel(totalMinutes)}</div></div>
                    <div class="info-item"><div class="k">Lecture Load</div><div class="v">${formatHourMinuteLabel(totalLectureMinutes)}</div></div>
                    <div class="info-item"><div class="k">Lab Load</div><div class="v">${formatHourMinuteLabel(totalLabMinutes)}</div></div>
                    <div class="info-item"><div class="k">Avg / Teacher</div><div class="v">${formatHourMinuteLabel(Math.round(averageHours * 60))}</div></div>
                    <div class="info-item"><div class="k">Max Load</div><div class="v">${formatHourMinuteLabel(Math.round(maxHours * 60))}</div></div>
                    <div class="info-item"><div class="k">Min Load</div><div class="v">${formatHourMinuteLabel(Math.round(minHours * 60))}</div></div>
                </div>
            `;

            const rows = workload.map(item => {
                const courses = Array.from(item.courses).sort().join(', ') || '-';
                const sections = Array.from(item.sections).sort().join(', ') || '-';
                return `
                    <tr>
                        <td>${escapeHtml(item.teacher)}</td>
                        <td>${formatHourMinuteLabel(item.lectureHours)}</td>
                        <td>${formatHourMinuteLabel(item.labHours)}</td>
                        <td>${formatHourMinuteLabel(item.totalMinutes)}</td>
                        <td>${escapeHtml(courses)}</td>
                        <td>${escapeHtml(sections)}</td>
                    </tr>
                `;
            }).join('');

            container.innerHTML = `
                ${summaryHtml}
                <div style="overflow-x:auto;">
                    <table class="workload-table" style="width:100%; border-collapse:collapse; font-size:13px; table-layout: fixed;">
                        <colgroup>
                            <col style="width:18%;">
                            <col style="width:14%;">
                            <col style="width:14%;">
                            <col style="width:14%;">
                            <col style="width:20%;">
                            <col style="width:20%;">
                        </colgroup>
                        <thead>
                            <tr style="background:#f3f4f6; text-align:left;">
                                <th style="padding:10px; border:1px solid #e5e7eb; text-align:left;">Teacher</th>
                                <th style="padding:10px; border:1px solid #e5e7eb; text-align:left;">Lecture Hrs</th>
                                <th style="padding:10px; border:1px solid #e5e7eb; text-align:left;">Lab Hrs</th>
                                <th style="padding:10px; border:1px solid #e5e7eb; text-align:left;">Total Hrs</th>
                                <th style="padding:10px; border:1px solid #e5e7eb; text-align:left;">Courses</th>
                                <th style="padding:10px; border:1px solid #e5e7eb; text-align:left;">Sections</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Check whether a teacher is already assigned at the given day/slot
        // across ALL courses, semesters and sections. Returns true if a conflict
        // exists outside the exact course/semester/section being edited.
        function isTeacherAssignedInOtherSection(currentSemester, day, slotIndex, teacher, currentSection) {
            if (!teacher) return false;
            const normalizedTeacher = normalizeTeacherName(teacher);

            // Collect all known courses (fallback to current dashboardCourse)
            const courses = Object.keys(dashboardTimetableDataByCourse || {}).length > 0
                ? Object.keys(dashboardTimetableDataByCourse)
                : [dashboardCourse];

            for (const course of courses) {
                const allSemesters = getDashboardTimetableData(course);
                for (const semester of Object.keys(allSemesters)) {
                    const semData = allSemesters[semester] || {};
                    for (const section of Object.keys(semData)) {
                        // Skip the exact same course+semester+section we're editing.
                        if (course === dashboardCourse && semester === currentSemester && section === currentSection) continue;

                        const slotKey = `${semester}|${section}|${day}|${slotIndex}`;
                        const slotData = getDashboardTimetableSlotData(course)[slotKey];
                        if (getDashboardSlotAssignments(slotData).some(assignment => (
                            normalizeTeacherName(assignment.teacher) === normalizedTeacher
                        ))) {
                            return true;
                        }
                    }
                }
            }

            return false;
        }

        function findTeacherAssignmentConflict(day, slotIndex, teacher, excludedKeys = new Set()) {
            if (!teacher) return null;
            const normalizedTeacher = normalizeTeacherName(teacher);
            const courses = Array.from(new Set([
                ...Object.keys(dashboardTimetableSlotDataByCourse || {}),
                ...Object.keys(dashboardTimetableDataByCourse || {}),
                dashboardCourse
            ].filter(Boolean)));

            for (const course of courses) {
                const slotDataStore = getDashboardTimetableSlotData(course);
                for (const slotKey of Object.keys(slotDataStore)) {
                    if (excludedKeys.has(`${course}|${slotKey}`)) continue;
                    const [semester, section, slotDay, slotIndexText] = slotKey.split('|');
                    if (slotDay !== day || Number(slotIndexText) !== slotIndex) continue;

                    const slot = slotDataStore[slotKey];
                    const assignment = getDashboardSlotAssignments(slot).find(item => (
                        normalizeTeacherName(item.teacher) === normalizedTeacher
                    ));
                    if (assignment) {
                        const periodLabel = getDashboardPeriodTimes(course, semester)[slotIndex] || `slot ${slotIndex + 1}`;
                        return {
                            course,
                            semester,
                            section,
                            day,
                            periodLabel,
                            subject: assignment.subject || slot.subject || ''
                        };
                    }
                }
            }

            return null;
        }

        function findRoomAssignmentConflict(day, slotIndex, room, excludedKeys = new Set()) {
            if (!room) return null;
            const normalizedRoom = normalizeLabSubjectValue(room);
            const courses = Array.from(new Set([
                ...Object.keys(dashboardTimetableSlotDataByCourse || {}),
                ...Object.keys(dashboardTimetableDataByCourse || {}),
                dashboardCourse
            ].filter(Boolean)));

            for (const course of courses) {
                const slotDataStore = getDashboardTimetableSlotData(course);
                for (const slotKey of Object.keys(slotDataStore)) {
                    if (excludedKeys.has(`${course}|${slotKey}`)) continue;
                    const [semester, section, slotDay, slotIndexText] = slotKey.split('|');
                    if (slotDay !== day || Number(slotIndexText) !== slotIndex) continue;

                    const slot = slotDataStore[slotKey];
                    const assignment = getDashboardSlotAssignments(slot).find(item => (
                        normalizeLabSubjectValue(item.room) === normalizedRoom
                    ));
                    if (assignment) {
                        const periodLabel = getDashboardPeriodTimes(course, semester)[slotIndex] || `slot ${slotIndex + 1}`;
                        return { course, semester, section, day, periodLabel, subject: assignment.subject || slot.subject || '' };
                    }
                }
            }

            return null;
        }

        function formatTeacherAssignmentConflict(conflict) {
            if (!conflict) return '';
            const sectionLabel = conflict.section ? conflict.section.replace('section', 'Section ') : '';
            return [conflict.course, semesterToRomanLabel(conflict.semester), sectionLabel, conflict.day, conflict.periodLabel]
                .filter(Boolean)
                .join(' - ');
        }

        function isDashboardSlotEmpty(semester, section, day, slotIndex) {
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section];
            if (!schedule) return false;
            const periodTimes = getDashboardPeriodTimes(dashboardCourse, semester);
            const value = schedule[day]?.[slotIndex] ?? (periodTimes[slotIndex] === 'Lunch' ? 'Lunch' : '-');
            if (value === 'Lunch') return false;
            if (value && value !== '-') return false;

            const key = `${semester}|${section}|${day}|${slotIndex}`;
            const slotData = getDashboardTimetableSlotData(dashboardCourse)[key];
            return !slotData?.subject && !slotData?.teacher && !slotData?.batchAssignments?.length;
        }

        function shuffledDashboardValues(values) {
            const shuffled = values.slice();
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                const swapIndex = Math.floor(Math.random() * (index + 1));
                [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
            }
            return shuffled;
        }

        async function autoGenerateDashboardTimetable(requirements) {
            const semester = dashboardTimetableState.currentSemester;
            const section = dashboardTimetableState.currentSection;
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section];
            if (!schedule) {
                return { filledCount: 0, conflicts: ['Timetable view is not available for generation.'] };
            }
            const days = getDashboardWorkingDays(dashboardCourse);
            const periodCount = getDashboardPeriodCount(dashboardCourse);
            const periodTimes = getDashboardPeriodTimes(dashboardCourse);
            const teacherSchedule = {};
            const teacherSubjectSchedule = new Map();
            const conflicts = [];
            let filledCount = 0;
            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            const hasDailySubjectAssignment = (teacher, subjectCode, subjectName, day, course, slotSemester, slotSection) => {
                const teacherDayKey = dashboardTeacherSubjectDayKey(teacher, day, course, slotSemester, slotSection);
                const subjectCodeKey = normalizeSubjectValue(subjectCode);
                const subjectNameKey = normalizeSubjectValue(subjectName);
                return (teacherSubjectSchedule.get(teacherDayKey) || []).some(existing => (
                    subjectCodeKey && existing.code
                        ? subjectCodeKey === existing.code
                        : subjectNameKey === existing.name
                ));
            };
            const addDailySubjectAssignment = (teacher, subjectCode, subjectName, day, course, slotSemester, slotSection) => {
                const teacherDayKey = dashboardTeacherSubjectDayKey(teacher, day, course, slotSemester, slotSection);
                const assignments = teacherSubjectSchedule.get(teacherDayKey) || [];
                assignments.push({
                    code: normalizeSubjectValue(subjectCode),
                    name: normalizeSubjectValue(subjectName)
                });
                teacherSubjectSchedule.set(teacherDayKey, assignments);
            };

            const timetableCourses = Array.from(new Set([
                ...Object.keys(dashboardTimetableSlotDataByCourse || {}),
                dashboardCourse
            ].filter(Boolean)));
            timetableCourses.forEach(course => {
                const slotDataStore = getDashboardTimetableSlotData(course);
                Object.keys(slotDataStore).forEach(key => {
                    const [slotSemester, slotSection, day, slotIndex] = key.split('|');
                    const slot = slotDataStore[key];
                    getDashboardSlotAssignments(slot).forEach(assignment => {
                        if (!assignment.teacher) return;
                        const teacherKey = normalizeTeacherName(assignment.teacher);
                        if (!teacherSchedule[teacherKey]) teacherSchedule[teacherKey] = {};
                        teacherSchedule[teacherKey][`${day}-${slotIndex}`] = true;
                        addDailySubjectAssignment(assignment.teacher, assignment.subjectCode, assignment.subjectName || assignment.subject, day, course, slotSemester, slotSection);
                    });
                });
            });

            const labRequirements = requirements.filter(req => String(req.classType || '').toLowerCase().includes('lab'));
            const labPairs = [];
            for (let index = 0; index + 1 < labRequirements.length; index += 2) {
                labPairs.push([labRequirements[index], labRequirements[index + 1]]);
            }
            if (labRequirements.length % 2) {
                const unpaired = labRequirements[labRequirements.length - 1];
                conflicts.push(`${unpaired.teacher} - ${unpaired.subjectName} (${unpaired.lecturesPerWeek}/week): needs a second lab subject for a P1/P2 session.`);
            }

            const matchesLabRequirement = (assignment, requirement, slot) => {
                if (!assignment || normalizeTeacherName(assignment.teacher) !== normalizeTeacherName(requirement.teacher)) return false;
                if (!/lab/i.test(assignment.classType || slot?.classType || assignment.subject || '')) return false;
                const code = normalizeSubjectValue(assignment.subjectCode);
                const name = normalizeSubjectValue(assignment.subjectName || assignment.subject);
                const expectedCode = normalizeSubjectValue(requirement.subjectCode);
                const expectedName = normalizeSubjectValue(requirement.subjectName);
                return expectedCode && code ? expectedCode === code : expectedName === name;
            };

            const makeBatchAssignment = (requirement, batch) => ({
                batch,
                subject: requirement.subjectCode ? `${requirement.subjectName} (${requirement.subjectCode})` : requirement.subjectName,
                subjectName: requirement.subjectName || '',
                subjectCode: requirement.subjectCode || '',
                teacher: requirement.teacher,
                room: '',
                classType: 'Lab'
            });

            labPairs.forEach(([firstRequirement, secondRequirement]) => {
                const firstName = normalizeSubjectValue(firstRequirement.subjectCode || firstRequirement.subjectName);
                const secondName = normalizeSubjectValue(secondRequirement.subjectCode || secondRequirement.subjectName);
                if (firstName === secondName) {
                    conflicts.push(`${firstRequirement.subjectName}: P1/P2 need two different lab subjects.`);
                    return;
                }
                if (normalizeTeacherName(firstRequirement.teacher) === normalizeTeacherName(secondRequirement.teacher)) {
                    conflicts.push(`${firstRequirement.subjectName} / ${secondRequirement.subjectName}: P1 and P2 need different faculty members.`);
                    return;
                }

                const requestedFirst = Math.max(0, Number(firstRequirement.lecturesPerWeek) || 0);
                const requestedSecond = Math.max(0, Number(secondRequirement.lecturesPerWeek) || 0);
                const required = Math.min(requestedFirst, requestedSecond);
                if (requestedFirst !== requestedSecond) {
                    conflicts.push(`${firstRequirement.subjectName} / ${secondRequirement.subjectName}: weekly lab counts differ (${requestedFirst}/${requestedSecond}); only ${required} paired sessions can be scheduled, so the higher requested count will not be met.`);
                }
                if (!required) return;

                const existingSessionDays = new Set();
                Object.keys(slotDataStore).forEach(key => {
                    const [slotSemester, slotSection, day, slotIndexText] = key.split('|');
                    if (slotSemester !== semester || slotSection !== section) return;
                    const slot = slotDataStore[key];
                    const assignments = getDashboardSlotAssignments(slot);
                    if (!assignments.some(item => matchesLabRequirement(item, firstRequirement, slot))
                        || !assignments.some(item => matchesLabRequirement(item, secondRequirement, slot))) return;
                    const slotIndex = Number(slotIndexText);
                    if (slotIndex > 0) {
                        const previous = slotDataStore[`${semester}|${section}|${day}|${slotIndex - 1}`];
                        const previousAssignments = getDashboardSlotAssignments(previous);
                        if (previousAssignments.some(item => matchesLabRequirement(item, firstRequirement, previous))
                            && previousAssignments.some(item => matchesLabRequirement(item, secondRequirement, previous))) return;
                    }
                    existingSessionDays.add(day);
                });
                let assigned = existingSessionDays.size;

                for (const day of shuffledDashboardValues(days)) {
                    if (assigned >= required) break;
                    if (hasDailySubjectAssignment(firstRequirement.teacher, firstRequirement.subjectCode, firstRequirement.subjectName, day, dashboardCourse, semester, section)
                        || hasDailySubjectAssignment(secondRequirement.teacher, secondRequirement.subjectCode, secondRequirement.subjectName, day, dashboardCourse, semester, section)) continue;

                    for (const slotIndex of shuffledDashboardValues(Array.from({ length: periodCount }, (_, index) => index))) {
                        if (assigned >= required) break;
                        if (hasDailySubjectAssignment(firstRequirement.teacher, firstRequirement.subjectCode, firstRequirement.subjectName, day, dashboardCourse, semester, section)
                            || hasDailySubjectAssignment(secondRequirement.teacher, secondRequirement.subjectCode, secondRequirement.subjectName, day, dashboardCourse, semester, section)) break;
                        if (slotIndex >= periodCount - 1
                            || !isDashboardSlotEmpty(semester, section, day, slotIndex)
                            || !isDashboardSlotEmpty(semester, section, day, slotIndex + 1)) continue;

                        const assignments = [
                            { requirement: firstRequirement, teacher: normalizeTeacherName(firstRequirement.teacher), subject: firstRequirement.subjectCode ? `${firstRequirement.subjectName} (${firstRequirement.subjectCode})` : firstRequirement.subjectName },
                            { requirement: secondRequirement, teacher: normalizeTeacherName(secondRequirement.teacher), subject: secondRequirement.subjectCode ? `${secondRequirement.subjectName} (${secondRequirement.subjectCode})` : secondRequirement.subjectName }
                        ];
                        const unavailable = assignments.some(({ requirement, teacher, subject }) => (
                            isTeacherAssignedInOtherSection(semester, day, slotIndex, requirement.teacher, section)
                            || isTeacherAssignedInOtherSection(semester, day, slotIndex + 1, requirement.teacher, section)
                            || (teacherSchedule[teacher] && (teacherSchedule[teacher][`${day}-${slotIndex}`] || teacherSchedule[teacher][`${day}-${slotIndex + 1}`]))
                            || findLabAssignmentConflict(day, slotIndex, dashboardCourse, semester, subject)
                            || findLabAssignmentConflict(day, slotIndex + 1, dashboardCourse, semester, subject)
                        ));
                        if (unavailable) continue;

                        const firstBatch = assigned % 2 === 0;
                        const batchAssignments = firstBatch
                            ? [makeBatchAssignment(firstRequirement, 'P1'), makeBatchAssignment(secondRequirement, 'P2')]
                            : [makeBatchAssignment(secondRequirement, 'P1'), makeBatchAssignment(firstRequirement, 'P2')];
                        const displaySubject = batchAssignments.map(item => `${item.subject} (${item.batch})`).join(' / ');
                        const slotInfo = {
                            subject: displaySubject,
                            subjectName: displaySubject,
                            subjectCode: '',
                            teacher: batchAssignments.map(item => `${item.batch}: ${item.teacher}`).join(' / '),
                            room: '',
                            classTeacher: '',
                            studentNumber: '',
                            academicSession: '',
                            classType: 'Lab',
                            batchAssignments
                        };
                        const slotKey1 = `${semester}|${section}|${day}|${slotIndex}`;
                        const slotKey2 = `${semester}|${section}|${day}|${slotIndex + 1}`;
                        slotDataStore[slotKey1] = { ...slotInfo };
                        slotDataStore[slotKey2] = { ...slotInfo, batchAssignments: batchAssignments.map(item => ({ ...item })) };
                        setDashboardScheduleCellValue(dashboardCourse, semester, section, day, slotIndex, displaySubject);
                        setDashboardScheduleCellValue(dashboardCourse, semester, section, day, slotIndex + 1, displaySubject);

                        assignments.forEach(({ requirement, teacher }) => {
                            if (!teacherSchedule[teacher]) teacherSchedule[teacher] = {};
                            teacherSchedule[teacher][`${day}-${slotIndex}`] = true;
                            teacherSchedule[teacher][`${day}-${slotIndex + 1}`] = true;
                            addDailySubjectAssignment(requirement.teacher, requirement.subjectCode, requirement.subjectName, day, dashboardCourse, semester, section);
                        });
                        assigned += 1;
                        filledCount += 2;
                    }
                }

                if (assigned < required) {
                    conflicts.push(`${firstRequirement.teacher} / ${secondRequirement.teacher} - ${firstRequirement.subjectName} / ${secondRequirement.subjectName} (${assigned}/${required} paired sessions)`);
                }
            });

            shuffledDashboardValues(requirements.filter(req => !String(req.classType || '').toLowerCase().includes('lab')))
                .sort((a, b) => b.lecturesPerWeek - a.lecturesPerWeek)
                .forEach((req) => {
                const isLab = String(req.classType || '').toLowerCase().includes('lab');
                const required = req.lecturesPerWeek;
                const displaySubject = req.subjectCode ? `${req.subjectName} (${req.subjectCode})` : req.subjectName;
                const normalizedSubjectCode = normalizeSubjectValue(req.subjectCode);
                const normalizedSubjectName = normalizeSubjectValue(req.subjectName);
                const normalizedTeacher = normalizeTeacherName(req.teacher);
                const existingSessionDays = new Set();
                Object.keys(slotDataStore).forEach(key => {
                    const [slotSemester, slotSection, day, slotIndexText] = key.split('|');
                    if (slotSemester !== semester || slotSection !== section) return;
                    const slot = slotDataStore[key];
                    const slotIndex = Number(slotIndexText);
                    const assignment = getDashboardSlotAssignments(slot).find(item => {
                        if (normalizeTeacherName(item.teacher) !== normalizedTeacher) return false;
                        if (Boolean(/lab/i.test(item.classType || slot.classType || item.subject || '')) !== isLab) return false;
                        const slotCode = normalizeSubjectValue(item.subjectCode);
                        const slotName = normalizeSubjectValue(item.subjectName || item.subject);
                        return normalizedSubjectCode && slotCode
                            ? normalizedSubjectCode === slotCode
                            : normalizedSubjectName === slotName;
                    });
                    if (!assignment) return;

                    if (isLab && slotIndex > 0) {
                        const previous = slotDataStore[`${semester}|${section}|${day}|${slotIndex - 1}`];
                        if (getDashboardSlotAssignments(previous).some(previousAssignment => (
                            normalizeTeacherName(previousAssignment.teacher) === normalizedTeacher
                            && normalizeSubjectValue(previousAssignment.subjectCode) === normalizeSubjectValue(assignment.subjectCode)
                            && normalizeSubjectValue(previousAssignment.subjectName || previousAssignment.subject)
                                === normalizeSubjectValue(assignment.subjectName || assignment.subject)
                            && /lab/i.test(previousAssignment.classType || previous?.classType || previousAssignment.subject || '')
                        ))) return;
                    }
                    existingSessionDays.add(day);
                    });
                let assignedThisReq = existingSessionDays.size;

                for (const day of shuffledDashboardValues(days)) {
                    if (assignedThisReq >= required) break;
                    if (hasDailySubjectAssignment(req.teacher, req.subjectCode, req.subjectName, day, dashboardCourse, semester, section)) continue;
                    const slotIndexes = Array.from({ length: periodCount }, (_, index) => index);
                    for (const slotIndex of shuffledDashboardValues(slotIndexes)) {
                        if (assignedThisReq >= required) break;
                        if (hasDailySubjectAssignment(req.teacher, req.subjectCode, req.subjectName, day, dashboardCourse, semester, section)) break;
                        if (isLab) {
                            if (slotIndex >= periodCount - 1) continue;
                            if (!isDashboardSlotEmpty(semester, section, day, slotIndex)) continue;
                            if (!isDashboardSlotEmpty(semester, section, day, slotIndex + 1)) continue;
                            if (isTeacherAssignedInOtherSection(semester, day, slotIndex, req.teacher, section)) continue;
                            if (isTeacherAssignedInOtherSection(semester, day, slotIndex + 1, req.teacher, section)) continue;
                            if (findLabAssignmentConflict(day, slotIndex, dashboardCourse, semester, displaySubject)) continue;
                            if (findLabAssignmentConflict(day, slotIndex + 1, dashboardCourse, semester, displaySubject)) continue;
                            const teacherKey1 = `${day}-${slotIndex}`;
                            const teacherKey2 = `${day}-${slotIndex + 1}`;
                            if ((teacherSchedule[normalizedTeacher] && teacherSchedule[normalizedTeacher][teacherKey1]) || (teacherSchedule[normalizedTeacher] && teacherSchedule[normalizedTeacher][teacherKey2])) continue;

                            const slotKey1 = `${semester}|${section}|${day}|${slotIndex}`;
                            const slotKey2 = `${semester}|${section}|${day}|${slotIndex + 1}`;
                            const slotInfo = {
                                subject: displaySubject,
                                subjectName: req.subjectName || (req.subjectCode ? req.subjectName : ''),
                                subjectCode: req.subjectCode || '',
                                teacher: req.teacher,
                                room: '',
                                classTeacher: '',
                                studentNumber: '',
                                academicSession: '',
                                classType: req.classType
                            };
                            slotDataStore[slotKey1] = slotInfo;
                            slotDataStore[slotKey2] = slotInfo;
                            setDashboardScheduleCellValue(dashboardCourse, semester, section, day, slotIndex, displaySubject);
                            setDashboardScheduleCellValue(dashboardCourse, semester, section, day, slotIndex + 1, displaySubject);
                            if (!teacherSchedule[normalizedTeacher]) teacherSchedule[normalizedTeacher] = {};
                            teacherSchedule[normalizedTeacher][teacherKey1] = true;
                            teacherSchedule[normalizedTeacher][teacherKey2] = true;
                            addDailySubjectAssignment(req.teacher, req.subjectCode, req.subjectName, day, dashboardCourse, semester, section);
                            assignedThisReq += 1;
                            filledCount += 2;
                        } else {
                            if (!isDashboardSlotEmpty(semester, section, day, slotIndex)) continue;
                            if (isTeacherAssignedInOtherSection(semester, day, slotIndex, req.teacher, section)) continue;
                            const teacherKey = `${day}-${slotIndex}`;
                            if (teacherSchedule[normalizedTeacher] && teacherSchedule[normalizedTeacher][teacherKey]) continue;

                            const slotKey = `${semester}|${section}|${day}|${slotIndex}`;
                            slotDataStore[slotKey] = {
                                subject: displaySubject,
                                subjectName: req.subjectName || '',
                                subjectCode: req.subjectCode || '',
                                teacher: req.teacher,
                                room: '',
                                classTeacher: '',
                                studentNumber: '',
                                academicSession: '',
                                classType: req.classType
                            };
                            setDashboardScheduleCellValue(dashboardCourse, semester, section, day, slotIndex, displaySubject);
                            if (!teacherSchedule[normalizedTeacher]) teacherSchedule[normalizedTeacher] = {};
                            teacherSchedule[normalizedTeacher][teacherKey] = true;
                            addDailySubjectAssignment(req.teacher, req.subjectCode, req.subjectName, day, dashboardCourse, semester, section);
                            assignedThisReq += 1;
                            filledCount += 1;
                        }
                    }
                }

                if (assignedThisReq < required) {
                    conflicts.push(`${req.teacher} - ${displaySubject} (${assignedThisReq}/${required})`);
                }
            });

            return { filledCount, conflicts };
        }

        // Styled conflict modal (used to show assignment conflicts)
        // Markup is appended near other modals; simple show/close helpers below.

        async function clearDashboardTimetable() {
            const semester = dashboardTimetableState.currentSemester;
            const section = dashboardTimetableState.currentSection;
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section];
            if (!schedule) {
                alert('No timetable data found to clear.');
                return;
            }

            if (!confirm('Clear all current timetable cells for this semester and section?')) {
                return;
            }

            const archived = archiveDashboardTimetable();
            const days = getDashboardWorkingDays(dashboardCourse);
            const periodCount = getDashboardPeriodCount(dashboardCourse);
            days.forEach((day) => {
                schedule[day] = (schedule[day] || Array.from({ length: periodCount }, () => '-')).map((value) => value === 'Lunch' ? 'Lunch' : '-');
            });

            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            Object.keys(slotDataStore).forEach((key) => {
                if (key.startsWith(`${semester}|${section}|`)) {
                    delete slotDataStore[key];
                }
            });

            renderDashboardTimetable();
            renderDashboardHistoryPanel();

            if (archived) {
                const savedToMongo = await saveDashboardHistoryToApi();
                renderDashboardHistoryPanel();
                alert(savedToMongo
                    ? 'Timetable cleared and archived in MongoDB history. Open the history view to restore it.'
                    : 'Timetable cleared and archived locally, but history was not saved to MongoDB.');
            } else {
                alert('Timetable cleared. No data was archived because the timetable was already empty.');
            }
        }

        function toggleTimeSettingDay(day) {
            const button = document.querySelector(`#time-setting-working-days [data-day="${day}"]`);
            if (!button) return;

            const isActive = button.classList.toggle('active');
            const count = [...document.querySelectorAll('#time-setting-working-days .day-toggle.active')].length;
            document.getElementById('time-setting-days-count').textContent = `${count} day${count === 1 ? '' : 's'} selected`;

            if (!isActive && count === 0) {
                button.classList.add('active');
                document.getElementById('time-setting-days-count').textContent = '1 day selected';
            }
        }

        async function applyTimeSettingPanel() {
            const start = document.getElementById('time-setting-start').value;
            const end = document.getElementById('time-setting-end').value;
            const startDate = document.getElementById('time-setting-start-date').value;
            const endDate = document.getElementById('time-setting-end-date').value;
            const duration = Number(document.getElementById('time-setting-duration').value);
            const labDuration = Number(document.getElementById('time-setting-lab-duration').value);
            const lunchStart = document.getElementById('time-setting-lunch-start').value;
            const lunchEnd = document.getElementById('time-setting-lunch-end').value;
            const course = document.getElementById('time-setting-course').value;
            const semester = document.getElementById('time-setting-current-semester').value;
            const applyAll = document.getElementById('time-setting-apply-all').checked;

            function parseTime(t) {
                const parts = String(t || '').split(':').map(Number);
                if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
                return parts[0] * 60 + parts[1];
            }

            function minutesToHHMM(m) {
                const h = Math.floor(m / 60).toString().padStart(2, '0');
                const mm = (m % 60).toString().padStart(2, '0');
                return `${h}:${mm}`;
            }

            const startMin = parseTime(start);
            const endMin = parseTime(end);
            const lunchStartMin = parseTime(lunchStart);
            const lunchEndMin = parseTime(lunchEnd);

            if (startMin === null || endMin === null || duration <= 0 || startMin >= endMin) {
                alert('Please provide valid Start/End times and a positive Duration.');
                return;
            }

            if ((startDate && !endDate) || (!startDate && endDate) || (startDate && endDate && new Date(endDate) < new Date(startDate))) {
                alert('Please provide a valid semester date range with the starting date before the ending date.');
                return;
            }

            // Build new periodTimes array inserting a single 'Lunch' entry when the lunch window is encountered
            const newPeriodTimes = [];
            let cur = startMin;
            while (cur + duration <= endMin) {
                // If lunch falls within the next slot window, insert Lunch and skip to lunch end
                if (lunchStartMin !== null && lunchEndMin !== null && cur >= lunchStartMin && cur < lunchEndMin) {
                    newPeriodTimes.push('Lunch');
                    cur = lunchEndMin;
                    continue;
                }
                // If next slot would overlap the lunch window, and lunch starts before slot end, insert Lunch first
                if (lunchStartMin !== null && lunchEndMin !== null && cur < lunchStartMin && (cur + duration) > lunchStartMin) {
                    newPeriodTimes.push('Lunch');
                    cur = lunchEndMin;
                    continue;
                }

                const s = minutesToHHMM(cur);
                const e = minutesToHHMM(cur + duration);
                newPeriodTimes.push(`${s}-${e}`);
                cur += duration;
            }

            // fallback: ensure at least one period
            if (!newPeriodTimes.length) newPeriodTimes.push(`${start}-${end}`);

            // Determine selected working days
            const activeDayButtons = document.querySelectorAll('#time-setting-working-days .day-toggle.active');
            const selectedDays = Array.from(activeDayButtons).map(b => {
                const d = (b.dataset.day || '').toLowerCase();
                return d ? (d.charAt(0).toUpperCase() + d.slice(1)) : null;
            }).filter(Boolean);
            const finalDays = selectedDays.length ? selectedDays : ['Monday','Tuesday','Wednesday','Thursday','Friday'];

            // Apply settings to the selected course and semester
            const applySemesters = applyAll ? Object.keys(getDashboardTimetableData(course)) : [semester];
            applySemesters.forEach((sem) => {
                const courseSettings = getDashboardCourseSettings(course, sem);
                courseSettings.start = start;
                courseSettings.end = end;
                courseSettings.startDate = startDate || '';
                courseSettings.endDate = endDate || '';
                courseSettings.duration = duration;
                courseSettings.labDuration = labDuration;
                courseSettings.lunchStart = lunchStart;
                courseSettings.lunchEnd = lunchEnd;
                courseSettings.periodTimes = newPeriodTimes.slice();
                courseSettings.periodCount = courseSettings.periodTimes.length;
                courseSettings.workingDays = finalDays.slice();
            });

            // Update summary UI
            const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : 'No semester dates set';
            const summary = [
                `Course ${course}`,
                `Start ${start}`,
                `End ${end}`,
                `Dates ${dateRange}`,
                `Duration ${duration} min`,
                `Lab ${labDuration} min`,
                `Lunch ${lunchStart}-${lunchEnd}`,
                applyAll ? 'Applied to all semesters' : 'Current semester only'
            ].join(' | ');
            // Update dashboardTimetableData structures: set each selected day array to the new period layout
            const targetData = getDashboardTimetableData(course);
            const semesterKeys = applyAll ? Object.keys(targetData) : [semester];
            semesterKeys.forEach((sem) => {
                const semObj = targetData[sem];
                if (!semObj) return;
                Object.keys(semObj).forEach((sec) => {
                    const schedule = semObj[sec];
                    const semesterSettings = getDashboardCourseSettings(course, sem);
                    finalDays.forEach((day) => {
                        schedule[day] = semesterSettings.periodTimes.map(t => t === 'Lunch' ? 'Lunch' : '-');
                    });
                });
            });

            // Remove any existing overrides that are now out-of-range or on days no longer active for the selected course
            const slotDataStore = getDashboardTimetableSlotData(course);
            Object.keys(slotDataStore).forEach((key) => {
                const [sem, sec, day, slotIndexStr] = key.split('|');
                if (!slotIndexStr) return;
                if (!applyAll && sem !== semester) return;

                const semSettings = getDashboardCourseSettings(course, sem);
                const slotIndex = Number(slotIndexStr);
                if (!semSettings.workingDays.includes(day)) {
                    delete slotDataStore[key];
                    return;
                }
                if (slotIndex >= semSettings.periodCount) {
                    delete slotDataStore[key];
                    return;
                }
            });

            const recordsToSave = applySemesters.map((sem) => ({
                course,
                semester: sem,
                ...getDashboardCourseSettings(course, sem)
            }));
            const savedToMongo = await saveTimeSettingsToApi(recordsToSave);

            const status = document.createElement('div');
            status.className = 'hint-box';
            status.innerHTML = `<b>${savedToMongo ? 'Saved to MongoDB' : 'Not saved to MongoDB'}:</b> ${summary}${savedToMongo ? '' : '<br><span style="color:#b45309;">The backend did not confirm this change. Please retry.</span>'}`;
            const card = document.querySelector('#panel-time-setting .card');
            const oldHint = card.querySelector('.hint-box');
            if (oldHint) oldHint.remove();
            card.appendChild(status);

            // Re-render timetable with updated layout
            renderDashboardTimetable();
        }

        async function resetTimeSettingPanel() {
            const course = document.getElementById('time-setting-course')?.value || 'B.Tech';
            const semester = document.getElementById('time-setting-current-semester')?.value || 'semester1';
            const applyAll = document.getElementById('time-setting-apply-all')?.checked;
            const defaultSettings = JSON.parse(JSON.stringify(defaultDashboardSemesterSettings));

            ensureDashboardCourseExists(course);

            const targetSemesters = applyAll ? Object.keys(dashboardCourseSettings[course].semesters) : [semester];
            targetSemesters.forEach((sem) => {
                dashboardCourseSettings[course].semesters[sem] = JSON.parse(JSON.stringify(defaultSettings));
            });

            document.getElementById('time-setting-apply-all').checked = false;
            loadTimeSettingCourseSettings(course, semester);

            const targetData = getDashboardTimetableData(course);
            targetSemesters.forEach((sem) => {
                const semObj = targetData[sem];
                if (!semObj) return;
                Object.keys(semObj).forEach((sec) => {
                    const schedule = semObj[sec];
                    defaultSettings.workingDays.forEach((day) => {
                        schedule[day] = defaultSettings.periodTimes.map(t => t === 'Lunch' ? 'Lunch' : '-');
                    });
                });
            });

            const slotDataStore = getDashboardTimetableSlotData(course);
            Object.keys(slotDataStore).forEach((key) => {
                const [sem, sec, day, slotIndexStr] = key.split('|');
                if (!targetSemesters.includes(sem)) return;
                const slotIndex = Number(slotIndexStr);
                if (!defaultSettings.workingDays.includes(day) || slotIndex >= defaultSettings.periodCount) {
                    delete slotDataStore[key];
                }
            });

            if (dashboardCourse === course && targetSemesters.includes(dashboardTimetableState.currentSemester)) {
                renderDashboardTimetable();
            }

            const savedToMongo = await saveTimeSettingsToApi(targetSemesters.map((sem) => ({
                course,
                semester: sem,
                ...getDashboardCourseSettings(course, sem)
            })));
            const status = document.createElement('div');
            status.className = 'hint-box';
            status.innerHTML = `<b>${savedToMongo ? 'Reset and saved to MongoDB' : 'Reset not saved to MongoDB'}.</b>${savedToMongo ? '' : ' Please check the backend connection and retry.'}`;
            const card = document.querySelector('#panel-time-setting .card');
            const oldHint = card.querySelector('.hint-box');
            if (oldHint) oldHint.remove();
            card.appendChild(status);
        }

        /* ============ DASHBOARD TIMETABLE FRAGMENT ============ */
        // Active course-specific working days and period definitions
        const defaultDashboardSemesterSettings = {
            start: '10:00',
            end: '17:00',
            startDate: '',
            endDate: '',
            duration: 50,
            labDuration: 100,
            lunchStart: '13:20',
            lunchEnd: '14:10',
            workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            periodTimes: ['10:00-10:50', '10:50-11:40', '11:40-12:30', '12:30-13:20', '13:20-14:10', '14:10-15:00', '15:00-15:50'],
            periodCount: 7
        };

        const defaultDashboardCourseSettings = {
            semesters: {
                semester1: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester2: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester3: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester4: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester5: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester6: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester7: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings)),
                semester8: JSON.parse(JSON.stringify(defaultDashboardSemesterSettings))
            }
        };

        function createEmptyDashboardCourseData() {
            return {
                semester1: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester2: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester3: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester4: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester5: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester6: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester7: { sectionA: {}, sectionB: {}, sectionC: {} },
                semester8: { sectionA: {}, sectionB: {}, sectionC: {} }
            };
        }

        const dashboardCourseSettings = {
            'B.Tech': JSON.parse(JSON.stringify(defaultDashboardCourseSettings)),
            'M.Tech': JSON.parse(JSON.stringify(defaultDashboardCourseSettings))
        };

        function getDashboardCourseSettings(course = dashboardCourse, semester = dashboardTimetableState.currentSemester) {
            ensureDashboardCourseExists(course);
            const courseSettings = dashboardCourseSettings[course];
            if (!courseSettings.semesters[semester]) {
                courseSettings.semesters[semester] = JSON.parse(JSON.stringify(defaultDashboardSemesterSettings));
            }
            return courseSettings.semesters[semester];
        }

        function getDashboardWorkingDays(course = dashboardCourse, semester = dashboardTimetableState.currentSemester) {
            return getDashboardCourseSettings(course, semester).workingDays;
        }

        function getDashboardPeriodTimes(course = dashboardCourse, semester = dashboardTimetableState.currentSemester) {
            return getDashboardCourseSettings(course, semester).periodTimes;
        }

        function getDashboardPeriodCount(course = dashboardCourse, semester = dashboardTimetableState.currentSemester) {
            return getDashboardCourseSettings(course, semester).periodCount;
        }

        const dashboardTimetableState = {
            currentSemester: 'semester1',
            currentSection: 'sectionA'
        };

        let dashboardCourse = 'B.Tech';
        let dashboardTimetableEditing = null;
        const dashboardTimetableHistory = [];
        let selectedDashboardHistoryEntryId = null;

        function setDashboardCourse(course) {
            if (!course) return;
            dashboardCourse = course;
            const select = document.getElementById('dashboardCourse');
            if (select) select.value = course;
            const settingSelect = document.getElementById('time-setting-course');
            if (settingSelect) settingSelect.value = course;
            loadTimeSettingCourseSettings(course);
            renderDashboardTimetable();
        }

        function loadTimeSettingCourseSettings(course = dashboardCourse, semester = null) {
            const semesterSelect = document.getElementById('time-setting-current-semester');
            const selectedSemester = semester || (semesterSelect ? semesterSelect.value : dashboardTimetableState.currentSemester);
            const settings = getDashboardCourseSettings(course, selectedSemester);
            const startInput = document.getElementById('time-setting-start');
            const endInput = document.getElementById('time-setting-end');
            const startDateInput = document.getElementById('time-setting-start-date');
            const endDateInput = document.getElementById('time-setting-end-date');
            const durationInput = document.getElementById('time-setting-duration');
            const labDurationInput = document.getElementById('time-setting-lab-duration');
            const lunchStartInput = document.getElementById('time-setting-lunch-start');
            const lunchEndInput = document.getElementById('time-setting-lunch-end');
            const courseSelect = document.getElementById('time-setting-course');
            const dayButtons = document.querySelectorAll('#time-setting-working-days .day-toggle');

            if (semesterSelect) semesterSelect.value = selectedSemester;
            if (courseSelect) courseSelect.value = course;
            if (startInput) startInput.value = settings.start || '10:00';
            if (endInput) endInput.value = settings.end || '17:00';
            if (startDateInput) startDateInput.value = settings.startDate || '';
            if (endDateInput) endDateInput.value = settings.endDate || '';
            if (durationInput) durationInput.value = settings.duration || 50;
            if (labDurationInput) labDurationInput.value = settings.labDuration || 100;
            if (lunchStartInput) lunchStartInput.value = settings.lunchStart || '13:20';
            if (lunchEndInput) lunchEndInput.value = settings.lunchEnd || '14:10';

            if (dayButtons.length) {
                dayButtons.forEach((button) => {
                    const day = button.dataset.day ? button.dataset.day.charAt(0).toUpperCase() + button.dataset.day.slice(1) : '';
                    button.classList.toggle('active', settings.workingDays.includes(day));
                });
                const count = settings.workingDays.length;
                const countEl = document.getElementById('time-setting-days-count');
                if (countEl) countEl.textContent = `${count} day${count === 1 ? '' : 's'} selected`;
            }
        }

        function generateDashboardHistoryId() {
            return `dashboard-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }

        function archiveDashboardTimetable() {
            const semester = dashboardTimetableState.currentSemester;
            const section = dashboardTimetableState.currentSection;
            const course = dashboardCourse;
            const schedule = getDashboardTimetableData(course)[semester]?.[section];
            if (!schedule) return null;

            const slotData = {};
            const slotDataStore = getDashboardTimetableSlotData(course);
            Object.keys(slotDataStore).forEach((key) => {
                if (key.startsWith(`${semester}|${section}|`)) {
                    slotData[key] = JSON.parse(JSON.stringify(slotDataStore[key]));
                }
            });

            const entryCount = Object.values(schedule).reduce((count, values) => {
                if (!Array.isArray(values)) return count;
                return count + values.filter(value => value && value !== '-' && value !== '-' && value !== 'Lunch').length;
            }, 0) + Object.keys(slotData).length;

            const archiveEntry = {
                id: generateDashboardHistoryId(),
                course,
                semester,
                section,
                timestamp: new Date().toISOString(),
                entryCount,
                schedule: JSON.parse(JSON.stringify(schedule)),
                slotData
            };

            dashboardTimetableHistory.unshift(archiveEntry);
            if (dashboardTimetableHistory.length > 20) {
                dashboardTimetableHistory.length = 20;
            }
            return archiveEntry;
        }

        function renderDashboardHistoryPanel() {
            const panel = document.getElementById('historyPanel');
            const countText = document.getElementById('historyCountText');
            const previewContainer = document.getElementById('historyPreviewContainer');
            const previewContent = document.getElementById('historyPreviewContent');
            const restoreButton = document.getElementById('restoreHistoryButton');
            if (!panel || !countText || !previewContainer || !previewContent || !restoreButton) return;

            if (!dashboardTimetableHistory.length) {
                countText.textContent = 'No cleared timetables have been archived yet.';
                panel.innerHTML = '<p style="margin:0; color:#555;">No cleared timetables have been archived yet.</p>';
                previewContainer.style.display = 'none';
                restoreButton.disabled = true;
                return;
            }

            countText.textContent = `Showing ${dashboardTimetableHistory.length} cleared timetable${dashboardTimetableHistory.length !== 1 ? 's' : ''}. Click one to preview it.`;
            panel.innerHTML = dashboardTimetableHistory.map((entry) => {
                const selected = entry.id === selectedDashboardHistoryEntryId;
                const date = new Date(entry.timestamp).toLocaleString();
                const semesterLabel = semesterToRomanLabel(entry.semester);
                const sectionLabel = entry.section.replace('section', 'Section ');
                const subtitle = entry.entryCount > 0 ? `${entry.entryCount} slot${entry.entryCount !== 1 ? 's' : ''}` : 'empty timetable';
                return `
                    <button type="button" class="history-entry" onclick="selectDashboardHistoryEntry('${entry.id}')" style="text-align:left; width:100%; padding:10px; border:1px solid ${selected ? '#6366f1' : '#ddd'}; border-radius:6px; background:${selected ? '#eef2ff' : '#fff'}; cursor:pointer; text-align:left;">
                        <div style="display:flex; justify-content:space-between; gap:16px; font-weight:600; color:#111;">
                            <span>${entry.course} / ${semesterLabel} / ${sectionLabel}</span>
                            <small style="color:#6b7280;">${date}</small>
                        </div>
                        <div style="margin-top:4px; color:#4b5563; font-size:0.9rem;">${subtitle} - click to preview</div>
                    </button>`;
            }).join('');

            if (selectedDashboardHistoryEntryId && dashboardTimetableHistory.some(entry => entry.id === selectedDashboardHistoryEntryId)) {
                renderDashboardHistoryPreview();
            } else {
                selectedDashboardHistoryEntryId = null;
                previewContainer.style.display = 'none';
                restoreButton.disabled = true;
                previewContent.textContent = 'Select a cleared timetable above to preview it here.';
            }
        }

        function selectDashboardHistoryEntry(entryId) {
            selectedDashboardHistoryEntryId = entryId;
            renderDashboardHistoryPanel();
        }

        function renderDashboardHistoryPreview() {
            const previewContainer = document.getElementById('historyPreviewContainer');
            const previewContent = document.getElementById('historyPreviewContent');
            const restoreButton = document.getElementById('restoreHistoryButton');
            if (!previewContainer || !previewContent || !restoreButton) return;

            const entry = dashboardTimetableHistory.find(item => item.id === selectedDashboardHistoryEntryId);
            if (!entry) {
                previewContainer.style.display = 'none';
                restoreButton.disabled = true;
                return;
            }

            const schedule = entry.schedule || {};
            const historySettings = getDashboardCourseSettings(entry.course, entry.semester);
            const days = historySettings.workingDays;
            const periodCount = historySettings.periodCount;
            const headers = historySettings.periodTimes.map((time, idx) => `<th style="padding:4px 8px; border:1px solid #d1d5db;">${time}</th>`).join('');
            const rows = days.map(day => {
                const values = Array.isArray(schedule[day]) ? schedule[day] : Array.from({ length: periodCount }, () => '-');
                const cells = values.map((value, index) => {
                    const slotKey = `${entry.semester}|${entry.section}|${day}|${index}`;
                    const slotData = entry.slotData && entry.slotData[slotKey];
                    const displayValue = slotData?.subject || value || '-';
                    const content = displayValue === 'Lunch' ? 'Lunch' : displayValue;
                    return `<td style="padding:4px 8px; border:1px solid #d1d5db; background:#fff;">${content}</td>`;
                }).join('');
                return `<tr><th style="padding:4px 8px; border:1px solid #d1d5db; text-align:left; background:#f8fafc;">${day}</th>${cells}</tr>`;
            }).join('');

            previewContent.innerHTML = `
                <div style="overflow:auto; max-width:100%;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.92rem;">
                        <thead><tr><th style="padding:4px 8px; border:1px solid #d1d5db; background:#e2e8f0;">Day / Time</th>${headers}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
            previewContainer.style.display = 'block';
            restoreButton.disabled = false;
        }

        function restoreSelectedDashboardHistoryEntry() {
            if (!selectedDashboardHistoryEntryId) {
                alert('Please select a cleared timetable entry to restore before clicking restore.');
                return;
            }
            restoreDashboardHistoryEntry(selectedDashboardHistoryEntryId);
        }

        function restoreDashboardHistoryEntry(entryId) {
            const entry = dashboardTimetableHistory.find(item => item.id === entryId);
            if (!entry) {
                alert('Could not find the selected history entry.');
                return;
            }

            const { course, semester, section } = entry;
            const targetData = getDashboardTimetableData(course);
            targetData[semester] = targetData[semester] || { sectionA: {}, sectionB: {}, sectionC: {} };
            targetData[semester][section] = JSON.parse(JSON.stringify(entry.schedule));

            const targetSlotData = getDashboardTimetableSlotData(course);
            Object.keys(targetSlotData).forEach((key) => {
                if (key.startsWith(`${semester}|${section}|`)) {
                    delete targetSlotData[key];
                }
            });
            Object.keys(entry.slotData).forEach((key) => {
                targetSlotData[key] = JSON.parse(JSON.stringify(entry.slotData[key]));
            });

            dashboardCourse = course;
            const courseSelect = document.getElementById('dashboardCourse');
            if (courseSelect) courseSelect.value = course;
            const settingSelect = document.getElementById('time-setting-course');
            if (settingSelect) settingSelect.value = course;

            dashboardTimetableState.currentSemester = semester;
            dashboardTimetableState.currentSection = section;
            document.querySelectorAll('.semester-selector .semester-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.semester === semester);
            });
            document.querySelectorAll('.section-selector .section-btn').forEach((btn) => {
                btn.classList.toggle('active-a', btn.dataset.section === 'sectionA' && section === 'sectionA');
                btn.classList.toggle('active-b', btn.dataset.section === 'sectionB' && section === 'sectionB');
                btn.classList.toggle('active-c', btn.dataset.section === 'sectionC' && section === 'sectionC');
            });

            loadTimeSettingCourseSettings(course);
            renderDashboardTimetable();
            renderDashboardHistoryPanel();
            alert('Archived timetable restored from history.');
        }

        const dashboardTimetableDataByCourse = {
            'B.Tech': createEmptyDashboardCourseData(),
            'M.Tech': createEmptyDashboardCourseData()
        };

        const dashboardTimetableSlotDataByCourse = {
            'B.Tech': {},
            'M.Tech': {}
        };

        function ensureDashboardCourseExists(course) {
            if (!dashboardCourseSettings[course]) {
                dashboardCourseSettings[course] = JSON.parse(JSON.stringify(defaultDashboardCourseSettings));
            }
            if (!dashboardTimetableDataByCourse[course]) {
                dashboardTimetableDataByCourse[course] = createEmptyDashboardCourseData();
            }
            if (!dashboardTimetableSlotDataByCourse[course]) {
                dashboardTimetableSlotDataByCourse[course] = {};
            }
        }

        function getDashboardTimetableData(course = dashboardCourse) {
            ensureDashboardCourseExists(course);
            return dashboardTimetableDataByCourse[course];
        }

        function getDashboardTimetableSlotData(course = dashboardCourse) {
            ensureDashboardCourseExists(course);
            return dashboardTimetableSlotDataByCourse[course];
        }

        function setDashboardScheduleCellValue(course, semester, section, day, slotIndex, value) {
            const courseData = getDashboardTimetableData(course);
            const sectionSchedule = courseData[semester]?.[section];
            if (!sectionSchedule) return;

            const periodTimes = getDashboardPeriodTimes(course, semester);
            if (!sectionSchedule[day]) {
                sectionSchedule[day] = periodTimes.map(time => time === 'Lunch' ? 'Lunch' : '-');
            }

            if (sectionSchedule[day][slotIndex] === 'Lunch') return;
            sectionSchedule[day][slotIndex] = value || '-';
        }

        function hasDashboardAssignmentsForView(course, semester, section, schedule, days) {
            const hasScheduleCells = days.some(day => (schedule[day] || []).some(value => value && value !== '-' && value !== 'Lunch'));
            if (hasScheduleCells) return true;

            const slotDataStore = getDashboardTimetableSlotData(course);
            return Object.keys(slotDataStore).some((key) => {
                if (!key.startsWith(`${semester}|${section}|`)) return false;
                return Boolean(slotDataStore[key]?.subject);
            });
        }

        function changeDashboardSemester(semester) {
            dashboardTimetableState.currentSemester = semester;
            document.querySelectorAll('.semester-selector .semester-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.semester === semester);
            });
            renderDashboardTimetable();
        }

        function changeDashboardSection(section) {
            dashboardTimetableState.currentSection = section;
            document.querySelectorAll('.section-selector .section-btn').forEach((btn) => {
                btn.classList.toggle('active-a', btn.dataset.section === 'sectionA' && section === 'sectionA');
                btn.classList.toggle('active-b', btn.dataset.section === 'sectionB' && section === 'sectionB');
                btn.classList.toggle('active-c', btn.dataset.section === 'sectionC' && section === 'sectionC');
            });
            renderDashboardTimetable();
        }

        function renderDashboardTimetable() {
            const body = document.getElementById('dashboardTimetableBody');
            const title = document.getElementById('dashboardTimetableTitle');
            const head = document.getElementById('dashboardTimetableHead');
            if (!body || !title) return;

            const semester = dashboardTimetableState.currentSemester;
            const section = dashboardTimetableState.currentSection;
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section] || {};
            const titleLabel = semesterToRomanLabel(semester);
            const sectionLabel = section.replace('section', 'Section ');
            title.textContent = `Timetable - ${dashboardCourse} - ${titleLabel} - ${sectionLabel}`;
            renderDashboardTimetableMeta(semester, section);

            const days = getDashboardWorkingDays(dashboardCourse);
            const periodCount = getDashboardPeriodCount(dashboardCourse);
            const periodTimes = getDashboardPeriodTimes(dashboardCourse);
            // build header
            if (head) {
                head.innerHTML = `<tr><th>Day/Time</th>${periodTimes.map(t => `<th>${t}</th>`).join('')}</tr>`;
            }

            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            body.innerHTML = days.map(day => {
                const values = schedule[day] || Array.from({ length: periodCount }, () => '-');
                const cells = [];
                let index = 0;
                while (index < periodCount) {
                    const value = values[index] || (periodTimes[index] === 'Lunch' ? 'Lunch' : '-');
                    if (value === 'Lunch') {
                        cells.push('<td class="lunch"><div class="slot-content">Lunch Break</div></td>');
                        index += 1;
                        continue;
                    }

                    const key = `${semester}|${section}|${day}|${index}`;
                    const slotData = slotDataStore[key];
                    const displayValue = slotData?.subject || (value !== '-' ? value : '-');
                    const isEmpty = displayValue === '-';

                    if (isEmpty) {
                        cells.push(`<td class="clickable" onclick="openDashboardEditModal('${day}', ${index}, '${semester}', '${section}')"><div class="slot-content">-</div></td>`);
                        index += 1;
                        continue;
                    }

                    // decide whether this slot represents a lab (only labs may span consecutive periods)
                    const isLabSlot = (slotData?.classType && String(slotData.classType).toLowerCase().includes('lab')) || /lab/i.test(displayValue);

                    // compute run length only for lab slots; lectures remain a single slot
                    let run = 1;
                    if (isLabSlot) {
                        for (let j = index + 1; j < periodCount; j += 1) {
                            const v2 = values[j] || (periodTimes[j] === 'Lunch' ? 'Lunch' : '-');
                            if (v2 === 'Lunch') break;
                            const key2 = `${semester}|${section}|${day}|${j}`;
                            const slot2 = slotDataStore[key2];
                            const display2 = slot2?.subject || (v2 !== '-' ? v2 : '-');
                            const teacherEqual = (slotData?.teacher || '') === (slot2?.teacher || '');
                            const classTypeEqual = (slotData?.classType || '') === (slot2?.classType || '');
                            const isLab2 = (slot2?.classType && String(slot2.classType).toLowerCase().includes('lab')) || /lab/i.test(display2);
                            if (isLab2 && display2 === displayValue && teacherEqual && classTypeEqual) run += 1; else break;
                        }
                    }

                    const cellClass = ['clickable', 'filled'];
                    if (isLabSlot) cellClass.push('lab-session');
                    const batchTeachers = Array.isArray(slotData?.batchAssignments) ? slotData.batchAssignments : [];
                    const teacherText = batchTeachers.length
                        ? batchTeachers.map(assignment => `${assignment.batch}: ${assignment.teacher || 'Faculty not assigned'}${assignment.room ? ` · ${assignment.room}` : ''}`).join(' / ')
                        : slotData?.teacher || '';
                    const teacherLine = teacherText ? `<div class="slot-teacher">${escapeHtml(teacherText)}</div>` : '';
                    const colspan = run > 1 ? ` colspan="${run}"` : '';

                    cells.push(`<td class="${cellClass.join(' ')}"${colspan} onclick="openDashboardEditModal('${day}', ${index}, '${semester}', '${section}')">
                        <div class="slot-content"><strong>${displayValue}</strong></div>
                        ${teacherLine}
                    </td>`);

                    index += run;
                }
                return `<tr><th>${day}</th>${cells.join('')}</tr>`;
            }).join('');

            // Refresh subject summary whenever timetable is rendered
            try { renderDashboardSubjectSummary(); } catch (e) { /* ignore */ }
            try { renderLabTimetable(); } catch (e) { /* ignore */ }
            try { renderFacultyTimetablePanel(); } catch (e) { /* ignore */ }
            if (document.getElementById('faculty-schedule-section')?.style.display !== 'none') {
                try { renderFacultyPersonalSchedulePanel(); } catch (e) { /* ignore */ }
            }
            queueDashboardTimetableSave();
        }

        function setFacultyCourse(course) {
            dashboardCourse = course;
            const select = document.getElementById('facultyCourseSelect');
            if (select) select.value = course;
            renderFacultyTimetablePanel();
        }

        function renderFacultyPersonalSchedulePanel() {
            const panel = document.getElementById('facultyPersonalSchedulePanel');
            const title = document.getElementById('facultyPersonalScheduleTitle');
            const roomEl = document.getElementById('facultyPersonalRoomValue');
            const teacherEl = document.getElementById('facultyPersonalClassTeacherValue');
            const studentsEl = document.getElementById('facultyPersonalStudentNumberValue');
            const sessionEl = document.getElementById('facultyPersonalAcademicSessionValue');
            const dateRangeEl = document.getElementById('facultyPersonalSemesterDateValue');
            if (!panel) return;

            const faculty = currentFaculty || facultyDB.find(item => item.id === currentFacultyId);
            const teacherName = faculty?.name || '';
            const normalizedTeacher = normalizeTeacherName(teacherName);

            if (title) {
                title.textContent = teacherName ? `My Schedule - ${teacherName}` : 'My Schedule';
            }

            if (!normalizedTeacher) {
                panel.innerHTML = '<div class="empty-note">Faculty profile was not loaded.</div>';
                return;
            }

            const meta = { room: '', classTeacher: '', studentNumber: '', academicSession: '', dateRange: '' };
            const courseTables = [];

            Object.keys(dashboardTimetableDataByCourse).forEach(course => {
                const slotStore = getDashboardTimetableSlotData(course);
                const courseData = getDashboardTimetableData(course);
                const semesters = Object.keys(courseData);
                if (!semesters.length) return;

                const headerSemester = semesters[0];
                const days = getDashboardWorkingDays(course, headerSemester);
                const periodTimes = getDashboardPeriodTimes(course, headerSemester);
                const periodCount = periodTimes.length;
                const cells = {};
                days.forEach(day => {
                    cells[day] = Array.from({ length: periodCount }, () => []);
                });
                let found = false;

                semesters.forEach(semester => {
                    Object.keys(courseData[semester] || {}).forEach(section => {
                        days.forEach(day => {
                            for (let index = 0; index < periodCount; index += 1) {
                                const key = `${semester}|${section}|${day}|${index}`;
                                const slot = slotStore[key];
                                const assignment = getTeacherSlotAssignment(slot, teacherName);
                                if (!assignment) continue;

                                const assignmentRoom = assignment.room || slot.room;
                                if (!meta.room && assignmentRoom) meta.room = assignmentRoom;
                                if (!meta.classTeacher && slot.classTeacher) meta.classTeacher = slot.classTeacher;
                                if (!meta.studentNumber && slot.studentNumber) meta.studentNumber = slot.studentNumber;
                                if (!meta.academicSession && slot.academicSession) meta.academicSession = slot.academicSession;
                                if (!meta.dateRange) meta.dateRange = getDashboardSemesterDateRange(course, semester);

                                cells[day][index].push({
                                    ...slot,
                                    subject: assignment.batch ? `${assignment.subject} (${assignment.batch})` : assignment.subject,
                                    teacher: assignment.teacher,
                                    room: assignmentRoom,
                                    semester,
                                    section
                                });
                                found = true;
                            }
                        });
                    });
                });

                if (found) {
                    courseTables.push({ course, days, periodTimes, cells });
                }
            });

            if (roomEl) roomEl.textContent = meta.room || 'No rooms assigned';
            if (teacherEl) teacherEl.textContent = meta.classTeacher || teacherName || 'No class teacher assigned';
            if (studentsEl) studentsEl.textContent = meta.studentNumber || 'Not assigned';
            if (sessionEl) sessionEl.textContent = meta.academicSession || '2025-2026';
            if (dateRangeEl) dateRangeEl.textContent = meta.dateRange || 'Not assigned';

            if (!courseTables.length) {
                panel.innerHTML = '<div class="empty-note">No timetable assignments found for you yet.</div>';
                return;
            }

            panel.innerHTML = courseTables.map(table => `
                <div style="margin-bottom:24px;">
                    <div class="section-label">${escapeHtml(table.course)}</div>
                    <div style="overflow-x:auto; background:#fff; border-radius:18px; padding:14px; box-shadow:inset 0 0 0 1px rgba(15, 23, 42, 0.05);">
                        <table class="teacher-timetable-table" style="min-width:760px; margin-bottom:0;">
                            <thead>
                                <tr><th>Day / Time</th>${table.periodTimes.map(time => `<th>${escapeHtml(time)}</th>`).join('')}</tr>
                            </thead>
                            <tbody>
                                ${table.days.map(day => {
                                    const rowCells = table.cells[day];
                                    let rowHtml = '';
                                    for (let cellIndex = 0; cellIndex < rowCells.length; cellIndex += 1) {
                                        const entries = rowCells[cellIndex];
                                        if (!entries.length) {
                                            rowHtml += '<td>-</td>';
                                            continue;
                                        }

                                        const entry = entries[0];
                                        const semesterLabel = semesterToRomanLabel(entry.semester);
                                        const sectionLabel = entry.section.replace('section', 'Section ');
                                        const roomLabel = entry.room ? `Room ${escapeHtml(entry.room)}` : 'Room not assigned';
                                        const isLabCell = /lab/i.test(entry.classType || entry.subject || '');
                                        let colspan = '';

                                        if (isLabCell && cellIndex + 1 < rowCells.length) {
                                            const nextEntries = rowCells[cellIndex + 1];
                                            if (nextEntries.length) {
                                                const nextEntry = nextEntries[0];
                                                const sameSlot = normalizeTeacherName(nextEntry.teacher) === normalizedTeacher
                                                    && nextEntry.subject === entry.subject
                                                    && nextEntry.section === entry.section
                                                    && nextEntry.semester === entry.semester
                                                    && /lab/i.test(nextEntry.classType || nextEntry.subject || '');
                                                if (sameSlot) colspan = ' colspan="2"';
                                            }
                                        }

                                        rowHtml += `
                                            <td class="filled${isLabCell ? ' lab-session' : ''}"${colspan}>
                                                <div class="slot-block">
                                                    <strong>${escapeHtml(entry.subject || '')}</strong>
                                                    <div class="slot-meta">
                                                        <span>${escapeHtml(entry.classType || 'Lecture')}</span>
                                                        <span>${escapeHtml(semesterLabel)}</span>
                                                        <span>${escapeHtml(sectionLabel)}</span>
                                                        <span>${roomLabel}</span>
                                                    </div>
                                                </div>
                                            </td>
                                        `;
                                        if (colspan) cellIndex += 1;
                                    }
                                    return `<tr><th>${escapeHtml(day)}</th>${rowHtml}</tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `).join('');
        }

        function renderFacultyTimetablePanel() {
            const panel = document.getElementById('facultyTimetablePanel');
            const title = document.getElementById('facultyTimetableTitle');
            const roomEl = document.getElementById('facultyRoomValue');
            const teacherEl = document.getElementById('facultyClassTeacherValue');
            const studentsEl = document.getElementById('facultyStudentNumberValue');
            const sessionEl = document.getElementById('facultyAcademicSessionValue');
            const dateRangeEl = document.getElementById('facultySemesterDateValue');
            if (!panel) return;

            const course = dashboardCourse || 'B.Tech';
            const semester = dashboardTimetableState?.currentSemester || 'semester1';
            const section = dashboardTimetableState?.currentSection || 'sectionA';
            const schedule = getDashboardTimetableData(course)[semester]?.[section] || {};
            const days = getDashboardWorkingDays(course);
            const periodCount = getDashboardPeriodCount(course);
            const periodTimes = getDashboardPeriodTimes(course);
            const slotDataStore = getDashboardTimetableSlotData(course);

            if (title) {
                const titleLabel = semesterToRomanLabel(semester);
                const sectionLabel = section.replace('section', 'Section ');
                title.textContent = `Timetable - ${course} - ${titleLabel} - ${sectionLabel}`;
            }

            const meta = { room: '', classTeacher: '', studentNumber: '', academicSession: '' };
            Object.keys(slotDataStore).forEach((key) => {
                if (!key.startsWith(`${semester}|${section}|`)) return;
                const slot = slotDataStore[key];
                if (!slot || !slot.subject) return;
                if (!meta.room && slot.room) meta.room = slot.room;
                if (!meta.classTeacher && slot.classTeacher) meta.classTeacher = slot.classTeacher;
                if (!meta.studentNumber && slot.studentNumber) meta.studentNumber = slot.studentNumber;
                if (!meta.academicSession && slot.academicSession) meta.academicSession = slot.academicSession;
            });
            if (roomEl) roomEl.textContent = meta.room || 'No rooms assigned';
            if (teacherEl) teacherEl.textContent = meta.classTeacher || 'No class teacher assigned';
            if (studentsEl) studentsEl.textContent = meta.studentNumber || 'Not assigned';
            if (sessionEl) sessionEl.textContent = meta.academicSession || '2025-2026';
            if (dateRangeEl) dateRangeEl.textContent = getDashboardSemesterDateRange(course, semester);

            if (!days.length || !periodTimes.length) {
                panel.innerHTML = '<div class="empty-note">No timetable data is available yet.</div>';
                return;
            }

            const hasAnySchedule = hasDashboardAssignmentsForView(course, semester, section, schedule, days);
            if (!hasAnySchedule) {
                panel.innerHTML = '<div class="empty-note">The admin has not generated a timetable for this view yet.</div>';
                return;
            }

            const rows = days.map(day => {
                const values = schedule[day] || Array.from({ length: periodCount }, () => '-');
                const cells = [];
                let index = 0;
                while (index < periodCount) {
                    const value = values[index] || (periodTimes[index] === 'Lunch' ? 'Lunch' : '-');
                    if (value === 'Lunch') {
                        cells.push('<td class="lunch"><div class="slot-content">Lunch Break</div></td>');
                        index += 1;
                        continue;
                    }

                    const key = `${semester}|${section}|${day}|${index}`;
                    const slotData = slotDataStore[key];
                    const displayValue = slotData?.subject || (value !== '-' ? value : '-');
                    const isEmpty = displayValue === '-';

                    if (isEmpty) {
                        cells.push('<td><div class="slot-content">-</div></td>');
                        index += 1;
                        continue;
                    }

                    const isLabSlot = (slotData?.classType && String(slotData.classType).toLowerCase().includes('lab')) || /lab/i.test(displayValue);
                    let run = 1;
                    if (isLabSlot) {
                        for (let j = index + 1; j < periodCount; j += 1) {
                            const v2 = values[j] || (periodTimes[j] === 'Lunch' ? 'Lunch' : '-');
                            if (v2 === 'Lunch') break;
                            const key2 = `${semester}|${section}|${day}|${j}`;
                            const slot2 = slotDataStore[key2];
                            const display2 = slot2?.subject || (v2 !== '-' ? v2 : '-');
                            const teacherEqual = (slotData?.teacher || '') === (slot2?.teacher || '');
                            const classTypeEqual = (slotData?.classType || '') === (slot2?.classType || '');
                            const isLab2 = (slot2?.classType && String(slot2.classType).toLowerCase().includes('lab')) || /lab/i.test(display2);
                            if (isLab2 && display2 === displayValue && teacherEqual && classTypeEqual) run += 1; else break;
                        }
                    }

                    const cellClass = ['filled'];
                    if (isLabSlot) cellClass.push('lab-session');
                    const teacherLine = slotData?.teacher ? `<div class="slot-teacher">${escapeHtml(slotData.teacher)}</div>` : '';
                    const colspan = run > 1 ? ` colspan="${run}"` : '';
                    cells.push(`<td class="${cellClass.join(' ')}"${colspan}><div class="slot-content"><strong>${displayValue}</strong></div>${teacherLine}</td>`);
                    index += run;
                }
                return `<tr><th>${day}</th>${cells.join('')}</tr>`;
            }).join('');

            panel.innerHTML = `
                <div class="dashboard-timetable-grid">
                    <table class="dashboard-timetable-table">
                        <thead>
                            <tr><th>Day/Time</th>${periodTimes.map(t => `<th>${t}</th>`).join('')}</tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        function formatSemesterDateRange(startDate, endDate) {
            const formatDate = (value) => {
                if (!value) return '';
                const date = new Date(value + 'T00:00:00');
                if (Number.isNaN(date.getTime())) return value;
                return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            };
            const start = formatDate(startDate);
            const end = formatDate(endDate);
            if (start && end) return `${start} - ${end}`;
            if (start) return `From ${start}`;
            if (end) return `Until ${end}`;
            return 'Not assigned';
        }

        function getDashboardSemesterDateRange(course = dashboardCourse, semester = dashboardTimetableState.currentSemester) {
            const settings = getDashboardCourseSettings(course, semester);
            return formatSemesterDateRange(settings.startDate, settings.endDate);
        }

        function renderDashboardTimetableMeta(semester, section) {
            const roomEl = document.getElementById('dashboardRoomValue');
            const teacherEl = document.getElementById('dashboardClassTeacherValue');
            const studentsEl = document.getElementById('dashboardStudentNumberValue');
            const sessionEl = document.getElementById('dashboardAcademicSessionValue');
            const dateRangeEl = document.getElementById('dashboardSemesterDateValue');
            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            const meta = { room: '', classTeacher: '', studentNumber: '', academicSession: '' };
            Object.keys(slotDataStore).forEach((key) => {
                if (!key.startsWith(`${semester}|${section}|`)) return;
                if (meta.room && meta.classTeacher && meta.studentNumber && meta.academicSession) return;
                const slot = slotDataStore[key];
                if (!slot || !slot.subject) return;
                if (!meta.room && slot.room) meta.room = slot.room;
                if (!meta.classTeacher && slot.classTeacher) meta.classTeacher = slot.classTeacher;
                if (!meta.studentNumber && slot.studentNumber) meta.studentNumber = slot.studentNumber;
                if (!meta.academicSession && slot.academicSession) meta.academicSession = slot.academicSession;
            });
            roomEl.textContent = meta.room || 'No rooms assigned';
            teacherEl.textContent = meta.classTeacher || 'No class teacher assigned';
            studentsEl.textContent = meta.studentNumber || 'Not assigned';
            sessionEl.textContent = meta.academicSession || '2025-2026';
            if (dateRangeEl) dateRangeEl.textContent = getDashboardSemesterDateRange(dashboardCourse, semester);
            return meta;
        }

        function renderDashboardSubjectSummary() {
            const container = document.getElementById('dashboardSubjectSummary');
            if (!container) return;
            const sem = dashboardTimetableState.currentSemester;
            const sec = dashboardTimetableState.currentSection;

            const summaryMap = {}; // key -> {subjectName, code, L, T, P, faculties:Set}
            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);

            Object.keys(slotDataStore).forEach((key) => {
                if (!key.startsWith(`${sem}|${sec}|`)) return;
                const parts = key.split('|');
                if (parts.length < 4) return;
                const day = parts[2];
                const idx = Number(parts[3]);
                const slot = slotDataStore[key];
                if (!slot || !slot.subject) return;

                const prevKey = `${sem}|${sec}|${day}|${idx - 1}`;
                const prev = slotDataStore[prevKey];
                getDashboardSlotAssignments(slot).forEach(assignment => {
                    const isLab = /lab/i.test(assignment.classType || slot.classType || assignment.subject || '');
                    const alreadyCounted = getDashboardSlotAssignments(prev).some(previous => (
                        previous.subject === assignment.subject
                        && previous.teacher === assignment.teacher
                        && (previous.classType || '') === (assignment.classType || '')
                    ));
                    if (alreadyCounted) return;

                    let name = assignment.subjectName || '';
                    let code = assignment.subjectCode || '';
                    if (!name && !code) {
                        const parsed = extractSubjectNameAndCodeGlobal(assignment.subject || '');
                        name = parsed.name;
                        code = parsed.code;
                    }

                    const mapKey = `${name}|${code}`;
                    if (!summaryMap[mapKey]) summaryMap[mapKey] = { subjectName: name, code, L: 0, T: 0, P: 0, faculties: new Set() };
                    const entry = summaryMap[mapKey];
                    if (isLab) entry.P += 1; else entry.L += 1;
                    if (assignment.teacher) entry.faculties.add(assignment.teacher);
                });
            });

            // build HTML
            const keys = Object.keys(summaryMap);
            if (!keys.length) {
                container.innerHTML = '<div class="empty-note">No subjects assigned in this timetable.</div>';
                return;
            }

            let totalL = 0;
            let totalT = 0;
            let totalP = 0;
            let html = '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
            html += '<thead><tr style="background:#f3f4f6"><th style="padding:8px; border:1px solid #e5e7eb; text-align:left">Subject Code</th><th style="padding:8px; border:1px solid #e5e7eb; text-align:left">Subject Name</th><th style="padding:8px; border:1px solid #e5e7eb; width:60px; text-align:center">L</th><th style="padding:8px; border:1px solid #e5e7eb; width:60px; text-align:center">T</th><th style="padding:8px; border:1px solid #e5e7eb; width:60px; text-align:center">P</th><th style="padding:8px; border:1px solid #e5e7eb; text-align:left">Name of Faculties</th></tr></thead>';
            html += '<tbody>';
            keys.sort().forEach(k => {
                const e = summaryMap[k];
                const faculties = Array.from(e.faculties).join(', ');
                totalL += e.L;
                totalT += e.T;
                totalP += e.P;
                html += `<tr><td style="padding:8px; border:1px solid #e5e7eb">${escapeHtml(e.code || '')}</td><td style="padding:8px; border:1px solid #e5e7eb">${escapeHtml(e.subjectName)}</td><td style="padding:8px; border:1px solid #e5e7eb; text-align:center">${e.L}</td><td style="padding:8px; border:1px solid #e5e7eb; text-align:center">${e.T}</td><td style="padding:8px; border:1px solid #e5e7eb; text-align:center">${e.P}</td><td style="padding:8px; border:1px solid #e5e7eb">${escapeHtml(faculties)}</td></tr>`;
            });
            html += `<tr style="font-weight:700; background:#f9fafb"><td style="padding:8px; border:1px solid #e5e7eb"></td><td style="padding:8px; border:1px solid #e5e7eb; text-align:right">Total</td><td style="padding:8px; border:1px solid #e5e7eb; text-align:center">${totalL}</td><td style="padding:8px; border:1px solid #e5e7eb; text-align:center">${totalT}</td><td style="padding:8px; border:1px solid #e5e7eb; text-align:center">${totalP}</td><td style="padding:8px; border:1px solid #e5e7eb"></td></tr>`;
            html += '</tbody></table>';
            container.innerHTML = html;
        }

        function openDashboardEditModal(day, slotIndex, semester = dashboardTimetableState.currentSemester, section = dashboardTimetableState.currentSection) {
            const key = `${semester}|${section}|${day}|${slotIndex}`;
            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            const slotData = slotDataStore[key] || {};
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section]?.[day] || [];
            const originalValue = schedule[slotIndex];
            const batchAssignments = Array.isArray(slotData.batchAssignments) ? slotData.batchAssignments : [];
            const subject = batchAssignments[0]?.subject || slotData.subject || (originalValue && originalValue !== '-' && originalValue !== 'Lunch' ? originalValue : '');
            dashboardTimetableEditing = { day, slotIndex, semester, section, key };

            // Populate teacher dropdown with current roster and set selection
            try { populateEditSlotTeacherDropdown(); } catch (e) { console.warn('populateEditSlotTeacherDropdown failed', e); }
            try { populateEditSlotSubjectDropdown(subject); } catch (e) { console.warn('populateEditSlotSubjectDropdown failed', e); }
            populateEditSlotBatchSubjectDropdown('editSlotP1Subject', batchAssignments[0]?.subject || subject);
            populateEditSlotBatchSubjectDropdown('editSlotP2Subject', batchAssignments[1]?.subject || '');
            populateEditSlotBatchTeacherDropdown('editSlotP1Teacher');
            populateEditSlotBatchTeacherDropdown('editSlotP2Teacher');
            setElValue('editSlotTeacher', batchAssignments[0]?.teacher || slotData.teacher || '');
            setElValue('editSlotSubject', subject);
            setElValue('editSlotRoom', batchAssignments[0]?.room || slotData.room || '');
            setElValue('editSlotP1Teacher', batchAssignments[0]?.teacher || slotData.teacher || '');
            setElValue('editSlotP1Room', batchAssignments[0]?.room || slotData.room || '');
            setElValue('editSlotP2Teacher', batchAssignments[1]?.teacher || '');
            setElValue('editSlotP2Room', batchAssignments[1]?.room || '');
            setElValue('editSlotClassTeacher', slotData.classTeacher || '');
            setElValue('editSlotStudentNumber', slotData.studentNumber || '');
            setElValue('editSlotAcademicSession', slotData.academicSession || '2025-2026');

            initializeDashboardSlotEditor();
            updateDashboardSlotEditorMode();
            document.getElementById('dashboardEditModalBackdrop').classList.add('active');
        }

        function closeDashboardEditModal(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('dashboardEditModalBackdrop').classList.remove('active');
            dashboardTimetableEditing = null;
        }

        function saveDashboardSlot() {
            if (!dashboardTimetableEditing) return;
            const key = dashboardTimetableEditing.key;
            const rawSubject = document.getElementById('editSlotSubject').value.trim();
            const subjParts = extractSubjectNameAndCodeGlobal(rawSubject);
            const singleSubject = subjParts.code ? `${subjParts.name} (${subjParts.code})` : subjParts.name || rawSubject;
            if (!singleSubject) {
                alert('Please enter a subject for the slot.');
                return;
            }

            let sem;
            let sec;
            let day;
            let slotIndex;

            const parts = key.split('|');
            if (parts.length >= 4) {
                sem = parts[0];
                sec = parts[1];
                day = parts[2];
                slotIndex = Number(parts[3]);
            }

            const subjectSelect = document.getElementById('editSlotSubject');
            const selectedOption = subjectSelect?.selectedOptions?.[0];
            const isLab = selectedOption?.dataset?.isLab === 'true';
            const batchAssignments = isLab ? ['P1', 'P2'].map(batch => {
                const subjectSelectForBatch = document.getElementById(`editSlot${batch}Subject`);
                const option = subjectSelectForBatch?.selectedOptions?.[0];
                const rawBatchSubject = subjectSelectForBatch?.value.trim() || '';
                const parsed = extractSubjectNameAndCodeGlobal(rawBatchSubject);
                return {
                    batch,
                    subject: rawBatchSubject,
                    subjectName: parsed.name || rawBatchSubject,
                    subjectCode: parsed.code || '',
                    teacher: document.getElementById(`editSlot${batch}Teacher`)?.value.trim() || '',
                    room: document.getElementById(`editSlot${batch}Room`)?.value.trim() || '',
                    classType: 'Lab',
                    isLab: option?.dataset?.isLab === 'true'
                };
            }) : [];
            let subject = singleSubject;
            let subjPartsForSlot = subjParts;
            let teacher = document.getElementById('editSlotTeacher').value.trim();
            let room = document.getElementById('editSlotRoom').value.trim();

            if (isLab) {
                if (batchAssignments.some(assignment => !assignment.subject || !assignment.isLab)) {
                    alert('Select a lab subject for both P1 and P2 batches.');
                    return;
                }
                if (normalizeLabSubjectValue(batchAssignments[0].subject) === normalizeLabSubjectValue(batchAssignments[1].subject)) {
                    alert('Choose a different lab subject for P1 and P2.');
                    return;
                }
                if (batchAssignments.some(assignment => !assignment.teacher)) {
                    alert('Select a separate faculty member for each lab batch.');
                    return;
                }
                if (normalizeTeacherName(batchAssignments[0].teacher) === normalizeTeacherName(batchAssignments[1].teacher)) {
                    alert('Choose a different faculty member for P1 and P2 because both batches run at the same time.');
                    return;
                }
                if (batchAssignments.some(assignment => !assignment.room)) {
                    alert('Enter a separate lab room for each batch.');
                    return;
                }
                if (normalizeLabSubjectValue(batchAssignments[0].room) === normalizeLabSubjectValue(batchAssignments[1].room)) {
                    alert('Enter different lab rooms for P1 and P2 so each 30-student batch has its own lab space.');
                    return;
                }

                subject = batchAssignments.map(assignment => `${assignment.subjectName}${assignment.subjectCode ? ` (${assignment.subjectCode})` : ''} (${assignment.batch})`).join(' / ');
                subjPartsForSlot = { name: subject, code: '' };
                teacher = batchAssignments.map(assignment => `${assignment.batch}: ${assignment.teacher}`).join(' / ');
                room = batchAssignments.map(assignment => `${assignment.batch}: ${assignment.room || 'Room not assigned'}`).join(' / ');
            }

            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            const periodCount = getDashboardPeriodCount(dashboardCourse);
            const nextSlotIndex = slotIndex + 1;
            const nextSlotKey = `${sem}|${sec}|${day}|${nextSlotIndex}`;
            const nextSlotData = slotDataStore[nextSlotKey];
            const currentSlotData = slotDataStore[key];
            const excludedConflictKeys = new Set([`${dashboardCourse}|${key}`]);

            if (currentSlotData && /lab/i.test(currentSlotData.classType || currentSlotData.subject || '')) {
                const oldContinuationKey = `${sem}|${sec}|${day}|${slotIndex + 1}`;
                const oldContinuation = slotDataStore[oldContinuationKey];
                if (oldContinuation && oldContinuation.subject === currentSlotData.subject && oldContinuation.teacher === currentSlotData.teacher) {
                    excludedConflictKeys.add(`${dashboardCourse}|${oldContinuationKey}`);
                }
            }

            const assignmentsToValidate = isLab
                ? batchAssignments
                : [{ subject, teacher, classType: 'Lecture' }];

            // Prevent global teacher and physical lab conflicts across courses, semesters and sections.
            try {
                if (parts.length >= 4) {
                    const validationSlotIndexes = isLab ? [slotIndex, nextSlotIndex] : [slotIndex];
                    for (const assignment of assignmentsToValidate) {
                        for (const validationSlotIndex of validationSlotIndexes) {
                            const teacherConflict = findTeacherAssignmentConflict(day, validationSlotIndex, assignment.teacher, excludedConflictKeys);
                            if (teacherConflict) {
                                showConflictModal(`Conflict: ${assignment.batch ? `${assignment.batch} faculty member` : 'This teacher'} is already assigned at ${formatTeacherAssignmentConflict(teacherConflict)}.`);
                                return;
                            }
                            if (isLab) {
                                const labConflict = findLabAssignmentConflict(day, validationSlotIndex, dashboardCourse, sem, assignment.subject, excludedConflictKeys);
                                if (labConflict) {
                                    showConflictModal(`Conflict: This lab subject is already assigned to ${formatLabAssignmentConflict(labConflict, day, validationSlotIndex, dashboardCourse, sem)}.`);
                                    return;
                                }
                                const roomConflict = findRoomAssignmentConflict(day, validationSlotIndex, assignment.room, excludedConflictKeys);
                                if (roomConflict) {
                                    showConflictModal(`Conflict: ${assignment.batch} lab room is already assigned at ${formatTeacherAssignmentConflict(roomConflict)}.`);
                                    return;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Conflict check failed:', e);
                showConflictModal('Conflict check failed. Please try again before saving this slot.');
                return;
            }

            if (isLab) {
                if (nextSlotIndex >= periodCount) {
                    showConflictModal('Conflict: Cannot assign this lab because there is no following slot available. Select an earlier time slot.');
                    return;
                }
                if (nextSlotData && nextSlotData.subject && !excludedConflictKeys.has(`${dashboardCourse}|${nextSlotKey}`)) {
                    showConflictModal('Conflict: The slot after this one is already occupied and this lab requires two consecutive slots.');
                    return;
                }
            }

            // If the current slot used to be a lab, clear its old continuation when changing.
            if (currentSlotData && /lab/i.test(currentSlotData.classType || currentSlotData.subject || '')) {
                const oldContinuationKey = `${sem}|${sec}|${day}|${slotIndex + 1}`;
                const oldContinuation = slotDataStore[oldContinuationKey];
                if (oldContinuation && oldContinuation.subject === currentSlotData.subject && oldContinuation.teacher === currentSlotData.teacher) {
                    delete slotDataStore[oldContinuationKey];
                    setDashboardScheduleCellValue(dashboardCourse, sem, sec, day, slotIndex + 1, '-');
                }
            }

            const slotInfo = {
                subject,
                subjectName: subjPartsForSlot.name || '',
                subjectCode: subjPartsForSlot.code || '',
                teacher: teacher,
                room,
                classTeacher: document.getElementById('editSlotClassTeacher').value.trim(),
                studentNumber: document.getElementById('editSlotStudentNumber').value.trim(),
                academicSession: document.getElementById('editSlotAcademicSession').value.trim() || '2025-2026',
                classType: isLab ? 'Lab' : 'Lecture'
            };
            if (isLab) slotInfo.batchAssignments = batchAssignments.map(({ isLab: _isLab, ...assignment }) => assignment);

            slotDataStore[key] = slotInfo;
            setDashboardScheduleCellValue(dashboardCourse, sem, sec, day, slotIndex, subject);
            if (isLab) {
                slotDataStore[nextSlotKey] = slotInfo;
                setDashboardScheduleCellValue(dashboardCourse, sem, sec, day, nextSlotIndex, subject);
            } else if (nextSlotData && /lab/i.test(nextSlotData.classType || nextSlotData.subject || '')) {
                delete slotDataStore[nextSlotKey];
                setDashboardScheduleCellValue(dashboardCourse, sem, sec, day, nextSlotIndex, '-');
            }

            closeDashboardEditModal();
            renderDashboardTimetable();
        }

        function deleteDashboardSlot() {
            if (!dashboardTimetableEditing) return;
            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            const key = dashboardTimetableEditing.key;
            const parts = key.split('|');
            if (parts.length < 4) {
                delete slotDataStore[key];
                closeDashboardEditModal();
                renderDashboardTimetable();
                return;
            }

            const [sem, sec, day, slotIndexStr] = parts;
            const slotIndex = Number(slotIndexStr);
            const slotData = slotDataStore[key];

            // If this is a lab, remove consecutive slots that belong to the same lab (same subject, teacher, classType)
            const isLab = slotData && ((slotData.classType && String(slotData.classType).toLowerCase().includes('lab')) || /lab/i.test(slotData.subject || ''));
            if (isLab) {
                let j = slotIndex;
                while (true) {
                    const k = `${sem}|${sec}|${day}|${j}`;
                    const s = slotDataStore[k];
                    if (!s) break;
                    const sameSubject = (s.subject || '') === (slotData.subject || '');
                    const sameTeacher = (s.teacher || '') === (slotData.teacher || '');
                    const sameClassType = (s.classType || '') === (slotData.classType || '');
                    if (sameSubject && sameTeacher && sameClassType) {
                        delete slotDataStore[k];
                        setDashboardScheduleCellValue(dashboardCourse, sem, sec, day, j, '-');
                        j += 1;
                        continue;
                    }
                    break;
                }
            } else {
                delete slotDataStore[key];
                setDashboardScheduleCellValue(dashboardCourse, sem, sec, day, slotIndex, '-');
            }

            closeDashboardEditModal();
            renderDashboardTimetable();
        }

        function setElValue(id, value) {
            const el = document.getElementById(id);
            if (el) el.value = value || '';
        }

        // Populate the `editSlotTeacher` dropdown with current teachers
        function populateEditSlotTeacherDropdown() {
            syncApprovedFacultyNamesToTeacherRoster();
            const sel = document.getElementById('editSlotTeacher');
            if (!sel) return;
            sel.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '(Select teacher)';
            sel.appendChild(placeholder);

            const list = Array.isArray(teacherRoster) ? teacherRoster : [];
            list.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                sel.appendChild(opt);
            });
        }

        function populateEditSlotBatchTeacherDropdown(id) {
            syncApprovedFacultyNamesToTeacherRoster();
            const select = document.getElementById(id);
            if (!select) return;
            const selectedValue = select.value;
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '(Select faculty)';
            select.appendChild(placeholder);
            teacherRoster.forEach(teacher => {
                const option = document.createElement('option');
                option.value = teacher;
                option.textContent = teacher;
                select.appendChild(option);
            });
            if (selectedValue) select.value = selectedValue;
        }

        function populateEditSlotBatchSubjectDropdown(id, selectedValue = '') {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '(Select lab subject)';
            select.appendChild(placeholder);

            const activeCourse = dashboardCourse || document.getElementById('time-setting-course')?.value || 'B.Tech';
            const activeSemester = dashboardTimetableEditing?.semester
                || dashboardTimetableState?.currentSemester
                || document.getElementById('time-setting-current-semester')?.value
                || 'semester1';
            const subjects = subjectCatalog
                .filter(item => item.isLab
                    && item.name
                    && (item.course || 'B.Tech') === activeCourse
                    && (item.semester || 'semester1') === activeSemester)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

            subjects.forEach(item => {
                const option = document.createElement('option');
                option.value = item.code ? `${item.name} (${item.code})` : item.name;
                option.textContent = option.value;
                option.dataset.isLab = 'true';
                select.appendChild(option);
            });

            if (selectedValue && !Array.from(select.options).some(option => option.value === selectedValue)) {
                const existingOption = document.createElement('option');
                existingOption.value = selectedValue;
                existingOption.textContent = `${selectedValue} (Existing)`;
                existingOption.dataset.isLab = 'true';
                select.appendChild(existingOption);
            }
            select.value = selectedValue;
        }

        function updateDashboardSlotEditorMode() {
            const isLab = document.getElementById('editSlotSubject')?.selectedOptions?.[0]?.dataset?.isLab === 'true';
            const batchPanel = document.getElementById('editSlotLabBatches');
            if (batchPanel) batchPanel.hidden = !isLab;
            ['editSlotSingleSubjectRow', 'editSlotSingleTeacherRow', 'editSlotSingleRoomRow'].forEach(id => {
                const row = document.getElementById(id);
                if (row) row.hidden = isLab;
            });

            if (isLab) {
                const p1Subject = document.getElementById('editSlotP1Subject');
                if (p1Subject && !p1Subject.value) {
                    p1Subject.value = document.getElementById('editSlotSubject')?.value || '';
                }
            }
        }

        function initializeDashboardSlotEditor() {
            const subjectSelect = document.getElementById('editSlotSubject');
            if (!subjectSelect || subjectSelect.dataset.batchEditorBound) return;
            subjectSelect.addEventListener('change', updateDashboardSlotEditorMode);
            subjectSelect.dataset.batchEditorBound = 'true';
        }

        function populateEditSlotSubjectDropdown(selectedValue = '') {
            const sel = document.getElementById('editSlotSubject');
            if (!sel) return;
            sel.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '(Select subject)';
            sel.appendChild(placeholder);

            const activeCourse = dashboardCourse || document.getElementById('time-setting-course')?.value || 'B.Tech';
            const activeSemester = dashboardTimetableState?.currentSemester || document.getElementById('time-setting-current-semester')?.value || 'semester1';
            const list = Array.isArray(subjectCatalog) ? subjectCatalog.slice() : [];
            const filtered = list.filter((item) => {
                const matchesCourse = typeof item.course === 'string' && item.course === activeCourse;
                const matchesSemester = typeof item.semester === 'string' && item.semester === activeSemester;
                return matchesCourse && matchesSemester;
            });

            filtered.sort((a, b) => {
                if (a.isLab !== b.isLab) return a.isLab ? 1 : -1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });

            filtered.forEach(item => {
                const opt = document.createElement('option');
                const label = item.code ? `${item.name} (${item.code})` : item.name;
                opt.value = label;
                opt.textContent = item.isLab ? `${label} - LAB` : label;
                opt.dataset.isLab = item.isLab ? 'true' : 'false';
                if (item.isLab) {
                    opt.style.color = '#a855f7';
                } else {
                    opt.style.color = '#111827';
                }
                sel.appendChild(opt);
            });

            if (selectedValue) {
                const existing = Array.from(sel.options).some(opt => opt.value === selectedValue);
                if (!existing) {
                    const customOpt = document.createElement('option');
                    customOpt.value = selectedValue;
                    customOpt.textContent = `${selectedValue} (Existing)`;
                    customOpt.style.color = '#ef4444';
                    sel.appendChild(customOpt);
                }
                sel.value = selectedValue;
            }
        }

        // Show a styled conflict modal with message details
        function showConflictModal(message) {
            let modal = document.getElementById('conflictModal');
            if (!modal) {
                // Create modal DOM
                modal = document.createElement('div');
                modal.id = 'conflictModal';
                modal.className = 'modal-backdrop active';
                modal.style.zIndex = 12000;
                modal.innerHTML = `
                    <div class="edit-modal" style="max-width:600px;">
                        <h3 style="margin-bottom:8px;">Conflict Detected</h3>
                        <div id="conflictModalMessage" style="white-space:pre-wrap; color:#4b5563; margin-bottom:16px;"></div>
                        <div style="display:flex; gap:8px; justify-content:flex-end;">
                            <button class="btn btn-secondary" onclick="closeConflictModal()">Close</button>
                        </div>
                    </div>`;
                document.body.appendChild(modal);
            }
            const msgDiv = document.getElementById('conflictModalMessage');
            if (msgDiv) msgDiv.textContent = message;
            modal.classList.add('active');
        }

        function closeConflictModal() {
            const modal = document.getElementById('conflictModal');
            if (modal) {
                modal.classList.remove('active');
                modal.remove();
            }
        }

        // Helper: extract subject name and code from a free-form subject string
        function extractSubjectNameAndCodeGlobal(text) {
            const t0 = String(text || '').trim();
            if (!t0) return { name: '', code: '' };
            let t = t0;

            // parentheses tokens
            const parenMatch = t.match(/\(([^)]+)\)/g);
            if (parenMatch && parenMatch.length) {
                for (let i = parenMatch.length - 1; i >= 0; i--) {
                    const token = parenMatch[i].replace(/[()]/g, '').trim();
                    if (/[A-Za-z].*\d|\d.*[A-Za-z]|[A-Za-z]{1,}\s*\d{2,}/.test(token)) {
                        const codeText = token;
                        t = t.replace(parenMatch[i], '').replace(/\s{2,}/g, ' ').replace(/[-:\s]+$/, '').replace(/^[-:\s]+/, '').trim();
                        return { name: t, code: codeText };
                    }
                }
            }

            const anywhere = t.match(/([A-Za-z]{1,}\s*\d{2,}[A-Za-z0-9()\/-]*)/);
            if (anywhere) {
                const codeText = anywhere[1].trim();
                t = t.replace(anywhere[1], '').replace(/\s{2,}/g, ' ').replace(/[-:\s]+$/, '').replace(/^[-:\s]+/, '').trim();
                return { name: t, code: codeText };
            }

            const lead = t.match(/^([A-Za-z]{1,}\s*\d{2,})\s*[-:]\s*(.+)$/);
            if (lead) return { name: lead[2].trim(), code: lead[1].trim() };

            const trail = t.match(/^(.+?)\s*[-:]\s*([A-Za-z]{1,}\s*\d{2,})$/);
            if (trail) return { name: trail[1].trim(), code: trail[2].trim() };

            return { name: t, code: '' };
        }

        function toRoman(num) {
            const roman = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
            const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
            let result = '';
            for (let i = 0; i < values.length; i++) {
                while (num >= values[i]) {
                    result += roman[i];
                    num -= values[i];
                }
            }
            return result;
        }

        function semesterToRomanLabel(sem) {
            if (!sem) return '';
            const n = parseInt(String(sem).replace('semester', ''), 10) || 0;
            return n ? `Semester ${toRoman(n)}` : '';
        }

        function printDashboardTimetable() {
            try {
                const semesterNum = parseInt(dashboardTimetableState.currentSemester.replace('semester', ''), 10) || 0;
                const sectionLetter = dashboardTimetableState.currentSection.replace('section', '');
                const semesterLabel = semesterNum ? `Semester ${toRoman(semesterNum)}` : '';
                const sectionLabel = `Section ${sectionLetter}`;

                const table = document.getElementById('dashboardTimetableTable');
                if (!table) {
                    alert('Timetable not found.');
                    return;
                }

                                // Build subject summary HTML similar to renderDashboardSubjectSummary()
                                const sem = dashboardTimetableState.currentSemester;
                                const sec = dashboardTimetableState.currentSection;
                                const summaryMap = {};
                                const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
                                Object.keys(slotDataStore).forEach((key) => {
                                        if (!key.startsWith(`${sem}|${sec}|`)) return;
                                        const parts = key.split('|');
                                        if (parts.length < 4) return;
                                        const day = parts[2];
                                        const idx = Number(parts[3]);
                                        const slot = slotDataStore[key];
                                        if (!slot || !slot.subject) return;

                                        const prevKey = `${sem}|${sec}|${day}|${idx - 1}`;
                                        const prev = slotDataStore[prevKey];
                                        getDashboardSlotAssignments(slot).forEach(assignment => {
                                                const isLab = /lab/i.test(assignment.classType || slot.classType || assignment.subject || '');
                                                const alreadyCounted = getDashboardSlotAssignments(prev).some(previous => (
                                                        previous.subject === assignment.subject
                                                        && previous.teacher === assignment.teacher
                                                        && (previous.classType || '') === (assignment.classType || '')
                                                ));
                                                if (alreadyCounted) return;

                                                let name = assignment.subjectName || '';
                                                let code = assignment.subjectCode || '';
                                                if (!name && !code) {
                                                        const parsed = extractSubjectNameAndCodeGlobal(assignment.subject || '');
                                                        name = parsed.name;
                                                        code = parsed.code;
                                                }

                                                const mapKey = `${name}|${code}`;
                                                if (!summaryMap[mapKey]) summaryMap[mapKey] = { subjectName: name, code, L: 0, T: 0, P: 0, faculties: new Set() };
                                                const entry = summaryMap[mapKey];
                                                if (isLab) entry.P += 1; else entry.L += 1;
                                                if (assignment.teacher) entry.faculties.add(assignment.teacher);
                                        });
                                });

                                // Totals
                                let totalL = 0, totalT = 0, totalP = 0;
                                Object.keys(summaryMap).forEach(k => {
                                        totalL += summaryMap[k].L;
                                        totalT += summaryMap[k].T || 0;
                                        totalP += summaryMap[k].P;
                                });

                                // Build summary table HTML
                                let summaryHtml = '';
                                const keys = Object.keys(summaryMap).sort();
                                if (keys.length) {
                                                summaryHtml += '<table class="summary-table" style="width:100%; border-collapse:collapse; font-size:12px; margin-top:18px;">';
                                                summaryHtml += '<thead><tr style="background:#f3f4f6"><th class="" style="width:120px">Subject Code</th><th class="" style="width:260px">Subject Name</th><th class="numeric" style="width:60px">L</th><th class="numeric" style="width:60px">T</th><th class="numeric" style="width:60px">P</th><th class="" style="">Name of Faculties</th></tr></thead>';
                                                summaryHtml += '<tbody>';
                                                keys.forEach(k => {
                                                        const e = summaryMap[k];
                                                        const faculties = Array.from(e.faculties).join(', ');
                                                        summaryHtml += `<tr><td>${escapeHtml(e.code || '')}</td><td>${escapeHtml(e.subjectName)}</td><td class="numeric">${e.L}</td><td class="numeric">${e.T}</td><td class="numeric">${e.P}</td><td>${escapeHtml(faculties)}</td></tr>`;
                                                });
                                                summaryHtml += `<tr style="font-weight:700"><td></td><td style="text-align:right;">Total</td><td class="numeric">${totalL}</td><td class="numeric">${totalT}</td><td class="numeric">${totalP}</td><td></td></tr>`;
                                } else {
                                        summaryHtml = '<div class="empty-note">No subjects assigned in this timetable.</div>';
                                }

                                const meta = renderDashboardTimetableMeta(sem, sec);
                const printHtml = `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Timetable - ${dashboardCourse} - ${semesterLabel} - ${sectionLabel}</title>
    <style>
        @page { size: A4 landscape; margin: 0.25in; }
        * { box-sizing: border-box; }
        html, body { width: auto; min-width: 0; margin: 0; padding: 0; }
        body { font-family: Inter, Arial, sans-serif; color: #111827; font-size: 10px; }
        .print-header { display: grid; justify-items: center; gap: 4px; margin-bottom: 6px; text-align: center; }
        .print-heading { flex: 1; text-align: center; font-weight: 700; font-size: 13px; line-height: 1.2; }
        .print-subheading { font-weight: 600; font-size: 10px; color: #111827; margin-top: 2px; }
        .info-line { display: flex; justify-content: space-between; align-items: center; margin: 6px 0 12px; font-weight: 700; font-size: 10px; gap: 6px; }
        .info-line div { flex: 1; }
        .info-line div:first-child { text-align: left; }
        .info-line div:nth-child(2) { text-align: center; }
        .info-line div:last-child { text-align: right; }
        table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 9px; table-layout: fixed; }
        th, td { min-width: 0; border: 0.5px solid #999; padding: 3px 4px; }
        th { background: #f0f0f0; text-align: left; }
        td { text-align: left; vertical-align: middle; overflow-wrap: anywhere; word-break: normal; white-space: normal; }
        td.numeric, .summary-table th.numeric, .summary-table td.numeric { text-align: center; }
        .summary-table th, .summary-table td { padding: 5px 4px; border: 1px solid #e5e7eb; }
        .summary-table th:not(.numeric), .summary-table td:not(.numeric) { text-align: left; }
        .dashboard-timetable-table, .summary-table-container, .summary-table { width: 100%; max-width: 100%; min-width: 0; }
        .dashboard-timetable-table table { table-layout: fixed; }
        .dashboard-timetable-table th:first-child, .dashboard-timetable-table td:first-child { width: 11%; }
        .summary-table { margin-top: 10px; }
        .no-break, .summary-table, .dashboard-timetable-table { page-break-inside: avoid; }
        @media print {
            html, body { width: auto !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important; }
            .print-header, .print-heading, .info-line { page-break-inside: avoid; }
            table, .summary-table, tr, th, td { page-break-inside: avoid; }
            .dashboard-timetable-table, .summary-table-container { width: 100% !important; max-width: 100% !important; }
            .dashboard-timetable-table table, .summary-table { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; table-layout: fixed !important; }
            table th, table td { min-width: 0 !important; padding: 3px 4px !important; font-size: 9px !important; line-height: 1.15 !important; overflow-wrap: anywhere; }
        }
    </style>
</head>
<body>
    <div class="print-header">
        <div style="font-weight:700; font-size:13px; line-height:1.3; text-align:center;">Prestige Institute of Engineering Management &amp; Research, Indore</div>
        <div style="font-weight:700; font-size:13px; line-height:1.3; text-align:center;">Department of Computer Science &amp; Engineering</div>
    </div>
    <div class="print-heading">
        Timetable - ${dashboardCourse} - ${semesterLabel} - ${sectionLabel}
        <div class="print-subheading">Academic Session: ${escapeHtml(meta.academicSession || '2025-2026')} | Semester Dates: ${escapeHtml(getDashboardSemesterDateRange(dashboardCourse, sem))}</div>
    </div>
    <div class="info-line no-break">
        <div>Room: ${escapeHtml(meta.room || 'No rooms assigned')}</div>
        <div>Teacher: ${escapeHtml(meta.classTeacher || 'No class teacher assigned')}</div>
        <div>Students: ${escapeHtml(meta.studentNumber || 'Not assigned')}</div>
    </div>
    <div class="dashboard-timetable-table">
        ${table.outerHTML}
    </div>
    <div class="summary-table-container" style="margin-top:12px;">
        ${summaryHtml}
    </div>
</body>
</html>`;

                const printWindow = window.open('', '_blank', 'width=1000,height=800');
                if (!printWindow) {
                    alert('Unable to open print window.');
                    return;
                }

                printWindow.document.write(printHtml);
                printWindow.document.close();
                printWindow.focus();
                printWindow.addEventListener('afterprint', () => {
                    if (!printWindow.closed) {
                        printWindow.close();
                    }
                });
                printWindow.print();
            } catch (error) {
                console.error('Print failed', error);
                alert('Unable to print timetable.');
            }
        }

       

        /* ============ FACULTY DASHBOARD ============ */
        async function loadFacultyWorkloadForms() {
            const container = document.getElementById('facultyWorkloadForms');
            if (!container) return;
            container.innerHTML = '<p class="faculty-workload-empty">Loading forms...</p>';
            try {
                const payload = await apiRequest('/api/workload-forms/faculty');
                const forms = payload.forms || [];
                if (!forms.length) {
                    container.innerHTML = '<p class="faculty-workload-empty">No subject preference forms are waiting for you.</p>';
                    return;
                }

                container.innerHTML = forms.map(form => {
                    const submitted = form.status === 'submitted';
                    const selectedIds = form.selectedSubjectIds || [];
                    const subjects = (form.subjects || []).map(subject => {
                        const checked = submitted && selectedIds.includes(subject.id);
                        const counts = [
                            subject.lectureCount ? `${subject.lectureCount} lectures/week` : '',
                            subject.labEnabled || subject.isLab ? `${subject.labCount || subject.lectureCount} labs/week` : ''
                        ].filter(Boolean).join(', ');
                        const subjectCode = subject.code ? ' <small>' + escapeHtml(subject.code) + '</small>' : '';
                        const countsText = counts ? '<small>' + escapeHtml(counts) + '</small>' : '';
                        return `<label class="faculty-workload-subject">
                            <input type="checkbox" data-form-id="${escapeHtml(String(form.id))}" value="${escapeHtml(subject.id)}" ${checked ? 'checked' : ''} ${submitted ? 'disabled' : ''}>
                            <span><strong>${escapeHtml(subject.name)}</strong>${subjectCode}${countsText}</span>
                        </label>`;
                    }).join('');
                    const stateLabel = submitted ? 'Submitted' : 'Action needed';
                    const submittedDate = form.submittedAt ? new Date(form.submittedAt).toLocaleString() : '';
                    const confirmationDate = submittedDate ? ' on ' + escapeHtml(submittedDate) : '';
                    const responseAction = submitted
                        ? '<p class="faculty-workload-confirmation">Your response was submitted' + confirmationDate + '.</p>'
                        : `<button type="button" class="faculty-workload-submit" data-submit-form="${escapeHtml(String(form.id))}">Submit selected subjects</button>`;
                    return `<article class="faculty-workload-card" data-workload-card="${escapeHtml(String(form.id))}">
                        <div class="faculty-workload-card-head">
                            <div><h3>${escapeHtml(form.course || '-')} · ${escapeHtml(form.semester || '-')}</h3><p>${escapeHtml(form.category || 'main')}</p></div>
                            <span class="faculty-workload-state ${submitted ? 'submitted' : 'pending'}">${stateLabel}</span>
                        </div>
                        <div class="faculty-workload-subjects">${subjects}</div>
                        ${responseAction}
                    </article>`;
                }).join('');

                container.querySelectorAll('[data-submit-form]').forEach(button => {
                    button.addEventListener('click', async () => {
                        const formId = button.dataset.submitForm;
                        const selected = Array.from(container.querySelectorAll(`input[data-form-id="${formId}"]:checked`))
                            .map(input => input.value);
                        if (!selected.length) {
                            alert('Select at least one subject before submitting.');
                            return;
                        }
                        button.disabled = true;
                        try {
                            await apiRequest(`/api/workload-forms/${encodeURIComponent(formId)}/faculty-submit`, {
                                method: 'POST',
                                body: { subjectIds: selected }
                            });
                            await loadFacultyWorkloadForms();
                        } catch (error) {
                            alert(error.message || 'Unable to submit your subject preferences.');
                            button.disabled = false;
                        }
                    });
                });
            } catch (error) {
                container.innerHTML = `<p class="faculty-workload-empty">${escapeHtml(error.message || 'Unable to load forms.')}</p>`;
            }
        }

        function setFacultySection(section) {
            const profileSection = document.getElementById('faculty-profile-section');
            const dashboardSection = document.getElementById('faculty-dashboard-section');
            const workloadSection = document.getElementById('faculty-workload-section');
            const scheduleSection = document.getElementById('faculty-schedule-section');
            const profileNav = document.getElementById('faculty-nav-profile');
            const dashboardNav = document.getElementById('faculty-nav-dashboard');
            const workloadNav = document.getElementById('faculty-nav-workload');
            const scheduleNav = document.getElementById('faculty-nav-schedule');

            if (profileSection) profileSection.style.display = section === 'profile' ? '' : 'none';
            if (dashboardSection) dashboardSection.style.display = section === 'dashboard' ? '' : 'none';
            if (workloadSection) workloadSection.style.display = section === 'workload' ? '' : 'none';
            if (scheduleSection) scheduleSection.style.display = section === 'schedule' ? '' : 'none';

            if (profileNav) profileNav.classList.toggle('active', section === 'profile');
            if (dashboardNav) dashboardNav.classList.toggle('active', section === 'dashboard');
            if (workloadNav) workloadNav.classList.toggle('active', section === 'workload');
            if (scheduleNav) scheduleNav.classList.toggle('active', section === 'schedule');

            if (section === 'dashboard') {
                try { renderFacultyTimetablePanel(); } catch (e) { /* ignore */ }
            }
            if (section === 'workload') {
                void loadFacultyWorkloadForms();
            }
            if (section === 'schedule') {
                try { renderFacultyPersonalSchedulePanel(); } catch (e) { /* ignore */ }
            }
        }

        function openFaculty(f) {
            currentFacultyId = f.id;
            currentFaculty = f;
            showScreen("faculty");
            document.getElementById("fac-side-name").textContent = f.name;
            document.getElementById("fac-side-email").textContent = f.email;
            document.getElementById("fac-welcome-name").textContent = "Welcome, " + f.name;
            document.getElementById("fac-name").textContent = f.name;
            document.getElementById("fac-dept").textContent = f.dept;
            document.getElementById("fac-empid").textContent = f.empid;
            document.getElementById("fac-email").textContent = f.email;
            document.getElementById("fac-approved-date").textContent = f.approvedOn || "-";
            document.getElementById("fac-date").textContent = formatToday();
            setFacultySection('profile');
        }

        function logout() {
            currentFacultyId = null;
            currentFaculty = null;
            setApiSession('', '');
            document.getElementById("login-email").value = "";
            document.getElementById("login-password").value = "";
            showScreen("login");
        }

        function initializeManageFormControls() {
            document.querySelectorAll('.manage-form-switch input').forEach(input => {
                const label = input.closest('.manage-form-switch')?.querySelector('strong');
                if (!label) return;
                const updateLabel = () => {
                    label.textContent = input.checked ? 'Lab ON' : 'Lab OFF';
                };
                if (!input.dataset.manageFormBound) {
                    input.addEventListener('change', async () => {
                        updateLabel();
                        const subjectName = input.dataset.manageFormLab;
                        if (subjectName) {
                            const labCountKey = input.dataset.manageFormLabCount;
                            if (input.checked && labCountKey && manageFormLectureCounts[labCountKey] === undefined) {
                                manageFormLectureCounts[labCountKey] = '1';
                                saveManageFormLectureCounts();
                            }
                            const saved = await toggleSubjectLab(subjectName, input.dataset.course || 'B.Tech', input.dataset.semester || 'semester1');
                            if (!saved) {
                                input.checked = !input.checked;
                                updateLabel();
                            }
                        }
                    });
                    input.dataset.manageFormBound = 'true';
                }
                updateLabel();
            });

            document.querySelectorAll('[data-manage-form-count]').forEach(input => {
                if (input.dataset.manageFormBound) return;
                input.addEventListener('input', () => {
                    manageFormLectureCounts[input.dataset.manageFormCount] = input.value;
                    saveManageFormLectureCounts();
                });
                input.dataset.manageFormBound = 'true';
            });

            document.querySelectorAll('[data-manage-form-subject]').forEach(input => {
                if (input.dataset.manageFormBound) return;
                input.addEventListener('change', () => {
                    manageFormSubjectSelections[input.dataset.manageFormSubject] = input.checked;
                    queueAppSettingsSave();
                });
                input.dataset.manageFormBound = 'true';
            });
        }

        function initializeManageFormFilters() {
            document.querySelectorAll('.manage-form-controls select').forEach(select => {
                if (select.dataset.manageFormBound) return;
                select.addEventListener('change', renderManageFormSubjects);
                select.dataset.manageFormBound = 'true';
            });

            document.querySelectorAll('.manage-form-tab').forEach(tab => {
                if (tab.dataset.manageFormBound) return;
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.manage-form-tab').forEach(item => item.classList.remove('active'));
                    tab.classList.add('active');
                    renderManageFormSubjects();
                });
                tab.dataset.manageFormBound = 'true';
            });

            const saveButton = document.querySelector('.manage-form-save');
            if (saveButton && !saveButton.dataset.manageFormBound) {
                saveButton.addEventListener('click', async () => {
                    saveManageFormLectureCounts();
                    saveManageFormSubjectSelections();
                    if (await saveAppSettingsToApi()) {
                        alert('Manage Form saved to the database.');
                    } else {
                        alert('Manage Form was not saved. Please check the backend connection and retry.');
                    }
                });
                saveButton.dataset.manageFormBound = 'true';
            }

            const forwardButton = document.querySelector('.manage-form-forward');
            if (forwardButton && !forwardButton.dataset.manageFormBound) {
                forwardButton.addEventListener('click', forwardManageFormToFaculty);
                forwardButton.dataset.manageFormBound = 'true';
            }
        }

        async function openWorkloadResponseForm(token) {
            showScreen('workload-response');
            const intro = document.getElementById('workload-response-intro');
            const status = document.getElementById('workload-response-status');
            const subjectList = document.getElementById('workload-response-subjects');
            const submitButton = document.getElementById('workload-response-submit');
            try {
                const payload = await apiRequest(`/api/workload-forms/${encodeURIComponent(token)}`, { auth: false });
                const form = payload.form;
                intro.textContent = `${form.facultyName}, choose the subjects you are able to teach for ${form.course}, ${form.semester}.`;
                if (form.status === 'submitted') {
                    const selected = (form.subjects || []).filter(subject => (form.selectedSubjectIds || []).includes(subject.id));
                    const selectedRows = selected.map(subject => {
                        const subjectCode = subject.code ? ' (' + escapeHtml(subject.code) + ')' : '';
                        return '<li>' + escapeHtml(subject.name) + subjectCode + '</li>';
                    }).join('');
                    subjectList.innerHTML = '<ul>' + selectedRows + '</ul>';
                    status.textContent = 'This form has already been submitted.';
                    submitButton.hidden = true;
                    return;
                }

                subjectList.innerHTML = (form.subjects || []).map(subject => {
                    const counts = [
                        subject.lectureCount ? `${subject.lectureCount} lectures/week` : '',
                        subject.labEnabled || subject.isLab ? `${subject.labCount || subject.lectureCount} labs/week` : ''
                    ].filter(Boolean).join(', ');
                    const subjectCode = subject.code ? ' <small>' + escapeHtml(subject.code) + '</small>' : '';
                    const countsLabel = counts ? '<small>' + escapeHtml(counts) + '</small>' : '';
                    return `<label class="workload-response-subject">
                        <input type="checkbox" value="${escapeHtml(subject.id)}">
                        <span><strong>${escapeHtml(subject.name)}</strong>${subjectCode}${countsLabel}</span>
                    </label>`;
                }).join('');
                if (!(form.subjects || []).length) {
                    status.textContent = 'No subjects were included in this form.';
                    submitButton.hidden = true;
                    return;
                }
                status.textContent = 'Select every subject you can teach, then submit your response.';
                submitButton.hidden = false;
                submitButton.onclick = async () => {
                    const subjectIds = Array.from(subjectList.querySelectorAll('input:checked')).map(input => input.value);
                    if (!subjectIds.length) {
                        status.textContent = 'Select at least one subject before submitting.';
                        return;
                    }
                    submitButton.disabled = true;
                    try {
                        await apiRequest(`/api/workload-forms/${encodeURIComponent(token)}/submit`, {
                            method: 'POST',
                            auth: false,
                            body: { subjectIds }
                        });
                        status.textContent = 'Your subject preferences have been submitted.';
                        subjectList.querySelectorAll('input').forEach(input => { input.disabled = true; });
                        submitButton.hidden = true;
                    } catch (error) {
                        status.textContent = error.message || 'Unable to submit your response.';
                        submitButton.disabled = false;
                    }
                };
            } catch (error) {
                intro.textContent = 'This faculty workload form is unavailable.';
                status.textContent = error.message || 'The link may be invalid or already expired.';
                submitButton.hidden = true;
            }
        }

        // Check for invite code in URL on page load
        async function initializeFromUrlParams() {
            const urlParams = new URLSearchParams(window.location.search);
            if (inviteRegistrationMode) {
                setInviteRegistrationMode(true);
            }
            const workloadToken = urlParams.get('workloadForm');
            if (workloadToken) {
                await openWorkloadResponseForm(workloadToken);
                return;
            }
            let inviteCode = urlParams.get('inviteCode');
            
            if (inviteCode) {
                setInviteRegistrationMode(true);
                showScreen('signup');
                document.getElementById('signup-submit-button').disabled = true;
                const signupError = document.getElementById('signup-error');
                signupError.textContent = 'Checking your faculty invitation...';
                signupError.classList.add('show');
                // Decode the invite code
                console.log('Processing invite code:', inviteCode);
                console.log('Available invites:', inviteDB.map(i => i.inviteCode));
                
                const invitedEmail = await validateAndUseInvite(inviteCode);
                if (invitedEmail) {
                    clearErrors();
                    document.getElementById('signup-submit-button').disabled = false;
                    document.getElementById('invite-registration-notice').textContent =
                        'You are registering as faculty with an invitation. Admin sign-in is unavailable from this link.';
                    console.log('Invite validated for:', invitedEmail);
                    // Pre-fill email in signup form and lock it
                    const emailField = document.getElementById("su-email");
                    emailField.value = invitedEmail;
                    emailField.readOnly = true;
                    emailField.style.backgroundColor = "var(--parchment-dark)";
                    emailField.style.cursor = "not-allowed";
                    
                    // Add locked indicator
                    const emailLabel = document.querySelector('label[for="su-email"]') || 
                                     Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('Email'));
                    if (emailLabel) {
                        const span = emailLabel.querySelector('span');
                        if (!span) {
                            emailLabel.innerHTML += ' <span style="color: var(--slate); font-size: 12px; font-weight: 400;">(locked)</span>';
                        }
                    }
                    
                    // Switch to signup tab and show signup screen
                    setLoginRole('faculty');
                    showScreen('signup');
                    document.documentElement.classList.remove('invite-link-pending');
                    // Scroll to page top
                    window.scrollTo(0, 0);
                } else {
                    console.error('Invite validation failed for code:', inviteCode);
                    signupError.textContent = 'This faculty invitation is invalid or expired. Please contact your administrator for a new invite.';
                    signupError.classList.add('show');
                    document.getElementById('invite-registration-notice').textContent =
                        'This invitation could not be verified. Registration is disabled until you receive a valid invite.';
                    document.documentElement.classList.remove('invite-link-pending');
                }
            }
        }

        /* init */
        renderTeachers();
        updateHeaderStats();
        setLoginRole(loginRole);
        renderPendingInvites();
        initializeManageFormFilters();
        initializeManageFormControls();
