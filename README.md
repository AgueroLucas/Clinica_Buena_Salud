# Clinica Buena Salud

Aplicacion de turnos construida con Next.js y PostgreSQL. La base puede estar en Neon o en cualquier servidor PostgreSQL compatible.

## Requisitos

- Node.js 20 o superior
- Corepack, incluido con Node.js

En Windows se puede comprobar el entorno con:

```powershell
node --version
corepack --version
```

## Instalacion

Desde la carpeta del proyecto:

```powershell
corepack yarn install --frozen-lockfile
```

La aplicacion usa el cliente `pg` y crea automaticamente la tabla de persistencia en la base indicada por `DATABASE_URL`.

## Variables de entorno

Crea `.env.local` en la raiz del proyecto. Para desarrollo local puedes copiar `env.example` y usar esta configuracion minima:

```env
DATABASE_URL=postgresql://usuario:contraseña@host/base?sslmode=require
NEXT_PUBLIC_BASE_URL=http://localhost:3000
CORS_ORIGINS=*
SESSION_SECRET=pon-aqui-un-secreto-largo
ENCRYPTION_KEY=pon-aqui-una-clave-hexadecimal-de-64-caracteres
```

`DATABASE_URL` debe ser privada. No la subas al repositorio ni la compartas en el chat.

### Variables de seguridad y anti-bot

| Variable | Ambito | Descripcion |
| --- | --- | --- |
| `SESSION_SECRET` | servidor | Firma los tokens de sesion. Obligatoria en produccion. |
| `ENCRYPTION_KEY` | servidor | Clave AES-GCM (32 bytes en hex) para cifrar datos sensibles (telefono, DNI, etc.). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | cliente | Site key publica de Cloudflare Turnstile. Se usa para renderizar el widget CAPTCHA en la reserva de turnos. |
| `TURNSTILE_SECRET_KEY` | servidor | Secret key de Turnstile. El servidor la usa para validar el token del CAPTCHA (`siteverify`). |
| `SEED_SECRET` | servidor | Clave opcional para permitir `POST /api/seed?force=1` mediante el header `X-Seed-Secret`. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | cliente | Numero de WhatsApp de la clinica, formato internacional y solo digitos (ej: `5491155555555`). Se usa en el centro de ayuda y en la bandeja de solicitudes. |
| `NEXT_PUBLIC_CLINIC_PHONE` | cliente | Telefono que se muestra en el boton "Llamar" del centro de ayuda. |
| `WHATSAPP_NUMBER` | servidor | Opcional. Numero que usa la API para armar el link de WhatsApp. Si esta vacio, toma `NEXT_PUBLIC_WHATSAPP_NUMBER`. |

**Reserva de turnos (anti-bot):** desde el endurecimiento de seguridad, `POST /api/appointments` exige una sesion autenticada (paciente, recepcion o admin). Ademas, si `TURNSTILE_SECRET_KEY` y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` estan configuradas, se exige un token valido de Turnstile. Si se dejan vacias, el CAPTCHA no bloquea (pensado solo para desarrollo).

Como obtener las claves de Turnstile: crea un sitio en <https://dash.cloudflare.com/> (seccion Turnstile) y copia la *Site Key* y la *Secret Key*. Para pruebas, Cloudflare ofrece claves de test que siempre aprueban (ver documentacion de Turnstile).

**Proteccion del seed:** `POST /api/seed` (sin `force`) es publico y solo carga datos si la base esta vacia. `POST /api/seed?force=1` borra y recarga todo, por lo que con datos existentes exige una sesion de administrador valida (con 2FA) o el header `X-Seed-Secret` igual a `SEED_SECRET`. En una base vacia el bootstrap inicial sigue siendo publico.

```powershell
# Forzar recarga usando el secreto (util en scripts/CI)
Invoke-WebRequest -Method POST -Uri 'http://localhost:3000/api/seed?force=1' -Headers @{ 'X-Seed-Secret' = 'tu-seed-secret' }
```

## Levantar la web

En Windows, ejecuta:

```powershell
corepack yarn dev:no-reload
```

Abre:

```text
http://localhost:3000
```

El script `dev:no-reload` es el recomendado en Windows porque evita la sintaxis de variables de entorno de Unix usada por el script `dev`.

## Preparar la base de datos y datos demo

Con la web levantada, ejecuta una segunda terminal PowerShell:

```powershell
Invoke-WebRequest -Method POST -Uri http://localhost:3000/api/seed
```

Esto crea las tablas logicas y carga especialidades, sedes, medicos, usuarios y turnos de demostracion. Para volver a cargar todo desde cero:

```powershell
Invoke-WebRequest -Method POST -Uri 'http://localhost:3000/api/seed?force=1'
```

El reciclado (`force=1`) borra los datos existentes, por lo que requiere sesion de administrador o el header `X-Seed-Secret` (ver *Variables de seguridad y anti-bot*). En una base vacia la carga inicial no requiere credenciales.

Tambien se puede comprobar el estado de la API:

```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/health
```

## Usuarios demo

Las credenciales de demostracion se encuentran en `memory/test_credentials.md`. Cambialas antes de usar la aplicacion fuera de desarrollo.

### Acceso con DNI

- **Pacientes y recepcion** inician sesion con **DNI + contraseña**. El DNI es el identificador unico del paciente (no el email).
- **Medicos y administradores** siguen ingresando con email + contraseña y 2FA obligatorio.
- Al crear una cuenta de paciente se pide DNI, nombre, contraseña y, opcionalmente, email y telefono.
- Si el DNI ya existe porque la persona dejo una solicitud por WhatsApp, al crear la cuenta se **vincula automaticamente** la ficha y todo el historial de turnos.
- El DNI se guarda cifrado (AES-GCM) y se indexa mediante un hash determinístico (`dniHash`) para mantener la unicidad sin exponer el valor.

### Historial clinico

Cada paciente tiene un historial asociado a su DNI con:

- Todos sus turnos (proximos, atendidos, cancelados).
- Las solicitudes recibidas por WhatsApp.
- Las **evoluciones clinicas** que agrega el medico (motivo, diagnostico, tratamiento y notas).

El paciente lo ve en **Historial clinico** dentro de su portal. Recepcion y admin pueden consultarlo desde la agenda o desde la bandeja de solicitudes, y el medico puede agregar evoluciones desde su agenda diaria.

### Prueba automatica del flujo DNI

Con el servidor de desarrollo corriendo:

```powershell
npm run dev
# en otra terminal
npm run test:dni
```

La prueba verifica login por DNI, creacion de ficha desde WhatsApp, reclamo del historial al registrarse, reserva de turno, aislamiento entre pacientes y acceso de recepcion. Al finalizar borra los datos que genero. Para conservarlos y probar la interfaz manualmente:

```powershell
npm run test:dni -- --keep
```

Para apuntar a otro puerto:

```powershell
$env:TEST_BASE_URL='http://localhost:3010'; npm run test:dni
```

El informe completo de la ultima ejecucion (63 casos automatizados) esta en `docs/Ejecucion_Plan_Pruebas_DNI_Historial.md`.

## Centro de ayuda y solicitudes de turno

En la esquina inferior derecha de la pagina publica hay un boton **Ayuda**. Abre un panel con:

- **Reservar turno online**: lleva al registro/login existente (la reserva online sigue requiriendo cuenta).
- **Solicitar turno sin cuenta**: formulario corto (nombre, **DNI**, telefono, especialidad, sede y preferencia). El pedido se guarda en `whatsapp_requests`, crea/vincula la ficha del paciente por DNI y aparece en **Solicitudes** para admin y recepcion. Luego el paciente puede crear su cuenta con ese mismo DNI para acceder a su historial.
- Recepcion puede reservar el turno directamente desde cada solicitud con **Reservar turno**: abre el asistente con el paciente, la especialidad y la sede precargados. Al confirmar, el turno se vincula al DNI y la solicitud pasa a **Contactada**. Tambien hay un acceso **Reservar** en el menu para cargar un turno manualmente.
- **Escribir por WhatsApp**: abre `wa.me` con un mensaje precargado. El visitante debe pulsar *Enviar* en WhatsApp; no se envia automaticamente.
- **Llamar a la clinica**: abre el marcador del telefono.
- **Preguntas frecuentes**: turnos, sedes, cancelaciones, coberturas y urgencias.

Las solicitudes se pueden marcar como **Nueva**, **Contactada** o **Cerrada** desde la bandeja de admin/recepcion. El telefono, la preferencia y la consulta se guardan cifrados (AES-GCM) y se descifran solo para el personal autorizado.

La ruta publica `POST /api/whatsapp-requests` tiene un limite de 5 solicitudes cada 10 minutos por IP y un campo honeypot anti-bot. No usa Turnstile para no agregar friccion al visitante; si mas adelante hace falta, se puede sumar.

**Envio automatico:** el flujo actual es *click-to-chat* (el visitante envia desde su WhatsApp). Para que el servidor envie mensajes sin intervencion del usuario hace falta integrar la WhatsApp Cloud API de Meta (o Twilio) con un numero verificado y sus credenciales. La bandeja y el modelo de datos ya quedan preparados para esa integracion.

El numero configurado en `.env.local` (`NEXT_PUBLIC_WHATSAPP_NUMBER`) es el que recibe los mensajes del centro de ayuda y de la bandeja. Si lo cambias, reinicia el servidor para que Next.js vuelva a compilar el valor publico. `NEXT_PUBLIC_CLINIC_PHONE` controla el telefono que muestra el boton **Llamar**.

## Pruebas automatizadas

Con la web levantada (`http://localhost:3000`) y el entorno de Python con `requests` instalado:

```powershell
python backend_test.py
python backend_test_2h_rule.py
python security_test.py
python security_test_final.py
```

Variables opcionales para las pruebas:

| Variable | Descripcion |
| --- | --- |
| `TEST_BASE_URL` | URL base de la API. Por defecto `http://localhost:3000/api`. |
| `TEST_SEED_SECRET` | Si se define, `backend_test_2h_rule.py` usa `POST /api/seed?force=1` con el header `X-Seed-Secret`. |

Notas:

- Los endpoints de turnos requieren sesion: las pruebas inician sesion primero (reusando la sesion para no agotar el limite de intentos de login de 5/min por IP). Si ejecutas varias suites seguidas, algunas pueden esperar ~60s por el limite de intentos.
- Las comprobaciones de base de datos hechas con `mongosh` se marcan como **SKIP** porque la persistencia actual es PostgreSQL. Los tests de 2FA usan `pyotp` si esta instalado; si no, un generador TOTP integrado en el propio script.

## Detener y reiniciar

Pulsa `Ctrl+C` en la terminal donde corre Next.js. Los datos quedan guardados en PostgreSQL y se reutilizan al volver a iniciar.

## Estructura de persistencia

La API mantiene sus rutas existentes, pero `lib/postgres.js` reemplaza la conexion MongoDB por PostgreSQL. Los documentos se almacenan como `jsonb` en una tabla relacional con indices unicos para usuarios y turnos. Los identificadores son UUID.
