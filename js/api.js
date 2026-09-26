// ANT — cliente del backend. Única función que habla con el servidor.
import { CONFIG } from './config.js';

export class ErrorApi extends Error {
  constructor(codigo, mensaje, campos) {
    super(mensaje);
    this.codigo = codigo || 'ERROR_INTERNO';
    this.campos = campos || null;
  }
}

const ALMACEN = 'ant.sesion';

export const Sesion = {
  datos: null,
  cargar() {
    try { this.datos = JSON.parse(sessionStorage.getItem(ALMACEN)) || null; } catch { this.datos = null; }
    return this.datos;
  },
  guardar(d) { this.datos = d; sessionStorage.setItem(ALMACEN, JSON.stringify(d)); },
  actualizar(parcial) { this.guardar(Object.assign({}, this.datos, parcial)); },
  borrar() { this.datos = null; sessionStorage.removeItem(ALMACEN); },
  get token() { return this.datos ? this.datos.token : null; },
  tiene(permiso) { return !!(this.datos && this.datos.permisos && this.datos.permisos.includes(permiso)); }
};

function idCliente() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
}

/**
 * Llama una acción del backend. Resuelve con { data, message } o lanza ErrorApi.
 * Se envía como text/plain para que el navegador no haga preflight CORS (Apps Script no lo responde).
 */
export async function llamar(accion, datos = {}, opciones = {}) {
  if (!navigator.onLine) throw new ErrorApi('SIN_CONEXION', 'No hay conexión a internet. Revisa tu señal e intenta de nuevo.');
  const cuerpo = { accion, datos, versionCliente: CONFIG.VERSION, idCliente: idCliente() };
  const token = opciones.token !== undefined ? opciones.token : Sesion.token;
  if (token) cuerpo.token = token;

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), opciones.tiempo || CONFIG.TIEMPO_ESPERA_MS);
  let respuesta;
  try {
    respuesta = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo),
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: control.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new ErrorApi('TIEMPO_AGOTADO', 'El servidor tardó demasiado en responder. Intenta de nuevo.');
    throw new ErrorApi('SIN_CONEXION', 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo. (Detalle: ' + (e.name || 'Error') + ': ' + (e.message || 'sin mensaje') + ')');
  } finally {
    clearTimeout(temporizador);
  }

  if (!respuesta.ok) throw new ErrorApi('ERROR_SERVIDOR', 'El servidor respondió con un error (' + respuesta.status + '). Intenta de nuevo en unos minutos.');
  let json;
  try { json = await respuesta.json(); } catch {
    throw new ErrorApi('RESPUESTA_INVALIDA', 'El servidor devolvió una respuesta inesperada. Verifica que la implementación esté publicada para "Cualquier persona".');
  }
  if (!json.success) {
    throw new ErrorApi(json.error && json.error.code, json.message || 'Ocurrió un error.', json.error && json.error.campos);
  }
  return { data: json.data || {}, message: json.message || '' };
}
