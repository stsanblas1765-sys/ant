// ANT — respaldo local cifrado de tramos de audio pendientes de subir.
//
// Cada tramo se guarda en IndexedDB cifrado con AES-GCM (256 bits). La llave se genera
// en el dispositivo como no exportable: el código no puede leerla ni enviarla, y quien
// copie los archivos del navegador solo obtiene datos cifrados. Protege el audio en
// reposo; no sustituye el bloqueo de pantalla del dispositivo.

const BD = 'ant-cola-v1';
let bdPromesa = null;
let llaveMemo = null;

function abrirBd() {
  if (!bdPromesa) {
    bdPromesa = new Promise((ok, falla) => {
      if (!('indexedDB' in self)) { falla(new Error('Este navegador no permite guardar respaldo local.')); return; }
      const r = indexedDB.open(BD, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('llaves')) db.createObjectStore('llaves');
        if (!db.objectStoreNames.contains('tareas')) db.createObjectStore('tareas', { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { bdPromesa = null; falla(r.error || new Error('No se pudo abrir el respaldo local.')); };
    });
  }
  return bdPromesa;
}

function operar(almacen, modo, fn) {
  return abrirBd().then(db => new Promise((ok, falla) => {
    const tx = db.transaction(almacen, modo);
    let resultado;
    const req = fn(tx.objectStore(almacen));
    if (req) req.onsuccess = () => { resultado = req.result; };
    tx.oncomplete = () => ok(resultado);
    tx.onerror = () => falla(tx.error || new Error('Error del respaldo local.'));
    tx.onabort = () => falla(tx.error || new Error('El respaldo local se canceló (¿sin espacio?).'));
  }));
}

async function llave() {
  if (llaveMemo) return llaveMemo;
  let k = await operar('llaves', 'readonly', st => st.get('aes'));
  if (!k) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await operar('llaves', 'readwrite', st => st.put(k, 'aes'));
  }
  llaveMemo = k;
  return k;
}

export const Cola = {
  /** Guarda una tarea; si trae audio, lo cifra. Devuelve el id de la tarea. */
  async agregar(tarea, audio) {
    const t = Object.assign({ creada: new Date().toISOString(), error: '' }, tarea);
    if (audio) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      t.iv = iv;
      t.cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await llave(), audio);
    }
    return operar('tareas', 'readwrite', st => st.add(t));
  },
  async listar() {
    const l = await operar('tareas', 'readonly', st => st.getAll());
    return (l || []).sort((a, b) => a.id - b.id);
  },
  async audio(t) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: t.iv }, await llave(), t.cifrado);
  },
  quitar(id) { return operar('tareas', 'readwrite', st => st.delete(id)); },
  async marcarError(id, mensaje) {
    const t = await operar('tareas', 'readonly', st => st.get(id));
    if (!t) return;
    t.error = mensaje || 'Error';
    return operar('tareas', 'readwrite', st => st.put(t));
  },
  /** Comprueba que el respaldo funciona antes de grabar (y pide al navegador no borrarlo). */
  async verificar() {
    await llave();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* opcional */ }
  }
};
