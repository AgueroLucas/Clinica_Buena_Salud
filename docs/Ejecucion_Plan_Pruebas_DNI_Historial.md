# Ejecución del plan de pruebas: DNI + historial clínico

**Proyecto:** Clínica Buena Salud
**Fecha de ejecución:** 28/10/2026
**Responsable:** Agente de desarrollo
**Estado:** **APROBADO a nivel API y build**. La reserva desde recepción se validó en navegador; quedan 8 validaciones manuales de interfaz pendientes.
**Cambios:** sin commitear al momento de este informe.

---

## 1. Alcance

Se validaron los cambios de:

- Login de pacientes y recepción con **DNI + contraseña**.
- Login de admin/médicos con **email + 2FA**.
- Registro de pacientes con **DNI obligatorio** y email opcional.
- Reclamo de fichas creadas desde WhatsApp/recepción.
- Solicitudes de WhatsApp con DNI y creación/vinculación de paciente.
- Reserva de turnos asociada a DNI.
- Historial clínico: turnos, solicitudes y evoluciones.
- Permisos por rol y aislamiento entre pacientes.
- Migración de DNI en cuentas demo.
- Índices y reglas de unicidad.

**Fuera de alcance de la ejecución automática:** validación visual en navegador y flujo completo de 2FA de admin/médico (requiere TOTP).

---

## 2. Ambiente de pruebas

| Elemento | Valor |
|---|---|
| Sistema operativo | Windows (`win32`) |
| Node.js | v24.14.0 |
| Framework | Next.js 15.5.18 |
| Base de datos | PostgreSQL (configurada en `.env.local`) |
| Servidor | `npm run dev` → `http://localhost:3000` |
| Fecha/hora | 2026-10-28 18:46 UTC |
| Datos | Seed demo + datos temporales creados y eliminados por la prueba |

---

## 3. Estrategia

| Nivel | Herramienta | Estado |
|---|---|---|
| API / integración | `tests/verify-dni-flow.mjs` (`npm run test:dni`) | Ejecutado |
| Build de producción | `npx next build` | Ejecutado |
| Interfaz / navegador | Checklist manual | Pendiente |

**Criterio de aprobación:** 100 % de los casos críticos automatizados en verde y build sin errores. Cualquier fallo de autenticación, unicidad de DNI, reclamo o permisos bloquea la aprobación.

---

## 4. Resumen de resultados

| Suite | Casos | OK | Fallidos |
|---|---:|---:|---:|
| A. Preparación | 1 | 1 | 0 |
| B. Autenticación | 10 | 10 | 0 |
| C. WhatsApp y ficha por DNI | 6 | 6 | 0 |
| D. Registro y reclamo | 9 | 9 | 0 |
| E. Turnos y DNI | 15 | 15 | 0 |
| F. Historial y permisos | 12 | 12 | 0 |
| G. Bandeja de solicitudes | 7 | 7 | 0 |
| H. Migración y datos | 3 | 3 | 0 |
| **Total automatizado** | **63** | **63** | **0** |
| Build de producción | 1 | 1 | 0 |
| Manual UI | 9 | 1 | 0 (8 pendientes) |

**Resultado automatizado:** `RESUMEN: 63 OK, 0 fallido(s)`.
**Resultado del build:** `✓ Compiled successfully in 4.1s`.

---

## 5. Defectos encontrados y corregidos durante la ejecución

| ID | Hallazgo | Impacto | Corrección | Re-prueba |
|---|---|---|---|---|
| DEF-01 | El backend todavía permitía login con **email** a pacientes y recepción | Medio: contradecía la política de identidad por DNI | `handleLogin` rechaza email para roles `patient` y `reception` | B09, B10 |
| DEF-02 | La bandeja seguía mostrando **“Cuenta pendiente”** después de que el paciente reclamaba la ficha | Bajo/Medio: información desactualizada para recepción | `handleListWhatsAppRequests` calcula `patientHasAccount` al leer, consultando los usuarios por `$in` | C06, G04 |
| DEF-03 | El historial mostraba turnos y evoluciones, pero **no las solicitudes de WhatsApp**, aunque la API ya las devolvía | Bajo: historial incompleto respecto a la documentación | Se agregó la sección “Solicitudes de WhatsApp” y el contador `summary.whatsappRequests` | F12 + build |
| DEF-04 | Al reservar desde recepción, el frontend enviaba el `patientId` del recepcionista y el turno quedaba asociado a la cuenta de recepción | Alto: el turno y su historial apuntaban a la persona equivocada | El asistente solo envía `patientId` cuando el usuario es paciente; el backend ignora `patientId` para el personal y exige DNI, resolviendo la ficha por `dniHash` | E13, E14, E15 + navegador |

No se encontraron fallos en:

- Unicidad de DNI.
- Reclamo de historial.
- Conservación del `patientId`.
- Asociación de turnos al DNI.
- Aislamiento de historial entre pacientes.
- Rate limit de solicitudes.
- Honeypot antispam.

---

## 6. Ejecución detallada

### A. Preparación

| ID | Caso | Resultado |
|---|---|---|
| A01 | La API responde `/api/health` | ✅ OK |

### B. Autenticación

| ID | Caso | Resultado |
|---|---|---|
| B01 | Paciente demo ingresa con DNI `35678910` | ✅ OK |
| B02 | La respuesta devuelve el DNI descifrado | ✅ OK |
| B03 | Recepción ingresa con DNI `30111222` | ✅ OK |
| B04 | Recepción devuelve su DNI | ✅ OK |
| B05 | Paciente del seed ingresa con DNI generado (`35000013`) | ✅ OK |
| B06 | Admin con email exige 2FA | ✅ OK |
| B07 | Médico con email exige 2FA | ✅ OK |
| B08 | DNI inexistente devuelve `401` | ✅ OK |
| B09 | Paciente no puede ingresar con email | ✅ OK |
| B10 | Recepción no puede ingresar con email | ✅ OK |

### C. Solicitudes de WhatsApp y ficha por DNI

| ID | Caso | Resultado |
|---|---|---|
| C01 | Solicitud con DNI crea la ficha del paciente | ✅ OK |
| C02 | La ficha nace sin cuenta (`hasAccount: false`) | ✅ OK |
| C03 | Una segunda solicitud reutiliza el mismo paciente | ✅ OK |
| C04 | Solicitud sin DNI devuelve `400` | ✅ OK |
| C05 | La ficha sin cuenta no puede ingresar (`needsRegistration`) | ✅ OK |
| C06 | La bandeja marca “cuenta pendiente” antes del reclamo | ✅ OK |

### D. Registro y reclamo de historial

| ID | Caso | Resultado |
|---|---|---|
| D01 | Contraseña débil devuelve `400` | ✅ OK |
| D02 | DNI inválido devuelve `400` | ✅ OK |
| D03 | Registro con DNI y sin email (email opcional) | ✅ OK |
| D04 | El registro reclama el historial existente (`claimedHistory: true`) | ✅ OK |
| D05 | Se conserva el mismo `patientId` | ✅ OK |
| D06 | DNI ya registrado devuelve `409` | ✅ OK |
| D07 | Email perteneciente a otra cuenta devuelve `409` | ✅ OK |
| D08 | Contraseña incorrecta devuelve `401` | ✅ OK |
| D09 | Login con el DNI reclamado | ✅ OK |

### E. Turnos y DNI

| ID | Caso | Resultado |
|---|---|---|
| E01 | Existen médicos con agenda | ✅ OK |
| E02 | Paciente reserva un turno con su DNI | ✅ OK |
| E03 | Horario ocupado devuelve `409` | ✅ OK |
| E04 | Reserva sin sesión devuelve `401` | ✅ OK |
| E05 | Horario invertido devuelve `400` | ✅ OK |
| E06 | Paciente no puede reservar con el DNI de otra persona | ✅ OK |
| E07 | El turno conserva el DNI del paciente logueado | ✅ OK |
| E08 | El turno conserva el nombre del paciente logueado | ✅ OK |
| E09 | Recepción reserva para un DNI existente | ✅ OK |
| E10 | El turno de recepción queda ligado al paciente | ✅ OK |
| E13 | Recepción no asocia el turno a su propia cuenta | ✅ OK |
| E14 | El turno conserva al paciente del DNI | ✅ OK |
| E15 | Recepción no puede reservar sin DNI | ✅ OK |
| E11 | Paciente cancela su propio turno | ✅ OK |
| E12 | Paciente no puede marcar su turno como atendido | ✅ OK |

### F. Historial clínico y permisos

| ID | Caso | Resultado |
|---|---|---|
| F01 | Paciente accede a su historial | ✅ OK |
| F02 | Incluye las solicitudes de WhatsApp | ✅ OK |
| F03 | Incluye los turnos | ✅ OK |
| F04 | Incluye el turno cancelado | ✅ OK |
| F05 | Marca la cuenta como activa | ✅ OK |
| F06 | Los turnos conservan el DNI | ✅ OK |
| F07 | Un paciente no puede leer el historial de otro | ✅ OK |
| F08 | Recepción consulta el historial | ✅ OK |
| F09 | Paciente no puede crear evoluciones | ✅ OK |
| F10 | Recepción no puede crear evoluciones | ✅ OK |
| F11 | Sin sesión no se pueden crear evoluciones | ✅ OK |
| F12 | El resumen cuenta las solicitudes de WhatsApp | ✅ OK |

### G. Bandeja de solicitudes

| ID | Caso | Resultado |
|---|---|---|
| G01 | Paciente no puede listar solicitudes | ✅ OK |
| G02 | Recepción lista solicitudes | ✅ OK |
| G03 | Las solicitudes quedan ligadas al paciente | ✅ OK |
| G04 | La bandeja refleja la cuenta activa después del reclamo | ✅ OK |
| G05 | El honeypot responde OK sin guardar | ✅ OK |
| G06 | El honeypot no crea registros | ✅ OK |
| G07 | Rate limit: 5 solicitudes permitidas y la 6.ª devuelve `429` | ✅ OK |

### H. Migración y datos existentes

| ID | Caso | Resultado |
|---|---|---|
| H01 | Las cuentas demo tienen DNI reconstruido | ✅ OK |
| H02 | La cuenta reclamada tiene `dniHash` y DNI | ✅ OK |
| H03 | La ficha sin cuenta no expone contraseña | ✅ OK |

---

## 7. Evidencia de ejecución

Comando:

```powershell
npm run dev
# en otra terminal
npm run test:dni
```

Salida resumida:

```text
PLAN DE PRUEBAS: DNI + HISTORIAL CLÍNICO
Entorno: http://localhost:3000
Node: v24.14.0 | Fecha: 2026-10-28T18:46:23.867Z

A. Preparación .......................... 1 OK
B. Autenticación ....................... 10 OK
C. WhatsApp y ficha por DNI ............ 6 OK
D. Registro y reclamo .................. 9 OK
E. Turnos y DNI ........................ 15 OK
F. Historial y permisos ................ 12 OK
G. Bandeja de solicitudes .............. 7 OK
H. Migración y datos ................... 3 OK

Limpieza: 2 usuario(s), 4 turno(s), 7 solicitud(es) y 0 evolución(es) eliminados.
RESUMEN: 63 OK, 0 fallido(s)
```

Build:

```text
✓ Compiled successfully in 4.1s
✓ Generating static pages (4/4)
```

Limpieza de datos: la prueba eliminó sus propios usuarios, turnos y solicitudes. Los registros de **auditoría** se conservan por diseño.

---

## 8. Casos manuales

Estos casos requieren navegador. El build y los endpoints asociados están verificados; M09 se validó con un navegador automatizado (Playwright + Chrome).

| ID | Caso | Pasos | Estado |
|---|---|---|---|
| M01 | Login con pestañas DNI/email | Abrir **Ingresar**; verificar DNI en Paciente/Recepción y email en Médico/Admin | ⏳ Pendiente |
| M02 | Registro con reclamo visible | Registrarse con un DNI que tenga solicitud; verificar toast de historial vinculado | ⏳ Pendiente |
| M03 | Historial del paciente en UI | Verificar resumen, turnos, **solicitudes de WhatsApp** y evoluciones | ⏳ Pendiente |
| M04 | Reserva con DNI bloqueado | Paciente logueado: el campo DNI debe estar precargado y no editable | ⏳ Pendiente |
| M05 | Bandeja de recepción | Ver badge “Cuenta pendiente” antes del reclamo y “Cuenta activa” después | ⏳ Pendiente |
| M06 | Historial desde agenda | Recepción/admin abre un turno → **Historial** | ⏳ Pendiente |
| M07 | Evolución del médico | Médico con 2FA abre un turno → carga una evolución → el paciente la ve | ⏳ Pendiente |
| M08 | Auditoría | Admin verifica eventos `REGISTER`, `CLAIM_PATIENT_ACCOUNT`, `CREATE_APPOINTMENT` | ⏳ Pendiente |
| M09 | Reserva desde una solicitud de WhatsApp | Recepción → **Solicitudes** → **Reservar turno** → elegir médico/horario → confirmar. Verificar que el turno queda ligado al DNI del paciente, no a recepción, y que la solicitud pasa a **Contactada** | ✅ Validado |

> M07 es el único caso funcional importante no cubierto por la suite automática, porque requiere completar el alta de 2FA de un médico.

---

## 9. Observaciones y riesgos

1. **Usuarios reales sin DNI:** no podrán iniciar sesión hasta que se les asigne un DNI. Es un riesgo operativo de la migración, no un defecto de código.
2. **2FA de médicos/admins:** la suite verifica que el login exige 2FA, pero no completa el circuito TOTP ni crea evoluciones con un médico real.
3. **Validación visual:** se validó en navegador la reserva desde recepción (M09); los 8 casos restantes quedan para el visto bueno final.
4. **Rate limit en memoria:** es por proceso. En un despliegue con varias instancias, cada instancia lleva su propio contador (comportamiento preexistente).
5. **Datos de auditoría:** los tests dejan eventos de auditoría aunque limpian los datos operativos. Si se necesita una base completamente limpia, regenerar el seed.
6. **Índice único de email:** en bases existentes puede permanecer el índice viejo. PostgreSQL permite múltiples `NULL`, por lo que el email opcional sigue funcionando.
7. **Cambios sin commit:** todo el trabajo está en el working tree.

---

## 10. Conclusión

- **API e integración:** 63/63 casos aprobados.
- **Build de producción:** aprobado.
- **Defectos detectados:** 4, todos corregidos y re-probados.
- **Interfaz:** reserva desde recepción validada; quedan 8 casos manuales.

**Recomendación:** los cambios están aptos para revisión y commit. Antes de desplegar a producción, ejecutar los 8 casos manuales restantes, especialmente M03 (historial con solicitudes), M05 (badge de cuenta) y M07 (evolución del médico).

---

## 11. Anexo: comandos útiles

```powershell
# Ejecutar la suite completa (limpia sus datos al final)
npm run dev
npm run test:dni

# Conservar los datos de prueba para revisar la UI
npm run test:dni -- --keep

# Probar contra otro puerto
$env:TEST_BASE_URL='http://localhost:3010'; npm run test:dni

# Build de producción
npx next build
```
