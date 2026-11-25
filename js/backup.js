// Backup-Datei: alles (inkl. Belege) in eine Datei, verschlüsselt mit deinem Passwort.
// AES-GCM 256, Schlüssel aus dem Passwort mit PBKDF2 (SHA-256, 310'000 Runden).
// Ohne Passwort kann niemand die Datei lesen, auch nicht wer sie findet.

const ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64FromBytes(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

function bytesFromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function blobToB64(blob) {
  return b64FromBytes(new Uint8Array(await blob.arrayBuffer()));
}

export function b64ToBlob(b64, mime) {
  return new Blob([bytesFromB64(b64)], { type: mime || 'application/octet-stream' });
}

async function deriveKey(password, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPayload(payload, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plain = enc.encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    app: 'budget',
    type: 'backup',
    v: 1,
    enc: { alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64FromBytes(salt), iv: b64FromBytes(iv) },
    data: b64FromBytes(cipher),
  };
}

export async function decryptFile(file, password) {
  const salt = bytesFromB64(file.enc.salt);
  const iv = bytesFromB64(file.enc.iv);
  const key = await deriveKey(password, salt, file.enc.iter || ITER);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytesFromB64(file.data));
    return JSON.parse(dec.decode(plain));
  } catch (e) {
    throw new Error('Falsches Passwort oder beschädigte Datei.');
  }
}

// Liest eine geladene Datei: unverschlüsselte Startdaten oder verschlüsseltes Backup
export function inspectFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('Das ist keine Budget-Datei.'); }
  if (!obj || obj.app !== 'budget') throw new Error('Das ist keine Budget-Datei.');
  if (obj.type === 'backup' && obj.enc) return { encrypted: true, file: obj };
  if (obj.type === 'daten' && obj.data) return { encrypted: false, payload: obj.data };
  throw new Error('Unbekanntes Dateiformat.');
}

export function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `budget-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.budget`;
}

// Datei an den Benutzer geben: auf dem iPhone über "Teilen" (Dateien, AirDrop), sonst Download
export async function deliverFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'geteilt';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'abgebrochen';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'heruntergeladen';
}
