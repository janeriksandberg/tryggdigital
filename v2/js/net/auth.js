// Pålogging for administratorer: e-post + passord + tofaktor (TOTP-app). Passord alene gir aldri tilgang:
// appen krever andre faktor, og sikkerhetsreglene i Firestore avviser alle forespørsler uten den.
import { fb, F } from './fb.js';
import { EMULATOR } from '../config.js';

export const MIN_PASSWORD = 12;
const A = () => fb('admin').auth;

export async function adminState(user = A().currentUser) {
  if (!user) return null;
  const tok = await F.getIdTokenResult(user);
  const mfa = !!tok.signInSecondFactor;
  return {
    uid: user.uid, email: (user.email || '').toLowerCase(), emailVerified: user.emailVerified,
    mfa, factor: tok.signInSecondFactor || null, enrolled: F.multiFactor(user).enrolledFactors.length > 0,
  };
}

/** Steg 1. Returnerer { done:true } eller { resolver, hints } når andre faktor kreves. */
export async function signIn(email, password) {
  try {
    await F.signInWithEmailAndPassword(A(), email.trim(), password);
    return { done: true };
  } catch (e) {
    if (e.code === 'auth/multi-factor-auth-required') {
      const resolver = F.getMultiFactorResolver(A(), e);
      return { resolver, hints: resolver.hints };
    }
    throw e;
  }
}

/** Steg 2: sekssifret kode fra autentiseringsappen. */
export async function completeTotp(resolver, code) {
  const hint = resolver.hints.find((x) => x.factorId === F.TotpMultiFactorGenerator.FACTOR_ID) || resolver.hints[0];
  const assertion = F.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, String(code).replace(/\s/g, ''));
  await resolver.resolveSignIn(assertion);
}

// Bare for automatiske tester mot Firebase-emulatoren, som ikke støtter TOTP men støtter SMS-faktor.
export async function emulatorPhoneStart(resolver) {
  if (!EMULATOR) throw new Error('Bare i testmodus');
  A().settings.appVerificationDisabledForTesting = true;
  const fakeVerifier = { type: 'recaptcha', verify: async () => 'test-token', _reset() {} };
  const hint = resolver.hints.find((x) => x.factorId === 'phone');
  return new F.PhoneAuthProvider(A()).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, fakeVerifier);
}
export async function emulatorPhoneFinish(resolver, verificationId, code) {
  const cred = F.PhoneAuthProvider.credential(verificationId, code);
  await resolver.resolveSignIn(F.PhoneMultiFactorGenerator.assertion(cred));
}

export function checkPassword(pw) {
  const errs = [];
  if (pw.length < MIN_PASSWORD) errs.push('length');
  if (!/[a-zæøå]/.test(pw) || !/[A-ZÆØÅ]/.test(pw)) errs.push('case');
  if (!/[0-9]/.test(pw)) errs.push('digit');
  return errs;
}

export async function signUp(email, password) {
  const cred = await F.createUserWithEmailAndPassword(A(), email.trim(), password);
  await F.sendEmailVerification(cred.user);
  return cred.user;
}
export const resendVerification = () => F.sendEmailVerification(A().currentUser);
export async function refreshUser() { await F.reload(A().currentUser); return A().currentUser; }
export const resetPassword = (email) => F.sendPasswordResetEmail(A(), email.trim());
export const signOutAdmin = () => F.signOut(A());

/** Starter registrering av autentiseringsapp. Returnerer hemmelighet + otpauth-URL for QR. */
export async function startTotpEnrollment(password) {
  const user = A().currentUser;
  if (password) await F.reauthenticateWithCredential(user, F.EmailAuthProvider.credential(user.email, password));
  const session = await F.multiFactor(user).getSession();
  const secret = await F.TotpMultiFactorGenerator.generateSecret(session);
  return { secret, url: secret.generateQrCodeUrl(user.email, 'Tryggdigital'), key: secret.secretKey };
}
export async function finishTotpEnrollment(secret, code) {
  const assertion = F.TotpMultiFactorGenerator.assertionForEnrollment(secret, String(code).replace(/\s/g, ''));
  await F.multiFactor(A().currentUser).enroll(assertion, 'Autentiseringsapp');
}

export function authErrorKey(e) {
  const map = {
    'auth/invalid-credential': 'auth.err.credentials', 'auth/wrong-password': 'auth.err.credentials', 'auth/user-not-found': 'auth.err.credentials',
    'auth/invalid-email': 'auth.err.email', 'auth/too-many-requests': 'auth.err.tooMany', 'auth/network-request-failed': 'auth.err.network',
    'auth/invalid-verification-code': 'auth.err.code', 'auth/email-already-in-use': 'auth.err.inUse', 'auth/weak-password': 'auth.err.weak',
    'auth/requires-recent-login': 'auth.err.recent', 'auth/unverified-email': 'auth.err.unverified', 'auth/operation-not-allowed': 'auth.err.notEnabled',
  };
  return map[e?.code] || 'auth.err.generic';
}
