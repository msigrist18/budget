// Belege: Fotos werden verkleinert (gut lesbar, aber viel kleiner), PDFs bleiben wie sie sind.

const MAX_SIDE = 1600;
const QUALITY = 0.72;

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) { /* Fallback unten */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

export async function prepareReceipt(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) return { blob: file, mime: 'application/pdf', name: file.name || 'Beleg.pdf' };
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|webp)$/i.test(file.name)) {
    throw new Error('Bitte ein Foto oder ein PDF wählen.');
  }
  try {
    const img = await loadImage(file);
    const w = img.width, h = img.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    if (img.close) img.close();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('toBlob');
    // Falls das Original schon kleiner ist, Original behalten
    if (file.size && file.size < blob.size && file.type === 'image/jpeg') {
      return { blob: file, mime: file.type, name: file.name || 'Beleg.jpg' };
    }
    return { blob, mime: 'image/jpeg', name: (file.name || 'Beleg').replace(/\.[^.]+$/, '') + '.jpg' };
  } catch (e) {
    // Bild nicht lesbar (z.B. HEIC am PC): Original speichern
    return { blob: file, mime: file.type || 'application/octet-stream', name: file.name || 'Beleg' };
  }
}
