// Pålogging for administrator: e-post + passord, deretter alltid kode fra autentiseringsapp (TOTP).
// Nye administratorer oppretter konto, bekrefter e-post og registrerer autentiseringsapp før de får tilgang.
import { t } from '../i18n.js';
import { h, icon, qrEl, toast, field, input, clear } from '../ui.js';
import { S, auth, refreshAdmin, signOutAdmin } from '../session.js';
import { EMULATOR, IS_CONFIGURED } from '../config.js';
import { go, topbar } from '../app.js';

let step = 'signin'; // signin | mfa | signup | verify | enroll | forgot
let resolver = null, enrollState = null, phoneVerification = null, flash = null;

export function view() {
  return {
    topbar: () => topbar({ kind: 'kiosk', subtitle: t('login.admin') }),
    async render() {
      if (!IS_CONFIGURED) return h('main', { class: 'center-page' }, h('div', { class: 'card auth-card' }, h('p', {}, t('welcome.notConfigured'))));
      const st = S.admin;
      if (st && step !== 'mfa') {
        if (!st.emailVerified) step = 'verify';
        else if (!st.enrolled) step = step === 'enroll' ? 'enroll' : 'enroll-start';
        else if (!st.mfa) { await signOutAdmin(); step = 'signin'; flash = t('login.reloginMfa'); }
        else { setTimeout(() => go(S.mode === 'device' ? 'admin' : 'admin'), 0); return h('div', { class: 'boot' }, '…'); }
      }
      const wrap = h('main', { class: 'center-page' });
      const card = h('div', { class: 'card' });
      wrap.append(h('div', { class: 'auth-card' }, card));
      const draw = (fn) => { clear(card); card.append(...[].concat(fn())); };
      const steps = { signin, mfa, signup, verify, 'enroll-start': enrollStart, enroll, forgot };
      draw(() => (steps[step] || signin)(draw));
      return wrap;
    },
  };
}

const head = (title, text) => [h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'tile-ico', style: { width: '44px', height: '44px', borderRadius: '12px', background: 'var(--brand-soft)', color: 'var(--brand-2)', display: 'grid', placeItems: 'center' } }, icon('shield', 24)), h('h1', { style: { margin: 0, fontSize: '1.45rem' } }, title)), text ? h('p', { class: 'muted' }, text) : null];
const errBox = () => h('div', { class: 'notice bad', hidden: true, role: 'alert' });
const showErr = (box, e) => { box.hidden = false; box.replaceChildren(icon('alert'), h('p', {}, typeof e === 'string' ? e : t(auth().authErrorKey(e)))); };
const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('loading', on); };

function signin(draw) {
  const email = input({ type: 'email', autocomplete: 'username', required: true, name: 'email', inputmode: 'email' });
  const pw = input({ type: 'password', autocomplete: 'current-password', required: true, name: 'password' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary xl block', type: 'submit' }, icon('login'), t('login.next'));
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    busy(btn, true);
    try {
      const r = await auth().signIn(email.value, pw.value);
      if (r.resolver) { resolver = r.resolver; step = 'mfa'; draw(() => mfa(draw)); }
      else { await refreshAdmin(); }
    } catch (ex) { showErr(err, ex); } finally { busy(btn, false); }
  } },
  ...head(t('login.title'), t('login.text')),
  flash ? h('div', { class: 'notice' }, icon('info'), h('p', {}, flash)) : null,
  field(t('login.email'), email), field(t('login.password'), pw), err, btn,
  h('div', { class: 'row between wrap' },
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => { step = 'forgot'; draw(() => forgot(draw)); } }, t('login.forgot')),
    h('button', { class: 'btn ghost small', type: 'button', 'data-act': 'signup', onclick: () => { step = 'signup'; draw(() => signup(draw)); } }, t('login.create'))),
  h('p', { class: 'muted small' }, icon('lock', 14), ' ', t('login.mfaAlways')));
  flash = null;
  return form;
}

function mfa(draw) {
  const totp = resolver.hints.find((x) => x.factorId === 'totp');
  const code = input({ class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', name: 'code', required: true });
  const err = errBox();
  const btn = h('button', { class: 'btn primary xl block', type: 'submit' }, icon('check'), t('login.verify'));
  const usePhone = !totp && EMULATOR; // bare automatiske tester mot emulatoren
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    busy(btn, true);
    try {
      if (usePhone) await auth().emulatorPhoneFinish(resolver, phoneVerification, code.value);
      else await auth().completeTotp(resolver, code.value);
      resolver = null; step = 'signin';
      await refreshAdmin();
    } catch (ex) { showErr(err, ex); code.select(); } finally { busy(btn, false); }
  } }, ...head(t('login.mfaTitle'), t('login.mfaText')), field(t('login.code'), code), err, btn,
  h('button', { class: 'btn ghost small', type: 'button', onclick: () => { resolver = null; step = 'signin'; draw(() => signin(draw)); } }, t('common.back')));
  if (usePhone && !phoneVerification) auth().emulatorPhoneStart(resolver).then((id) => { phoneVerification = id; }).catch((e) => showErr(err, e));
  return form;
}

function signup(draw) {
  const email = input({ type: 'email', autocomplete: 'username', required: true, name: 'email' });
  const pw = input({ type: 'password', autocomplete: 'new-password', required: true, name: 'password', minlength: 12 });
  const pw2 = input({ type: 'password', autocomplete: 'new-password', required: true, name: 'password2' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary xl block', type: 'submit' }, t('login.createBtn'));
  return h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const problems = auth().checkPassword(pw.value);
    if (problems.length) return showErr(err, t('login.pwRules'));
    if (pw.value !== pw2.value) return showErr(err, t('login.pwMismatch'));
    busy(btn, true);
    try { await auth().signUp(email.value, pw.value); step = 'verify'; await refreshAdmin(); }
    catch (ex) { showErr(err, ex); } finally { busy(btn, false); }
  } }, ...head(t('login.createTitle'), t('login.createText')),
  field(t('login.email'), email), field(t('login.password'), pw, t('login.pwRules')), field(t('login.password2'), pw2), err, btn,
  h('button', { class: 'btn ghost small', type: 'button', onclick: () => { step = 'signin'; draw(() => signin(draw)); } }, t('common.back')));
}

function verify(draw) {
  const err = errBox();
  return h('div', { class: 'stack' }, ...head(t('login.verifyTitle'), t('login.verifyText', { email: S.admin?.email || '' })), err,
    h('button', { class: 'btn primary xl block', onclick: async () => {
      try { const u = await auth().refreshUser(); if (u.emailVerified) { step = 'enroll-start'; await refreshAdmin(); } else showErr(err, t('login.notYetVerified')); } catch (e) { showErr(err, e); }
    } }, icon('check'), t('login.verified')),
    h('div', { class: 'row between wrap' },
      h('button', { class: 'btn ghost small', onclick: async () => { try { await auth().resendVerification(); toast(t('login.resent')); } catch (e) { showErr(err, e); } } }, t('login.resend')),
      h('button', { class: 'btn ghost small', onclick: async () => { await signOutAdmin(); step = 'signin'; } }, t('login.signOut'))));
}

function enrollStart(draw) {
  const pw = input({ type: 'password', autocomplete: 'current-password', required: true, name: 'password' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary xl block', type: 'submit' }, t('login.next'));
  return h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    busy(btn, true);
    try { enrollState = await auth().startTotpEnrollment(pw.value); step = 'enroll'; draw(() => enroll(draw)); }
    catch (ex) { showErr(err, ex); } finally { busy(btn, false); }
  } }, ...head(t('login.enrollTitle'), t('login.enrollIntro')),
  h('ol', { class: 'steps' }, h('li', {}, t('login.enroll1')), h('li', {}, t('login.enroll2')), h('li', {}, t('login.enroll3'))),
  field(t('login.passwordAgain'), pw), err, btn,
  h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { await signOutAdmin(); step = 'signin'; } }, t('login.signOut')));
}

function enroll(draw) {
  const code = input({ class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, name: 'code', required: true });
  const err = errBox();
  const btn = h('button', { class: 'btn primary xl block', type: 'submit' }, icon('check'), t('login.activate'));
  return h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    busy(btn, true);
    try {
      await auth().finishTotpEnrollment(enrollState.secret, code.value);
      enrollState = null;
      flash = t('login.enrolledRelogin');
      step = 'signin';
      await signOutAdmin();
    } catch (ex) { showErr(err, ex); } finally { busy(btn, false); }
  } }, ...head(t('login.scanTitle'), t('login.scanText')),
  h('div', { style: { textAlign: 'center' } }, qrEl(enrollState.url, 210, 'M')),
  h('p', { class: 'small muted' }, t('login.manualKey')), h('div', { class: 'pair-code', style: { fontSize: '1.1rem', letterSpacing: '.08em' } }, enrollState.key.match(/.{1,4}/g).join(' ')),
  field(t('login.code'), code), err, btn);
}

function forgot(draw) {
  const email = input({ type: 'email', autocomplete: 'username', required: true, name: 'email' });
  const err = errBox();
  return h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try { await auth().resetPassword(email.value); toast(t('login.resetSent')); step = 'signin'; draw(() => signin(draw)); } catch (ex) { showErr(err, ex); }
  } }, ...head(t('login.forgotTitle'), t('login.forgotText')), field(t('login.email'), email), err,
  h('button', { class: 'btn primary xl block', type: 'submit' }, t('login.sendReset')),
  h('button', { class: 'btn ghost small', type: 'button', onclick: () => { step = 'signin'; draw(() => signin(draw)); } }, t('common.back')));
}
