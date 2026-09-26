# ANT — Aplicación (PWA) v1.2.1

Interfaz de ANT para tablet y teléfono. Se conecta al backend de Apps Script cuya URL
está en `js/config.js`.

## Qué incluye

- Inicio de sesión con celular o usuario.
- Solicitud de acceso con celular y contraseña propia.
- Cambio obligatorio de contraseña en el primer acceso y después de un restablecimiento.
- Bandeja de solicitudes para aprobar o rechazar, asignando rol, alcance y unidad.
- Administración de usuarios: cambiar rol, suspender, reactivar, dar de baja y generar contraseña temporal.
- Cierre de sesión por inactividad, con aviso un minuto antes.
- Instalable como app. La interfaz abre sin señal; los datos nunca se guardan en el dispositivo.

## Publicar en GitHub Pages

1. Entra a github.com con la cuenta que administrará ANT.
2. Arriba a la derecha: **+** → **New repository**.
   - Repository name: `ant`
   - Visibilidad: **Public**. GitHub Pages gratuito requiere repositorio público; con GitHub Pro puede ser privado.
   - No marques "Add a README file".
   - **Create repository**.
3. En la página del repositorio vacío, da clic en **uploading an existing file**.
4. Arrastra **todo el contenido** de esta carpeta: `index.html`, `sw.js`, `manifest.webmanifest`,
   `robots.txt`, `.nojekyll`, `README.md` y las carpetas `css`, `js` y `assets`.
   Arrastra el contenido, no la carpeta que lo contiene.
5. Abajo: **Commit changes**.
6. **Settings** → **Pages** (menú izquierdo).
   - Source: **Deploy from a branch**
   - Branch: **main**, carpeta **/(root)** → **Save**
7. Espera 1 a 2 minutos y recarga. Arriba aparecerá la dirección:
   `https://TU_USUARIO.github.io/ant/`

## Instalar en tablet o teléfono

- **Android (Chrome):** abre la dirección → menú ⋮ → **Instalar app** o **Agregar a pantalla principal**.
- **iPad / iPhone (Safari):** abre la dirección → botón Compartir → **Agregar a inicio**.

## Publicar cambios

1. Sube los archivos modificados al repositorio (Add file → Upload files).
2. Cambia la versión en **dos lugares**, con el mismo número:
   - `sw.js` → `const VERSION = 'ant-v1.0.1';`
   - `js/config.js` → `VERSION: '1.0.1'`
3. Quienes tengan la app abierta verán "Hay una versión nueva de ANT. Actualizar ahora".

## Seguridad

- Este repositorio es público: contiene solo la interfaz. **No subas aquí el código del backend**
  (`Ant.gs`) ni ninguna contraseña o llave.
- La URL del backend es visible por diseño. Sin usuario aprobado solo responde el estado del
  sistema, el formulario de registro y el inicio de sesión, con límites de intentos.
- La sesión se guarda solo mientras la app está abierta (sessionStorage). Al cerrarla hay que volver a entrar.
- Política de seguridad de contenido (CSP): la app solo puede conectarse a Apps Script.
- Fuente Inter autoalojada (licencia OFL en `assets/fonts/LICENSE-Inter.txt`).
