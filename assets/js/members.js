/* Theme sign-in and subscribe. Forms request a magic link from Ghost's members API: an integrity
   token, then send-magic-link. The member account page is Portal's. */
(function () {
    'use strict';

    var html = document.documentElement;
    var ghost = document.querySelector('script[data-ghost]');
    var api = (ghost ? ghost.getAttribute('data-ghost') : location.origin + '/').replace(/\/?$/, '/') + 'members/api/';
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Portal keeps the pages a reader saw before signing up, for member attribution.
    function urlHistory() {
        try {
            var h = JSON.parse(window.sessionStorage.getItem('ghost-history'));
            return Array.isArray(h) ? h : null;
        } catch (e) { return null; }
    }
    function send(form, email) {
        var name = form.querySelector('[data-member-name]');
        var body = {email: email, emailType: form.getAttribute('data-member-form'), autoRedirect: true};
        if (name && name.value.trim()) { body.name = name.value.trim(); }
        if (form.getAttribute('data-redirect')) { body.redirect = form.getAttribute('data-redirect'); }
        var seen = urlHistory();
        if (seen) { body.urlHistory = seen; }
        return fetch(api + 'integrity-token/').then(function (r) { return r.ok ? r.text() : ''; }).then(function (token) {
            body.integrityToken = token;
            return fetch(api + 'send-magic-link/', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
        }).then(function (r) {
            if (r.ok) { return; }
            return r.json().catch(function () { return {}; }).then(function (j) {
                var e = new Error(j && j.errors && j.errors[0] && j.errors[0].message || '');
                e.fromServer = true;
                throw e;
            });
        });
    }

    // A form's state is data-state="loading|success|error" on the form; the theme's CSS shows the rest.
    function bind(form) {
        var scope = form.closest('[data-member-scope]') || form;
        var input = form.querySelector('[data-member-email]');
        var out = scope.querySelector('[data-member-error]');
        function fail(message) {
            if (out) { out.textContent = message; }
            form.setAttribute('data-state', 'error');
            input.focus();
        }
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (form.getAttribute('data-state') === 'loading') { return; }
            var email = input.value.trim();
            if (!EMAIL.test(email)) { fail(out && out.getAttribute('data-invalid') || 'Enter a valid email address.'); return; }
            form.setAttribute('data-state', 'loading');
            send(form, email).then(function () {
                scope.querySelectorAll('[data-member-echo]').forEach(function (n) { n.textContent = email; });
                form.setAttribute('data-state', 'success');
                var done = scope.querySelector('[data-member-done]');
                if (done && done.getClientRects().length) { done.focus(); }
            }).catch(function (err) {
                fail(err.fromServer && err.message || out && out.getAttribute('data-fallback') || 'That didn’t work. Try again.');
            });
        });
        input.addEventListener('input', function () {
            if (form.getAttribute('data-state') === 'error') { form.removeAttribute('data-state'); }
        });
    }
    document.querySelectorAll('form[data-member-form]').forEach(bind);

    // The dialog: one panel, two modes (signin and signup), switched in place.
    var panel = document.querySelector('[data-member-panel]');
    var opener = null;
    function forms() { return panel.querySelectorAll('[data-member-form]'); }
    function current() { return panel.querySelector('[data-member-form]:not([hidden])'); }
    function setMode(mode) {
        var was = current();
        var typed = was ? was.querySelector('[data-member-email]').value : '';
        panel.setAttribute('data-mode', mode);
        panel.querySelectorAll('[data-for-mode]').forEach(function (n) { n.hidden = n.getAttribute('data-for-mode') !== mode; });
        forms().forEach(function (f) { f.hidden = f.getAttribute('data-member-form') !== mode; });
        var now = current();
        var email = now.querySelector('[data-member-email]');
        if (typed && !email.value) { email.value = typed; }
        now.removeAttribute('data-state');
        var empty = Array.prototype.filter.call(now.querySelectorAll('input'), function (n) { return !n.value; })[0];
        setTimeout(function () { (empty || email).focus(); }, 0);
    }
    function open(mode, from, redirect) {
        if (!panel.hidden) { setMode(mode); return; }
        opener = from || document.activeElement;
        forms().forEach(function (f) {
            f.removeAttribute('data-state');
            if (redirect) { f.setAttribute('data-redirect', redirect); } else { f.removeAttribute('data-redirect'); }
        });
        panel.hidden = false;
        html.classList.add('member-open');
        setMode(mode);
    }
    function close() {
        if (panel.hidden) { return; }
        panel.hidden = true;
        html.classList.remove('member-open');
        if (opener && opener.focus) { opener.focus(); }
    }

    if (panel) {
        document.querySelectorAll('[data-member]').forEach(function (b) {
            b.addEventListener('click', function (e) { e.preventDefault(); open(b.getAttribute('data-member'), b); });
        });
        panel.querySelectorAll('[data-member-mode]').forEach(function (b) {
            b.addEventListener('click', function () { setMode(b.getAttribute('data-member-mode')); });
        });
        panel.querySelectorAll('[data-member-close]').forEach(function (b) { b.addEventListener('click', close); });
        // A link to Portal (a paid plan, required terms) closes the dialog first.
        panel.querySelectorAll('[data-portal]').forEach(function (b) { b.addEventListener('click', close); });
        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
            if (e.key !== 'Tab') { return; }
            var stops = Array.prototype.filter.call(panel.querySelectorAll('button, input, a[href], [tabindex="0"]'), function (n) {
                return !n.disabled && n.getClientRects().length;
            });
            var i = stops.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); stops[stops.length - 1].focus(); }
            else if (!e.shiftKey && i === stops.length - 1) { e.preventDefault(); stops[0].focus(); }
        });

        // Portal links (#/portal/, #/portal/signin, #/portal/signup), including the comments box's,
        // open the theme's dialog; the hash is cleared before Portal reads it. Signup links open it only
        // when data-signup="theme" (free signup, no paid tiers, no required terms); otherwise they go to Portal.
        var portalLink = /^#\/portal\/?(?:(signin|signup)(?:\/free)?\/?)?(?:\?(.*))?$/;
        var ownSignup = (panel.getAttribute('data-signup') || 'theme') === 'theme';
        var fromHash = function () {
            var m = location.hash.match(portalLink);
            if (!m || (m[1] !== 'signin' && !ownSignup)) { return; }
            history.replaceState(history.state, '', location.pathname + location.search);
            open(m[1] || 'signup', null, new URLSearchParams(m[2] || '').get('redirect'));
        };
        window.addEventListener('hashchange', fromHash);
        fromHash();
    }

    // After a magic link, Ghost lands on ?action=signin&success=true (or signup / subscribe).
    // The theme shows its own status line for it and removes the parameters from the URL.
    var note = document.querySelector('[data-member-note]');
    var q = new URLSearchParams(location.search);
    var action = q.get('action');
    var ok = q.get('success');
    if (note && ['signin', 'signup', 'subscribe'].indexOf(action) !== -1 && (ok === 'true' || ok === 'false')) {
        q.delete('action');
        q.delete('success');
        var rest = q.toString();
        history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
        html.classList.add('has-member-note');
        var key = ok === 'false' ? 'fail' : action === 'signin' ? 'signin' : 'signup';
        note.querySelectorAll('[data-note]').forEach(function (n) { n.hidden = n.getAttribute('data-note') !== key; });
        note.setAttribute('data-kind', key);
        note.hidden = false;
        var hide = function () { note.hidden = true; };
        note.querySelectorAll('[data-note-close]').forEach(function (b) { b.addEventListener('click', hide); });
        if (key !== 'fail') { setTimeout(hide, 9000); }
    }
})();
