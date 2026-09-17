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

Tambien se puede comprobar el estado de la API:

```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/health
```

## Usuarios demo

Las credenciales de demostracion se encuentran en `memory/test_credentials.md`. Cambialas antes de usar la aplicacion fuera de desarrollo.

## Detener y reiniciar

Pulsa `Ctrl+C` en la terminal donde corre Next.js. Los datos quedan guardados en PostgreSQL y se reutilizan al volver a iniciar.

## Estructura de persistencia

La API mantiene sus rutas existentes, pero `lib/postgres.js` reemplaza la conexion MongoDB por PostgreSQL. Los documentos se almacenan como `jsonb` en una tabla relacional con indices unicos para usuarios y turnos. Los identificadores son UUID.
