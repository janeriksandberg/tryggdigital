// Inngangspunkt for vendor/firebase.js (bygges med esbuild, se tools/build-vendor.mjs)
export { initializeApp, getApps, deleteApp } from 'firebase/app';
export {
  initializeAuth, indexedDBLocalPersistence, browserSessionPersistence, inMemoryPersistence,
  signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, onAuthStateChanged, onIdTokenChanged, multiFactor, getMultiFactorResolver,
  TotpMultiFactorGenerator, PhoneAuthProvider, PhoneMultiFactorGenerator, connectAuthEmulator,
  reload, reauthenticateWithCredential, EmailAuthProvider, getIdTokenResult, updatePassword,
} from 'firebase/auth';
export {
  initializeFirestore, memoryLocalCache, connectFirestoreEmulator, doc, collection, collectionGroup, setDoc, getDoc,
  getDocs, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch,
  terminate, enableNetwork, disableNetwork, getCountFromServer, deleteField,
} from 'firebase/firestore';
