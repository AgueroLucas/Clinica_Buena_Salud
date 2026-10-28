# Cambios: acceso por DNI e historial clínico

**Proyecto:** Clínica Buena Salud
**Fecha:** 28/10/2026
**Estado:** implementado, probado y compilado (`next build` OK). Cambios sin commitear.

---

## 1. Resumen ejecutivo

Se cambió la identidad de los pacientes: antes la cuenta se identificaba por **email** y ahora se identifica por **DNI**. A partir de esto se construyó un **historial clínico único por paciente** que reúne turnos, solicitudes de WhatsApp y evoluciones médicas.

Además:

- Pacientes y recepción inician sesión con **DNI + contraseña**.
- Administradores y médicos siguen usando **email + contraseña + 2FA**.
- Las solicitudes de turno por WhatsApp ahora **guardan el DNI** y crean/vinculan automáticamente la ficha del paciente.
- Si una persona pidió un turno por WhatsApp y después se registra con ese mismo DNI, **recupera todo su historial**.
- El DNI se guarda **cifrado** y se indexa mediante un **hash determinístico**, para poder buscarlo y garantizar unicidad sin almacenarlo en texto plano.

---

## 2. Por qué se hizo

### Problemas del esquema anterior

| Problema | Consecuencia |
|---|---|
| El email era la clave del paciente | Muchos pacientes no tienen email o usan el de un familiar; quedaban fuera del portal |
| Las solicitudes de WhatsApp no se asociaban a un paciente | Recepción veía el pedido, pero no existía una ficha ni historial detrás |
| Se podían crear fichas duplicadas | La misma persona podía aparecer con distintos emails o sin email |
| No existía historial clínico | El paciente no podía consultar sus turnos ni evoluciones; el médico no tenía dónde registrar la atención |
| Recepción iniciaba sesión con email | Contradicción con el dato que realmente usa en el mostrador: el DNI |

### Objetivos

1. Usar el **DNI como identificador único** del paciente.
2. Permitir que un paciente **reclame** una ficha creada por WhatsApp/recepción.
3. Dar al paciente una vista de **historial clínico**.
4. Permitir al médico registrar **evoluciones** asociadas a un turno.
5. No romper el acceso de admin/médicos ni la seguridad existente (2FA, cifrado, auditoría).

---

## 3. Decisiones técnicas y justificación

### 3.1 DNI cifrado + hash para búsquedas

El DNI es un dato sensible. Guardarlo en texto plano para poder indexarlo no era aceptable, pero AES-GCM usa IV aleatorio y su resultado no se puede indexar.

Solución implementada en `lib/security.js`:

- `normalizeDni(valor)`: deja solo dígitos (`"35.678.910"` → `"35678910"`).
- `hashDni(valor)`: `HMAC-SHA256(SESSION_SECRET, "dni:" + dni)`.

En la base:

- `dni`: valor cifrado con AES-GCM.
- `dniHash`: hash determinístico usado para buscar y validar unicidad.

Ventajas:

- El DNI real no queda expuesto en la base.
- La búsqueda es directa por índice.
- El hash no es reversible sin `SESSION_SECRET`.
- Se mantiene compatibilidad con registros viejos que tenían el DNI cifrado pero sin hash.

### 3.2 Cuentas "sin cuenta" (stub) para reclamar

Cuando llega una solicitud de WhatsApp con un DNI que no existe, se crea un usuario paciente con:

- `password: null`
- `hasAccount: false`
- `createdFrom: "whatsapp"`

Ese registro **no puede iniciar sesión** (la API responde que debe registrarse), pero ya tiene `patientId`. Cuando la persona se registra con el mismo DNI:

- No se crea otro paciente.
- Se completa la misma ficha con nombre, contraseña, email/teléfono.
- Se conservan turnos, solicitudes y evoluciones previas.
- La respuesta incluye `claimedHistory: true`.

Esto evita duplicados y permite que el historial "exista antes" de que el paciente tenga cuenta.

### 3.3 Email opcional

El email dejó de ser obligatorio para pacientes. Sigue siendo útil como dato de contacto y para el login de admin/médicos, pero ya no identifica al paciente.

En bases existentes, el índice único viejo de email no genera conflictos porque PostgreSQL permite múltiples valores `NULL`.

### 3.4 Migración automática

En `lib/postgres.js`, al inicializar el esquema:

1. Se crean tablas e índices nuevos.
2. Se ejecuta `backfillDniHashes()`:
   - Calcula `dniHash` para usuarios que solo tenían el DNI cifrado.
   - Re-cifra DNIs ilegibles con la `ENCRYPTION_KEY` actual.
   - Reconstruye los DNI de las cuentas demo históricas a partir del email.
   - Asigna `30111222` a la cuenta de recepción si no tiene DNI.
3. Se crean los índices únicos, sin tumbar la app si hubiera datos duplicados históricos.

---

## 4. Cambios por archivo

### `lib/security.js`

- Nuevas funciones `normalizeDni()` y `hashDni()`.
- Se reutiliza `SESSION_SECRET` para el HMAC.

### `lib/postgres.js`

- El esquema se dividió en sentencias individuales (`schemaStatements`) para poder ejecutarlas en orden.
- Nuevos índices:
  - `appointments_patient_idx` → historial por paciente.
  - `appointments_doctor_date_idx` → agenda por médico/fecha.
  - `clinical_records_patient_idx` → evoluciones por paciente.
  - `whatsapp_requests_patient_idx` → solicitudes por paciente.
- Nuevo índice único parcial `users_dni_hash_idx` sobre `data->>'dniHash'` para usuarios.
- Se mantiene el índice único de turnos (`appointments_slot_idx`) para evitar solapamientos.
- Nueva migración `backfillDniHashes()`.

### `app/api/[[...path]]/route.js`

- Esquemas de validación:
  - `LoginSchema` acepta `dni` o `email`.
  - `RegisterSchema` exige DNI y deja email como opcional.
  - `WhatsAppRequestSchema` exige DNI.
  - `AppointmentSchema` acepta `patientDni`.
  - Nuevo `ClinicalRecordSchema`.
- Nuevos helpers:
  - `findUserByDni(db, dni)`.
  - `findOrCreatePatientByDni(db, {...})`.
- Login:
  - Paciente/recepción: búsqueda por `dniHash`.
  - Admin/médico: búsqueda por email.
  - Si un paciente o recepción intenta ingresar con email, la API responde `400`.
  - Si la ficha no tiene contraseña, devuelve `403` con `needsRegistration: true`.
- Registro:
  - Normaliza el DNI.
  - Si ya existe una ficha sin cuenta, la reclama.
  - Si ya existe una cuenta con ese DNI, responde `409`.
  - Valida que el email no pertenezca a otro usuario.
- Turnos:
  - El paciente solo puede reservar a su nombre.
  - Se resuelve/crea el paciente por DNI.
  - El turno guarda `patientDni` cifrado.
  - Se conserva compatibilidad con turnos viejos sin DNI.
- WhatsApp:
  - Crea/vincula paciente por DNI.
  - Guarda `patientId`, `dni`, `dniHash` en la solicitud.
  - Devuelve `patientId` y `hasAccount`.
- Historial clínico:
  - `GET /api/clinical-history` (propio paciente o staff autorizado).
  - `POST /api/clinical-records` (admin/médico).
  - El médico solo accede a pacientes de su propia agenda y solo agrega evoluciones a turnos propios.
- Seed:
  - Pacientes con DNI y `dniHash`.
  - Recepción con DNI `30111222`.
  - Credenciales demo actualizadas.

### `components/clinical-history.jsx` (nuevo)

Componente reutilizable con:

- Ficha del paciente (nombre, DNI, teléfono, email).
- Estado de cuenta: **activa** o **pendiente de reclamar**.
- Resumen: turnos totales, atendidos, próximos y evoluciones.
- Lista de evoluciones clínicas.
- Lista de turnos con estado.
- Formulario de **nueva evolución** (solo médico/admin): fecha, motivo, diagnóstico, tratamiento y notas.
- `ClinicalHistoryDialog` para usarlo dentro de modales.

### `app/page.js`

- Login:
  - Paciente y recepción muestran campo **DNI**; admin y médico muestran **email**.
  - Credenciales demo precargadas con el dato correcto.
  - Registro con **DNI obligatorio** y **email opcional**.
  - Mensaje especial cuando se vincula un historial existente.
- Reserva:
  - Nuevo campo **DNI** en el formulario.
  - Para pacientes logueados, el DNI se muestra bloqueado (se toma de su cuenta).
  - El email pasa a ser opcional.
- Paciente:
  - Nueva vista **Historial clínico** en el menú.
  - Botón de acceso desde **Mis turnos**.
- Médico:
  - Botón **Historial clínico** en el detalle del turno.
  - Puede agregar evoluciones desde ese modal.
- Recepción/admin:
  - Botón **Historial** en el detalle del turno de la agenda.
  - Se muestra el DNI del paciente.

### `components/whatsapp-inbox.jsx`

- Botón **Historial** en cada solicitud vinculada a un paciente.
- Badge **"Cuenta pendiente"** cuando la ficha todavía no fue reclamada.
- Modal de historial clínico reutilizando el nuevo componente.

### `components/help-widget.jsx`

- Sin cambios en este archivo: ya contaba con campo DNI. Ahora la API lo **exige y lo usa** para crear/vincular la ficha del paciente.

### `README.md` y `memory/test_credentials.md`

- Documentación del acceso por DNI.
- Descripción del historial clínico.
- Credenciales demo actualizadas.

---

## 5. Flujos resultantes

### 5.1 Paciente nuevo

1. Entra a la web y se registra con **nombre + DNI + contraseña** (email/teléfono opcionales).
2. Se crea su usuario paciente.
3. Puede reservar turnos y ver su **Historial clínico**.

### 5.2 Paciente que pidió turno por WhatsApp

1. Completa el formulario de ayuda con **nombre + DNI + teléfono + preferencia**.
2. La API crea una ficha paciente sin cuenta y una solicitud en `whatsapp_requests`.
3. Recepción ve la solicitud con el badge **"Cuenta pendiente"**.
4. El paciente se registra con el mismo DNI.
5. La ficha se reclama: se conserva el `patientId` y todo el historial.
6. Desde ese momento puede iniciar sesión con DNI y ver sus turnos/solicitudes/evoluciones.

### 5.3 Recepción

1. Inicia sesión con **DNI + contraseña**.
2. Gestiona la agenda y las solicitudes.
3. Desde **Solicitudes** puede pulsar **Reservar turno** para cargar el turno de ese pedido con los datos del paciente, la especialidad y la sede precargados. Al confirmar, el turno queda vinculado a su DNI y la solicitud pasa a **Contactada**.
4. También tiene un acceso **Reservar** en el menú para cargar un turno manualmente. El DNI del paciente es obligatorio: la ficha se resuelve por DNI y nunca se asocia a la cuenta del personal.
5. Desde el detalle de un turno o de una solicitud puede abrir el **Historial** del paciente.

### 5.4 Médico

1. Inicia sesión con **email + contraseña + 2FA**.
2. En su agenda abre el turno.
3. Puede ver el **historial clínico** del paciente.
4. Puede registrar una **evolución** (motivo, diagnóstico, tratamiento, notas).
5. Solo accede a pacientes con turnos propios.

### 5.5 Administrador

1. Inicia sesión con **email + contraseña + 2FA**.
2. Puede consultar historiales y agregar evoluciones.
3. Mantiene acceso a dashboard, auditoría y solicitudes.

---

## 6. Repercusiones en la página

### Visible para el público

- El formulario de solicitud de turno por WhatsApp ahora **requiere DNI**.
- El registro de paciente ahora **requiere DNI** y el email es opcional.
- El login de paciente/recepción cambió de email a DNI.
- Se agregó la vista de historial clínico para pacientes.

### Visible para recepción

- Debe iniciar sesión con DNI.
- Ve el DNI en los turnos.
- Puede abrir el historial desde agenda y solicitudes.
- Detecta solicitudes con **cuenta pendiente**.

### Visible para médicos

- Ve el DNI del paciente en el turno.
- Puede consultar el historial y cargar evoluciones.
- El acceso queda limitado a sus propios pacientes/turnos.

### Visible para administración

- Puede consultar historiales y cargar evoluciones.
- Las nuevas colecciones e índices mejoran el rendimiento de las consultas.

### Impacto en datos existentes

- Los DNI de las cuentas demo se reconstruyen automáticamente.
- Los usuarios reales sin DNI **no podrán iniciar sesión** hasta que un administrador les asigne uno. Es la principal consideración operativa de la migración.
- Los turnos viejos sin `patientDni` siguen funcionando; los turnos nuevos ya se crean con DNI. Completar los históricos requeriría una migración específica.

---

## 7. Seguridad y privacidad

- DNI y teléfono se guardan cifrados con AES-GCM.
- El DNI no se indexa en claro: se indexa su HMAC.
- El hash usa `SESSION_SECRET`, por lo que no es portable entre entornos.
- Se mantienen:
  - Bloqueo temporal tras 5 intentos fallidos.
  - Rate limiting en login, registro, reservas y solicitudes.
  - 2FA obligatorio para admin y médicos.
  - Auditoría de login, registro, reclamo de cuenta, turnos, solicitudes y evoluciones.
- El historial clínico tiene control por rol:
  - Paciente: solo el propio.
  - Médico: solo pacientes de su agenda.
  - Recepción/admin: acceso de consulta.
  - Evoluciones: solo admin/médico.
- Los campos clínicos (`reason`, `diagnosis`, `treatment`, `notes`) se guardan cifrados.

---

## 8. Pruebas realizadas

Se ejecutaron pruebas reales contra el servidor de desarrollo y la base PostgreSQL:

| Prueba | Resultado |
|---|---|
| Login de paciente demo con DNI `35678910` | ✅ |
| El usuario devuelto incluye `dni: "35678910"` | ✅ |
| Login de recepción con DNI `30111222` | ✅ |
| Solicitud de WhatsApp con DNI crea ficha sin cuenta | ✅ |
| Login de ficha sin cuenta pide registrarse | ✅ |
| Registro con el mismo DNI reclama la ficha (`claimedHistory: true`) | ✅ |
| Se conserva el mismo `patientId` | ✅ |
| Login posterior con DNI | ✅ |
| El historial incluye la solicitud de WhatsApp | ✅ |
| Reserva de turno con DNI | ✅ |
| El turno aparece en el historial con su DNI | ✅ |
| Recepción puede consultar el historial | ✅ |
| Recepción reserva desde una solicitud y el turno queda ligado al DNI | ✅ |
| Recepción no puede asociar el turno a su propia cuenta | ✅ |
| `npx next build` | ✅ Compila sin errores |

Los datos de prueba creados durante la verificación fueron eliminados al finalizar.

### 8.1 Prueba automática

Se agregó el script `tests/verify-dni-flow.mjs` y el comando `npm run test:dni`.

```powershell
# terminal 1
npm run dev

# terminal 2
npm run test:dni
```

Qué comprueba (63 verificaciones):

- Salud de la API.
- Login de paciente y recepción con DNI; bloqueo de email para esos roles.
- Login de admin/médico con email y exigencia de 2FA.
- Solicitud de WhatsApp que crea una ficha sin cuenta y reutiliza el paciente.
- Bloqueo de login hasta reclamar la ficha.
- Registro con el mismo DNI y `claimedHistory: true`.
- Conservación del `patientId`, unicidad de DNI y email.
- Validaciones de contraseña y DNI.
- Historial con turnos, solicitudes y contador.
- Aislamiento: un paciente no puede leer el historial de otro.
- Reserva de turno usando un horario realmente disponible.
- Prevención de suplantación al reservar con otro DNI.
- Turno visible en el historial y con su DNI.
- Cancelación propia y bloqueo de cambios de estado no permitidos.
- Acceso de recepción al historial y a la bandeja.
- Reserva de recepción usando el DNI del paciente y bloqueo de asociación a la cuenta del personal.
- Badge de cuenta pendiente/activa antes y después del reclamo.
- Honeypot y rate limit de solicitudes.

El informe completo de ejecución está en `docs/Ejecucion_Plan_Pruebas_DNI_Historial.md`.

Al terminar, el script elimina el paciente de prueba y sus turnos/solicitudes/evoluciones. Para conservar los datos y probar la interfaz:

```powershell
npm run test:dni -- --keep
```

Para usar otro puerto:

```powershell
$env:TEST_BASE_URL='http://localhost:3010'; npm run test:dni
```

### 8.2 Checklist manual

**Público / paciente**

1. Abrir la web y el botón **Ayuda** → **Solicitar turno sin cuenta**.
2. Completar con un DNI nuevo y enviar. Debe abrir WhatsApp con el mensaje y guardar la solicitud.
3. Ir a **Ingresar** → pestaña **Paciente**. Intentar entrar con ese DNI: debe pedir registrarse.
4. Registrarse con el mismo DNI (sin email). Debe aparecer el mensaje de historial vinculado.
5. Ver **Historial clínico**: debe mostrar la solicitud de WhatsApp y el estado de cuenta activa.
6. Reservar un turno: el DNI debe aparecer bloqueado con el de la cuenta.
7. Cerrar sesión y volver a entrar con DNI + contraseña.

**Recepción**

1. Ingresar con DNI `30111222` / `Recepcion@2025!`.
2. Abrir **Solicitudes**: la solicitud de prueba debe mostrar el badge **Cuenta pendiente** antes del registro y permitir **Historial**.
3. Abrir **Agenda** → un turno → verificar que se muestra el DNI y el botón **Historial**.

**Médico**

1. Ingresar con `dr.rossi@clinicabuenasalud.com` / `Doctor@2025!` y completar 2FA.
2. Abrir un turno propio → **Historial clínico**.
3. Cargar una **nueva evolución** (motivo, diagnóstico, tratamiento, notas).
4. Confirmar que aparece en la lista y que el paciente la ve al refrescar su historial.

**Admin**

1. Ingresar con `admin@clinicabuenasalud.com` / `Admin@2025!` y 2FA.
2. Verificar acceso a agenda, solicitudes e historial.
3. Confirmar en **Auditoría** los eventos `REGISTER`, `CLAIM_PATIENT_ACCOUNT`, `CREATE_APPOINTMENT` y `CREATE_CLINICAL_RECORD`.

---

## 9. Qué mejoró

| Antes | Después |
|---|---|
| Paciente identificado por email | Paciente identificado por DNI |
| Pacientes sin email no podían registrarse | Pueden registrarse solo con DNI |
| Solicitudes de WhatsApp aisladas | Vinculadas a una ficha e historial |
| Fichas duplicadas por email/teléfono | Unicidad por DNI |
| Sin historial para el paciente | Historial con turnos, solicitudes y evoluciones |
| Médico sin registro de evolución | Formulario de evolución clínica |
| Recepción buscaba por email | Ingresa y busca por DNI |
| Datos sensibles sin trazabilidad clínica | Historial auditado y cifrado |

Beneficios concretos:

- **Menos fricción:** el DNI es un dato que el paciente siempre tiene.
- **Menos duplicados:** el DNI es único.
- **Continuidad:** el historial sobrevive al registro posterior.
- **Mejor atención:** recepción y médico ven el contexto del paciente.
- **Trazabilidad:** cada evolución queda asociada a un turno, un médico y una fecha.
- **Rendimiento:** índices específicos para historial, agenda y solicitudes.

---

## 10. Limitaciones y próximos pasos

1. **Usuarios reales sin DNI:** definir un proceso administrativo para asignarles DNI antes de exigir el nuevo login.
2. **Edición de evoluciones:** hoy se pueden crear y listar, pero no editar ni eliminar.
3. **Adjuntos:** el historial no soporta archivos/estudios.
4. **Consentimiento:** si el historial se expone a terceros, conviene registrar consentimiento informado.
5. **Verificación de DNI:** actualmente se valida formato (mínimo 6 dígitos), no existencia real.
6. **Commit:** los cambios están en el working tree, sin commitear.

---

## 11. Credenciales demo

| Rol | Usuario | Contraseña |
|---|---|---|
| Paciente | DNI `35678910` | `Paciente@2025!` |
| Recepción | DNI `30111222` | `Recepcion@2025!` |
| Médico | `dr.rossi@clinicabuenasalud.com` | `Doctor@2025!` (2FA obligatorio) |
| Admin | `admin@clinicabuenasalud.com` | `Admin@2025!` (2FA obligatorio) |

Los pacientes del seed tienen DNI generados como `3` + `5000000 + (i * 13)` (por ejemplo, paciente 1: `35000000`).

---

## 12. Archivos modificados

```
README.md
memory/test_credentials.md          (ignorado por git)
package.json                        (script test:dni)
app/api/[[...path]]/route.js
app/page.js
components/clinical-history.jsx     (nuevo)
components/whatsapp-inbox.jsx
docs/Cambios_DNI_e_Historial_Clinico.md       (nuevo)
docs/Ejecucion_Plan_Pruebas_DNI_Historial.md  (nuevo)
lib/postgres.js
lib/security.js
tests/verify-dni-flow.mjs                     (nuevo)
```



## prueba manual en la web
## Como paciente
1. Abrí la web → botón Ayuda → Solicitar turno sin cuenta.
2. Usá un DNI nuevo y enviá la solicitud.
3. Andá a Ingresar → pestaña Paciente e intentá entrar con ese DNI: debe pedirte registrarte.
4. Registrate con el mismo DNI (podés omitir el email).
5. Debe aparecer el mensaje de historial vinculado.
6. Entrá a Historial clínico: tiene que mostrar la solicitud de WhatsApp.
7. Reservá un turno: el DNI debe aparecer bloqueado con el de tu cuenta.
8. Cerrá sesión y volvé a entrar con DNI + contraseña.
## Como recepción
1. Ingresá con DNI 30111222 / Recepcion@2025!.
2. En Solicitudes, la ficha de prueba debe mostrar “Cuenta pendiente” y el botón Historial.
3. En Agenda → abrí un turno: debe mostrar el DNI y el botón Historial.
## Como médico
1. Ingresá con dr.rossi@clinicabuenasalud.com / Doctor@2025! y completá 2FA.
2. Abrí un turno propio → Historial clínico.
3. Cargá una nueva evolución.
4. Verificá que aparezca en la lista y que el paciente la vea.
## Como admin
1. Ingresá con admin@clinicabuenasalud.com / Admin@2025! y 2FA.
2. Revisá agenda, solicitudes e historial.
3. En Auditoría deberían figurar eventos como REGISTER, CLAIM_PATIENT_ACCOUNT y CREATE_CLINICAL_RECORD.