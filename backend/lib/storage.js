const { supabase } = require('./supabase');

const BUCKET = 'documents';

// Upload un fichier (buffer) dans le bucket privé, au chemin donné.
async function uploadDocument(path, buffer, mime) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Génère un lien de téléchargement signé, temporaire (défaut 120 s).
async function signedUrl(path, expiresSec = 120) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresSec);
  if (error) throw error;
  return data.signedUrl;
}

// Télécharge un fichier du bucket et renvoie un Buffer.
async function downloadDocument(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Supprime un fichier du bucket.
async function removeDocument(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

module.exports = { uploadDocument, signedUrl, downloadDocument, removeDocument, BUCKET };
