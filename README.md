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
