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

let nextId = 3;
        let loginRole = "faculty";
        let currentFacultyId = null;
        let currentFaculty = null;
        let currentInviteCode = null;
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

        function startManageFacultyAutoRefresh() {
            // Stop any existing interval
            stopManageFacultyAutoRefresh();
            // Auto-refresh every 1 second for immediate visibility
            manageFacultyRefreshInterval = setInterval(() => {
                if (document.getElementById("panel-manage")?.classList.contains("active")) {
                    renderManageFaculty();
                }
            }, 1000);
            console.log('Auto-refresh started for Manage Faculty panel');
        }
        
        function stopManageFacultyAutoRefresh() {
            if (manageFacultyRefreshInterval) {
                clearInterval(manageFacultyRefreshInterval);
                manageFacultyRefreshInterval = null;
                console.log('Auto-refresh stopped for Manage Faculty panel');
            }
        }

        function setLoginRole(role) {
            loginRole = role;
            document.getElementById("tab-faculty").classList.toggle("active", role === "faculty");
            document.getElementById("tab-admin").classList.toggle("active", role === "admin");
            document.getElementById("login-title").textContent = role === "admin" ? "Admin sign in" : "Faculty sign in";
            document.getElementById("login-sub").textContent = role === "admin"
                ? "Reach the registrar console to manage requests."
                : "Enter your credentials to reach your dashboard.";
            document.getElementById("login-hint").style.display = role === "admin" ? "block" : "none";
            document.getElementById("login-email").value = "";
            document.getElementById("login-password").value = "";
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
                    await loadDashboardHistoryFromApi();
                    openAdmin();
                } else {
                    await loadTimeSettingsFromApi();
                    await loadSubjectsFromApi();
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

            stamp.classList.remove("approved");
            if (kind === "pending") {
                stampText.innerHTML = "PENDING<br>REVIEW";
                title.textContent = "Request received";
                text.textContent = `Hi ${record.name.split(' ')[0]}, your registration has been sent to the admin office. You'll be able to sign in as soon as it's approved.`;
            } else {
                stampText.innerHTML = "NOT<br>APPROVED";
                title.textContent = "Access not granted";
                text.textContent = "The admin office did not approve this registration. Contact the registrar for details.";
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
            document.getElementById("admin-date").textContent = dateStr;
            document.getElementById("admin-date2").textContent = dateStr;
        }

        let manageFacultyRefreshInterval = null;
        
        function startManageFacultyAutoRefresh() {
            stopManageFacultyAutoRefresh();
            manageFacultyRefreshInterval = setInterval(() => {
                if (document.getElementById("panel-manage")?.classList.contains("active")) {
                    renderManageFaculty();
                }
            }, 1000);
        }
        
        function stopManageFacultyAutoRefresh() {
            if (manageFacultyRefreshInterval) {
                clearInterval(manageFacultyRefreshInterval);
                manageFacultyRefreshInterval = null;
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
                loadFacultyFromApi();
                renderManageFaculty();
                renderInvitationsStatus();  // Refresh invitation status
                startManageFacultyAutoRefresh();
            } else {
                stopManageFacultyAutoRefresh();
            }
            if (which === "manage-admin") {
                loadAdminsFromApi();
                renderManageAdmin();
                renderInvitationsStatus();  // Show invitation status
            }
            if (which === "add-faculty") {
                syncApprovedFacultyNamesToTeacherRoster();
                renderTeachers(document.getElementById('teacherSearch')?.value || '');
            }
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
            await loadFacultyFromApi();
            console.log('renderManageFaculty called, facultyDB length:', facultyDB.length, 'facultyDB:', facultyDB);
            const pending = facultyDB.filter(f => f.status === "pending");
            const approved = facultyDB.filter(f => f.status === "approved");
            const all = approved;

            console.log('Pending faculty:', pending.length, 'Approved faculty:', approved.length);

            // Track pending count changes (without notifications)
            lastSeenPendingFaculty = [...pending];
            lastPendingCount = pending.length;

            document.getElementById("stat-a").textContent = pending.length;
            document.getElementById("stat-b").textContent = approved.length;
            document.getElementById("stat-c").textContent = approved.length;
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

        async function refreshManageFaculty() {
            console.log('Manual refresh clicked');
            await renderManageFaculty();
            // Optional: Show a brief visual feedback
            const btn = event.target;
            btn.textContent = 'Refresh Refreshed!';
            setTimeout(() => btn.textContent = 'Refresh Refresh', 2000);
        }

        function syncApprovedFacultyNamesToTeacherRoster() {
            const existing = new Set((Array.isArray(teacherRoster) ? teacherRoster : []).map(normalizeTeacherName));
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
        let subjectCatalog = [];

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

            const dashboardExcelInput = document.getElementById('dashboardExcelFileInput');
            if (dashboardExcelInput) {
                dashboardExcelInput.addEventListener('change', function () {
                    const nameEl = document.getElementById('dashboardExcelFileName');
                    if (nameEl) {
                        nameEl.textContent = dashboardExcelInput.files && dashboardExcelInput.files.length
                            ? dashboardExcelInput.files[0].name
                            : 'No file chosen';
                    }
                });
            }

            if (typeof renderDashboardHistoryPanel === 'function') {
                renderDashboardHistoryPanel();
            }
            if (typeof loadTimeSettingCourseSettings === 'function') {
                loadTimeSettingCourseSettings(dashboardCourse);
            }
            loadDemoSubjects();
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
                return `
                <div class="teacher-item">
                    <span class="teacher-item-name">${escapeHtml(name)}</span>
                    <div class="teacher-actions">
                        <button class="btn btn-ghost btn-small" type="button" onclick='showTeacherTimetable(${arg})'>View</button>
                        <button class="teacher-delete" type="button" onclick="deleteTeacher('${name.replace(/'/g, "\\'")}')">Delete</button>
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
                                if (slot && normalizeTeacherName(slot.teacher) === normalizedTeacher) {
                                    const hintKey = `${course}|${semester}|${section}`;
                                    cells[day][idx].push({ ...slot, semester, section, hintKey });
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
            await saveTeacherViewToApi({
                facultyId: faculty?.id || null,
                teacherName,
                normalizedTeacherName: normalizedTeacher,
                email: faculty?.email || '',
                dept: faculty?.dept || '',
                empid: faculty?.empid || '',
                viewedAt: new Date().toISOString(),
                courseTables
            });
        }

        function closeTeacherTimetableModal() {
            const modal = document.getElementById('teacherTimetableModal');
            if (modal) modal.classList.remove('active');
        }

        function toggleSubjectLab(itemName, course = dashboardCourse || 'B.Tech', semester = dashboardTimetableState?.currentSemester || 'semester1') {
            const baseName = String(itemName || '').trim();
            if (!baseName) return false;

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
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                return true;
            }

            subjectCatalog.push({
                name: labName,
                code: '',
                isLab: true,
                course: course || 'B.Tech',
                semester: semester || 'semester1'
            });

            renderSubjects(document.getElementById('subjectSearch')?.value || '');
            try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
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
                }
            };

            visible.forEach((item) => {
                if ((item.category || 'main') === 'elective') {
                    const electiveKey = item.electiveType === 'open' ? 'open' : 'program';
                    groups.elective[electiveKey].push(item);
                } else {
                    groups.main.push(item);
                }
            });

            const hasAny = groups.main.length || groups.elective.program.length || groups.elective.open.length;
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
                                <div class="subject-item ${item.category === 'elective' ? 'elective' : 'main'} ${item.isLab ? 'lab' : ''}">
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
                groups.elective.open.length ? renderGroup('Open Elective', groups.elective.open, 'elective') : ''
            ].filter(Boolean).join('');

            list.innerHTML = sections;

            list.querySelectorAll('.toggle-lab-btn').forEach((button) => {
                button.addEventListener('click', () => {
                    const name = button.dataset.name || '';
                    const courseValue = button.dataset.course || dashboardCourse || 'B.Tech';
                    const semesterValue = button.dataset.semester || dashboardTimetableState?.currentSemester || 'semester1';
                    toggleSubjectLab(name, courseValue, semesterValue);
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
            try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}

            const saved = await saveSubjectsToApi();
            if (!saved) {
                subjectCatalog = subjectCatalog.filter((item) => item !== subject);
                renderSubjects(document.getElementById('subjectSearch')?.value || '');
                try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                alert('Backend unavailable. Subject was not saved to MongoDB.');
            }
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
                        try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotSubjectDropdown(); } catch (e) {}
                        const saved = await saveSubjectsToApi();
                        if (!saved) {
                            alert('Imported locally, but subjects were not saved to MongoDB. Please sign in as admin and try again.');
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

        function addTeacher() {
            const input = document.getElementById('teacherName');
            if (!input) return;

            const name = input.value.trim();
            if (!name) return;

            const normalizedName = normalizeTeacherName(name);
            if (teacherRoster.some((t) => normalizeTeacherName(t) === normalizedName)) {
                input.value = '';
                return;
            }

            teacherRoster.push(name);
            input.value = '';
            renderTeachers();
            // If edit modal is open, refresh the teacher dropdown
            try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotTeacherDropdown(); } catch (e) {}
        }

        function deleteTeacher(name) {
            const index = teacherRoster.indexOf(name);
            if (index !== -1) {
                teacherRoster.splice(index, 1);
                renderTeachers(document.getElementById('teacherSearch')?.value || '');
            }
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

            reader.onload = function (e) {
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

                        teacherRoster.push(trimmedName);
                        existingNames.push(normalized);
                        addedCount += 1;
                    });

                    if (addedCount === 0) {
                        alert('No new teacher names were imported. The file may contain only duplicates or no valid teacher name column.');
                    } else {
                        renderTeachers(document.getElementById('teacherSearch')?.value || '');
                        try { if (document.getElementById('dashboardEditModalBackdrop')?.classList.contains('active')) populateEditSlotTeacherDropdown(); } catch(e){}
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

        function uploadDashboardTimetableFromExcel() {
            const input = document.getElementById('dashboardExcelFileInput');
            if (!input) {
                alert('Upload control is unavailable.');
                return;
            }

            if (!input.files.length) {
                input.click();
                return;
            }

            if (typeof XLSX === 'undefined') {
                alert('Excel library is not loaded. Please refresh the page and try again.');
                return;
            }

            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = parseDashboardExcelRows(firstSheet);
                    const requirements = buildDashboardRequirements(rows);
                    if (!requirements.length) {
                        alert('No valid timetable requirements were found. Use columns: Subject Name, Subject Code, Teacher Name, Class Type, Lectures Per Week.');
                        return;
                    }
                    autoGenerateDashboardTimetable(requirements);
                } catch (error) {
                    console.error('Dashboard Excel import failed', error);
                    alert('Failed to import timetable from Excel: ' + (error.message || error));
                } finally {
                    input.value = '';
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function normalizeTeacherName(name) {
            return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
                    if (!slot || !slot.teacher) return;
                    const parts = key.split('|');
                    if (parts.length < 4) return;
                    const [semester, section, day, slotIndexStr] = parts;
                    const slotIndex = Number(slotIndexStr);
                    if (Number.isNaN(slotIndex)) return;

                    const isLab = /lab/i.test(slot.classType || slot.subject || '');
                    if (isLab) {
                        const prevKey = `${semester}|${section}|${day}|${slotIndex - 1}`;
                        const prevSlot = slotStore[prevKey];
                        if (prevSlot && prevSlot.teacher === slot.teacher && prevSlot.subject === slot.subject && prevSlot.classType === slot.classType) {
                            return;
                        }
                    }

                    const normName = normalizeTeacherName(slot.teacher);
                    if (!data[normName]) {
                        data[normName] = {
                            teacher: slot.teacher.trim(),
                            lectureHours: 0,
                            labHours: 0,
                            totalMinutes: 0,
                            courses: new Set(),
                            sections: new Set()
                        };
                    }

                    const row = data[normName];
                    const periodMinutes = parseTimeRangeToMinutes(periodTimes[slotIndex]);
                    let durationMinutes = periodMinutes;

                    if (isLab) {
                        let nextIndex = slotIndex + 1;
                        while (nextIndex < periodTimes.length) {
                            const nextKey = `${semester}|${section}|${day}|${nextIndex}`;
                            const nextSlot = slotStore[nextKey];
                            if (!nextSlot) break;
                            const nextIsLab = /lab/i.test(nextSlot.classType || nextSlot.subject || '');
                            if (!nextIsLab || nextSlot.teacher !== slot.teacher || nextSlot.subject !== slot.subject || nextSlot.classType !== slot.classType) break;
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

        function parseDashboardExcelRows(sheet) {
            const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            if (rawRows.length && Object.keys(rawRows[0]).some((key) => String(key).trim() !== '' && !/^\d+$/.test(key))) {
                return rawRows;
            }

            const arrayRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            if (!arrayRows.length) return [];

            const headers = arrayRows[0].map((h) => String(h || '').trim());
            return arrayRows.slice(1).map((row) => {
                const obj = {};
                for (let i = 0; i < headers.length; i += 1) {
                    const header = headers[i] || `Column${i}`;
                    obj[header] = row[i] || '';
                }
                return obj;
            });
        }

        function buildDashboardRequirements(rows) {
            const requirements = [];
            rows.forEach((row) => {
                const subjectName = String(row['Subject Name'] || row['Subject'] || '').trim();
                const subjectCode = String(row['Subject Code'] || row['SubjectCode'] || row['Code'] || '').trim();
                const teacher = String(row['Teacher Name'] || row['Teacher'] || row['Faculty'] || '').trim();
                const classType = String(row['Class Type'] || row['Lecture Type'] || row['Type'] || 'Lecture').trim();
                const lecturesPerWeek = parseInt(row['Lectures Per Week'] || row['Lecture Count'] || row['Count'] || '', 10) || 0;

                if (!subjectName || !teacher || lecturesPerWeek <= 0) return;

                requirements.push({
                    subjectName,
                    subjectCode,
                    teacher,
                    classType,
                    lecturesPerWeek
                });
            });
            return requirements;
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
                        if (slotData && normalizeTeacherName(slotData.teacher) === normalizedTeacher) {
                            return true;
                        }
                    }
                }
            }

            return false;
        }

        function isDashboardSlotEmpty(semester, section, day, slotIndex) {
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section];
            if (!schedule || !schedule[day]) return false;
            const value = schedule[day][slotIndex];
            if (value === 'Lunch') return false;
            if (value && value !== '-' && value !== '-') return false;

            const key = `${semester}|${section}|${day}|${slotIndex}`;
            const slotData = getDashboardTimetableSlotData(dashboardCourse)[key];
            return !slotData?.subject;
        }

        function autoGenerateDashboardTimetable(requirements) {
            const semester = dashboardTimetableState.currentSemester;
            const section = dashboardTimetableState.currentSection;
            const schedule = getDashboardTimetableData(dashboardCourse)[semester]?.[section];
            if (!schedule) {
                alert('Current timetable view is not available for import.');
                return;
            }
            const days = getDashboardWorkingDays(dashboardCourse);
            const periodCount = getDashboardPeriodCount(dashboardCourse);
            const periodTimes = getDashboardPeriodTimes(dashboardCourse);
            const teacherSchedule = {};
            const conflicts = [];
            let filledCount = 0;

            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            Object.keys(slotDataStore).forEach((key) => {
                const [sem, sec, day, slotIndex] = key.split('|');
                if (sem !== semester || sec !== section) return;
                const slot = slotDataStore[key];
                if (slot?.teacher) {
                    if (!teacherSchedule[slot.teacher]) teacherSchedule[slot.teacher] = {};
                    teacherSchedule[slot.teacher][`${day}-${slotIndex}`] = true;
                }
            });

            requirements.sort((a, b) => b.lecturesPerWeek - a.lecturesPerWeek);

            requirements.forEach((req) => {
                const isLab = String(req.classType || '').toLowerCase().includes('lab');
                const required = req.lecturesPerWeek;
                const displaySubject = req.subjectCode ? `${req.subjectName} (${req.subjectCode})` : req.subjectName;
                let assignedThisReq = 0;

                for (const day of days) {
                    if (assignedThisReq >= required) break;
                    for (let slotIndex = 0; slotIndex < periodCount; slotIndex += 1) {
                        if (assignedThisReq >= required) break;
                        if (isLab) {
                            if (slotIndex >= periodCount - 1) continue;
                            if (!isDashboardSlotEmpty(semester, section, day, slotIndex)) continue;
                            if (!isDashboardSlotEmpty(semester, section, day, slotIndex + 1)) continue;
                            if (isTeacherAssignedInOtherSection(semester, day, slotIndex, req.teacher, section)) continue;
                            if (isTeacherAssignedInOtherSection(semester, day, slotIndex + 1, req.teacher, section)) continue;
                            const teacherKey1 = `${day}-${slotIndex}`;
                            const teacherKey2 = `${day}-${slotIndex + 1}`;
                            if ((teacherSchedule[req.teacher] && teacherSchedule[req.teacher][teacherKey1]) || (teacherSchedule[req.teacher] && teacherSchedule[req.teacher][teacherKey2])) continue;

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
                            if (!teacherSchedule[req.teacher]) teacherSchedule[req.teacher] = {};
                            teacherSchedule[req.teacher][teacherKey1] = true;
                            teacherSchedule[req.teacher][teacherKey2] = true;
                            assignedThisReq += 1;
                            filledCount += 2;
                        } else {
                            if (!isDashboardSlotEmpty(semester, section, day, slotIndex)) continue;
                            if (isTeacherAssignedInOtherSection(semester, day, slotIndex, req.teacher, section)) continue;
                            const teacherKey = `${day}-${slotIndex}`;
                            if (teacherSchedule[req.teacher] && teacherSchedule[req.teacher][teacherKey]) continue;

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
                            if (!teacherSchedule[req.teacher]) teacherSchedule[req.teacher] = {};
                            teacherSchedule[req.teacher][teacherKey] = true;
                            assignedThisReq += 1;
                            filledCount += 1;
                        }
                    }
                }

                if (assignedThisReq < required) {
                    conflicts.push(`${req.teacher} - ${displaySubject} (${assignedThisReq}/${required})`);
                }
            });

            renderDashboardTimetable();

            let message = `${filledCount} empty slot${filledCount === 1 ? '' : 's'} filled from Excel.`;
            if (conflicts.length) {
                message += `\nCould not complete assignment for: ${conflicts.join('; ')}`;
                showConflictModal(message);
            } else {
                alert(message);
            }
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
            status.innerHTML = `<b>${savedToMongo ? 'Saved to MongoDB' : 'Saved locally'}:</b> ${summary}${savedToMongo ? '' : '<br><span style="color:#b45309;">MongoDB save failed because the backend is unavailable.</span>'}`;
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

            await saveTimeSettingsToApi(targetSemesters.map((sem) => ({
                course,
                semester: sem,
                ...getDashboardCourseSettings(course, sem)
            })));
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
                    const teacherLine = slotData?.teacher ? `<div class="slot-teacher">${slotData.teacher}</div>` : '';
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
            try { renderFacultyTimetablePanel(); } catch (e) { /* ignore */ }
            if (document.getElementById('faculty-schedule-section')?.style.display !== 'none') {
                try { renderFacultyPersonalSchedulePanel(); } catch (e) { /* ignore */ }
            }
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
                                if (!slot || normalizeTeacherName(slot.teacher) !== normalizedTeacher) continue;

                                if (!meta.room && slot.room) meta.room = slot.room;
                                if (!meta.classTeacher && slot.classTeacher) meta.classTeacher = slot.classTeacher;
                                if (!meta.studentNumber && slot.studentNumber) meta.studentNumber = slot.studentNumber;
                                if (!meta.academicSession && slot.academicSession) meta.academicSession = slot.academicSession;
                                if (!meta.dateRange) meta.dateRange = getDashboardSemesterDateRange(course, semester);

                                cells[day][index].push({ ...slot, semester, section });
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

            const hasAnySchedule = days.some(day => (schedule[day] || []).some(value => value && value !== '-' && value !== '-'));
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
                    const teacherLine = slotData?.teacher ? `<div class="slot-teacher">${slotData.teacher}</div>` : '';
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

                // skip continuation slots (count only first slot of a multi-slot lab)
                const prevKey = `${sem}|${sec}|${day}|${idx - 1}`;
                const prev = slotDataStore[prevKey];
                if (prev && prev.subject === slot.subject && prev.teacher === slot.teacher && prev.classType === slot.classType) {
                    return;
                }
                // prefer explicit fields if available (set during Excel import or manual save)
                let name = '';
                let code = '';
                if (slot.subjectName || slot.subjectCode) {
                    name = slot.subjectName || '';
                    code = slot.subjectCode || '';
                } else {
                    const parsed = extractSubjectNameAndCodeGlobal(slot.subject || '');
                    name = parsed.name;
                    code = parsed.code;
                }

                const mapKey = `${name}|${code}`;
                if (!summaryMap[mapKey]) summaryMap[mapKey] = { subjectName: name, code: code, L: 0, T: 0, P: 0, faculties: new Set() };

                const entry = summaryMap[mapKey];
                const classType = (slot.classType || '').toLowerCase();
                const isLab = classType.includes('lab') || /lab/i.test(slot.subject || '');
                if (isLab) entry.P += 1; else entry.L += 1;
                if (slot.teacher) entry.faculties.add(slot.teacher);
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
            const subject = slotData.subject || (originalValue && originalValue !== '-' && originalValue !== 'Lunch' ? originalValue : '');

            // Populate teacher dropdown with current roster and set selection
            try { populateEditSlotTeacherDropdown(); } catch (e) { console.warn('populateEditSlotTeacherDropdown failed', e); }
            try { populateEditSlotSubjectDropdown(subject); } catch (e) { console.warn('populateEditSlotSubjectDropdown failed', e); }
            setElValue('editSlotTeacher', slotData.teacher || '');
            setElValue('editSlotSubject', subject);
            setElValue('editSlotRoom', slotData.room || '');
            setElValue('editSlotClassTeacher', slotData.classTeacher || '');
            setElValue('editSlotStudentNumber', slotData.studentNumber || '');
            setElValue('editSlotAcademicSession', slotData.academicSession || '2025-2026');

            dashboardTimetableEditing = { day, slotIndex, semester, section, key };
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
            const subject = subjParts.code ? `${subjParts.name} (${subjParts.code})` : subjParts.name || rawSubject;
            if (!subject) {
                alert('Please enter a subject for the slot.');
                return;
            }
            const teacher = document.getElementById('editSlotTeacher').value.trim();

            let sem;
            let sec;
            let day;
            let slotIndex;

            // Prevent global teacher conflicts across courses/semesters/sections
            try {
                const parts = key.split('|');
                if (parts.length >= 4) {
                    sem = parts[0];
                    sec = parts[1];
                    day = parts[2];
                    slotIndex = Number(parts[3]);

                    if (teacher && isTeacherAssignedInOtherSection(sem, day, slotIndex, teacher, sec)) {
                        showConflictModal('Conflict: This teacher is already assigned at the same time in another course/semester/section. Please choose a different teacher or time slot.');
                        return;
                    }
                }
            } catch (e) {
                console.warn('Conflict check failed, proceeding with save:', e);
            }

            const subjectSelect = document.getElementById('editSlotSubject');
            const selectedOption = subjectSelect?.selectedOptions?.[0];
            const isLab = selectedOption?.dataset?.isLab === 'true';
            const slotDataStore = getDashboardTimetableSlotData(dashboardCourse);
            const periodCount = getDashboardPeriodCount(dashboardCourse);
            const nextSlotIndex = slotIndex + 1;
            const nextSlotKey = `${sem}|${sec}|${day}|${nextSlotIndex}`;
            const nextSlotData = slotDataStore[nextSlotKey];

            // If the current slot used to be a lab, clear its old continuation when changing.
            const currentSlotData = slotDataStore[key];
            if (currentSlotData && /lab/i.test(currentSlotData.classType || currentSlotData.subject || '')) {
                const oldContinuationKey = `${sem}|${sec}|${day}|${slotIndex + 1}`;
                const oldContinuation = slotDataStore[oldContinuationKey];
                if (oldContinuation && oldContinuation.subject === currentSlotData.subject && oldContinuation.teacher === currentSlotData.teacher) {
                    delete slotDataStore[oldContinuationKey];
                }
            }

            if (isLab) {
                if (nextSlotIndex >= periodCount) {
                    showConflictModal('Conflict: Cannot assign this lab because there is no following slot available. Select an earlier time slot.');
                    return;
                }
                const nextCellOccupied = nextSlotData && normalizeTeacherName(nextSlotData.teacher || '') !== normalizeTeacherName(teacher);
                if (nextCellOccupied && nextSlotData.subject && nextSlotData.subject !== subject) {
                    showConflictModal('Conflict: The slot after this one is already occupied and this lab requires two consecutive slots.');
                    return;
                }
            }

            const slotInfo = {
                subject,
                subjectName: subjParts.name || '',
                subjectCode: subjParts.code || '',
                teacher: teacher,
                room: document.getElementById('editSlotRoom').value.trim(),
                classTeacher: document.getElementById('editSlotClassTeacher').value.trim(),
                studentNumber: document.getElementById('editSlotStudentNumber').value.trim(),
                academicSession: document.getElementById('editSlotAcademicSession').value.trim() || '2025-2026',
                classType: isLab ? 'Lab' : 'Lecture'
            };

            slotDataStore[key] = slotInfo;
            if (isLab) {
                slotDataStore[nextSlotKey] = slotInfo;
            } else if (nextSlotData && /lab/i.test(nextSlotData.classType || nextSlotData.subject || '')) {
                delete slotDataStore[nextSlotKey];
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
                        j += 1;
                        continue;
                    }
                    break;
                }
            } else {
                delete slotDataStore[key];
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
                                        if (prev && prev.subject === slot.subject && prev.teacher === slot.teacher && prev.classType === slot.classType) return;

                                        let name = '';
                                        let code = '';
                                        if (slot.subjectName || slot.subjectCode) {
                                                name = slot.subjectName || '';
                                                code = slot.subjectCode || '';
                                        } else {
                                                const parsed = extractSubjectNameAndCodeGlobal(slot.subject || '');
                                                name = parsed.name;
                                                code = parsed.code;
                                        }

                                        const mapKey = `${name}|${code}`;
                                        if (!summaryMap[mapKey]) summaryMap[mapKey] = { subjectName: name, code: code, L: 0, T: 0, P: 0, faculties: new Set() };
                                        const entry = summaryMap[mapKey];
                                        const classType = (slot.classType || '').toLowerCase();
                                        const isLab = classType.includes('lab') || /lab/i.test(slot.subject || '');
                                        if (isLab) entry.P += 1; else entry.L += 1;
                                        if (slot.teacher) entry.faculties.add(slot.teacher);
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
        @page { size: A4 landscape; margin: 0.2in; }
        html, body { width: 100%; margin: 0; padding: 0; }
        body { font-family: Inter, Arial, sans-serif; color: #111827; margin: 0.2in; font-size: 11px; }
        .print-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .print-heading { flex: 1; text-align: center; font-weight: 700; font-size: 13px; line-height: 1.2; }
        .print-subheading { font-weight: 600; font-size: 10px; color: #111827; margin-top: 2px; }
        .info-line { display: flex; justify-content: space-between; align-items: center; margin: 6px 0 12px; font-weight: 700; font-size: 10px; gap: 6px; }
        .info-line div { flex: 1; }
        .info-line div:first-child { text-align: left; }
        .info-line div:nth-child(2) { text-align: center; }
        .info-line div:last-child { text-align: right; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
        th, td { border: 0.5px solid #999; padding: 4px 5px; }
        th { background: #f0f0f0; text-align: left; }
        td { text-align: left; vertical-align: middle; word-break: break-word; white-space: normal; }
        td.numeric, .summary-table th.numeric, .summary-table td.numeric { text-align: center; }
        .summary-table th, .summary-table td { padding: 5px 4px; border: 1px solid #e5e7eb; }
        .summary-table th:not(.numeric), .summary-table td:not(.numeric) { text-align: left; }
        .summary-table { margin-top: 10px; }
        .no-break, .summary-table, .dashboard-timetable-table { page-break-inside: avoid; }
        .dashboard-timetable-table table { width: 100%; }
        @media print {
            body { margin: 0; padding: 0; }
            .print-header, .print-heading, .info-line { page-break-inside: avoid; }
            table, .summary-table, tr, th, td { page-break-inside: avoid; }
            .dashboard-timetable-table table { margin: 0 !important; padding: 0 !important; }
            table th, table td { padding: 5px 4px !important; font-size: 11px !important; line-height: 1.1 !important; }
        }
    </style>
</head>
<body>
    <div class="print-header">
        <div style="flex:1; text-align:left; font-weight:700; font-size:13px; line-height:1.3;">Prestige Institute of Engineering Management &amp; Research, Indore</div>
        <div style="flex:1; text-align:center; font-weight:700; font-size:13px; line-height:1.3;">Department of Computer Science &amp; Engineering</div>
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
        function setFacultySection(section) {
            const profileSection = document.getElementById('faculty-profile-section');
            const dashboardSection = document.getElementById('faculty-dashboard-section');
            const scheduleSection = document.getElementById('faculty-schedule-section');
            const profileNav = document.getElementById('faculty-nav-profile');
            const dashboardNav = document.getElementById('faculty-nav-dashboard');
            const scheduleNav = document.getElementById('faculty-nav-schedule');

            if (profileSection) profileSection.style.display = section === 'profile' ? '' : 'none';
            if (dashboardSection) dashboardSection.style.display = section === 'dashboard' ? '' : 'none';
            if (scheduleSection) scheduleSection.style.display = section === 'schedule' ? '' : 'none';

            if (profileNav) profileNav.classList.toggle('active', section === 'profile');
            if (dashboardNav) dashboardNav.classList.toggle('active', section === 'dashboard');
            if (scheduleNav) scheduleNav.classList.toggle('active', section === 'schedule');

            if (section === 'dashboard') {
                try { renderFacultyTimetablePanel(); } catch (e) { /* ignore */ }
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

        // Check for invite code in URL on page load
        async function initializeFromUrlParams() {
            const urlParams = new URLSearchParams(window.location.search);
            let inviteCode = urlParams.get('inviteCode');
            
            if (inviteCode) {
                // Decode the invite code
                inviteCode = decodeURIComponent(inviteCode);
                console.log('Processing invite code:', inviteCode);
                console.log('Available invites:', inviteDB.map(i => i.inviteCode));
                
                const invitedEmail = await validateAndUseInvite(inviteCode);
                if (invitedEmail) {
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
                    // Scroll to page top
                    window.scrollTo(0, 0);
                } else {
                    console.error('Invite validation failed for code:', inviteCode);
                    alert('Invalid or expired invite code. Please contact your administrator.');
                    showScreen('login');
                }
            }
        }

        /* init */
        renderTeachers();
        updateHeaderStats();
        renderPendingInvites();












