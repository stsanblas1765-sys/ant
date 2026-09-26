// ANT — aplicación principal.
// Regla de seguridad: los datos del servidor se insertan siempre con textContent
// (función el()), nunca con innerHTML.
import { CONFIG } from './config.js';
import { llamar, Sesion, ErrorApi } from './api.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const ROLES = {
  ADMINISTRADOR: { nombre: 'Administrador', ayuda: 'Aprueba accesos y administra usuarios. No consulta expedientes.' },
  SUPERVISOR: { nombre: 'Supervisor', ayuda: 'Registra, consulta, valida relaciones, fusiona duplicados y genera reportes.' },
  OPERADOR: { nombre: 'Operador', ayuda: 'Registra intervenciones, personas, fotos y entrevistas en campo.' },
  ANALISTA: { nombre: 'Analista', ayuda: 'Consulta, relaciona y genera reportes. No captura en campo.' },
  AUDITOR: { nombre: 'Auditor', ayuda: 'Solo consulta la bitácora de auditoría.' }
};
const ALCANCES = { PROPIO: 'Solo los suyos', UNIDAD: 'Su unidad', ESTATAL: 'Todo el estado' };
const ESTADOS = { PENDIENTE: 'Pendiente', ACTIVO: 'Activo', SUSPENDIDO: 'Suspendido', RECHAZADO: 'Rechazado', BAJA: 'Baja' };
const CODIGOS_SESION = ['SESION_REQUERIDA', 'SESION_INVALIDA', 'SESION_EXPIRADA', 'CUENTA_INACTIVA'];

let unidades = [];
let usuariosCache = [];
let filtroEstado = '';

// ───────────────────────── Utilidades de interfaz ─────────────────────────

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat()) {
    if (h === null || h === undefined || h === false) continue;
    n.append(h instanceof Node ? h : document.createTextNode(String(h)));
  }
  return n;
}

function nombrePropio(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s'-])(\S)/g, (m, a, b) => a + b.toUpperCase());
}
function nombreCompleto(u) { return nombrePropio([u.NOMBRE, u.APELLIDOS].filter(Boolean).join(' ')); }
function nombreUnidad(clave) { return (unidades.find(u => u.clave === clave) || {}).valor || clave || 'Sin unidad'; }
function formatoCelular(c) { const d = String(c || ''); return d.length === 10 ? d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6) : d; }
function soloDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function celularNormalizado(s) {
  let d = soloDigitos(s);
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  return d.length === 10 ? d : '';
}

const fmtFecha = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Monterrey' });
const fmtRelativo = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });
function fecha(iso) { return iso ? fmtFecha.format(new Date(iso)) : '—'; }
function haceCuanto(iso) {
  if (!iso) return 'nunca';
  const seg = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seg);
  if (abs < 60) return 'hace un momento';
  if (abs < 3600) return fmtRelativo.format(Math.round(seg / 60), 'minute');
  if (abs < 86400) return fmtRelativo.format(Math.round(seg / 3600), 'hour');
  if (abs < 86400 * 30) return fmtRelativo.format(Math.round(seg / 86400), 'day');
  return fecha(iso);
}

function notificar(texto, tipo = '') {
  const n = el('div', { class: 'notificacion ' + tipo, role: tipo === 'error' ? 'alert' : 'status', text: texto });
  $('#notificaciones').append(n);
  setTimeout(() => n.remove(), tipo === 'error' ? 7000 : 4000);
}

async function conCarga(boton, fn) {
  if (boton.disabled) return;
  boton.disabled = true;
  boton.classList.add('cargando');
  boton.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  finally { boton.disabled = false; boton.classList.remove('cargando'); boton.removeAttribute('aria-busy'); }
}

// ───────────────────────── Formularios ─────────────────────────

function limpiarErrores(form) {
  $$('.error-campo', form).forEach(n => n.remove());
  $$('[aria-invalid]', form).forEach(n => n.removeAttribute('aria-invalid'));
  const m = $('.mensaje-form', form);
  if (m) { m.hidden = true; m.textContent = ''; m.classList.remove('exito'); }
}

function errorCampo(form, nombre, mensaje) {
  const input = form.elements[nombre];
  if (!input) return false;
  input.setAttribute('aria-invalid', 'true');
  const campo = input.closest('.campo');
  const id = input.id + '-error';
  $$('.error-campo', campo).forEach(n => n.remove());
  campo.append(el('small', { class: 'error-campo', id, text: mensaje }));
  input.setAttribute('aria-describedby', id);
  return true;
}

function mensajeForm(form, texto, exito = false) {
  const m = $('.mensaje-form', form);
  if (!m) { notificar(texto, exito ? 'exito' : 'error'); return; }
  m.textContent = texto;
  m.classList.toggle('exito', exito);
  m.hidden = false;
}

/** Muestra un error del servidor en el formulario (por campo si viene error.campos). */
function mostrarError(form, err) {
  if (err.manejado) return;
  let sinCampo = [];
  if (err.campos) {
    for (const [k, msg] of Object.entries(err.campos)) if (!errorCampo(form, k, msg)) sinCampo.push(msg);
    mensajeForm(form, sinCampo.length ? sinCampo.join(' ') : 'Revisa los campos marcados.');
  } else {
    mensajeForm(form, err.message || 'Ocurrió un error. Intenta de nuevo.');
  }
  const primero = $('[aria-invalid="true"]', form);
  if (primero) primero.focus();
}

function requeridos(form) {
  let ok = true;
  $$('[required]', form).forEach(i => {
    if (!String(i.value || '').trim()) {
      const etiqueta = (form.querySelector('label[for="' + i.id + '"]') || {}).firstChild;
      errorCampo(form, i.name, (etiqueta ? etiqueta.textContent.trim() : 'Este campo') + ' es obligatorio.');
      ok = false;
    }
  });
  return ok;
}

// Reglas de contraseña (espejo de la política del servidor)
function reglasPassword(pwd, usuario) {
  const u = String(usuario || '');
  return [
    ['Mínimo 10 caracteres', pwd.length >= 10],
    ['Una mayúscula', /[A-ZÁÉÍÓÚÑ]/.test(pwd)],
    ['Una minúscula', /[a-záéíóúñ]/.test(pwd)],
    ['Un número', /\d/.test(pwd)],
    ['Un símbolo', /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(pwd)],
    ['Sin espacios', pwd.length > 0 && !/\s/.test(pwd)],
    ['Sin tu celular o usuario', pwd.length > 0 && (u.length < 4 || !pwd.toUpperCase().includes(u.toUpperCase()))]
  ];
}

function usuarioParaPolitica(ul) {
  if (ul.dataset.usuario) return celularNormalizado($('#' + ul.dataset.usuario).value);
  return Sesion.datos && Sesion.datos.usuario ? Sesion.datos.usuario.USUARIO : '';
}

function pintarPolitica(ul) {
  const pwd = $('#' + ul.dataset.para).value;
  ul.replaceChildren(...reglasPassword(pwd, usuarioParaPolitica(ul)).map(([t, ok]) => el('li', { class: ok ? 'cumple' : '' }, t)));
}

function passwordCumple(pwd, usuario) { return reglasPassword(pwd, usuario).every(r => r[1]); }

// ───────────────────────── Llamadas con manejo global ─────────────────────────

async function api(accion, datos) {
  try {
    const r = await llamar(accion, datos);
    Inactividad.llamadaHecha();
    return r;
  } catch (e) {
    if (CODIGOS_SESION.includes(e.codigo) && Sesion.token) {
      cerrarLocal(e.codigo === 'SESION_EXPIRADA' ? 'Tu sesión expiró. Vuelve a entrar.' : e.message);
      e.manejado = true;
    } else if (e.codigo === 'CAMBIO_PASSWORD_REQUERIDO') {
      Sesion.actualizar({ debeCambiarPassword: true });
      mostrarVista('cambio');
      e.manejado = true;
    } else if (e.codigo === 'CLIENTE_DESACTUALIZADO') {
      $('#aviso-version').hidden = false;
    }
    throw e;
  }
}

// ───────────────────────── Vistas ─────────────────────────

const VISTAS = ['cargando', 'login', 'registro', 'registro-ok', 'cambio', 'app'];

function mostrarVista(nombre) {
  VISTAS.forEach(v => { $('#v-' + v).hidden = v !== nombre; });
  window.scrollTo(0, 0);
  if (window.matchMedia('(pointer: fine)').matches) {
    const primero = $('#v-' + nombre + ' input:not([type=hidden])');
    if (primero) primero.focus();
  }
  if (nombre === 'registro') prepararRegistro();
  $$('#v-' + nombre + ' ul.politica').forEach(pintarPolitica);
}

function cerrarLocal(mensaje) {
  Inactividad.detener();
  Sesion.borrar();
  $$('dialog[open]').forEach(d => d.close());
  mostrarVista('login');
  if (mensaje) mensajeForm($('#f-login'), mensaje);
}

async function salir() {
  const token = Sesion.token;
  cerrarLocal('');
  // Se cierra en servidor sin esperar: la sesión local ya se borró.
  if (token) llamar('auth.logout', {}, { token }).catch(() => {});
}

function entrar() {
  const d = Sesion.datos;
  if (!d || !d.token) { mostrarVista('login'); return; }
  if (d.debeCambiarPassword) { mostrarVista('cambio'); Inactividad.iniciar(); return; }
  const u = d.usuario;
  $('#app-nombre').textContent = nombreCompleto(u);
  $('#app-rol').textContent = (ROLES[u.ROL] || { nombre: u.ROL }).nombre + (u.ES_MAESTRO ? ' (maestro)' : '');
  $$('.pestana[data-requiere]').forEach(p => { p.hidden = !Sesion.tiene(p.dataset.requiere); });
  mostrarVista('app');
  mostrarPanel(Sesion.tiene('USUARIO_APROBAR') ? 'solicitudes' : 'inicio');
  Inactividad.iniciar();
}

function mostrarPanel(nombre) {
  $$('.pestana').forEach(p => { if (p.dataset.panel === nombre) p.setAttribute('aria-current', 'page'); else p.removeAttribute('aria-current'); });
  $$('.panel-vista').forEach(p => { p.hidden = p.id !== 'p-' + nombre; });
  if (nombre === 'inicio') pintarInicio();
  if (nombre === 'solicitudes') cargarSolicitudes();
  if (nombre === 'usuarios') cargarUsuarios();
  if (nombre === 'cuenta') pintarCuenta();
}

// ───────────────────────── Inactividad ─────────────────────────

const Inactividad = {
  intervalo: null,
  ultimaInteraccion: Date.now(),
  ultimaLlamada: Date.now(),
  iniciar() {
    this.ultimaInteraccion = Date.now();
    this.ultimaLlamada = Date.now();
    clearInterval(this.intervalo);
    this.intervalo = setInterval(() => this.revisar(), 5000);
  },
  detener() {
    clearInterval(this.intervalo);
    this.intervalo = null;
    $('#aviso-inactividad').hidden = true;
  },
  llamadaHecha() { this.ultimaLlamada = Date.now(); },
  interaccion() {
    if (!this.intervalo) return;
    this.ultimaInteraccion = Date.now();
    const avisando = !$('#aviso-inactividad').hidden;
    $('#aviso-inactividad').hidden = true;
    // Mantiene viva la sesión del servidor mientras la persona trabaja sin hacer peticiones
    if (avisando || Date.now() - this.ultimaLlamada > 4 * 60000) {
      this.ultimaLlamada = Date.now();
      api('auth.sesion', {}).catch(() => {});
    }
  },
  revisar() {
    if (!Sesion.datos) return this.detener();
    const limite = (Sesion.datos.inactividadMin || 30) * 60000;
    const restante = limite - (Date.now() - this.ultimaInteraccion);
    if (restante <= 0) { cerrarLocal('Tu sesión se cerró por inactividad.'); return; }
    const aviso = $('#aviso-inactividad');
    if (restante <= CONFIG.AVISO_INACTIVIDAD_S * 1000) {
      $('#cuenta-regresiva').textContent = String(Math.ceil(restante / 1000));
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }
  }
};

// ───────────────────────── Inicio de sesión ─────────────────────────

function descripcionDispositivo() {
  const plataforma = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'desconocido';
  const modo = window.matchMedia('(display-mode: standalone)').matches ? 'app' : 'navegador';
  return (plataforma + ' ' + modo + ' ' + window.screen.width + 'x' + window.screen.height).slice(0, 120);
}

async function enviarLogin(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  limpiarErrores(form);
  if (!requeridos(form)) return;
  await conCarga($('button[type=submit]', form), async () => {
    try {
      const r = await api('auth.login', {
        usuario: form.elements.usuario.value.trim(),
        password: form.elements.password.value,
        dispositivo: descripcionDispositivo()
      });
      Sesion.guardar({
        token: r.data.token,
        usuario: r.data.usuario,
        permisos: r.data.permisos,
        expiraEn: r.data.expiraEn,
        inactividadMin: r.data.inactividadMin,
        debeCambiarPassword: r.data.debeCambiarPassword
      });
      form.reset();
      entrar();
    } catch (e) {
      form.elements.password.value = '';
      mostrarError(form, e);
    }
  });
}

// ───────────────────────── Registro ─────────────────────────

async function cargarUnidades() {
  if (unidades.length) return unidades;
  const r = await llamar('catalogos.registro', {});
  unidades = r.data.unidades || [];
  return unidades;
}

function llenarSelectUnidades(select, seleccionada) {
  select.replaceChildren(
    el('option', { value: '' }, 'Selecciona tu unidad'),
    ...unidades.filter(u => u.clave !== 'SIN_ASIGNAR' || seleccionada === 'SIN_ASIGNAR')
      .map(u => el('option', { value: u.clave, selected: u.clave === seleccionada }, u.valor))
  );
}

async function prepararRegistro() {
  const select = $('#reg-unidad');
  if (unidades.length) { if (select.options.length <= 1) llenarSelectUnidades(select, ''); return; }
  try {
    await cargarUnidades();
    llenarSelectUnidades(select, '');
  } catch (e) {
    select.replaceChildren(el('option', { value: '' }, 'No se pudieron cargar las unidades'));
    mensajeForm($('#f-registro'), e.message);
  }
}

async function enviarRegistro(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  limpiarErrores(form);
  let ok = requeridos(form);
  const f = form.elements;
  const celular = celularNormalizado(f.celular.value);
  if (f.celular.value.trim() && !celular) { errorCampo(form, 'celular', 'Captura un celular de 10 dígitos.'); ok = false; }
  if (f.password.value && !passwordCumple(f.password.value, celular)) { errorCampo(form, 'password', 'La contraseña no cumple todas las reglas de abajo.'); ok = false; }
  if (f.confirmacion.value && f.password.value !== f.confirmacion.value) { errorCampo(form, 'confirmacion', 'Las contraseñas no coinciden.'); ok = false; }
  if (!ok) { mensajeForm(form, 'Revisa los campos marcados.'); $('[aria-invalid="true"]', form).focus(); return; }

  await conCarga($('button[type=submit]', form), async () => {
    try {
      await api('auth.registrar', {
        celular,
        nombre: f.nombre.value.trim(),
        apellidos: f.apellidos.value.trim(),
        numeroEmpleado: f.numeroEmpleado.value.trim(),
        unidad: f.unidad.value,
        correo: f.correo.value.trim(),
        password: f.password.value,
        confirmacion: f.confirmacion.value
      });
      form.reset();
      mostrarVista('registro-ok');
    } catch (e) {
      mostrarError(form, e);
    }
  });
}

// ───────────────────────── Cambio de contraseña ─────────────────────────

async function enviarCambio(ev, obligatorio) {
  ev.preventDefault();
  const form = ev.currentTarget;
  limpiarErrores(form);
  let ok = requeridos(form);
  const f = form.elements;
  const usuario = Sesion.datos.usuario.USUARIO;
  if (f.nueva.value && !passwordCumple(f.nueva.value, usuario)) { errorCampo(form, 'nueva', 'La contraseña no cumple todas las reglas.'); ok = false; }
  if (f.confirmacion.value && f.nueva.value !== f.confirmacion.value) { errorCampo(form, 'confirmacion', 'Las contraseñas no coinciden.'); ok = false; }
  if (f.nueva.value && f.nueva.value === f.actual.value) { errorCampo(form, 'nueva', 'Debe ser distinta de la actual.'); ok = false; }
  if (!ok) { mensajeForm(form, 'Revisa los campos marcados.'); return; }

  await conCarga($('button[type=submit]', form), async () => {
    try {
      await api('auth.cambiarPassword', { actual: f.actual.value, nueva: f.nueva.value, confirmacion: f.confirmacion.value });
      form.reset();
      $$('ul.politica', form).forEach(pintarPolitica);
      if (obligatorio) {
        Sesion.actualizar({ debeCambiarPassword: false });
        entrar();
        notificar('Contraseña actualizada.', 'exito');
      } else {
        mensajeForm(form, 'Contraseña actualizada. Se cerraron tus sesiones en otros dispositivos.', true);
      }
    } catch (e) {
      mostrarError(form, e);
    }
  });
}

// ───────────────────────── Inicio y cuenta ─────────────────────────

function ficha(contenedor, pares) {
  contenedor.replaceChildren(...pares.map(([etq, val]) => el('div', {}, el('span', { class: 'etq' }, etq), el('span', { class: 'val' }, val))));
}

function pintarInicio() {
  const u = Sesion.datos.usuario;
  $('#inicio-saludo').textContent = 'Hola, ' + nombrePropio(u.NOMBRE);
  ficha($('#inicio-ficha'), [
    ['Rol', (ROLES[u.ROL] || { nombre: u.ROL }).nombre],
    ['Alcance', ALCANCES[u.ALCANCE] || u.ALCANCE],
    ['Unidad', nombreUnidad(u.UNIDAD)],
    ['Usuario', u.USUARIO]
  ]);
  const operativo = (Sesion.datos.permisos || []).some(p => /^(EXP|PER|FOTO|AUDIO|REL|REPORTE)_/.test(p));
  const lista = $('#inicio-modulos');
  if (!operativo) {
    lista.replaceChildren(el('li', {}, el('strong', {}, 'Tu rol administra accesos'), el('small', {}, 'Por diseño no consulta expedientes ni personas.')));
  } else {
    const modulos = [
      ['Expedientes', 'Folio, intervención y línea de tiempo'],
      ['Personas', 'Registro y búsqueda con detección de duplicados'],
      ['Fotografías y documentos', 'Captura con cámara y resguardo en Drive'],
      ['Entrevistas', 'Grabación de audio por segmentos'],
      ['Relaciones', 'Vínculos con fuente y verificación'],
      ['Reportes', 'PDF con código de verificación']
    ];
    lista.replaceChildren(...modulos.map(([t, d]) => el('li', {}, el('strong', {}, t), el('small', {}, d + '. Disponible en la siguiente fase.'))));
  }
  if (Sesion.tiene('USUARIO_APROBAR')) actualizarContadorSolicitudes();
}

function pintarCuenta() {
  const d = Sesion.datos;
  const u = d.usuario;
  ficha($('#cuenta-ficha'), [
    ['Nombre', nombreCompleto(u)],
    ['Usuario', u.USUARIO],
    ['Rol', (ROLES[u.ROL] || { nombre: u.ROL }).nombre],
    ['Sesión válida hasta', fecha(d.expiraEn)]
  ]);
}

// ───────────────────────── Solicitudes ─────────────────────────

function pintarContador(n) {
  const c = $('#contador-solicitudes');
  c.textContent = String(n);
  c.hidden = !n;
  const b = $('#inicio-solicitudes');
  if (n && Sesion.tiene('USUARIO_APROBAR')) {
    b.replaceChildren(el('strong', {}, n === 1 ? '1 solicitud espera tu revisión' : n + ' solicitudes esperan tu revisión'), el('span', { class: 'enlace' }, 'Revisar'));
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

async function actualizarContadorSolicitudes() {
  try { const r = await api('usuarios.pendientes', {}); pintarContador(r.data.usuarios.length); } catch { /* silencioso */ }
}

function cargando(contenedor) {
  contenedor.replaceChildren(el('div', { class: 'vacio' }, 'Cargando…'));
}

async function cargarSolicitudes() {
  const cont = $('#lista-solicitudes');
  cargando(cont);
  try {
    const [r] = await Promise.all([api('usuarios.pendientes', {}), cargarUnidades().catch(() => [])]);
    const lista = r.data.usuarios;
    pintarContador(lista.length);
    if (!lista.length) { cont.replaceChildren(el('div', { class: 'vacio' }, 'No hay solicitudes pendientes.')); return; }
    cont.replaceChildren(...lista.map(u => el('div', { class: 'fila' },
      el('div', {},
        el('div', { class: 'fila-nombre' }, nombreCompleto(u)),
        el('div', { class: 'fila-datos' },
          el('span', {}, 'Celular ', el('span', { class: 'num' }, formatoCelular(u.CELULAR))),
          el('span', {}, nombreUnidad(u.UNIDAD)),
          u.NUMERO_EMPLEADO ? el('span', {}, 'Empleado ', el('span', { class: 'num' }, u.NUMERO_EMPLEADO)) : null,
          u.CORREO ? el('span', {}, u.CORREO) : null,
          el('span', { title: fecha(u.FECHA_SOLICITUD) }, 'Solicitó ' + haceCuanto(u.FECHA_SOLICITUD)))
      ),
      el('div', { class: 'fila-acciones' },
        el('button', { type: 'button', class: 'boton boton-exito boton-chico', onclick: () => abrirAprobar(u) }, 'Aprobar'),
        el('button', { type: 'button', class: 'boton boton-contorno-peligro boton-chico', onclick: () => abrirRechazar(u) }, 'Rechazar'))
    )));
  } catch (e) {
    if (!e.manejado) cont.replaceChildren(el('div', { class: 'vacio' }, e.message));
  }
}

function opcionesRol(select, seleccionado) {
  const maestro = !!Sesion.datos.usuario.ES_MAESTRO;
  select.replaceChildren(...Object.entries(ROLES)
    .filter(([k]) => k !== 'ADMINISTRADOR' || maestro)
    .map(([k, v]) => el('option', { value: k, selected: k === seleccionado }, v.nombre)));
}

function enlazarAyudaRol(select, ayuda) {
  const pintar = () => { ayuda.textContent = (ROLES[select.value] || {}).ayuda || ''; };
  select.onchange = pintar;
  pintar();
}

function abrirAprobar(u) {
  const dlg = $('#dlg-aprobar');
  const form = $('#f-aprobar');
  limpiarErrores(form);
  $('#aprobar-quien').textContent = nombreCompleto(u) + ', celular ' + formatoCelular(u.CELULAR) + '.';
  opcionesRol($('#ap-rol'), 'OPERADOR');
  enlazarAyudaRol($('#ap-rol'), $('#ap-rol-ayuda'));
  $('#ap-alcance').value = 'UNIDAD';
  llenarSelectUnidades($('#ap-unidad'), u.UNIDAD);
  form.onsubmit = async ev => {
    ev.preventDefault();
    limpiarErrores(form);
    if (!requeridos(form)) return;
    await conCarga($('button[type=submit]', form), async () => {
      try {
        await api('usuarios.aprobar', { idUsuario: u.ID_USUARIO, rol: form.elements.rol.value, alcance: form.elements.alcance.value, unidad: form.elements.unidad.value, version: u.VERSION });
        dlg.close();
        notificar('Acceso aprobado para ' + nombreCompleto(u) + '.', 'exito');
        cargarSolicitudes();
      } catch (e) {
        if (e.codigo === 'VERSION_CONFLICT' || e.codigo === 'ESTADO_INVALIDO') { dlg.close(); notificar(e.message, 'error'); cargarSolicitudes(); return; }
        mostrarError(form, e);
      }
    });
  };
  dlg.showModal();
}

/** Diálogo genérico de confirmación con motivo obligatorio. */
function abrirMotivo({ titulo, texto, boton, claseBoton, enviar }) {
  const dlg = $('#dlg-motivo');
  const form = $('#f-motivo');
  limpiarErrores(form);
  form.reset();
  $('#motivo-titulo').textContent = titulo;
  $('#motivo-texto').textContent = texto;
  const b = $('#motivo-confirmar');
  b.textContent = boton;
  b.className = 'boton ' + claseBoton;
  b.type = 'submit';
  form.onsubmit = async ev => {
    ev.preventDefault();
    limpiarErrores(form);
    const motivo = form.elements.motivo.value.trim();
    if (motivo.length < 5) { errorCampo(form, 'motivo', 'Escribe un motivo de al menos 5 caracteres.'); return; }
    await conCarga(b, async () => {
      try { await enviar(motivo); dlg.close(); }
      catch (e) {
        if (e.codigo === 'VERSION_CONFLICT' || e.codigo === 'ESTADO_INVALIDO') { dlg.close(); notificar(e.message, 'error'); recargarActual(); return; }
        mostrarError(form, e);
      }
    });
  };
  dlg.showModal();
}

function abrirRechazar(u) {
  abrirMotivo({
    titulo: 'Rechazar solicitud',
    texto: nombreCompleto(u) + ' no podrá entrar. Si fue un error, deberá registrarse otra vez con otro celular.',
    boton: 'Rechazar solicitud',
    claseBoton: 'boton-peligro',
    enviar: async motivo => {
      await api('usuarios.rechazar', { idUsuario: u.ID_USUARIO, motivo, version: u.VERSION });
      notificar('Solicitud rechazada.', 'exito');
      cargarSolicitudes();
    }
  });
}

// ───────────────────────── Usuarios ─────────────────────────

function puedeGestionar(u) {
  const yo = Sesion.datos.usuario;
  return !u.ES_MAESTRO && u.ID_USUARIO !== yo.ID_USUARIO && (u.ROL !== 'ADMINISTRADOR' || !!yo.ES_MAESTRO);
}

async function cargarUsuarios() {
  const cont = $('#lista-usuarios');
  cargando(cont);
  try {
    const [r] = await Promise.all([api('usuarios.listar', {}), cargarUnidades().catch(() => [])]);
    usuariosCache = r.data.usuarios;
    pintarUsuarios();
  } catch (e) {
    if (!e.manejado) cont.replaceChildren(el('div', { class: 'vacio' }, e.message));
  }
}

function pintarUsuarios() {
  const cont = $('#lista-usuarios');
  const q = $('#buscar-usuario').value.trim().toLowerCase();
  const qDig = soloDigitos(q);
  const lista = usuariosCache.filter(u => {
    if (filtroEstado && u.ESTADO_USUARIO !== filtroEstado) return false;
    if (!q) return true;
    return nombreCompleto(u).toLowerCase().includes(q) || String(u.USUARIO).toLowerCase().includes(q) || (qDig && String(u.CELULAR).includes(qDig));
  });
  if (!lista.length) { cont.replaceChildren(el('div', { class: 'vacio' }, q || filtroEstado ? 'Ningún usuario coincide con el filtro.' : 'Aún no hay usuarios.')); return; }
  cont.replaceChildren(...lista.map(filaUsuario));
}

function filaUsuario(u) {
  const acciones = [];
  if (puedeGestionar(u)) {
    const b = (texto, clase, fn) => el('button', { type: 'button', class: 'boton boton-chico ' + clase, onclick: fn }, texto);
    if (u.ESTADO_USUARIO === 'ACTIVO') {
      acciones.push(b('Cambiar rol', 'boton-fantasma', () => abrirCambiarRol(u)));
      acciones.push(b('Restablecer contraseña', 'boton-fantasma', () => abrirRestablecer(u)));
      acciones.push(b('Suspender', 'boton-contorno-peligro', () => abrirEstado(u, 'SUSPENDIDO')));
    } else if (u.ESTADO_USUARIO === 'SUSPENDIDO') {
      acciones.push(b('Reactivar', 'boton-exito', () => abrirEstado(u, 'ACTIVO')));
      acciones.push(b('Cambiar rol', 'boton-fantasma', () => abrirCambiarRol(u)));
      acciones.push(b('Dar de baja', 'boton-contorno-peligro', () => abrirEstado(u, 'BAJA')));
    } else if (u.ESTADO_USUARIO === 'PENDIENTE' && Sesion.tiene('USUARIO_APROBAR')) {
      acciones.push(b('Revisar solicitud', 'boton-secundario', () => mostrarPanel('solicitudes')));
    }
  }
  const bloqueado = u.BLOQUEADO_HASTA && new Date(u.BLOQUEADO_HASTA).getTime() > Date.now();
  return el('div', { class: 'fila' },
    el('div', {},
      el('div', { class: 'fila-nombre' }, nombreCompleto(u),
        el('span', { class: 'estado estado-' + u.ESTADO_USUARIO }, ESTADOS[u.ESTADO_USUARIO] || u.ESTADO_USUARIO),
        u.ES_MAESTRO ? el('span', { class: 'marca-maestro' }, 'Maestro') : null,
        bloqueado ? el('span', { class: 'estado estado-SUSPENDIDO' }, 'Bloqueado por intentos') : null),
      el('div', { class: 'fila-datos' },
        el('span', { class: 'num' }, u.CELULAR ? formatoCelular(u.CELULAR) : u.USUARIO),
        u.ROL ? el('span', {}, (ROLES[u.ROL] || { nombre: u.ROL }).nombre + ', ' + (ALCANCES[u.ALCANCE] || u.ALCANCE).toLowerCase()) : null,
        el('span', {}, nombreUnidad(u.UNIDAD)),
        el('span', { title: fecha(u.ULTIMO_ACCESO) }, 'Último acceso ' + haceCuanto(u.ULTIMO_ACCESO)))
    ),
    acciones.length ? el('div', { class: 'fila-acciones' }, acciones) : null
  );
}

function abrirEstado(u, estado) {
  const textos = {
    SUSPENDIDO: ['Suspender acceso', nombreCompleto(u) + ' no podrá entrar hasta que lo reactives. Sus sesiones abiertas se cierran de inmediato.', 'Suspender', 'boton-peligro', 'Usuario suspendido.'],
    ACTIVO: ['Reactivar acceso', nombreCompleto(u) + ' podrá volver a entrar con su contraseña.', 'Reactivar', 'boton-exito', 'Usuario reactivado.'],
    BAJA: ['Dar de baja', nombreCompleto(u) + ' perderá el acceso de forma definitiva. Su historial se conserva.', 'Dar de baja', 'boton-peligro', 'Usuario dado de baja.']
  }[estado];
  abrirMotivo({
    titulo: textos[0], texto: textos[1], boton: textos[2], claseBoton: textos[3],
    enviar: async motivo => {
      await api('usuarios.cambiarEstado', { idUsuario: u.ID_USUARIO, estado, motivo, version: u.VERSION });
      notificar(textos[4], 'exito');
      cargarUsuarios();
    }
  });
}

function abrirCambiarRol(u) {
  const dlg = $('#dlg-rol');
  const form = $('#f-rol');
  limpiarErrores(form);
  form.reset();
  $('#rol-quien').textContent = nombreCompleto(u) + '. Rol actual: ' + (ROLES[u.ROL] || { nombre: u.ROL }).nombre + '.';
  opcionesRol($('#cr-rol'), u.ROL);
  enlazarAyudaRol($('#cr-rol'), $('#cr-rol-ayuda'));
  $('#cr-alcance').value = u.ALCANCE || 'UNIDAD';
  form.onsubmit = async ev => {
    ev.preventDefault();
    limpiarErrores(form);
    if (!requeridos(form)) return;
    const motivo = form.elements.motivo.value.trim();
    if (motivo.length < 5) { errorCampo(form, 'motivo', 'Escribe un motivo de al menos 5 caracteres.'); return; }
    await conCarga($('button[type=submit]', form), async () => {
      try {
        await api('usuarios.cambiarRol', { idUsuario: u.ID_USUARIO, rol: form.elements.rol.value, alcance: form.elements.alcance.value, motivo, version: u.VERSION });
        dlg.close();
        notificar('Rol actualizado.', 'exito');
        cargarUsuarios();
      } catch (e) {
        if (e.codigo === 'VERSION_CONFLICT') { dlg.close(); notificar(e.message, 'error'); cargarUsuarios(); return; }
        mostrarError(form, e);
      }
    });
  };
  dlg.showModal();
}

function abrirRestablecer(u) {
  abrirMotivo({
    titulo: 'Restablecer contraseña',
    texto: 'Se generará una contraseña temporal para ' + nombreCompleto(u) + '. Sus sesiones abiertas se cierran.',
    boton: 'Generar contraseña temporal',
    claseBoton: 'boton-primario',
    enviar: async motivo => {
      const r = await api('usuarios.restablecerPassword', { idUsuario: u.ID_USUARIO, motivo, version: u.VERSION });
      $('#temporal-quien').textContent = 'Para ' + nombreCompleto(u) + ', usuario ' + u.USUARIO + '.';
      $('#temporal-valor').textContent = r.data.passwordTemporal;
      // se cierra el diálogo de motivo antes de abrir este
      setTimeout(() => $('#dlg-temporal').showModal(), 0);
      cargarUsuarios();
    }
  });
}

function recargarActual() {
  const actual = $('.pestana[aria-current="page"]');
  if (actual) mostrarPanel(actual.dataset.panel);
}

// ───────────────────────── Arranque ─────────────────────────

function enlazarEventos() {
  $('#f-login').addEventListener('submit', enviarLogin);
  $('#f-registro').addEventListener('submit', enviarRegistro);
  $('#f-cambio-obligatorio').addEventListener('submit', ev => enviarCambio(ev, true));
  $('#f-cambio').addEventListener('submit', ev => enviarCambio(ev, false));

  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-ir], [data-accion], [data-panel], [data-recargar], [data-cerrar], .ver-password, .chip');
    if (!t) return;
    if (t.dataset.ir) { limpiarErrores($('#v-' + t.dataset.ir) || document); mostrarVista(t.dataset.ir); }
    else if (t.dataset.accion === 'salir') salir();
    else if (t.dataset.panel) mostrarPanel(t.dataset.panel);
    else if (t.dataset.recargar === 'solicitudes') cargarSolicitudes();
    else if (t.dataset.recargar === 'usuarios') cargarUsuarios();
    else if (t.hasAttribute('data-cerrar')) t.closest('dialog').close();
    else if (t.classList.contains('ver-password')) {
      const i = $('#' + t.dataset.objetivo);
      const ver = i.type === 'password';
      i.type = ver ? 'text' : 'password';
      t.textContent = ver ? 'Ocultar' : 'Mostrar';
      t.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
    } else if (t.classList.contains('chip')) {
      $$('.chip').forEach(c => c.classList.toggle('activo', c === t));
      filtroEstado = t.dataset.estado;
      pintarUsuarios();
    }
  });

  $('#inicio-solicitudes').addEventListener('click', () => mostrarPanel('solicitudes'));
  $('#buscar-usuario').addEventListener('input', pintarUsuarios);

  $$('ul.politica').forEach(ul => {
    $('#' + ul.dataset.para).addEventListener('input', () => pintarPolitica(ul));
    if (ul.dataset.usuario) $('#' + ul.dataset.usuario).addEventListener('input', () => pintarPolitica(ul));
  });

  // Limpia la contraseña temporal de la pantalla al cerrar
  $('#dlg-temporal').addEventListener('close', () => { $('#temporal-valor').textContent = ''; });
  $('#btn-copiar-temporal').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#temporal-valor').textContent); notificar('Copiada.', 'exito'); }
    catch { notificar('No se pudo copiar; anótala a mano.', 'error'); }
  });

  $('#btn-seguir').addEventListener('click', () => Inactividad.interaccion());
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => document.addEventListener(t, () => Inactividad.interaccion(), { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Inactividad.revisar(); });

  const conexion = () => { $('#aviso-conexion').hidden = navigator.onLine; };
  window.addEventListener('online', conexion);
  window.addEventListener('offline', conexion);
  conexion();
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const avisar = w => {
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) $('#aviso-version').hidden = false;
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) $('#aviso-version').hidden = false;
    reg.addEventListener('updatefound', () => avisar(reg.installing));
    $('#btn-actualizar').addEventListener('click', () => {
      if (reg.waiting) reg.waiting.postMessage('ACTIVAR');
      else location.reload();
    });
    // Revisa si hay versión nueva cada 30 min
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  }).catch(() => { /* sin service worker: la app funciona igual en línea */ });
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recargando) { recargando = true; location.reload(); } });
}

async function arrancar() {
  enlazarEventos();
  registrarServiceWorker();
  // Despierta al servidor mientras la persona escribe (la primera llamada del día tarda más).
  llamar('sistema.estado', {}).then(r => {
    if (r.data.modoMantenimiento) mensajeForm($('#f-login'), 'El sistema está en mantenimiento. Intenta más tarde.');
  }).catch(() => {});

  Sesion.cargar();
  if (!Sesion.token) { mostrarVista('login'); return; }
  $('#cargando-mensaje').textContent = 'Recuperando tu sesión…';
  try {
    const r = await api('auth.sesion', {});
    Sesion.actualizar({ usuario: r.data.usuario, permisos: r.data.permisos, debeCambiarPassword: r.data.debeCambiarPassword, expiraEn: r.data.expiraEn });
    entrar();
  } catch (e) {
    Sesion.borrar();
    mostrarVista('login');
    if (!e.manejado && e.codigo !== 'SIN_CONEXION') mensajeForm($('#f-login'), 'Tu sesión anterior ya no es válida. Vuelve a entrar.');
    if (e.codigo === 'SIN_CONEXION') mensajeForm($('#f-login'), e.message);
  }
}

arrancar();
